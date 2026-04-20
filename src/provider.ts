import * as vscode from "vscode";
import type {
  StreamResponse,
  ProxyModelList,
  ModelInfo,
  ChatRequest,
} from "./types";
import { convertMessages, convertTools } from "./utils";

import {
  CancellationToken,
  LanguageModelChatInformation,
  LanguageModelChatProvider,
  ProvideLanguageModelChatResponseOptions,
  LanguageModelResponsePart,
  Progress,
  PrepareLanguageModelChatModelOptions,
  EventEmitter,
  Event,
} from "vscode";

const DEFAULT_MAX_INPUT_TOKENS = 128000;
const DEFAULT_MAX_OUTPUT_TOKENS = 8192;
const MODELS_CACHE_TTL_MS = 60_000;
const EMA_ALPHA = 0.3;
const MIN_SAMPLES_FOR_LEARNING = 3;

interface ModelsCache {
  models: ModelInfo[];
  fetchedAt: number;
}

export interface TokenUsage {
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
}

interface TokenRatio {
  /** tokens per character (learned from actual API usage) */
  ratio: number;
  /** number of samples collected */
  samples: number;
}

export class ProxyChatModelProvider implements LanguageModelChatProvider {
  private _modelsCache: ModelsCache | null = null;
  private _hasShownNoKeyNotification = false;
  private _lastUsage = new Map<string, TokenUsage>();
  private _tokenRatios = new Map<string, TokenRatio>();
  private _requestCounter = 0;


  private readonly _onDidChangeLanguageModelChatInformation =
    new EventEmitter<void>();

  readonly onDidChangeLanguageModelChatInformation: Event<void> =
    this._onDidChangeLanguageModelChatInformation.event;

  fireModelInfoChanged(): void {
    this._modelsCache = null;
    this._hasShownNoKeyNotification = false; // Reset so user sees notification again next scan
    this._onDidChangeLanguageModelChatInformation.fire();
  }

  private getConfig(): { proxyUrl: string } {
    const cfg = vscode.workspace.getConfiguration("llmapiproxy");
    const proxyUrl = (
      cfg.get<string>("proxyUrl") ?? "http://localhost:8000"
    ).replace(/\/$/, "");
    return { proxyUrl };
  }

  private async getApiKey(silent: boolean): Promise<string | undefined> {
    const key = await this._secrets.get("llmapiproxy.apiKey");
    if (!key && !silent) {
      const entered = await vscode.window.showInputBox({
        title: "LLM API Proxy API Key",
        prompt: "Enter your LLM API Proxy API key",
        ignoreFocusOut: true,
        password: true,
        placeHolder: "Enter your proxy API key...",
      });
      if (entered?.trim()) {
        await this._secrets.store("llmapiproxy.apiKey", entered.trim());
        return entered.trim();
      }
      return undefined;
    }
    return key;
  }

  private async fetchModels(
    proxyUrl: string,
    apiKey: string,
  ): Promise<ModelInfo[]> {
    const response = await fetch(`${proxyUrl}/v1/models`, {
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
    });

    if (!response.ok) {
      throw new Error(
        `Failed to fetch models: ${response.status} ${response.statusText}`,
      );
    }

    const data = (await response.json()) as ProxyModelList;
    // Deduplicate models by ID (safety net in case proxy returns duplicates)
    const seen = new Set<string>();
    return (data.data ?? [])
      .filter((m) => {
        if (seen.has(m.id)) return false;
        seen.add(m.id);
        return true;
      })
      .map((m) => {
        const backends = m.available_backends ?? [];
        const routingStrategy = m.routing_strategy;
        return {
          id: m.id,
          displayName: m.display_name ? m.display_name : m.id,
          backends,
          routingStrategy,
          contextLength: m.context_length,
          maxOutputTokens: m.max_output_tokens,
          supportsVision: m.capabilities?.includes("vision") ?? false,
        };
      });
  }

  private async getModels(silent: boolean): Promise<ModelInfo[]> {
    const now = Date.now();
    if (
      this._modelsCache &&
      now - this._modelsCache.fetchedAt < MODELS_CACHE_TTL_MS
    ) {
      return this._modelsCache.models;
    }

    const apiKey = await this.getApiKey(silent);
    if (!apiKey) {
      if (silent && !this._hasShownNoKeyNotification) {
        this._hasShownNoKeyNotification = true;
        vscode.window
          .showInformationMessage(
            "LLM API Proxy: No API key configured. Models will not be available.",
            "Configure",
          )
          .then((choice) => {
            if (choice === "Configure") {
              vscode.commands.executeCommand("llmapiproxy.manage");
            }
          });
      }
      return [];
    }

    const { proxyUrl } = this.getConfig();
    try {
      const models = await this.fetchModels(proxyUrl, apiKey);
      this._modelsCache = { models, fetchedAt: now };
      this._hasShownNoKeyNotification = false; // key works — reset so we notify again if it's later removed
      return models;
    } catch (err) {
      console.error("[LLM Proxy] Failed to fetch models:", err);
      if (!silent) {
        vscode.window.showErrorMessage(
          `LLM API Proxy: Failed to fetch models from ${proxyUrl}. Check your proxy URL and API key.`,
        );
      }
      return this._modelsCache?.models ?? [];
    }
  }



