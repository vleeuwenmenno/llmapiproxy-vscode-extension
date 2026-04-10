# Setup Guide

## Prerequisites

- VS Code 1.104.0 or later
- A running [LLM API Proxy](https://github.com/vleeuwenmenno/llmapiproxy) instance
- A proxy API key (from `server.api_keys` in your proxy `config.yaml`)

## Installation

### From Pre-built VSIX

1. Download the latest `.vsix` from [Releases](../../releases)
2. Open VS Code
3. Go to Extensions → "..." menu → "Install from VSIX"
4. Select the downloaded file

### From Source

```bash
git clone https://github.com/vleeuwenmenno/llmapiproxy
cd llmapiproxy/llmapiproxy-vscode-extension
npm install
npm run compile
npm run package
code --install-extension llmapiproxy-vscode-chat-*.vsix
```

## Initial Setup

1. Open the Command Palette (`Ctrl/Cmd + Shift + P`)
2. Run **"Manage LLM API Proxy Connection"**
3. Select **"Set / Update API Key"** and enter your proxy API key
4. (Optional) Select **"Change Proxy URL"** if your proxy isn't at `http://localhost:8000`

Your API key is stored securely in VS Code's SecretStorage and never written to disk in plaintext.

## Usage

1. Open the Chat view (`Ctrl/Cmd + Alt + I`)
2. Click the model selector in the chat input
3. Choose a model (displayed as `model-name (backend)`)

Models are fetched automatically when you open the model picker. The list is cached for 60 seconds.

### Force Refresh

If you add backends or models to your proxy and don't see them:

1. Run **"Refresh Available Models"** from the Command Palette
2. Re-open the model picker

## Troubleshooting

### "No models available"

- Check that LLM API Proxy is running
- Verify your `llmapiproxy.proxyUrl` setting is correct
- Run "Manage LLM API Proxy Connection" to verify your API key

### Models not updating

- The model list is cached for 60 seconds
- Use "Refresh Available Models" to force a refresh

## Configuration

### Change Proxy URL

1. Command Palette → "Manage LLM API Proxy Connection"
2. Select "Change Proxy URL"
3. Enter the new URL (e.g., `http://192.168.1.100:8080`)

### Clear API Key

1. Command Palette → "Manage LLM API Proxy Connection"
2. Select "Clear API Key"
3. You'll be prompted to enter a new key on next use
