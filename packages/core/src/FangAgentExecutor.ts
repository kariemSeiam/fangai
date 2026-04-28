import { spawn, type ChildProcess } from "child_process";
import { createInterface } from "readline";
import type {
  AgentExecutor,
  ExecutionEventBus,
  RequestContext,
} from "@a2a-js/sdk/server";
import type { TaskArtifactUpdateEvent, TaskStatusUpdateEvent } from "@a2a-js/sdk";
import type { BaseAdapter, FangConfig, Task as FangTask, TaskUpdate } from "./index.js";
import { runOpenCodeServeTurn } from "./openCodeServeBridge.js";
import { splitCli } from "./splitCli.js";

function messageText(ctx: RequestContext): string {
  const parts = ctx.userMessage.parts ?? [];
  const chunks: string[] = [];
  for (const p of parts as Array<{ kind?: string; text?: string }>) {
    if (p.kind === "text" && typeof p.text === "string") chunks.push(p.text);
  }
  return chunks.join("\n").trim() || "(empty message)";
}

function artifactText(
  taskId: string,
  contextId: string,
  artifactId: string,
  name: string,
  text: string,
  lastChunk?: boolean
): TaskArtifactUpdateEvent {
  return {
    kind: "artifact-update",
    taskId,
    contextId,
    artifact: {
      artifactId,
      name,
      parts: [{ kind: "text", text }],
    },
    ...(lastChunk !== undefined ? { lastChunk } : {}),
  };
}

function makeFailStatus(
  taskId: string,
  contextId: string,
  msg: string
): TaskStatusUpdateEvent {
  return {
    kind: "status-update",
    taskId,
    contextId,
    final: true,
    status: {
      state: "failed",
      message: {
        kind: "message",
        role: "agent",
        messageId: crypto.randomUUID(),
        parts: [{ kind: "text", text: msg }],
      },
      timestamp: new Date().toISOString(),
    },
  };
}

type ActivePersistent = {
  taskId: string;
  contextId: string;
  eventBus: ExecutionEventBus;
  finishExecute: () => void;
};

/** After SIGTERM, force-kill if the child is still alive (Windows: best-effort). */
const KILL_ESCALATION_MS = 5000;

function scheduleKillAfterSigterm(proc: ChildProcess): NodeJS.Timeout {
  return setTimeout(() => {
    try {
      if (proc.exitCode === null && proc.signalCode === null) {
        proc.kill("SIGKILL");
      }
    } catch {
      /* ignore */
    }
  }, KILL_ESCALATION_MS);
}

/**
 * Bridges A2A execution to a subprocess CLI via adapters (Fang's core value).
 * Supports **oneshot** (spawn per task) and **persistent** (Pi `--mode rpc`, one process).
 */
export class FangAgentExecutor implements AgentExecutor {
  private readonly processes = new Map<string, ChildProcess>();
  private readonly contextByTask = new Map<string, string>();

  private persistentShell: ChildProcess | null = null;
  private activePersistent: ActivePersistent | null = null;

  constructor(
    private readonly config: FangConfig,
    private readonly adapter: BaseAdapter
  ) {}

  async execute(
    ctx: RequestContext,
    eventBus: ExecutionEventBus
  ): Promise<void> {
    const taskId = ctx.taskId;
    const contextId = ctx.contextId;
    this.contextByTask.set(taskId, contextId);
    const text = messageText(ctx);

    eventBus.publish({
      kind: "status-update",
      taskId,
      contextId,
      final: false,
      status: {
        state: "working",
        timestamp: new Date().toISOString(),
      },
    } satisfies TaskStatusUpdateEvent);

    if (this.config.openCodeServeUrl) {
      if (this.adapter.executionMode === "persistent") {
        this.contextByTask.delete(taskId);
        eventBus.publish(
          makeFailStatus(
            taskId,
            contextId,
            "openCodeServeUrl cannot be used with persistent CLI adapters (e.g. pi --mode rpc)"
          )
        );
        eventBus.finished();
        return;
      }
      if (!/\bopencode\b/.test(this.config.cli)) {
        this.contextByTask.delete(taskId);
        eventBus.publish(
          makeFailStatus(
            taskId,
            contextId,
            "openCodeServeUrl requires a CLI string containing opencode (e.g. fang wrap opencode --open-code-url …)"
          )
        );
        eventBus.finished();
        return;
      }
      return this.executeOpenCodeServe(ctx, text, eventBus);
    }

    if (this.adapter.executionMode === "persistent") {
      return this.executePersistent(ctx, text, eventBus);
    }

    return this.executeOneshot(ctx, text, eventBus);
  }

