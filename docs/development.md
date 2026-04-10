# Development Guide

## Prerequisites

- Node.js 18+ and npm
- VS Code 1.104.0+
- Git

## Setup

```bash
git clone https://github.com/vleeuwenmenno/llmapiproxy
cd llmapiproxy/llmapiproxy-vscode-extension
npm install
```

## Build

```bash
npm run compile    # Compile TypeScript
npm run watch      # Watch mode for development
```

## Run Extension

1. Open the folder in VS Code
2. Press `F5` to open a new Extension Development Host window
3. In the new window:
   - Ensure LLM API Proxy is running
   - Run "Manage LLM API Proxy Connection" to set your API key
   - Open Chat and test

## Package

```bash
npm run package    # Creates .vsix file
```

## Scripts

| Script            | Description           |
| ----------------- | --------------------- |
| `npm run compile` | Compile TypeScript    |
| `npm run watch`   | Compile in watch mode |
| `npm run package` | Create .vsix package  |
| `npm run lint`    | Run ESLint            |

## Architecture

```
src/
├── extension.ts    # Entry point, command registration
├── provider.ts     # LanguageModelChatProvider implementation
├── types.ts        # Type definitions
└── utils.ts        # Helper functions
```

### Key Components

**extension.ts**

- Registers commands (`llmapiproxy.manage`, `llmapiproxy.refreshModels`)
- Creates `ProxyChatModelProvider` and registers with VS Code
- Handles configuration changes

**provider.ts**

- `ProxyChatModelProvider` implements `LanguageModelChatProvider`
- Fetches models from `/v1/models` endpoint
- Handles chat completions with streaming SSE
- Supports tool/function calling
- Caches models for 60 seconds

**types.ts**

- OpenAI-compatible request/response types
- Tool and message type definitions

**utils.ts**

- Converts VS Code messages to OpenAI format
- Handles tool conversion
- Token counting (rough estimate: chars/4)

## API Integration

The extension communicates with LLM API Proxy via:

| Endpoint                    | Purpose                |
| --------------------------- | ---------------------- |
| `GET /v1/models`            | Fetch available models |
| `POST /v1/chat/completions` | Chat with streaming    |

Authentication via `Authorization: Bearer <apiKey>` header.

## Debugging

1. Set breakpoints in `src/` files
2. Press `F5` to start debugging
3. Use Debug Console in the main VS Code window

Check the Output panel → "Extension Host" for logs.
