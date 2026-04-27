/**
 * Tests for @fangai/adapters — all adapter parseLine, buildArgs, formatInput, detectAdapter
 */
import { describe, it, expect } from 'vitest';
import {
  PiAdapter,
  ClaudeAdapter,
  AiderAdapter,
  CodexAdapter,
  GeminiAdapter,
  OpenCodeAdapter,
  GenericAdapter,
  detectAdapter,
} from '../adapters.ts';
import type { AgentTask, FangConfig } from '../core.ts';

const dummyTask: AgentTask = { id: 'test-1', message: 'fix the bug in auth.ts' };
const dummyConfig: FangConfig = { cli: 'pi', port: 3001 };

// ─── PiAdapter ────────────────────────────────────────────────────────────

describe('PiAdapter', () => {
  const adapter = new PiAdapter();

  it('has correct metadata', () => {
    expect(adapter.id).toBe('pi');
    expect(adapter.tier).toBe(1);
    expect(adapter.mode).toBe('persistent');
    expect(adapter.binary).toBe('pi');
  });

  it('builds RPC args', () => {
    const args = adapter.buildArgs(dummyTask, dummyConfig);
    expect(args).toContain('--mode');
    expect(args).toContain('rpc');
  });

  it('formats input as JSONL prompt', () => {
    const input = adapter.formatInput(dummyTask);
    const parsed = JSON.parse(input.trim());
    expect(parsed.type).toBe('prompt');
    expect(parsed.message).toBe('fix the bug in auth.ts');
    expect(parsed.id).toBe('test-1');
  });

  it('parses text_delta via message_update', () => {
    const events = adapter.parseLine(JSON.stringify({
      type: 'message_update',
      assistantMessageEvent: { type: 'text_delta', delta: 'Hello world' },
    }));
    expect(events).toHaveLength(1);
    expect(events[0].type).toBe('text-delta');
    if (events[0].type === 'text-delta') expect(events[0].text).toBe('Hello world');
  });

  it('parses agent_end as completed', () => {
    const events = adapter.parseLine(JSON.stringify({ type: 'agent_end' }));
    expect(events).toHaveLength(1);
    expect(events[0].type).toBe('status');
    if (events[0].type === 'status') expect(events[0].state).toBe('completed');
  });

  it('parses turn_end as completed', () => {
    const events = adapter.parseLine(JSON.stringify({ type: 'turn_end' }));
    expect(events[0].type).toBe('status');
    if (events[0].type === 'status') expect(events[0].state).toBe('completed');
  });

  it('parses error type', () => {
    const events = adapter.parseLine(JSON.stringify({ type: 'error', error: 'Something broke' }));
    expect(events).toHaveLength(1);
    expect(events[0].type).toBe('error');
    if (events[0].type === 'error') expect(events[0].message).toContain('Something broke');
  });

  it('parses extension_error', () => {
    const events = adapter.parseLine(JSON.stringify({ type: 'extension_error', error: 'ext fail' }));
    expect(events[0].type).toBe('error');
  });

  it('parses tool_execution_end with tool-result', () => {
    const events = adapter.parseLine(JSON.stringify({
      type: 'tool_execution_end',
      toolName: 'edit_file',
      result: { content: [{ type: 'text', text: 'edited' }] },
    }));
    expect(events[0].type).toBe('tool-result');
    if (events[0].type === 'tool-result') expect(events[0].tool).toBe('edit_file');
  });

  it('parses tool_execution_start as working status', () => {
    const events = adapter.parseLine(JSON.stringify({
      type: 'tool_execution_start', tool: 'edit_file', input: { path: 'a.ts' },
    }));
    expect(events[0].type).toBe('status');
    if (events[0].type === 'status') expect(events[0].state).toBe('working');
  });

  it('returns empty for extension_ui_request', () => {
    const events = adapter.parseLine(JSON.stringify({
      type: 'extension_ui_request', id: 'ui-1', method: 'confirm',
    }));
    expect(events).toHaveLength(0);
  });

  it('returns empty for response acknowledgment', () => {
    const events = adapter.parseLine(JSON.stringify({ type: 'response' }));
    expect(events).toHaveLength(0);
  });

  it('returns empty for empty lines', () => {
    expect(adapter.parseLine('')).toHaveLength(0);
  });

  it('returns empty for non-JSON lines', () => {
    expect(adapter.parseLine('not json at all')).toHaveLength(0);
  });

  it('returns empty for unknown event types', () => {
    const events = adapter.parseLine(JSON.stringify({ type: 'queue_update' }));
    expect(events).toHaveLength(0);
  });
});