  private async executeOpenCodeServe(
    ctx: RequestContext,
    text: string,
    eventBus: ExecutionEventBus
  ): Promise<void> {
    const taskId = ctx.taskId;
    const contextId = ctx.contextId;
    const timeoutSec = this.config.timeout ?? 300;
    let settled = false;

    const finishFail = (msg: string) => {
      if (settled) return;
      settled = true;
      this.contextByTask.delete(taskId);
      eventBus.publish(makeFailStatus(taskId, contextId, msg));
      eventBus.finished();
    };

    const finishOk = () => {
      if (settled) return;
      settled = true;
      this.contextByTask.delete(taskId);
      eventBus.publish({
        kind: "status-update",
        taskId,
        contextId,
        final: true,
        status: {
          state: "completed",
          timestamp: new Date().toISOString(),
        },
      } satisfies TaskStatusUpdateEvent);
      eventBus.finished();
    };

    await runOpenCodeServeTurn({
      baseUrl: this.config.openCodeServeUrl!,
      password: this.config.openCodeServePassword,
      directory: this.config.openCodeDirectory,
      text,
      adapter: this.adapter,
      timeoutSec,
      onUpdate: (u) => {
        if (!u || settled) return;
        switch (u.type) {
          case "progress":
            if (u.text) {
              eventBus.publish(
                artifactText(taskId, contextId, "cli-stdout", "stdout", u.text)
              );
            }
            break;
          case "log":
            eventBus.publish(
              artifactText(
                taskId,
                contextId,
                `log-${u.level}`,
                u.level,
                u.text
              )
            );
            break;
          case "complete":
            finishOk();
            break;
          case "failed":
            finishFail(u.text);
            break;
          default:
            break;
        }
      },
    });

    if (!settled) {
      finishOk();
    }
  }

  private async executePersistent(
    ctx: RequestContext,
    text: string,
    eventBus: ExecutionEventBus
  ): Promise<void> {
    const taskId = ctx.taskId;
    const contextId = ctx.contextId;

    if (this.activePersistent) {
      this.contextByTask.delete(taskId);
      eventBus.publish(
        makeFailStatus(
          taskId,
          contextId,
          "Persistent CLI is busy with another task. Wait for completion or cancel the running task."
        )
      );
      eventBus.finished();
      return;
    }

    const timeoutMs = this.config.timeout ? this.config.timeout * 1000 : 300_000;

    return new Promise<void>((resolve) => {
      let settled = false;
      const finishExecute = () => {
        if (!settled) { settled = true; resolve(); }
      };

      this.activePersistent = {
        taskId,
        contextId,
        eventBus,
        finishExecute,
      };

      const turnPromise = this.runPersistentTurn(text).catch((e) => {
        const msg = e instanceof Error ? e.message : String(e);
        if (this.activePersistent?.taskId === taskId) {
          eventBus.publish(makeFailStatus(taskId, contextId, msg));
          eventBus.finished();
          this.activePersistent = null;
          this.contextByTask.delete(taskId);
        }
        finishExecute();
      });

      const timer = setTimeout(() => {
        if (settled) return;
        settled = true;
        if (this.activePersistent?.taskId === taskId) {
          eventBus.publish(
            makeFailStatus(taskId, contextId, `Persistent mode timed out after ${timeoutMs}ms`)
          );
          eventBus.finished();
          this.activePersistent = null;
          this.contextByTask.delete(taskId);
        }
        if (this.persistentShell) {
          this.persistentShell.kill("SIGTERM");
          scheduleKillAfterSigterm(this.persistentShell);
          this.persistentShell = null;
        }
      }, timeoutMs);

      void turnPromise.then(() => clearTimeout(timer));
    });
  }

  private async runPersistentTurn(userText: string): Promise<void> {
    const ap = this.activePersistent;
    if (!ap) return;

    await this.ensurePersistentShell();

    const proc = this.persistentShell;
    if (!proc?.stdin) {
      this.endPersistentFromError(ap, "Persistent process has no stdin");
      return;
    }

    const fangTask: FangTask = { id: ap.taskId, message: userText };
    const input = this.adapter.formatInput(fangTask);
    proc.stdin.write(input.endsWith("\n") ? input : `${input}\n`);
  }

