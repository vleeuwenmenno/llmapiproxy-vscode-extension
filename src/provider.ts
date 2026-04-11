import * as vscode from "vscode";
import type {
  StreamResponse,
  ProxyModelList,
  ModelInfo,
  ChatRequest,
} from "./types";
import {
  convertMessages,
  convertTools,
  makeDisplayName,
  extractBackend,
} from "./utils";
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

interface TokenUsage {
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
  private _statusBarItem: vscode.StatusBarItem | null = null;
  private _outputChannel: vscode.OutputChannel | null = null;
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
        const backendPrefix = extractBackend(m.id);
        return {
          id: m.id,
          displayName: m.display_name
            ? backendPrefix
              ? `${m.display_name} (${backendPrefix})`
              : m.display_name
            : makeDisplayName(m.id),
          backend: backendPrefix,
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

  /** Set the status bar item to update after each request */
  setStatusBarItem(item: vscode.StatusBarItem): void {
    this._statusBarItem = item;
  }

  /** Set the output channel for detailed usage logging */
  setOutputChannel(channel: vscode.OutputChannel): void {
    this._outputChannel = channel;
  }

  /** Extract a short label from the first user message for chat identification */
  private extractChatLabel(
    messages: readonly vscode.LanguageModelChatMessage[],
  ): string {
    for (const msg of messages) {
      if (msg.role === vscode.LanguageModelChatMessageRole.User) {
        const parts =
          typeof (msg as unknown as { content?: unknown }).content === "string"
            ? [(msg as unknown as { content: string }).content]
            : Array.isArray((msg as unknown as { content?: unknown[] }).content)
              ? (
                  (msg as unknown as { content: unknown[] }).content as Array<{
                    type?: string;
                    value?: string;
                    text?: string;
                  }>
                )
                  .filter(
                    (p) =>
                      p.type === "text" ||
                      typeof p.value === "string" ||
                      typeof p.text === "string",
                  )
                  .map((p) => p.value ?? p.text ?? "")
              : [];
        const text = parts.join(" ").trim();
        if (text) {
          // Take first line, truncate to 40 chars
          const firstLine = text.split("\n")[0].trim();
          return firstLine.length > 40
            ? firstLine.slice(0, 37) + "..."
            : firstLine;
        }
      }
    }
    return "(untitled)";
  }

  async provideTokenCount(
    model: LanguageModelChatInformation,
    text: string | vscode.LanguageModelChatRequestMessage,
    _token: CancellationToken,
  ): Promise<number> {
    const str = typeof text === "string" ? text : JSON.stringify(text);
    const learned = this._tokenRatios.get(model.id);
    if (learned && learned.samples >= MIN_SAMPLES_FOR_LEARNING) {
      return Math.ceil(str.length * learned.ratio);
    }
    return Math.ceil(str.length / 4);
  }

  async provideLanguageModelChatInformation(
    options: PrepareLanguageModelChatModelOptions,
    _token: CancellationToken,
  ): Promise<LanguageModelChatInformation[]> {
    const models = await this.getModels(options.silent ?? false);
    return models.map((m) => {
      const maxOutput = m.maxOutputTokens ?? DEFAULT_MAX_OUTPUT_TOKENS;
      const contextWindow = m.contextLength ?? DEFAULT_MAX_INPUT_TOKENS;
      // Leave room for output within the context window
      const maxInput = Math.max(1, contextWindow - maxOutput);
      return {
        id: m.id,
        name: m.displayName,
        detail: m.backend
          ? `via LLM API Proxy (${m.backend})`
          : "via LLM API Proxy",
        tooltip: `Model: ${m.id}`,
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
        const chatLabel = this.extractChatLabel(messages);

        // Console log (always)
        console.log(
          `[LLM Proxy] #${this._requestCounter} "${chatLabel}" | ${model.id}: prompt=${usage.promptTokens} completion=${usage.completionTokens} total=${usage.totalTokens}`,
        );

        // Output channel log (detailed, per-request history)
        if (this._outputChannel) {
          const ts = new Date().toLocaleTimeString();
          this._outputChannel.appendLine(
            [
              `[${ts}] Request #${this._requestCounter}`,
              `  Chat:  ${chatLabel}`,
              `  Model: ${model.id}`,
              `  Prompt:     ${usage.promptTokens.toLocaleString()} tokens`,
              `  Completion: ${usage.completionTokens.toLocaleString()} tokens`,
              `  Total:      ${usage.totalTokens.toLocaleString()}`,
            ].join("\n"),
          );
        }

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

        // Update status bar (shows last request with chat label)
        this.updateStatusBar(model.id, usage, chatLabel);
      }
    } finally {
      cancelSub.dispose();
    }
  }

  private updateStatusBar(
    modelId: string,
    usage: TokenUsage,
    chatLabel: string,
  ): void {
    if (!this._statusBarItem) return;
    const promptK =
      usage.promptTokens >= 1000
        ? `${(usage.promptTokens / 1000).toFixed(1)}k`
        : `${usage.promptTokens}`;
    const completionK =
      usage.completionTokens >= 1000
        ? `${(usage.completionTokens / 1000).toFixed(1)}k`
        : `${usage.completionTokens}`;
    // Truncate chat label for status bar (max ~20 chars to stay compact)
    const shortLabel =
      chatLabel.length > 20 ? chatLabel.slice(0, 17) + "..." : chatLabel;
    this._statusBarItem.text = `$(sparkle) "${shortLabel}" ${promptK}↑ ${completionK}↓`;
    this._statusBarItem.tooltip = [
      `LLM Proxy — Last Request (#${this._requestCounter})`,
      ``,
      `Chat:  ${chatLabel}`,
      `Model: ${modelId}`,
      ``,
      `  Prompt:     ${usage.promptTokens.toLocaleString()} tokens`,
      `  Completion: ${usage.completionTokens.toLocaleString()} tokens`,
      `  Total:      ${usage.totalTokens.toLocaleString()} tokens`,
    ].join("\n");
    this._statusBarItem.command = "llmapiproxy.showUsageLog";
    this._statusBarItem.show();
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

          // Capture usage from final chunk (sent when stream_options.include_usage is true)
          if (chunk.usage && (chunk.usage.prompt_tokens ?? 0) > 0) {
            capturedUsage = {
              promptTokens: chunk.usage.prompt_tokens ?? 0,
              completionTokens: chunk.usage.completion_tokens ?? 0,
              totalTokens: chunk.usage.total_tokens ?? 0,
            };
          }

          for (const choice of chunk.choices) {
            const delta = choice.delta;

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
