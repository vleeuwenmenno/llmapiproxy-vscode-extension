# Project Guidelines

## Overview

This is a VS Code extension that integrates a local [LLM API Proxy](https://github.com/vleeuwenmenno/llmapiproxy) into VS Code Copilot Chat. It implements a `LanguageModelChatProvider` to dynamically discover and expose proxy models in the VS Code model picker.

## Code Style

- **TypeScript**: Strict mode enabled. Prefer explicit types over `any`.
- **Naming**: Use camelCase for variables/functions, PascalCase for classes/interfaces, UPPER_SNAKE_CASE for constants.
- **Error Handling**: Always wrap `fetch` calls in try/catch. Use `vscode.window.showErrorMessage` for user-facing errors.
- **Secrets**: API keys must only be stored in `vscode.SecretStorage`. Never log or persist keys to disk.

## Architecture

```
src/
├── extension.ts    # Entry point: registers commands and the chat provider
├── provider.ts     # ProxyChatModelProvider: implements LanguageModelChatProvider
├── types.ts        # OpenAI-compatible type definitions
└── utils.ts        # Message/tool conversion helpers
```

### Key Patterns

- **Provider Pattern**: `ProxyChatModelProvider` is the core. It fetches models from `GET /v1/models` and handles streaming chat completions via `POST /v1/chat/completions`.
- **Caching**: Model lists are cached for 60 seconds (`MODELS_CACHE_TTL_MS`).
- **Token Estimation**: Uses a learned tokens-per-character ratio (EMA) after 3+ samples, falling back to `chars / 4` initially.
- **Event-Driven**: `fireModelInfoChanged()` triggers model re-discovery when settings or secrets change.

## Build and Test

```bash
npm install      # Install dependencies
npm run compile  # Compile TypeScript
npm run watch    # Watch mode for development
npm run lint     # Run ESLint
npm run package  # Create .vsix package
```

Run the extension: Press `F5` in VS Code to open an Extension Development Host window.

## Conventions

- **API Compatibility**: All proxy communication uses OpenAI-compatible endpoints (`/v1/models`, `/v1/chat/completions`).
- **Streaming**: Chat completions must use Server-Sent Events (SSE) and yield `LanguageModelTextPart` / `LanguageModelToolCallPart` progressively.
- **Tool Calling**: Convert VS Code `LanguageModelChatTool` objects to OpenAI tool format in `utils.ts`.
- **Configuration**: User-facing settings belong in `package.json` under `contributes.configuration`. Use `llmapiproxy.*` as the namespace.
- **Commands**: Register commands in `extension.ts` with the `llmapiproxy.*` prefix and `LLM API Proxy` category.

## Critical Gotchas

- The `vscode.d.ts` file is managed by `@vscode/dts`. Do not edit it manually. Run `npm run download-api` to update.
- The extension targets VS Code `^1.104.0` — avoid using newer API surfaces without a version gate.
- Always check `CancellationToken.isCancellationRequested` during long-running operations (streaming, fetch).