  private async ensurePersistentShell(): Promise<void> {
    if (this.persistentShell && !this.persistentShell.killed) {
      return;
    }

    const parts = splitCli(this.config.cli);
    const cmd = parts[0];
    const baseArgs = parts.slice(1);

    const proc = spawn(cmd, [...baseArgs, ...(this.config.args ?? [])], {
      stdio: ["pipe", "pipe", "pipe"],
      env: { ...process.env },
    });

    this.persistentShell = proc;

    if (proc.stdout) {
      const rl = createInterface({
        input: proc.stdout,
        crlfDelay: Infinity,
      });
      rl.on("line", (line) => {
        if (!line.trim()) return;
        this.handlePersistentLine(line);
      });
    }

    proc.stderr?.on("data", (chunk: Buffer) => {
      const ap = this.activePersistent;
      if (!ap) return;
      ap.eventBus.publish(
        artifactText(
          ap.taskId,
          ap.contextId,
          "cli-stderr",
          "stderr",
          chunk.toString()
        )
      );
    });

    proc.on("exit", (code) => {
      this.persistentShell = null;
      const ap = this.activePersistent;
      if (ap) {
        this.endPersistentFromError(
          ap,
          code === 0
            ? "Persistent process exited"
            : `Persistent process exited with code ${code}`
        );
      }
    });

    proc.on("error", (err) => {
      this.persistentShell = null;
      const ap = this.activePersistent;
      if (ap) {
        this.endPersistentFromError(ap, err.message);
      }
    });

    await new Promise<void>((r) => {
      proc.once("spawn", () => r());
      proc.once("error", () => r());
    });
  }

  private handlePersistentLine(line: string): void {
    const ap = this.activePersistent;
    if (!ap) return;

    const u = this.adapter.parseOutput(line);
    if (!u) return;

    switch (u.type) {
      case "progress":
        if (u.text) {
          ap.eventBus.publish(
            artifactText(
              ap.taskId,
              ap.contextId,
              "cli-stdout",
              "stdout",
              u.text
            )
          );
        }
        break;
      case "log":
        ap.eventBus.publish(
          artifactText(
            ap.taskId,
            ap.contextId,
            `log-${u.level}`,
            u.level,
            u.text
          )
        );
        break;
      case "complete":
        this.endPersistentSuccess(ap);
        break;
      case "failed":
        this.endPersistentFailure(ap, u.text);
        break;
      default:
        break;
    }
  }

  private endPersistentSuccess(ap: ActivePersistent): void {
    if (!this.activePersistent || this.activePersistent.taskId !== ap.taskId) {
      return;
    }
    this.activePersistent = null;
    this.contextByTask.delete(ap.taskId);
    ap.eventBus.publish({
      kind: "status-update",
      taskId: ap.taskId,
      contextId: ap.contextId,
      final: true,
      status: {
        state: "completed",
        timestamp: new Date().toISOString(),
      },
    } satisfies TaskStatusUpdateEvent);
    ap.eventBus.finished();
    ap.finishExecute();
  }

  private endPersistentFailure(ap: ActivePersistent, msg: string): void {
    if (!this.activePersistent || this.activePersistent.taskId !== ap.taskId) {
      return;
    }
    this.activePersistent = null;
    this.contextByTask.delete(ap.taskId);
    ap.eventBus.publish(makeFailStatus(ap.taskId, ap.contextId, msg));
    ap.eventBus.finished();
    ap.finishExecute();
  }

  private endPersistentFromError(ap: ActivePersistent, msg: string): void {
    if (!this.activePersistent || this.activePersistent.taskId !== ap.taskId) {
      return;
    }
    this.activePersistent = null;
    this.contextByTask.delete(ap.taskId);
    ap.eventBus.publish(makeFailStatus(ap.taskId, ap.contextId, msg));
    ap.eventBus.finished();
    ap.finishExecute();
  }

