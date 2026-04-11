# Bug Report: Copilot Chat Shows "0 Tokens Used" for Third-Party Language Model Providers

## Summary

When using third-party language model providers registered via the VS Code `LanguageModelChatProvider` API, the Copilot Chat context size indicator always shows **0%** / **"0 tokens used"**, regardless of the actual token usage.

**Copilot Chat version analyzed:** 0.43.0

## Steps to Reproduce

1. Install a VS Code extension that registers a `LanguageModelChatProvider` (e.g., the LLM API Proxy extension)
2. Open Copilot Chat in VS Code
3. Select a model provided by the third-party extension
4. Send a message and wait for the response to complete
5. Observe the context size indicator (bottom-left of the chat input area)

**Expected:** The indicator shows actual token usage (e.g., "1.2k / 128k tokens, 1%").
**Actual:** The indicator shows "0 tokens used" / 0%.

## Root Cause

The Copilot Chat extension's `LN` class (which handles all non-Copilot language model providers) **hardcodes zero usage** in its return value from `makeChatRequest2()`:

```javascript
// In github.copilot-chat/dist/extension.js (~byte offset 19966000)
return f || g > 0 ? {
    type: "success",
    usage: {
        prompt_tokens: 0,
        completion_tokens: 0,
        total_tokens: 0,
        prompt_tokens_details: { cached_tokens: 0 }
    },
    value: f,
    resolvedModel: this.languageModel.id
} : { type: "unknown", ... };
```

The model selection logic instantiates `LN` for any non-Copilot provider:

```javascript
if (r.vendor !== "copilot") return createInstance(LN, r);
```

## Data Flow

```
Third-party provider
  → progress.report(LanguageModelTextPart)
    → VS Code extension host
      → $reportResponsePart → main thread stream
        → Copilot LN.sendRequest() reads stream (text/tool-call parts only)
          → LN.makeChatRequest2() returns HARDCODED usage: {prompt_tokens: 0, ...}
            → Copilot agent reports {kind: "usage", promptTokens: 0, completionTokens: 0}
              → chatServiceImpl.setUsage() with zeros
                → Context widget reads response.usage → displays 0%
```

## Impact

- Users cannot see how much of their context window is consumed
- The percentage indicator is completely non-functional for third-party models
- `provideTokenCount` IS used correctly for prompt budgeting (truncation), but the display is broken
- `maxInputTokens` and `maxOutputTokens` are correctly passed through

## Suggested Fix

The `LN` class should estimate usage from the streamed response rather than hardcoding zeros. Options:

### Option A: Estimate from streamed content (minimal change)
Count characters from streamed `LanguageModelTextPart`s and `LanguageModelToolCallPart`s, then apply a rough token estimation (e.g., chars / 4). Also use `provideTokenCount` on the input messages for the prompt side.

### Option B: Expose usage via LanguageModelDataPart convention
Define a convention where providers can report actual usage via `LanguageModelDataPart` with a specific MIME type (e.g., `application/vnd.llm.usage`). The extension host would process this and Copilot would read it.

### Option C: Add usage reporting to the LanguageModelChatProvider API
Extend the VS Code API to allow providers to return usage metadata from `provideLanguageModelChatResponse`. This is the cleanest long-term solution but requires API changes.

## Workarounds

Since this cannot be fixed from the extension side alone (the `LanguageModelChatProvider` API has no usage reporting mechanism, and the extension host drops unknown response part types), the best current workaround is:

1. Track actual usage from the SSE stream's final chunk (`stream_options: { include_usage: true }`)
2. Display usage in a status bar item or output channel
3. Use an adaptive `provideTokenCount` that learns from actual usage data for better prompt budgeting

## Related

- VS Code `LanguageModelChatProvider` API
- `LanguageModelResponsePart` type (text, tool-call, and data parts)
- `provideTokenCount` method (used for prompt budgeting, NOT for display)
