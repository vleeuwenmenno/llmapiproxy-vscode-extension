import * as vscode from "vscode";
import type { ChatSession, ChatRequestRecord } from "./chatHistory";
import type { ChatHistoryStore } from "./chatHistory";

type TreeNode = ChatSession | ChatRequestRecord;

function isChatSession(node: TreeNode): node is ChatSession {
  return "requests" in node;
}

function formatK(n: number): string {
  return n >= 1000 ? `${(n / 1000).toFixed(1)}k` : `${n}`;
}

export class ChatHistoryTreeProvider
  implements vscode.TreeDataProvider<TreeNode>
{
  private readonly _onDidChangeTreeData = new vscode.EventEmitter<
    TreeNode | undefined | void
  >();
  readonly onDidChangeTreeData = this._onDidChangeTreeData.event;

  constructor(private readonly _store: ChatHistoryStore) {}

  refresh(): void {
    this._onDidChangeTreeData.fire();
  }

  getTreeItem(element: TreeNode): vscode.TreeItem {
    if (isChatSession(element)) {
      const item = new vscode.TreeItem(
        element.firstLabel,
        vscode.TreeItemCollapsibleState.Expanded,
      );
      item.description = `${element.requests.length} req · ${formatK(element.totalTokens)} tok`;
      item.tooltip = new vscode.MarkdownString(
        `**${element.firstLabel}**\n\n` +
          `Requests: ${element.requests.length}\n\n` +
          `Total tokens: ${element.totalTokens.toLocaleString()}`,
      );
      item.iconPath = new vscode.ThemeIcon("comment-discussion");
      item.contextValue = "chatSession";
      return item;
    } else {
      const r = element;
      const ts = r.timestamp.toLocaleTimeString();
      const promptK = formatK(r.usage.promptTokens);
      const completionK = formatK(r.usage.completionTokens);
      const item = new vscode.TreeItem(
        `#${r.requestNumber} ${r.modelId}`,
        vscode.TreeItemCollapsibleState.None,
      );
      item.description = `${promptK}↑ ${completionK}↓`;
      item.tooltip = new vscode.MarkdownString(
        [
          `**Request #${r.requestNumber}** — ${ts}`,
          ``,
          `Model: \`${r.modelId}\``,
          ``,
          `| | Tokens |`,
          `|---|---|`,
          `| Prompt | ${r.usage.promptTokens.toLocaleString()} |`,
          `| Completion | ${r.usage.completionTokens.toLocaleString()} |`,
          `| **Total** | **${r.usage.totalTokens.toLocaleString()}** |`,
        ].join("\n"),
      );
      item.iconPath = new vscode.ThemeIcon("sparkle");
      item.contextValue = "chatRequest";
      return item;
    }
  }

  getChildren(element?: TreeNode): TreeNode[] {
    if (!element) {
      return this._store.getSessions();
    }
    if (isChatSession(element)) {
      return [...element.requests].reverse(); // newest request first
    }
    return [];
  }
}
