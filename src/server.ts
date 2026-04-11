/**
 * @fangai/server — A2A server + BridgeExecutor
 * Uses @a2a-js/sdk for protocol compliance.
 * Bridges CLI agents via ProcessManager (oneshot) and PersistentProcess.
 */

import { randomUUID } from 'node:crypto';
import type { AgentExecutor, RequestContext, ExecutionEventBus } from '@a2a-js/sdk/server';
import {
  DefaultRequestHandler, InMemoryTaskStore,
} from '@a2a-js/sdk/server';
import {
  agentCardHandler, jsonRpcHandler, restHandler, UserBuilder,
} from '@a2a-js/sdk/server/express';
import type { Request, Response, NextFunction } from 'express';
import express from 'express';
import {
  type AgentAdapter, type FangConfig, type AdapterEvent,
  ProcessManager, PersistentProcess,
} from './core.ts';

// ─── BridgeExecutor ────────────────────────────────────────────────────────

export class BridgeExecutor implements AgentExecutor {
  private pm = new ProcessManager();
  private persistent: PersistentProcess | null = null;
  private adapter: AgentAdapter;
  private config: FangConfig;

  constructor(adapter: AgentAdapter, config: FangConfig) {
    this.adapter = adapter;
    this.config = config;
  }

  async execute(ctx: RequestContext, bus: ExecutionEventBus): Promise<void> {
    const taskId = ctx.taskId;
    const contextId = ctx.contextId;

    // Extract user text
    const parts = ctx.userMessage.parts ?? [];
    const text = (parts as Array<{ kind?: string; text?: string }>)
      .filter(p => p.kind === 'text' && typeof p.text === 'string')
      .map(p => p.text!)
      .join('\n').trim();

    if (!text) {
      this.publishMessage(bus, taskId, contextId, 'No message text provided.');
      bus.finished();
      return;
    }

    const task = { id: taskId, message: text, context: { workdir: this.config.workdir } };

    if (this.adapter.mode === 'persistent') {
      await this.executePersistent(ctx, bus, task);
    } else {
      await this.executeOneshot(ctx, bus, task);
    }
  }

  private async executeOneshot(ctx: RequestContext, bus: ExecutionEventBus, task: { id: string; message: string; context?: any }): Promise<void> {
    const { taskId, contextId } = ctx;
    const config = this.config;
    const adapter = this.adapter;
    const timeout = config.taskTimeout ?? 300;

    const [cmd, ...cliArgs] = this.splitCli(config.cli);
    const extraArgs = adapter.buildArgs(task, config);
    let accumulated = '';
    let settled = false;

    return new Promise<void>((resolve) => {
      const timer = setTimeout(() => {
        if (settled) return;
        settled = true;
        this.pm.kill(taskId);
        this.publishMessage(bus, taskId, contextId, `Task timed out after ${timeout}s`);
        bus.finished();
        resolve();
      }, timeout * 1000);

      this.pm.spawn(taskId, cmd, [...cliArgs, ...extraArgs], {
        cwd: config.workdir, env: config.env,
      }, {
        onLine: (line) => {
          if (settled) return;
          const events = adapter.parseLine(line);
          for (const ev of events) {
            if (ev.type === 'text-delta' && ev.text) {
              accumulated += ev.text;
              bus.publish({
                kind: 'artifact-update', taskId, contextId,
                artifact: { artifactId: 'stdout', name: 'output', parts: [{ kind: 'text', text: ev.text }] },
                append: true, lastChunk: false,
              });
            }
            if (ev.type === 'status' && ev.state === 'completed') {
              settled = true;
              clearTimeout(timer);
              bus.publish({ kind: 'message', messageId: randomUUID(), role: 'agent', parts: [{ kind: 'text', text: accumulated || 'Done' }] });
              bus.finished();
              resolve();
            }
            if (ev.type === 'error') {
              settled = true;
              clearTimeout(timer);
              bus.publish({
                kind: 'status-update', taskId, contextId, final: true,
                status: { state: 'failed', message: { kind: 'message', role: 'agent', messageId: randomUUID(), parts: [{ kind: 'text', text: ev.message }] }, timestamp: new Date().toISOString() },
              });
              bus.finished();
              resolve();
            }
          }
        },
        onError: (text) => {
          bus.publish({
            kind: 'artifact-update', taskId, contextId,
            artifact: { artifactId: 'stderr', name: 'errors', parts: [{ kind: 'text', text }] },
          });
        },
        onExit: (code) => {
          clearTimeout(timer);
          if (settled) { resolve(); return; }
          settled = true;
          if (code === 0) {
            bus.publish({ kind: 'message', messageId: randomUUID(), role: 'agent', parts: [{ kind: 'text', text: accumulated || '(no output)' }] });
          } else {
            bus.publish({ kind: 'message', messageId: randomUUID(), role: 'agent', parts: [{ kind: 'text', text: `Error: exit code ${code}` }] });
          }
          bus.finished();
          resolve();
        },
      });

      this.pm.stdin(taskId, adapter.formatInput(task), true);
    });
  }