  /**
   * Strip VS Code-injected XML context blocks (e.g. <environment_info>…</environment_info>)
   * from a string, then return the remaining trimmed text.
   */
  private stripInjectedBlocks(text: string): string {
    // Remove complete XML-tag blocks that VS Code injects as context
    return text
      .replace(
        /<[A-Za-z_][A-Za-z0-9_-]*[^>]*>[\s\S]*?<\/[A-Za-z_][A-Za-z0-9_-]*>/g,
        "",
      )
      .trim();
  }

  /**
   * Extract all text content from a single LanguageModelChatMessage,
   * stripping injected XML blocks, joined into one string.
   */
  private extractMessageText(msg: vscode.LanguageModelChatMessage): string {
    const parts: string[] = [];
    for (const part of msg.content) {
      if (part instanceof vscode.LanguageModelTextPart) {
        parts.push(part.value);
      } else if (
        typeof part === "object" &&
        part !== null &&
        "value" in part &&
        typeof (part as { value: unknown }).value === "string"
      ) {
        parts.push((part as { value: string }).value);
      }
    }
    return this.stripInjectedBlocks(parts.join(" "));
  }



  /**
   * Extract the actual text content from a chat message, ignoring JSON structure.
   * This avoids the massive overestimation that JSON.stringify causes.
   */
  private extractTextLength(
    text: string | vscode.LanguageModelChatRequestMessage,
  ): number {
    if (typeof text === "string") {
      return text.length;
    }
    // LanguageModelChatRequestMessage — sum text from content parts only
    let len = 0;
    for (const part of text.content) {
      if (part instanceof vscode.LanguageModelTextPart) {
        len += part.value.length;
      } else if (
        typeof part === "object" &&
        part !== null &&
        "value" in part &&
        typeof (part as { value: unknown }).value === "string"
      ) {
        len += (part as { value: string }).value.length;
      }
    }
    // Fallback: if no text parts found at all, use JSON length as last resort
    return len > 0 ? len : JSON.stringify(text).length;
  }

  async provideTokenCount(
    model: LanguageModelChatInformation,
    text: string | vscode.LanguageModelChatRequestMessage,
    _token: CancellationToken,
  ): Promise<number> {
    const charLen = this.extractTextLength(text);
    const learned = this._tokenRatios.get(model.id);
    if (learned && learned.samples >= MIN_SAMPLES_FOR_LEARNING) {
      return Math.ceil(charLen * learned.ratio);
    }
    return Math.ceil(charLen / 4);
  }

  async provideLanguageModelChatInformation(
    options: PrepareLanguageModelChatModelOptions,
    _token: CancellationToken,
  ): Promise<LanguageModelChatInformation[]> {
    const models = await this.getModels(options.silent ?? false);
    return models.map((m) => {
      const maxOutput = m.maxOutputTokens ?? DEFAULT_MAX_OUTPUT_TOKENS;
      const contextWindow = m.contextLength ?? DEFAULT_MAX_INPUT_TOKENS;
      // Use the full context window as maxInputTokens — VS Code's internal
      // compaction algorithm already reserves space for output tokens.
      // Subtracting maxOutput here caused double-reservation and premature
      // compaction (e.g. GPT-4 base: 8192 - 8192 = 1 token max input).
      const maxInput = Math.max(4096, contextWindow);

      // Build detail line showing backend count and routing strategy
      const backendCount = m.backends.length;
      const strategy = m.routingStrategy ?? "priority";
      const detail =
        backendCount > 1
          ? `via LLM Proxy (${backendCount} backends, ${strategy})`
          : backendCount === 1
            ? `via LLM Proxy (${m.backends[0]})`
            : "via LLM API Proxy";

      // Build tooltip with backend list
      const tooltipParts = [`Model: ${m.id}`];
      if (backendCount > 0) {
        tooltipParts.push(`Backends: ${m.backends.join(" → ")} (${strategy})`);
      }

      return {
        id: m.id,
        name: m.displayName,
        detail,
        tooltip: tooltipParts.join("\n"),
        family: "llmapiproxy",
        version: "1.0.0",
        maxInputTokens: maxInput,
        maxOutputTokens: maxOutput,
        capabilities: {
          toolCalling: 128,
          ...(m.supportsVision ? { imageInput: true } : {}),
        },
      };
    });
  }

