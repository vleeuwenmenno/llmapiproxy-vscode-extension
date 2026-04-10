import * as vscode from "vscode";
import { ProxyChatModelProvider } from "./provider";

let _provider: ProxyChatModelProvider | null = null;

export function activate(context: vscode.ExtensionContext) {
  const provider = new ProxyChatModelProvider(context.secrets);
  _provider = provider;

  // Re-fetch models when API key changes in SecretStorage
  context.subscriptions.push(
    context.secrets.onDidChange((e: vscode.SecretStorageChangeEvent) => {
      if (e.key === "llmapiproxy.apiKey") {
        _provider?.fireModelInfoChanged();
      }
    }),
  );

  // Re-fetch models when proxy URL setting changes
  context.subscriptions.push(
    vscode.workspace.onDidChangeConfiguration(
      (e: vscode.ConfigurationChangeEvent) => {
        if (e.affectsConfiguration("llmapiproxy.proxyUrl")) {
          _provider?.fireModelInfoChanged();
        }
      },
    ),
  );

  const registration = vscode.lm.registerLanguageModelChatProvider(
    "llmapiproxy",
    provider,
  );
  context.subscriptions.push(registration);

  context.subscriptions.push(
    vscode.commands.registerCommand("llmapiproxy.manage", async () => {
      const existing = await context.secrets.get("llmapiproxy.apiKey");

      const choice = await vscode.window.showQuickPick(
        [
          { label: "$(key) Set / Update API Key", action: "apikey" },
          { label: "$(globe) Change Proxy URL", action: "url" },
          ...(existing
            ? [{ label: "$(trash) Clear API Key", action: "clear" }]
            : []),
        ],
        { title: "LLM API Proxy: Manage Connection" },
      );

      if (!choice) return;

      if (choice.action === "apikey") {
        const apiKey = await vscode.window.showInputBox({
          title: "LLM API Proxy API Key",
          prompt: existing
            ? "Update your proxy API key"
            : "Enter your proxy API key",
          ignoreFocusOut: true,
          password: true,
          value: existing ?? "",
          placeHolder: "Enter your proxy API key...",
        });
        if (apiKey === undefined) return;
        if (!apiKey.trim()) {
          vscode.window.showWarningMessage(
            "LLM API Proxy: API key not changed (empty value).",
          );
          return;
        }
        await context.secrets.store("llmapiproxy.apiKey", apiKey.trim());
        vscode.window.showInformationMessage("LLM API Proxy: API key saved.");
        _provider?.fireModelInfoChanged();
      } else if (choice.action === "url") {
        const cfg = vscode.workspace.getConfiguration("llmapiproxy");
        const current = cfg.get<string>("proxyUrl") ?? "http://localhost:8000";
        const newUrl = await vscode.window.showInputBox({
          title: "LLM API Proxy URL",
          prompt: "Enter the base URL of your LLM API Proxy server",
          ignoreFocusOut: true,
          value: current,
          placeHolder: "http://localhost:8000",
        });
        if (newUrl === undefined) return;
        if (!newUrl.trim()) {
          vscode.window.showWarningMessage(
            "LLM API Proxy: URL not changed (empty value).",
          );
          return;
        }
        await cfg.update(
          "proxyUrl",
          newUrl.trim(),
          vscode.ConfigurationTarget.Global,
        );
        vscode.window.showInformationMessage(
          `LLM API Proxy: Proxy URL updated to ${newUrl.trim()}`,
        );
      } else if (choice.action === "clear") {
        await context.secrets.delete("llmapiproxy.apiKey");
        vscode.window.showInformationMessage("LLM API Proxy: API key cleared.");
        _provider?.fireModelInfoChanged();
      }
    }),
  );

  context.subscriptions.push(
    vscode.commands.registerCommand("llmapiproxy.refreshModels", () => {
      _provider?.fireModelInfoChanged();
      vscode.window.showInformationMessage(
        "LLM API Proxy: Model list refreshed.",
      );
    }),
  );

  console.log("[LLM API Proxy] Extension activated");
}

export function deactivate() {
  console.log("[LLM API Proxy] Extension deactivated");
  _provider = null;
}
