/**
 * Pi adapter — persistent RPC mode via --mode rpc
 * Tier 1. Full bidirectional JSONL protocol.
 */

import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import type { AgentAdapter, AgentTask, FangConfig, AdapterEvent, DetectionResult } from './core.ts';

const execFileAsync = promisify(execFile);

export class PiAdapter implements AgentAdapter {
  readonly id = 'pi';
  readonly binary = 'pi';
  readonly tier = 1 as const;
  readonly displayName = 'Pi';
  readonly mode = 'persistent' as const;
  skills = [
    { id: 'code', name: 'Code any task', tags: ['typescript', 'python', 'bash', 'react', 'go'] },
    { id: 'refactor', name: 'Refactor', tags: ['refactor', 'clean', 'types'] },
    { id: 'debug', name: 'Debug & fix', tags: ['debug', 'error', 'fix'] },
  ];

  buildArgs(_task: AgentTask, _config: FangConfig): string[] {
    return ['--mode', 'rpc'];
  }

  formatInput(task: AgentTask): string {
    return JSON.stringify({ id: task.id, type: 'prompt', message: task.message }) + '\n';
  }

  parseLine(line: string): AdapterEvent[] {
    let e: any;
    try { e = JSON.parse(line); } catch { return []; }

    if (e.type === 'extension_ui_request') return [];
    if (e.type === 'response') return [];

    switch (e.type) {
      case 'message_update': {
        const evt = e.assistantMessageEvent;
        if (!evt) return [];
        switch (evt.type) {
          case 'text_delta':
            return evt.delta ? [{ type: 'text-delta', text: evt.delta }] : [];
          case 'thinking_delta':
            return evt.delta ? [{ type: 'thinking', text: evt.delta }] : [];
          case 'toolcall_end': {
            const tc = evt.toolCall;
            if (tc) return [{ type: 'tool-call', tool: tc.name || 'unknown', input: typeof tc.arguments === 'string' ? JSON.parse(tc.arguments) : tc.arguments }];
            return [];
          }
          case 'start': case 'text_start': case 'text_end':
          case 'thinking_start': case 'thinking_end':
          case 'toolcall_start': case 'toolcall_delta': case 'done':
            return [];
          case 'error':
            return [{ type: 'error', message: evt.reason || evt.error || 'Streaming error' }];
          default: return [];
        }
      }
      case 'message_start': case 'message_end': return [];
      case 'turn_end': return [{ type: 'status', state: 'completed' }];
      case 'tool_execution_start': return [{ type: 'status', state: 'working' }];
      case 'tool_execution_end': {
        const result = e.result;
        const output = result?.content?.filter((p: any) => p.type === 'text')?.map((p: any) => p.text)?.join('') || '';
        return [{ type: 'tool-result', tool: e.toolName || 'unknown', output, isError: !!e.isError }];
      }
      case 'tool_execution_update': return [{ type: 'status', state: 'working' }];
      case 'agent_start': case 'turn_start': return [{ type: 'status', state: 'working' }];
      case 'agent_end': return [{ type: 'status', state: 'completed' }];
      case 'auto_retry_start': return [{ type: 'status', state: 'working' }];
      case 'auto_retry_end': return [];
      case 'error': return [{ type: 'error', message: e.error || e.message || 'Unknown pi error' }];
      case 'extension_error': return [{ type: 'error', message: e.error || 'Extension error' }];
      default: return [];
    }
  }

  async detect(): Promise<DetectionResult | null> {
    try {
      const { default: which } = await import('which');
      const path = await which(this.binary);
      let version = 'unknown';
      try { const { stdout } = await execFileAsync(this.binary, ['--version'], { timeout: 5000 }); version = stdout.trim().split('\n')[0] || 'unknown'; } catch {}
      return { binary: this.binary, version, path, tier: 1, protocol: 'jsonl-rpc' };
    } catch { return null; }
  }
}

