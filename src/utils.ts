import * as vscode from "vscode";
import type { ChatMessage, ContentPart, Tool, JsonObject } from "./types";

interface LegacyPart {
  type?: string;
  value?: string;
  callId?: string;
  name?: string;
  input?: unknown;
  arguments?: string | JsonObject;
  mimeType?: string;
  data?: Uint8Array | number[];
  bytes?: Uint8Array | number[];
  buffer?: ArrayBuffer;
  content?: unknown;
  [key: string]: unknown;
}

function getTextValue(
  part: vscode.LanguageModelInputPart | LegacyPart,
): string | undefined {
  if (part instanceof vscode.LanguageModelTextPart) {
    return part.value;
  }
  if (typeof part === "object" && part !== null) {
    const p = part as { value?: string };
    if (typeof p.value === "string") return p.value;
  }
  return undefined;
}

function getToolCallInfo(
  part: vscode.LanguageModelInputPart | LegacyPart,
): { id?: string; name?: string; args?: unknown } | undefined {
  if (part instanceof vscode.LanguageModelToolCallPart) {
    return { id: part.callId, name: part.name, args: part.input };
  }
  const p = part as LegacyPart;
  if (
    typeof p === "object" &&
    p !== null &&
    (p.type === "tool_call" ||
      ((typeof p.name === "string" || typeof p.callId === "string") &&
        (p.input !== undefined || p.arguments !== undefined)))
  ) {
    return { id: p.callId, name: p.name, args: p.input ?? p.arguments };
  }
  return undefined;
}

function isToolResultPart(part: LegacyPart): boolean {
  if (typeof part.type === "string") {
    const t = part.type.toLowerCase();
    if (t === "tool_result" || t === "tool_result_part") return true;
  }
  if (typeof part.callId === "string") {
    return (
      part.value !== undefined ||
      part.content !== undefined ||
      part.type === "tool_result"
    );
  }
  return false;
}

function getToolResultText(
  part: vscode.LanguageModelInputPart | LegacyPart,
): { callId: string; content: string } | undefined {
  if (part instanceof vscode.LanguageModelToolResultPart) {
    const texts: string[] = [];
    for (const inner of part.content) {
      const tv = getTextValue(inner as vscode.LanguageModelInputPart);
      if (tv !== undefined) texts.push(tv);
    }
    return { callId: part.callId, content: texts.join("\n") };
  }
  const p = part as LegacyPart;
  if (!isToolResultPart(p)) return undefined;
  if (typeof p.callId !== "string") return undefined;
  const content = typeof p.value === "string" ? p.value : JSON.stringify(p);
  return { callId: p.callId, content };
}

/** Convert VS Code messages to OpenAI-compatible format */
export function convertMessages(
  messages: readonly vscode.LanguageModelChatMessage[],
): ChatMessage[] {
  const result: ChatMessage[] = [];

  for (const msg of messages) {
    const role =
      msg.role === vscode.LanguageModelChatMessageRole.User
        ? "user"
        : msg.role === vscode.LanguageModelChatMessageRole.Assistant
          ? "assistant"
          : "system";

    const textParts: string[] = [];
    for (const part of msg.content) {
      const tv = getTextValue(part);
      if (tv !== undefined) textParts.push(tv);
    }

    const toolCalls = msg.content
      .map((p: vscode.LanguageModelInputPart | LegacyPart) =>
        getToolCallInfo(p),
      )
      .filter(
        (
          t: { id?: string; name?: string; args?: unknown } | undefined,
        ): t is { id?: string; name?: string; args?: unknown } => !!t,
      );

    let emitted = false;

    if (toolCalls.length > 0) {
      result.push({
        role: "assistant",
        content: textParts.join("") || "",
        tool_calls: toolCalls.map(
          (tc: { id?: string; name?: string; args?: unknown }) => ({
            id: tc.id ?? `call_${Math.random().toString(36).slice(2, 10)}`,
            type: "function",
            function: {
              name: tc.name ?? "unknown",
              arguments:
                typeof tc.args === "string"
                  ? tc.args
                  : JSON.stringify(tc.args ?? {}),
            },
          }),
        ),
      });
      emitted = true;
    }

    for (const part of msg.content) {
      const tr = getToolResultText(part);
      if (tr) {
        result.push({
          role: "tool",
          tool_call_id: tr.callId,
          content: tr.content || "",
        });
        emitted = true;
      }
    }

    if (
      textParts.length > 0 &&
      !(role === "assistant" && toolCalls.length > 0)
    ) {
      result.push({ role, content: textParts.join("") });
      emitted = true;
    }

    if (!emitted) {
      result.push({ role, content: "" });
    }
  }

  return result;
}

/** Convert VS Code tool options to OpenAI-compatible format */
export function convertTools(
  options: vscode.ProvideLanguageModelChatResponseOptions,
): {
  tools?: Tool[];
  tool_choice?: "auto" | "none" | { type: string; function: { name: string } };
} {
  const toolsInput = options.tools ?? [];
  if (toolsInput.length === 0) return {};

  const tools: Tool[] = toolsInput.map((t: vscode.LanguageModelChatTool) => ({
    type: "function",
    function: {
      name: t.name,
      description: t.description,
      parameters: t.inputSchema as JsonObject,
    },
  }));

  let tool_choice:
    | "auto"
    | "none"
    | { type: string; function: { name: string } } = "auto";
  if (
    options.toolMode === vscode.LanguageModelChatToolMode.Required &&
    tools.length === 1
  ) {
    tool_choice = {
      type: "function",
      function: { name: tools[0].function.name },
    };
  }

  return { tools, tool_choice };
}

/** Build a friendly display name from a proxy model ID like "backend/model-id" */
export function makeDisplayName(modelId: string): string {
  const slash = modelId.indexOf("/");
  if (slash === -1) return modelId;
  const backend = modelId.slice(0, slash);
  const model = modelId.slice(slash + 1);
  return `${model} (${backend})`;
}

/** Extract backend prefix from "backend/model-id" */
export function extractBackend(modelId: string): string {
  const slash = modelId.indexOf("/");
  return slash === -1 ? "" : modelId.slice(0, slash);
}
