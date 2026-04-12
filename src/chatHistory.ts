export interface TokenUsage {
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
}

export interface ChatRequestRecord {
  requestNumber: number;
  timestamp: Date;
  modelId: string;
  usage: TokenUsage;
  chatLabel: string;
}

export interface ChatSession {
  id: string;
  firstLabel: string;
  requests: ChatRequestRecord[];
  totalTokens: number;
}

export class ChatHistoryStore {
  private _sessions: Map<string, ChatSession> = new Map();
  private _sessionOrder: string[] = [];

  addRequest(
    sessionId: string,
    firstLabel: string,
    record: ChatRequestRecord,
  ): void {
    if (!this._sessions.has(sessionId)) {
      this._sessions.set(sessionId, {
        id: sessionId,
        firstLabel,
        requests: [],
        totalTokens: 0,
      });
      this._sessionOrder.unshift(sessionId); // newest first
    }
    const session = this._sessions.get(sessionId)!;
    session.requests.push(record);
    session.totalTokens += record.usage.totalTokens;
  }

  getSessions(): ChatSession[] {
    return this._sessionOrder
      .map((id) => this._sessions.get(id)!)
      .filter(Boolean);
  }

  clear(): void {
    this._sessions.clear();
    this._sessionOrder = [];
  }
}