// ─── ClaudeAdapter ────────────────────────────────────────────────────────

describe('ClaudeAdapter', () => {
  const adapter = new ClaudeAdapter();

  it('has correct metadata', () => {
    expect(adapter.id).toBe('claude-code');
    expect(adapter.tier).toBe(1);
    expect(adapter.mode).toBe('oneshot');
    expect(adapter.binary).toBe('claude');
  });

  it('builds stream-json args with --no-input', () => {
    const args = adapter.buildArgs(dummyTask, dummyConfig);
    expect(args).toContain('--output-format');
    expect(args).toContain('stream-json');
    expect(args).toContain('--input-format');
    expect(args).toContain('stream-json');
    expect(args).toContain('--no-input');
  });

  it('formats input as JSON user_message', () => {
    const input = adapter.formatInput(dummyTask);
    const parsed = JSON.parse(input.trim());
    expect(parsed.type).toBe('user_message');
    expect(parsed.content).toBe('fix the bug in auth.ts');
  });

  it('parses content_block_delta', () => {
    const events = adapter.parseLine(JSON.stringify({
      type: 'content_block_delta', delta: { text: 'code here' },
    }));
    expect(events[0].type).toBe('text-delta');
    if (events[0].type === 'text-delta') expect(events[0].text).toBe('code here');
  });

  it('parses text_delta type', () => {
    const events = adapter.parseLine(JSON.stringify({
      type: 'text_delta', text: 'response text',
    }));
    expect(events[0].type).toBe('text-delta');
    if (events[0].type === 'text-delta') expect(events[0].text).toBe('response text');
  });

  it('parses result as completed', () => {
    const events = adapter.parseLine(JSON.stringify({ type: 'result' }));
    expect(events[0].type).toBe('status');
    if (events[0].type === 'status') expect(events[0].state).toBe('completed');
  });

  it('parses error type', () => {
    const events = adapter.parseLine(JSON.stringify({ type: 'error', message: 'fail' }));
    expect(events[0].type).toBe('error');
    if (events[0].type === 'error') expect(events[0].message).toBe('fail');
  });

  it('parses tool_use as tool-call', () => {
    const events = adapter.parseLine(JSON.stringify({
      type: 'tool_use', name: 'edit_file', input: { path: 'x.ts' },
    }));
    expect(events[0].type).toBe('tool-call');
    if (events[0].type === 'tool-call') expect(events[0].tool).toBe('edit_file');
  });

  it('parses tool_result', () => {
    const events = adapter.parseLine(JSON.stringify({
      type: 'tool_result', tool_use_id: 'tu-1', content: 'result text',
    }));
    expect(events[0].type).toBe('tool-result');
  });

  it('passes non-JSON text as text-delta', () => {
    const events = adapter.parseLine('some plain text');
    expect(events[0].type).toBe('text-delta');
    if (events[0].type === 'text-delta') expect(events[0].text).toContain('some plain text');
  });

  it('returns empty for blank lines', () => {
    expect(adapter.parseLine('')).toHaveLength(0);
    expect(adapter.parseLine('   ')).toHaveLength(0);
  });

  it('extracts text from default type with .text field', () => {
    const events = adapter.parseLine(JSON.stringify({ type: 'unknown_type', text: 'fallback text' }));
    expect(events[0].type).toBe('text-delta');
    if (events[0].type === 'text-delta') expect(events[0].text).toBe('fallback text');
  });

  it('returns empty for default type without .text', () => {
    const events = adapter.parseLine(JSON.stringify({ type: 'unknown_type', data: 'nope' }));
    expect(events).toHaveLength(0);
  });
});

