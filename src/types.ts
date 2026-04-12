/**
 * OpenAI-compatible type definitions for the LLM API Proxy
 */

export type Json =
  | string
  | number
  | boolean
  | null
  | Json[]
  | { [k: string]: Json };

export type JsonObject = { [k: string]: Json };

export interface ContentPart {
  type: "text" | "image_url";
  text?: string;
  image_url?: { url: string };
}

export interface ChatMessage {
  role: "system" | "user" | "assistant" | "tool";
  content: string | ContentPart[];
  name?: string;
  tool_calls?: ToolCall[];
  tool_call_id?: string;
}

export interface ToolCall {
  id: string;
  index?: number;
  type: "function";
  function: {
    name: string;
    arguments: string;
  };
}

export interface Tool {
  type: "function";
  function: {
    name: string;
    description?: string;
    parameters?: JsonObject;
  };
}

export interface ChatRequest {
  model: string;
  messages: ChatMessage[];
  temperature?: number;
  max_tokens?: number;
  stream?: boolean;
  stream_options?: { include_usage: boolean };
  tools?: Tool[];
  tool_choice?: "auto" | "none" | { type: string; function: { name: string } };
}

export interface StreamChoice {
  index: number;
  delta: {
    role?: string;
    content?: string | null;
    tool_calls?: ToolCall[];
  };
  finish_reason: string | null;
}

export interface StreamResponse {
  id: string;
  object: string;
  created: number;
  model: string;
  choices: StreamChoice[];
  usage?: {
    prompt_tokens?: number;
    completion_tokens?: number;
    total_tokens?: number;
  };
}

/** A model entry returned by GET /v1/models */
export interface ProxyModel {
  id: string;
  object: string;
  created: number;
  owned_by: string;
  /** Human-readable display name, e.g. "Claude Sonnet 4" (may be absent) */
  display_name?: string;
  /** Context window size in tokens (may be absent for static model lists) */
  context_length?: number;
  /** Max output tokens (may be absent for static model lists) */
  max_output_tokens?: number;
  /** Feature flags e.g. ["vision", "tools"] */
  capabilities?: string[];
  /** Backends that serve this model, in routing priority order */
  available_backends?: string[];
  /** Effective routing strategy e.g. "priority", "round-robin" */
  routing_strategy?: string;
}

export interface ProxyModelList {
  object: "list";
  data: ProxyModel[];
}

/** Enriched model info used by the provider */
export interface ModelInfo {
  id: string;
  displayName: string;
  /** Ordered list of backends that serve this model */
  backends: string[];
  /** Effective routing strategy e.g. "priority", "round-robin" */
  routingStrategy?: string;
  contextLength?: number;
  maxOutputTokens?: number;
  supportsVision: boolean;
}
