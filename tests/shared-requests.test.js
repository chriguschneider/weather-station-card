// Unit tests for src/utils/shared-requests.ts — module-level request
// dedup shared by every card instance in the tab (ADR-0020).

import { describe, it, expect, beforeEach } from 'vitest';
import { dedupeRequest, clearDedupeCaches } from '../src/utils/shared-requests.js';

describe('dedupeRequest', () => {
  beforeEach(() => {
    clearDedupeCaches();
  });

  it('collapses concurrent callers with the same key into one fn() call', async () => {
    let calls = 0;
    let release;
    const gate = new Promise((resolve) => { release = resolve; });
    const fn = async () => { calls++; await gate; return 'payload'; };

    const p1 = dedupeRequest('k', 1000, fn);
    const p2 = dedupeRequest('k', 1000, fn);
    release();
    expect(await p1).toBe('payload');
    expect(await p2).toBe('payload');
    expect(calls).toBe(1);
  });

  it('serves a settled result from the TTL cache without re-calling fn', async () => {
    let calls = 0;
    let clock = 0;
    const now = () => clock;
    const fn = async () => { calls++; return { rows: [1, 2] }; };

    const first = await dedupeRequest('k', 1000, fn, now);
    clock = 500;
    const second = await dedupeRequest('k', 1000, fn, now);
    expect(second).toBe(first); // same shared reference, no clone
    expect(calls).toBe(1);
  });

  it('refetches once the TTL expired', async () => {
    let calls = 0;
    let clock = 0;
    const now = () => clock;
    const fn = async () => { calls++; return calls; };

    expect(await dedupeRequest('k', 1000, fn, now)).toBe(1);
    clock = 1001;
    expect(await dedupeRequest('k', 1000, fn, now)).toBe(2);
    expect(calls).toBe(2);
  });

  it('keys are independent', async () => {
    let calls = 0;
    const fn = async () => { calls++; return calls; };
    expect(await dedupeRequest('a', 1000, fn)).toBe(1);
    expect(await dedupeRequest('b', 1000, fn)).toBe(2);
  });

  it('propagates a rejection to every concurrent caller and never caches it', async () => {
    let calls = 0;
    const failing = async () => { calls++; throw new Error(`boom ${calls}`); };

    const p1 = dedupeRequest('k', 1000, failing);
    const p2 = dedupeRequest('k', 1000, failing);
    await expect(p1).rejects.toThrow('boom 1');
    await expect(p2).rejects.toThrow('boom 1');
    expect(calls).toBe(1);

    // Next call retries fresh instead of serving the failure.
    await expect(dedupeRequest('k', 1000, failing)).rejects.toThrow('boom 2');
    expect(calls).toBe(2);
  });

  it('prunes the oldest results beyond the FIFO cap', async () => {
    let calls = 0;
    const now = () => 0;
    const fn = async () => { calls++; return calls; };

    // Fill well past MAX_RESULTS (32) with distinct keys.
    for (let i = 0; i < 40; i++) {
      await dedupeRequest(`k${i}`, 10_000, fn, now);
    }
    expect(calls).toBe(40);
    // k0 was evicted — calling it again re-invokes fn...
    await dedupeRequest('k0', 10_000, fn, now);
    expect(calls).toBe(41);
    // ...while a recent key still serves from cache.
    await dedupeRequest('k39', 10_000, fn, now);
    expect(calls).toBe(41);
  });
});
