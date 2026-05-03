import { describe, it, expect } from 'vitest';
import type { Task } from '@a2a-js/sdk';
import { FangTaskStore } from '../fang-task-store.ts';

function makeTask(id: string, state: Task['status']['state']): Task {
  const now = new Date().toISOString();
  return {
    kind: 'task',
    id,
    contextId: `ctx-${id}`,
    status: {
      state,
      timestamp: now,
    },
    history: [],
  };
}

describe('FangTaskStore', () => {
  it('save and load upsert clone', async () => {
    const store = new FangTaskStore();
    const t = makeTask('a', 'working');
    await store.save(t);
    const loaded = await store.load('a');
    expect(loaded).toBeDefined();
    expect(loaded!.id).toBe('a');
    expect(loaded!.history).toEqual([]);
    loaded!.history = [{ kind: 'message', messageId: 'm1', role: 'user', parts: [{ kind: 'text', text: 'x' }] }];
    const again = await store.load('a');
    expect(again!.history).toEqual([]);
  });

  it('delete removes task', async () => {
    const store = new FangTaskStore();
    await store.save(makeTask('x', 'working'));
    await store.delete('x');
    expect(await store.load('x')).toBeUndefined();
  });

  it('evicts terminal tasks preferentially beyond maxTasks', async () => {
    const store = new FangTaskStore({ maxTasks: 2 });
    await store.save(makeTask('t1', 'completed'));
    await store.save(makeTask('t2', 'working'));
    await store.save(makeTask('t3', 'working'));
    expect(await store.load('t1')).toBeUndefined();
    expect(await store.load('t2')).toBeDefined();
    expect(await store.load('t3')).toBeDefined();
  });

  it('cleanupStaleCompleted removes old terminal rows', async () => {
    const store2 = new FangTaskStore({
      completedRetentionMinutes: 0,
    });
    await store2.save(makeTask('old', 'completed'));

    interface Intern {
      entries: Map<string, { terminalSinceMs: number | null; task: Task }>;
    }
    const wrap = store2 as unknown as Intern;
    const entry = wrap.entries.get('old');
    expect(entry).toBeDefined();

    Object.assign(entry!, { terminalSinceMs: Date.now() - 10 * 60 * 1000 });

    store2.cleanupStaleCompleted();
    expect(await store2.load('old')).toBeUndefined();
  });
});
