# LLM API Proxy — VS Code Chat Provider

Use your [LLM API Proxy](https://github.com/vleeuwenmenno/llmapiproxy) directly in VS Code's Copilot Chat. Models are discovered automatically — no hardcoding required.

## Quick Start

1. Ensure [LLM API Proxy](https://github.com/vleeuwenmenno/llmapiproxy) is running
2. Install this extension
3. Run command **"Manage LLM API Proxy Connection"** to set your API key
4. Open Chat (`Ctrl/Cmd + Alt + I`) and select a model from the picker

## Installation

### From VS Code Marketplace

_(Coming soon)_

### From Source

```bash
git clone https://github.com/vleeuwenmenno/llmapiproxy
cd llmapiproxy/llmapiproxy-vscode-extension
npm install
npm run compile
npm run package
code --install-extension llmapiproxy-vscode-chat-*.vsix
```

## Configuration

| Setting                | Default                 | Description           |
| ---------------------- | ----------------------- | --------------------- |
| `llmapiproxy.proxyUrl` | `http://localhost:8000` | Your proxy server URL |

## Commands

| Command                             | Description                         |
| ----------------------------------- | ----------------------------------- |
| **Manage LLM API Proxy Connection** | Set/clear API key, change proxy URL |
| **Refresh Available Models**        | Force refresh of model list         |

## Documentation

- [Setup Guide](docs/setup.md) — Detailed installation and configuration
- [Development](docs/development.md) — Building from source, debugging

## License

MIT