// ─── AiderAdapter ────────────────────────────────────────────────────────

describe('AiderAdapter', () => {
  const adapter = new AiderAdapter();

  it('has correct metadata', () => {
    expect(adapter.id).toBe('aider');
    expect(adapter.tier).toBe(3);
    expect(adapter.mode).toBe('oneshot');
  });

  it('builds args with --message and --yes', () => {
    const args = adapter.buildArgs(dummyTask, dummyConfig);
    expect(args).toContain('--message');
    expect(args).toContain('--yes');
    expect(args).toContain('--no-auto-commits');
  });

  it('appends /exit to input', () => {
    const input = adapter.formatInput(dummyTask);
    expect(input).toContain('/exit');
    expect(input).toContain('fix the bug in auth.ts');
  });

  it('parses assistant JSON', () => {
    const events = adapter.parseLine(JSON.stringify({
      type: 'assistant', content: 'Applied changes',
    }));
    expect(events[0].type).toBe('text-delta');
  });

  it('detects "Applied edit to" prefix', () => {
    const events = adapter.parseLine('Applied edit to src/auth.ts');
    expect(events[0].type).toBe('text-delta');
    if (events[0].type === 'text-delta') expect(events[0].text).toContain('Applied edit');
  });

  it('detects error lines', () => {
    const events = adapter.parseLine('Error: file not found');
    expect(events[0].type).toBe('error');
    if (events[0].type === 'error') expect(events[0].message).toContain('file not found');
  });

  it('passes through unknown text as text-delta', () => {
    const events = adapter.parseLine('some random output');
    expect(events[0].type).toBe('text-delta');
  });
});

// ─── CodexAdapter ────────────────────────────────────────────────────────

describe('CodexAdapter', () => {
  const adapter = new CodexAdapter();

  it('has correct metadata', () => {
    expect(adapter.id).toBe('codex');
    expect(adapter.tier).toBe(1);
  });

  it('builds --json args', () => {
    expect(adapter.buildArgs(dummyTask, dummyConfig)).toContain('--json');
  });

  it('parses item.content_part.delta', () => {
    const events = adapter.parseLine(JSON.stringify({
      type: 'item.content_part.delta', text: 'response text',
    }));
    expect(events[0].type).toBe('text-delta');
  });

  it('parses turn.completed', () => {
    const events = adapter.parseLine(JSON.stringify({ type: 'turn.completed' }));
    expect(events[0].type).toBe('status');
    if (events[0].type === 'status') expect(events[0].state).toBe('completed');
  });

  it('parses item.tool_call', () => {
    const events = adapter.parseLine(JSON.stringify({
      type: 'item.tool_call', name: 'edit_file', input: { path: 'x.ts' },
    }));
    expect(events[0].type).toBe('tool-call');
    if (events[0].type === 'tool-call') expect(events[0].tool).toBe('edit_file');
  });
});

// ─── GeminiAdapter ────────────────────────────────────────────────────────

describe('GeminiAdapter', () => {
  const adapter = new GeminiAdapter();

  it('builds --acp args', () => {
    expect(adapter.buildArgs(dummyTask, dummyConfig)).toContain('--acp');
  });

  it('formats input as JSON-RPC', () => {
    const input = adapter.formatInput(dummyTask);
    const parsed = JSON.parse(input);
    expect(parsed.jsonrpc).toBe('2.0');
    expect(parsed.method).toBe('session/prompt');
    expect(parsed.params.prompt).toBe('fix the bug in auth.ts');
  });

  it('parses session/new as working', () => {
    const events = adapter.parseLine(JSON.stringify({
      method: 'session/new', result: { sessionId: 'abc' },
    }));
    expect(events[0].type).toBe('status');
    if (events[0].type === 'status') expect(events[0].state).toBe('working');
  });

  it('parses result.text', () => {
    const events = adapter.parseLine(JSON.stringify({ result: { text: 'output' } }));
    expect(events[0].type).toBe('text-delta');
  });
});

