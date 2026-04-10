import express from "express";
import {
  DefaultExecutionEventBusManager,
  DefaultRequestHandler,
  InMemoryTaskStore,
} from "@a2a-js/sdk/server";
import {
  UserBuilder,
  agentCardHandler,
  jsonRpcHandler,
  restHandler,
} from "@a2a-js/sdk/server/express";
import type { BaseAdapter, FangConfig } from "./index.js";
import { apiKeyGate } from "./apiKeyGate.js";
import { FangAgentExecutor } from "./FangAgentExecutor.js";
import { buildSdkAgentCard } from "./sdkAgentCard.js";

/**
 * FangServer — A2A v1 server via @a2a-js/sdk (JSON-RPC + HTTP+JSON REST) + CLI subprocess bridge.
 */
export class FangServer {
  private readonly app = express();
  private readonly executor: FangAgentExecutor;
  private readonly effectiveApiKey: string | undefined;
  private server: import("http").Server | null = null;

  constructor(
    private readonly config: FangConfig,
    adapter: BaseAdapter
  ) {
    const publicBase =
      process.env.FANG_PUBLIC_URL ?? `http://localhost:${config.port}`;
    const agentCard = buildSdkAgentCard(config, publicBase);
    const apiKey = config.apiKey ?? process.env.FANG_API_KEY;
    this.effectiveApiKey = apiKey?.trim() || undefined;
    const gate = apiKeyGate(this.effectiveApiKey);
    this.executor = new FangAgentExecutor(config, adapter);
    const taskStore = new InMemoryTaskStore();
    const eventBusManager = new DefaultExecutionEventBusManager();
    const requestHandler = new DefaultRequestHandler(
      agentCard,
      taskStore,
      this.executor,
      eventBusManager
    );

    this.app.use(express.json({ limit: "20mb" }));

    const cardMw = agentCardHandler({
      agentCardProvider: requestHandler,
    });
    this.app.use("/.well-known/agent-card.json", cardMw);
    this.app.use("/.well-known/agent.json", cardMw);

    this.app.use(
      "/a2a",
      gate,
      jsonRpcHandler({
        requestHandler,
        userBuilder: UserBuilder.noAuthentication,
      })
    );

    this.app.get("/health", (_req, res) => {
      res.json({
        status: "ok",
        agent: this.config.name,
        bridge: "fang",
        sdk: "@a2a-js/sdk",
        uptime: Math.floor(process.uptime()),
        auth: this.effectiveApiKey ? "api-key" : "none",
      });
    });

    this.app.use(
      "/",
      gate,
      restHandler({
        requestHandler,
        userBuilder: UserBuilder.noAuthentication,
      })
    );
  }

  start(): Promise<void> {
    return new Promise((resolve) => {
      const host = this.config.host?.trim();
      const onListen = () => {
        const base =
          process.env.FANG_PUBLIC_URL ?? `http://localhost:${this.config.port}`;
        const authHint = this.effectiveApiKey
          ? " | API key required for /a2a and REST"
          : "";
        const bindLabel = host ? `${host}:${this.config.port}` : `:${this.config.port}`;
        console.log(
          `🦷 ${this.config.name} on ${bindLabel} | ` +
            `Card ${base}/.well-known/agent-card.json | ` +
            `JSON-RPC ${base}/a2a | REST ${base}/v1/…` +
            authHint
        );
        resolve();
      };

      this.server = host
        ? this.app.listen(this.config.port, host, onListen)
        : this.app.listen(this.config.port, onListen);
    });
  }

  /**
   * OS-assigned port when `config.port` was `0`. Call after `start()`.
   */
  listeningPort(): number {
    if (!this.server) {
      throw new Error("FangServer not started");
    }
    const addr = this.server.address();
    if (addr === null || typeof addr === "string") {
      throw new Error("Server address unavailable");
    }
    return addr.port;
  }

  stop(): Promise<void> {
    this.executor.killAll();
    return new Promise((resolve) => {
      if (this.server) {
        this.server.close(() => resolve());
      } else {
        resolve();
      }
    });
  }
}
