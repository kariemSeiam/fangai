#!/usr/bin/env node
/**
 * fang — Any CLI coding agent. A2A citizen. One command.
 * Entry point — re-exports everything and runs CLI.
 */

export { PiAdapter, ClaudeAdapter, AiderAdapter, CodexAdapter, GeminiAdapter, OpenCodeAdapter, GenericAdapter, detectAdapter, ALL_ADAPTERS } from './adapters.ts';
export { BridgeExecutor, createFangServer } from './server.ts';
export { FangClient, discoverAgents } from './client.ts';
export { ProcessManager, PersistentProcess, detectAdapters } from './core.ts';
export type { AgentAdapter, AgentTask, FangConfig, AdapterEvent, DetectionResult } from './core.ts';

// Run CLI when executed directly
import './cli.js';