  async provideLanguageModelChatResponse(
    model: LanguageModelChatInformation,
    messages: readonly vscode.LanguageModelChatMessage[],
    options: ProvideLanguageModelChatResponseOptions,
    progress: Progress<LanguageModelResponsePart>,
    token: CancellationToken,
  ): Promise<void> {
    const apiKey = await this.getApiKey(true);
    if (!apiKey) {
      throw vscode.LanguageModelError.NoPermissions(
        "LLM API Proxy API key not configured. Run 'LLM API Proxy: Manage Connection'.",
      );
    }

    const { proxyUrl } = this.getConfig();
    const abortController = new AbortController();
    const cancelSub = token.onCancellationRequested(() =>
      abortController.abort(),
    );

    try {
      const { tools, tool_choice } = convertTools(options);
      const convertedMessages = convertMessages(messages);

      // Estimate input characters for adaptive ratio learning
      const inputStr = JSON.stringify(convertedMessages);
      const body: ChatRequest = {
        model: model.id,
        messages: convertedMessages,
        stream: true,
        stream_options: { include_usage: true },
        ...(tools && tools.length > 0 ? { tools, tool_choice } : {}),
      };

      const response = await fetch(`${proxyUrl}/v1/chat/completions`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${apiKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(body),
        signal: abortController.signal,
      });

      if (!response.ok) {
        const errText = await response.text().catch(() => "");
        const msg = `LLM API Proxy error: ${response.status} ${response.statusText}${errText ? `\n${errText}` : ""}`;
        if (response.status === 401 || response.status === 403) {
          throw vscode.LanguageModelError.NoPermissions(msg);
        }
        if (response.status === 404) {
          throw vscode.LanguageModelError.NotFound(msg);
        }
        if (response.status === 429) {
          throw vscode.LanguageModelError.Blocked(msg);
        }
        throw new Error(msg);
      }

      if (!response.body) {
        throw new Error("LLM API Proxy: response body is empty");
      }

      const usage = await this.processStream(response.body, progress, token);

      if (usage) {
        this._lastUsage.set(model.id, usage);
        this._requestCounter++;
        // Console log (always)
        console.log(
          `[LLM Proxy] ${model.id}: prompt=${usage.promptTokens} completion=${usage.completionTokens} total=${usage.totalTokens}`,
        );

        // Update adaptive token ratio
        if (usage.promptTokens > 0 && inputStr.length > 0) {
          const sampleRatio = usage.promptTokens / inputStr.length;
          const existing = this._tokenRatios.get(model.id);
          if (existing) {
            existing.ratio =
              EMA_ALPHA * sampleRatio + (1 - EMA_ALPHA) * existing.ratio;
            existing.samples++;
          } else {
            this._tokenRatios.set(model.id, {
              ratio: sampleRatio,
              samples: 1,
            });
          }
        }
      }
    } finally {
      cancelSub.dispose();
    }
  }

  private async processStream(
    body: ReadableStream<Uint8Array>,
    progress: Progress<LanguageModelResponsePart>,
    token: CancellationToken,
  ): Promise<TokenUsage | null> {
    const reader = body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";
    let capturedUsage: TokenUsage | null = null;

    /** Accumulate streamed tool call deltas by index */
    const toolCallBuffers = new Map<
      number,
      { id?: string; name?: string; args: string }
    >();

    try {
      while (!token.isCancellationRequested) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines.pop() ?? "";

        for (const line of lines) {
          if (!line.startsWith("data: ")) continue;
          const data = line.slice(6).trim();
          if (data === "[DONE]") return capturedUsage;

          let chunk: StreamResponse;
          try {
            chunk = JSON.parse(data) as StreamResponse;
          } catch {
            continue;
          }

          if (!chunk || typeof chunk !== "object") continue;

          // Capture usage from final chunk (sent when stream_options.include_usage is true)
          if (chunk.usage && (chunk.usage.prompt_tokens ?? 0) > 0) {
            capturedUsage = {
              promptTokens: chunk.usage.prompt_tokens ?? 0,
              completionTokens: chunk.usage.completion_tokens ?? 0,
              totalTokens: chunk.usage.total_tokens ?? 0,
            };
          }

          const choices = chunk.choices ?? [];
          for (const choice of choices) {
            const delta = choice?.delta;
            if (!delta) continue;

            if (delta.content) {
              progress.report(new vscode.LanguageModelTextPart(delta.content));
            }

            if (delta.tool_calls) {
              for (const tc of delta.tool_calls) {
                const idx = tc.index ?? 0;
                if (!toolCallBuffers.has(idx)) {
                  toolCallBuffers.set(idx, {
                    id: tc.id,
                    name: tc.function?.name,
                    args: "",
                  });
                }
                const buf = toolCallBuffers.get(idx)!;
                if (tc.id) buf.id = tc.id;
                if (tc.function?.name) buf.name = tc.function.name;
                if (tc.function?.arguments) buf.args += tc.function.arguments;
              }
            }

            if (
              choice.finish_reason === "tool_calls" ||
              choice.finish_reason === "stop"
            ) {
              for (const [, buf] of toolCallBuffers) {
                if (buf.name && buf.id) {
                  let parsedArgs: Record<string, unknown> = {};
                  try {
                    parsedArgs = JSON.parse(buf.args) as Record<
                      string,
                      unknown
                    >;
                  } catch {
                    parsedArgs = {};
                  }
                  progress.report(
                    new vscode.LanguageModelToolCallPart(
                      buf.id,
                      buf.name,
                      parsedArgs,
                    ),
                  );
                }
              }
              toolCallBuffers.clear();
            }
          }
        }
      }
    } finally {
      reader.releaseLock();
    }
    return capturedUsage;
  }

  constructor(private readonly _secrets: vscode.SecretStorage) {}
}