  private async executePersistent(ctx: RequestContext, bus: ExecutionEventBus, task: { id: string; message: string }): Promise<void> {
    const { taskId, contextId } = ctx;
    const config = this.config;
    const adapter = this.adapter;
    const timeout = config.taskTimeout ?? 600;

    // Ensure persistent process is running
    if (!this.persistent) {
      const [cmd, ...cliArgs] = this.splitCli(config.cli);
      const extraArgs = adapter.buildArgs(task, config);
      this.persistent = new PersistentProcess(cmd, [...cliArgs, ...extraArgs], { cwd: config.workdir, env: config.env });
    }

    await this.persistent.ensure();
    if (!this.persistent.isAlive) {
      this.publishMessage(bus, taskId, contextId, 'Failed to start persistent process');
      bus.finished();
      return;
    }

    let accumulated = '';
    let settled = false;

    // Timeout guard
    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      this.persistent!.removeLineHandler(taskId);
      this.publishMessage(bus, taskId, contextId, `Task timed out after ${timeout}s`);
      bus.finished();
    }, timeout * 1000);

    // Register per-task line handler — routes stdout to THIS task's bus
    this.persistent.setLineHandler(taskId, (line: string) => {
      if (settled) return;
      const events = adapter.parseLine(line);
      for (const ev of events) {
        if (ev.type === 'text-delta' && ev.text) {
          accumulated += ev.text;
          bus.publish({
            kind: 'artifact-update', taskId, contextId,
            artifact: { artifactId: 'stdout', name: 'output', parts: [{ kind: 'text', text: ev.text }] },
            append: true, lastChunk: false,
          });
        }
        if (ev.type === 'status' && ev.state === 'completed') {
          settled = true;
          clearTimeout(timer);
          // Publish final message for sync clients
          bus.publish({ kind: 'message', messageId: randomUUID(), role: 'agent', parts: [{ kind: 'text', text: accumulated || 'Done' }] });
          bus.finished();
          // Clean up handler after completion
          this.persistent!.removeLineHandler(taskId);
        }
        if (ev.type === 'status' && ev.state === 'working') {
          bus.publish({
            kind: 'status-update', taskId, contextId, final: false,
            status: { state: 'working', timestamp: new Date().toISOString() },
          });
        }
        if (ev.type === 'error') {
          settled = true;
          clearTimeout(timer);
          bus.publish({
            kind: 'status-update', taskId, contextId, final: true,
            status: { state: 'failed', message: { kind: 'message', role: 'agent', messageId: randomUUID(), parts: [{ kind: 'text', text: ev.message }] }, timestamp: new Date().toISOString() },
          });
          bus.finished();
          this.persistent!.removeLineHandler(taskId);
        }
      }
    });

    // Send the task to the persistent process
    this.persistent.write(adapter.formatInput(task));
  }

  async cancelTask(taskId: string, bus: ExecutionEventBus): Promise<void> {
    this.pm.kill(taskId);
    if (this.persistent) this.persistent.removeLineHandler(taskId);
    bus.publish({ kind: 'message', messageId: randomUUID(), role: 'agent', parts: [{ kind: 'text', text: 'Task canceled' }] });
    bus.finished();
  }

  async shutdown(): Promise<void> {
    this.pm.killAll();
    if (this.persistent) await this.persistent.kill();
  }

  // ─── Helpers ───────────────────────────────────────────────────────────

  private publishMessage(bus: ExecutionEventBus, taskId: string, contextId: string, text: string) {
    bus.publish({
      kind: 'status-update', taskId, contextId, final: true,
      status: { state: 'failed', message: { kind: 'message', role: 'agent', messageId: randomUUID(), parts: [{ kind: 'text', text }] }, timestamp: new Date().toISOString() },
    });
  }

  private splitCli(cli: string): string[] {
    const parts: string[] = [];
    let cur = '', inQ: string | null = null;
    for (const ch of cli) {
      if (inQ) { if (ch === inQ) inQ = null; else cur += ch; }
      else if (ch === '"' || ch === "'") inQ = ch;
      else if (ch === ' ' || ch === '\t') { if (cur) { parts.push(cur); cur = ''; } }
      else cur += ch;
    }
    if (cur) parts.push(cur);
    return parts;
  }
}

// ─── Server Factory ─────────────────────────────────────────────────────────

export function createFangServer(config: FangConfig & { adapter: AgentAdapter }) {
  const { adapter, port, ...rest } = config;
  const name = config.name || adapter.displayName + '-agent';

  const agentCard = {
    name,
    description: `${adapter.displayName} via fang — A2A bridge`,
    protocolVersion: '0.3.0',
    version: '1.0.0',
    url: `http://localhost:${port}`,
    capabilities: { streaming: true },
    skills: adapter.skills,
    defaultInputModes: ['text/plain'],
    defaultOutputModes: ['text/plain'],
  };

  const executor = new BridgeExecutor(adapter, { ...rest, port });
  const requestHandler = new DefaultRequestHandler(agentCard, new InMemoryTaskStore(), executor);

  return {
    executor,
    agentCard,
    requestHandler,
    setupApp: (app: express.Express) => {
      app.use(express.json({ limit: '10mb' }));

      // CORS
      if (config.cors) {
        app.use((_req: Request, res: Response, next: NextFunction) => {
          res.setHeader('Access-Control-Allow-Origin', '*');
          res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
          res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
          if (_req.method === 'OPTIONS') return res.sendStatus(204);
          next();
        });
      }

      // Auth
      if (config.apiKey) {
        app.use((req: Request, res: Response, next: NextFunction) => {
          if (req.headers.authorization !== `Bearer ${config.apiKey}`) {
            return res.status(401).json({ error: { message: 'Unauthorized' } });
          }
          next();
        });
      }

      // A2A endpoints — powered by @a2a-js/sdk
      app.use('/.well-known/agent-card.json', agentCardHandler({ agentCardProvider: requestHandler }));
      app.use('/a2a/jsonrpc', jsonRpcHandler({ requestHandler, userBuilder: UserBuilder.noAuthentication }));
      app.use('/a2a/rest', restHandler({ requestHandler, userBuilder: UserBuilder.noAuthentication }));

      // Health
      app.get('/health', (_req, res) => {
        res.json({ status: 'ok', agent: name, mode: adapter.mode, tier: adapter.tier });
      });
    },
  };
}