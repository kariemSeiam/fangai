/**
 * Tests for @fangai/client — FangClient, discoverAgents
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { FangClient, discoverAgents } from '../client.ts';

// ─── FangClient ──────────────────────────────────────────────────────────

describe('FangClient', () => {
  it('normalizes baseUrl (strips trailing slash)', () => {
    // Access private field for testing
    const client = new FangClient('http://localhost:3001/');
    expect((client as any).baseUrl).toBe('http://localhost:3001');
  });

  it('constructs with clean URL', () => {
    const client = new FangClient('http://localhost:3001');
    expect((client as any).baseUrl).toBe('http://localhost:3001');
  });
});

// ─── discoverAgents ──────────────────────────────────────────────────────

describe('discoverAgents', () => {
  it('returns empty array when no agents running', async () => {
    // Scan a port that's almost certainly not running a fang agent
    const result = await discoverAgents([19999]);
    expect(result).toEqual([]);
  });

  it('handles all ports failing gracefully', async () => {
    const result = await discoverAgents([19998, 19997, 19996]);
    expect(result).toEqual([]);
  });

  it('uses Promise.allSettled for concurrency (does not throw)', async () => {
    // This should never throw even if all connections fail
    await expect(discoverAgents([19995])).resolves.toEqual([]);
  });
});