export class ClaudeAdapter implements AgentAdapter {
  readonly id = 'claude-code'; readonly binary = 'claude'; readonly tier = 1 as const; readonly displayName = 'Claude Code'; readonly mode = 'oneshot' as const;
  skills = [
    { id: 'reasoning', name: 'Complex reasoning', tags: ['reasoning', 'architecture', 'design'] },
    { id: 'code', name: 'Code generation', tags: ['typescript', 'python', 'system-design'] },
  ];
  buildArgs(task: AgentTask, config: FangConfig): string[] {
    const args = ['--output-format', 'stream-json', '--input-format', 'stream-json', '--no-input'];
    if (task.context?.workdir) args.push('--cwd', task.context.workdir);
    else if (config.workdir) args.push('--cwd', config.workdir);
    if (config.agentFlags?.length) args.push(...config.agentFlags);
    return args;
  }
  formatInput(task: AgentTask): string { return JSON.stringify({ type: 'user_message', content: task.message }) + '\n'; }
  parseLine(line: string): AdapterEvent[] {
    if (!line.trim()) return [];
    let obj: any; try { obj = JSON.parse(line); } catch { return [{ type: 'text-delta', text: line + '\n' }]; }
    switch (obj.type) {
      case 'text_delta': case 'content_block_delta': return (obj.text || obj.delta?.text) ? [{ type: 'text-delta', text: obj.text || obj.delta.text }] : [];
      case 'tool_use': case 'content_block_start': return obj.name ? [{ type: 'tool-call', tool: obj.name, input: obj.input }] : [];
      case 'tool_result': return [{ type: 'tool-result', tool: String(obj.tool_use_id || 'unknown'), output: typeof obj.content === 'string' ? obj.content : JSON.stringify(obj.content), isError: obj.is_error }];
      case 'result': return [{ type: 'status', state: 'completed' }];
      case 'error': return [{ type: 'error', message: String(obj.message || 'Unknown error') }];
      default: return obj.text ? [{ type: 'text-delta', text: obj.text }] : [];
    }
  }
  async detect(): Promise<DetectionResult | null> {
    try { const { default: which } = await import('which'); const path = await which(this.binary); let version = 'unknown'; try { const { stdout } = await execFileAsync(this.binary, ['--version'], { timeout: 5000 }); version = stdout.trim().split('\n')[0] || 'unknown'; } catch {} return { binary: this.binary, version, path, tier: 1, protocol: 'stream-json' }; } catch { return null; }
  }
}

export class AiderAdapter implements AgentAdapter {
  readonly id = 'aider'; readonly binary = 'aider'; readonly tier = 3 as const; readonly displayName = 'Aider'; readonly mode = 'oneshot' as const;
  skills = [
    { id: 'refactor', name: 'Git-native refactor', tags: ['git', 'refactor', 'large-codebase'] },
    { id: 'code', name: 'Code editing', tags: ['python', 'typescript', 'multi-file'] },
  ];
  buildArgs(): string[] { return ['--message', 'CMD', '--yes', '--no-auto-commits', '--no-pretty']; }
  formatInput(task: AgentTask): string { return task.message + '\n/exit\n'; }
  parseLine(line: string): AdapterEvent[] {
    if (!line.trim()) return []; const trimmed = line.trim();
    if (trimmed.startsWith('Applied edit to')) return [{ type: 'text-delta', text: trimmed }];
    if (trimmed.startsWith('Error:') || trimmed.startsWith('Error ')) return [{ type: 'error', message: trimmed }];
    try { const obj = JSON.parse(trimmed); if (obj.type === 'assistant') return [{ type: 'text-delta', text: obj.content || '' }]; if (obj.type === 'commit') return [{ type: 'tool-result', tool: 'git', output: `committed: ${obj.commit_hash || 'done'}` }]; if (obj.type === 'error') return [{ type: 'error', message: obj.message }]; } catch {}
    return [{ type: 'text-delta', text: trimmed }];
  }
  async detect(): Promise<DetectionResult | null> { try { const { default: which } = await import('which'); const path = await which(this.binary); return { binary: this.binary, version: 'unknown', path, tier: 3, protocol: 'text' }; } catch { return null; } }
}

export class CodexAdapter implements AgentAdapter {
  readonly id = 'codex'; readonly binary = 'codex'; readonly tier = 1 as const; readonly displayName = 'Codex CLI'; readonly mode = 'oneshot' as const;
  skills = [{ id: 'code', name: 'Code tasks', tags: ['typescript', 'python'] }];
  buildArgs(): string[] { return ['--json']; }
  formatInput(task: AgentTask): string { return task.message + '\n'; }
  parseLine(line: string): AdapterEvent[] {
    if (!line.trim()) return []; try { const obj = JSON.parse(line); switch (obj.type) { case 'item.content_part.delta': return obj.text ? [{ type: 'text-delta', text: obj.text }] : []; case 'item.tool_call': return [{ type: 'tool-call', tool: obj.name || 'tool', input: obj.input }]; case 'item.tool_result': return [{ type: 'tool-result', tool: obj.name || 'tool', output: obj.output || '' }]; case 'turn.completed': return [{ type: 'status', state: 'completed' }]; case 'thread.started': case 'turn.started': return [{ type: 'status', state: 'working' }]; default: return []; } } catch { return [{ type: 'text-delta', text: line.trim() }]; }
  }
  async detect(): Promise<DetectionResult | null> { try { const { default: which } = await import('which'); const path = await which(this.binary); return { binary: this.binary, version: 'unknown', path, tier: 1, protocol: 'jsonl' }; } catch { return null; } }
}

