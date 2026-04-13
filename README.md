# LLM API Proxy — VS Code Chat Provider

Integrates your local [LLM API Proxy](https://github.com/vleeuwenmenno/llmapiproxy) into VS Code Copilot Chat. Models are **discovered dynamically** from the proxy at runtime — no hardcoding required.

## Features

- **Dynamic model discovery** — calls `GET /v1/models` on your proxy and surfaces all available models in the VS Code model picker
- **Full streaming support** via Server-Sent Events
- **Tool / function calling** support
- **Secure API key storage** in VS Code SecretStorage (never written to disk in plaintext)
- **Configurable proxy URL** via VS Code settings

## Requirements

- VS Code 1.104.0 or later
- A running [LLM API Proxy](https://github.com/vleeuwenmenno/llmapiproxy) instance
- A proxy API key (one of the keys in `server.api_keys` in `config.yaml`)

## Setup

1. Install the extension (see [Installation](#installation) below)
2. Open the Command Palette (`Ctrl/Cmd + Shift + P`)
3. Run **LLM API Proxy: Manage Connection**
4. Choose **Set / Update API Key** and enter your proxy API key
5. Optionally choose **Change Proxy URL** if your proxy is not at `http://localhost:8000`

Models are fetched automatically when you open the chat model picker. Use **LLM API Proxy: Refresh Available Models** to force a refresh.

## Installation

### From Source

```bash
git clone https://github.com/vleeuwenmenno/llmapiproxy
cd llmapiproxy-vscode-extension
npm install
npm run compile
npm run package          # produces llmapiproxy-vscode-chat-*.vsix
code --install-extension llmapiproxy-vscode-chat-*.vsix
```

## Usage

1. Open the Chat view (`Ctrl/Cmd + Alt + I`)
2. Click the model selector
3. Choose any model prefixed with your backend name (e.g. `glm-5.1 (zai)`, `gpt-4.1 (openrouter)`)

## Settings

| Setting                | Type   | Default                 | Description                  |
| ---------------------- | ------ | ----------------------- | ---------------------------- |
| `llmapiproxy.proxyUrl` | string | `http://localhost:8000` | Base URL of the proxy server |

## Commands

| Command                                   | Description                                         |
| ----------------------------------------- | --------------------------------------------------- |
| `LLM API Proxy: Manage Connection`        | Set API key, change proxy URL, or clear the API key |
| `LLM API Proxy: Refresh Available Models` | Force a refresh of the model list from the proxy    |

## How It Works

When the VS Code model picker opens, the extension:

1. Reads `llmapiproxy.proxyUrl` from settings
2. Calls `GET /v1/models` with your stored API key
3. Maps each returned model ID (e.g. `openrouter/anthropic/claude-sonnet-4`) to a user-friendly display name
4. Registers each model as a selectable chat provider

The model list is cached for 60 seconds to avoid repeated requests.

## License

MIT