// ─── OpenCodeAdapter ──────────────────────────────────────────────────────

describe('OpenCodeAdapter', () => {
  const adapter = new OpenCodeAdapter();

  it('builds -f json args', () => {
    const args = adapter.buildArgs(dummyTask, dummyConfig);
    expect(args).toContain('-f');
    expect(args).toContain('json');
  });

  it('parses text/response types', () => {
    const events = adapter.parseLine(JSON.stringify({ type: 'text', content: 'hello' }));
    expect(events[0].type).toBe('text-delta');
  });

  it('parses done/complete as completed', () => {
    const events = adapter.parseLine(JSON.stringify({ type: 'done' }));
    expect(events[0].type).toBe('status');
    if (events[0].type === 'status') expect(events[0].state).toBe('completed');
  });
});

// ─── GenericAdapter ───────────────────────────────────────────────────────

describe('GenericAdapter', () => {
  it('passes through all text as text-delta', () => {
    const adapter = new GenericAdapter('my-custom-cli');
    const events = adapter.parseLine('any output at all');
    expect(events).toHaveLength(1);
    expect(events[0].type).toBe('text-delta');
    if (events[0].type === 'text-delta') expect(events[0].text).toBe('any output at all');
  });

  it('returns empty for blank lines', () => {
    const adapter = new GenericAdapter();
    expect(adapter.parseLine('')).toHaveLength(0);
    expect(adapter.parseLine('   ')).toHaveLength(0);
  });
});

// ─── detectAdapter ─────────────────────────────────────────────────────────

describe('detectAdapter', () => {
  it('detects pi from "pi --mode rpc"', () => {
    expect(detectAdapter('pi --mode rpc').id).toBe('pi');
  });

  it('detects claude from "claude"', () => {
    expect(detectAdapter('claude').id).toBe('claude-code');
  });

  it('detects aider from "aider --model gpt-4"', () => {
    expect(detectAdapter('aider --model gpt-4').id).toBe('aider');
  });

  it('detects codex from "codex --json"', () => {
    expect(detectAdapter('codex --json').id).toBe('codex');
  });

  it('detects gemini from "gemini --acp"', () => {
    expect(detectAdapter('gemini --acp').id).toBe('gemini');
  });

  it('detects opencode from "opencode -f json"', () => {
    expect(detectAdapter('opencode -f json').id).toBe('opencode');
  });

  it('falls back to GenericAdapter for unknown commands', () => {
    expect(detectAdapter('my-custom-tool --flag').id).toBe('generic');
  });

  it('does NOT false-match "some-pi-wrapper" as pi', () => {
    expect(detectAdapter('some-pi-wrapper').id).toBe('generic');
  });

  it('does NOT false-match "claude-wrapper" as claude', () => {
    expect(detectAdapter('claude-wrapper').id).toBe('generic');
  });

  it('matches "pi" alone (exact)', () => {
    expect(detectAdapter('pi').id).toBe('pi');
  });

  it('matches binary with path prefix', () => {
    expect(detectAdapter('/usr/local/bin/claude --print').id).toBe('claude-code');
  });

  it('matches binary with relative path', () => {
    expect(detectAdapter('./node_modules/.bin/codex').id).toBe('codex');
  });

  it('handles empty string', () => {
    expect(detectAdapter('').id).toBe('generic');
  });

  it('does not match "picat" as pi', () => {
    expect(detectAdapter('picat').id).toBe('generic');
  });
});