export class GeminiAdapter implements AgentAdapter {
  readonly id = 'gemini'; readonly binary = 'gemini'; readonly tier = 2 as const; readonly displayName = 'Gemini CLI'; readonly mode = 'oneshot' as const;
  skills = [{ id: 'code', name: 'Code tasks', tags: ['typescript', 'python'] }, { id: 'reasoning', name: 'Reasoning', tags: ['reasoning', 'analysis'] }];
  buildArgs(): string[] { return ['--acp']; }
  formatInput(task: AgentTask): string { return JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'session/prompt', params: { prompt: task.message } }) + '\n'; }
  private sessionId: string | null = null;
  parseLine(line: string): AdapterEvent[] {
    if (!line.trim()) return []; try { const obj = JSON.parse(line); if (obj.method === 'session/new' && obj.result?.sessionId) { this.sessionId = obj.result.sessionId; return [{ type: 'status', state: 'working' }]; } if (obj.result?.text) return [{ type: 'text-delta', text: obj.result.text }]; if (obj.result?.content) return [{ type: 'text-delta', text: typeof obj.result.content === 'string' ? obj.result.content : JSON.stringify(obj.result.content) }]; if (obj.error) return [{ type: 'error', message: obj.error.message || 'ACP error' }]; return []; } catch { return [{ type: 'text-delta', text: line.trim() }]; }
  }
  async detect(): Promise<DetectionResult | null> { try { const { default: which } = await import('which'); const path = await which(this.binary); return { binary: this.binary, version: 'unknown', path, tier: 2, protocol: 'acp' }; } catch { return null; } }
}

export class OpenCodeAdapter implements AgentAdapter {
  readonly id = 'opencode'; readonly binary = 'opencode'; readonly tier = 2 as const; readonly displayName = 'OpenCode'; readonly mode = 'oneshot' as const;
  skills = [{ id: 'code', name: 'Code tasks', tags: ['typescript', 'python'] }];
  buildArgs(): string[] { return ['-f', 'json']; }
  formatInput(task: AgentTask): string { return task.message + '\n'; }
  parseLine(line: string): AdapterEvent[] {
    if (!line.trim()) return []; try { const obj = JSON.parse(line); if (obj.type === 'text' || obj.type === 'response') return [{ type: 'text-delta', text: obj.content || obj.text || '' }]; if (obj.type === 'content') return [{ type: 'text-delta', text: obj.text || '' }]; if (obj.type === 'done' || obj.type === 'complete') return [{ type: 'status', state: 'completed' }]; if (obj.type === 'error') return [{ type: 'error', message: obj.message || 'OpenCode error' }]; return []; } catch { return [{ type: 'text-delta', text: line.trim() }]; }
  }
  async detect(): Promise<DetectionResult | null> { try { const { default: which } = await import('which'); const path = await which(this.binary); return { binary: this.binary, version: 'unknown', path, tier: 2, protocol: 'json' }; } catch { return null; } }
}

export class GenericAdapter implements AgentAdapter {
  readonly id = 'generic'; readonly binary = ''; readonly tier = 3 as const; readonly displayName = 'Generic CLI'; readonly mode = 'oneshot' as const;
  private cliCommand: string;
  skills = [{ id: 'generic', name: 'CLI task', tags: ['code'] }];
  constructor(cliCommand?: string) { this.cliCommand = cliCommand || ''; }
  buildArgs(): string[] { return []; }
  formatInput(task: AgentTask): string { return task.message + '\n'; }
  parseLine(line: string): AdapterEvent[] { if (!line.trim()) return []; return [{ type: 'text-delta', text: line.trim() }]; }
  async detect(): Promise<DetectionResult | null> { return null; }
}

export const ALL_ADAPTERS: AgentAdapter[] = [
  new PiAdapter(), new ClaudeAdapter(), new CodexAdapter(),
  new GeminiAdapter(), new AiderAdapter(), new OpenCodeAdapter(),
];

export function detectAdapter(cli: string): AgentAdapter {
  for (const adapter of ALL_ADAPTERS) { if (adapter.binary && cli.includes(adapter.binary)) return adapter; }
  return new GenericAdapter(cli);
}