  private async executeOneshot(
    ctx: RequestContext,
    text: string,
    eventBus: ExecutionEventBus
  ): Promise<void> {
    const taskId = ctx.taskId;
    const contextId = ctx.contextId;
    const timeoutSec = this.config.timeout ?? 300;

    const parts = splitCli(this.config.cli);
    const cmd = parts[0];
    const baseArgs = parts.slice(1);

    const proc = spawn(cmd, [...baseArgs, ...(this.config.args ?? [])], {
      stdio: ["pipe", "pipe", "pipe"],
      env: { ...process.env },
    });
    this.processes.set(taskId, proc);

    const fangTask: FangTask = { id: taskId, message: text };
    const input = this.adapter.formatInput(fangTask);
    proc.stdin.write(input);
    proc.stdin.end();

    await new Promise<void>((resolve, reject) => {
      let settled = false;
      let executionResolved = false;
      let killEscalation: NodeJS.Timeout | null = null;

      const safeResolve = () => {
        if (executionResolved) return;
        executionResolved = true;
        resolve();
      };

      const timer = setTimeout(() => {
        if (settled) return;
        settled = true;
        proc.kill("SIGTERM");
        killEscalation = scheduleKillAfterSigterm(proc);
        this.cleanupTask(taskId);
        eventBus.publish(
          makeFailStatus(taskId, contextId, `Task timed out after ${timeoutSec}s`)
        );
        eventBus.finished();
        safeResolve();
      }, timeoutSec * 1000);

      const applyUpdate = (u: TaskUpdate | null) => {
        if (!u || settled) return;
        switch (u.type) {
          case "progress":
            if (u.text) {
              eventBus.publish(
                artifactText(taskId, contextId, "cli-stdout", "stdout", u.text)
              );
            }
            break;
          case "log":
            eventBus.publish(
              artifactText(
                taskId,
                contextId,
                `log-${u.level}`,
                u.level,
                u.text
              )
            );
            break;
          case "complete":
            break;
          case "failed":
            settled = true;
            clearTimeout(timer);
            eventBus.publish(makeFailStatus(taskId, contextId, u.text));
            proc.kill("SIGTERM");
            killEscalation = scheduleKillAfterSigterm(proc);
            this.cleanupTask(taskId);
            eventBus.finished();
            safeResolve();
            break;
          default:
            break;
        }
      };

      if (proc.stdout) {
        const stdoutRl = createInterface({
          input: proc.stdout,
          crlfDelay: Infinity,
        });
        stdoutRl.on("line", (line) => {
          if (settled) return;
          if (!line.trim()) return;
          applyUpdate(this.adapter.parseOutput(line));
        });
      }

      proc.stderr.on("data", (chunk: Buffer) => {
        if (settled) return;
        eventBus.publish(
          artifactText(taskId, contextId, "cli-stderr", "stderr", chunk.toString())
        );
      });

      proc.on("exit", (code) => {
        clearTimeout(timer);
        if (killEscalation) {
          clearTimeout(killEscalation);
          killEscalation = null;
        }
        if (settled) {
          safeResolve();
          return;
        }
        settled = true;
        this.cleanupTask(taskId);

        eventBus.publish({
          kind: "status-update",
          taskId,
          contextId,
          final: true,
          status: {
            state: code === 0 ? "completed" : "failed",
            timestamp: new Date().toISOString(),
            ...(code !== 0
              ? {
                  message: {
                    kind: "message",
                    role: "agent",
                    messageId: crypto.randomUUID(),
                    parts: [
                      {
                        kind: "text",
                        text: `CLI exited with code ${code}`,
                      },
                    ],
                  },
                }
              : {}),
          },
        } satisfies TaskStatusUpdateEvent);
        eventBus.finished();
        safeResolve();
      });

      proc.on("error", (err) => {
        clearTimeout(timer);
        if (killEscalation) {
          clearTimeout(killEscalation);
          killEscalation = null;
        }
        if (settled) {
          reject(err);
          return;
        }
        settled = true;
        this.cleanupTask(taskId);
        eventBus.publish(makeFailStatus(taskId, contextId, err.message));
        eventBus.finished();
        reject(err);
      });
    });
  }

  private cleanupTask(taskId: string): void {
    this.processes.delete(taskId);
    this.contextByTask.delete(taskId);
  }

  async cancelTask(taskId: string, eventBus: ExecutionEventBus): Promise<void> {
    const ctxId = this.contextByTask.get(taskId) ?? "";

    if (this.activePersistent?.taskId === taskId) {
      try {
        this.persistentShell?.stdin?.write(
          `${JSON.stringify({ type: "abort" })}\n`
        );
      } catch {
        /* ignore */
      }
      if (this.persistentShell) {
        this.persistentShell.kill("SIGTERM");
        scheduleKillAfterSigterm(this.persistentShell);
        this.persistentShell = null;
      }
      const ap = this.activePersistent;
      this.activePersistent = null;
      this.contextByTask.delete(taskId);
      ap.eventBus.finished();
      ap.finishExecute();
    }

    const proc = this.processes.get(taskId);
    if (proc) {
      proc.kill("SIGTERM");
      this.cleanupTask(taskId);
    }

    eventBus.publish({
      kind: "status-update",
      taskId,
      contextId: ctxId,
      final: true,
      status: {
        state: "canceled",
        timestamp: new Date().toISOString(),
      },
    } satisfies TaskStatusUpdateEvent);
    eventBus.finished();
  }

  /** Kill all subprocesses (server shutdown). */
  killAll(): void {
    for (const [, proc] of this.processes) {
      proc.kill("SIGTERM");
    }
    this.processes.clear();

    if (this.persistentShell) {
      this.persistentShell.kill("SIGTERM");
      this.persistentShell = null;
    }
    this.activePersistent = null;
    this.contextByTask.clear();
  }
}
