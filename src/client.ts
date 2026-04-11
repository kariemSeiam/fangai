/**
 * @fangai/client — A2A client for discovering and calling fang-wrapped agents
 */

export interface FangAgent {
  name: string;
  url: string;
  tier?: number;
  mode?: string;
  skills?: Array<{ id: string; name: string; tags: string[] }>;
}

export interface TaskResult {
  taskId: string;
  status: string;
  text?: string;
  error?: string;
}

export class FangClient {
  private baseUrl: string;

  constructor(baseUrl: string) {
    this.baseUrl = baseUrl.replace(/\/$/, '');
  }

  async getCard(): Promise<any> {
    const res = await fetch(`${this.baseUrl}/.well-known/agent-card.json`);
    if (!res.ok) throw new Error(`Failed to get card: ${res.status}`);
    return res.json();
  }

  async send(message: string, opts?: { contextId?: string }): Promise<TaskResult> {
    const res = await fetch(`${this.baseUrl}/a2a/jsonrpc`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        jsonrpc: '2.0', id: randomId(), method: 'message/send',
        params: {
          message: {
            messageId: randomId(), role: 'user',
            parts: [{ kind: 'text', text: message }],
            ...(opts?.contextId ? { contextId: opts.contextId } : {}),
          },
        },
      }),
    });
    const data = await res.json() as any;
    if (data.error) return { taskId: '', status: 'failed', error: data.error.message };
    const result = data.result;
    if (result.kind === 'message') {
      const text = result.parts?.map((p: any) => p.text).join('') || '';
      return { taskId: '', status: 'completed', text };
    }
    return { taskId: result.id || '', status: result.status?.state || 'submitted' };
  }

  async sendStream(message: string, opts?: { contextId?: string; onProgress?: (text: string) => void }): Promise<TaskResult> {
    const res = await fetch(`${this.baseUrl}/a2a/jsonrpc`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        jsonrpc: '2.0', id: randomId(), method: 'message/stream',
        params: {
          message: {
            messageId: randomId(), role: 'user',
            parts: [{ kind: 'text', text: message }],
            ...(opts?.contextId ? { contextId: opts.contextId } : {}),
          },
        },
      }),
    });
    const data = await res.json() as any;
    if (data.error) return { taskId: '', status: 'failed', error: data.error.message };
    const taskId = data.result?.id || '';
    return { taskId, status: 'streaming' };
  }

  async health(): Promise<{ ok: boolean; agent: string; mode: string }> {
    const res = await fetch(`${this.baseUrl}/health`, { signal: AbortSignal.timeout(3000) });
    if (!res.ok) return { ok: false, agent: '', mode: '' };
    return { ok: true, ...(await res.json() as any) };
  }
}

function randomId(): string { return randomUUID(); }

function randomUUID(): string {
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, c => {
    const r = Math.random() * 16 | 0;
    return (c === 'x' ? r : (r & 0x3 | 0x8)).toString(16);
  });
}

export async function discoverAgents(ports = [3001, 3002, 3003, 3004, 3005, 4000, 8080]): Promise<FangAgent[]> {
  const found: FangAgent[] = [];
  for (const port of ports) {
    try {
      const client = new FangClient(`http://localhost:${port}`);
      const card = await client.getCard();
      found.push({
        name: card.name,
        url: card.url || `http://localhost:${port}`,
        mode: card.capabilities?.streaming ? 'streaming' : undefined,
        skills: card.skills,
      });
    } catch { /* not running */ }
  }
  return found;
}