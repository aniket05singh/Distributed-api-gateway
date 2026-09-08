import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { TokenBucketLimiter } from '../src/ratelimit/TokenBucketLimiter.js';
import { MemoryStore } from '../src/ratelimit/MemoryStore.js';

describe('TokenBucketLimiter (In-Memory)', () => {
  let store;
  let limiter;

  beforeEach(() => {
    store = new MemoryStore();
    limiter = new TokenBucketLimiter({
      capacity: 5,
      refillRate: 2, // 2 tokens per second
      store
    });
  });

  it('allows requests within capacity', async () => {
    const key = 'client-1';
    const now = 1000000;

    const res1 = await limiter.consume(key, 1, now);
    const res2 = await limiter.consume(key, 1, now);
    const res3 = await limiter.consume(key, 1, now);

    assert.equal(res1.allowed, true);
    assert.equal(res1.remainingTokens, 4);
    assert.equal(res2.remainingTokens, 3);
    assert.equal(res3.remainingTokens, 2);
  });

  it('rejects requests when bucket is exhausted', async () => {
    const key = 'client-2';
    const now = 1000000;

    // Consume all 5 tokens
    for (let i = 0; i < 5; i++) {
      const res = await limiter.consume(key, 1, now);
      assert.equal(res.allowed, true);
    }

    // 6th request must fail
    const rejected = await limiter.consume(key, 1, now);
    assert.equal(rejected.allowed, false);
    assert.equal(rejected.remainingTokens, 0);
    assert.equal(rejected.retryAfter, 1); // 1 token needed at 2 tokens/sec = 0.5s -> ceil = 1s
  });

  it('correctly refills tokens over time', async () => {
    const key = 'client-3';
    let now = 1000000;

    // Drain all tokens
    await limiter.consume(key, 5, now);

    // Immediate next request should fail
    const rejected = await limiter.consume(key, 1, now);
    assert.equal(rejected.allowed, false);

    // Advance 1000ms (refills 2 tokens)
    now += 1000;
    const res1 = await limiter.consume(key, 1, now);
    assert.equal(res1.allowed, true);
    assert.equal(res1.remainingTokens, 1);

    const res2 = await limiter.consume(key, 1, now);
    assert.equal(res2.allowed, true);
    assert.equal(res2.remainingTokens, 0);

    const res3 = await limiter.consume(key, 1, now);
    assert.equal(res3.allowed, false);
  });

  it('caps refilled tokens at max capacity', async () => {
    const key = 'client-4';
    let now = 1000000;

    // Use 1 token, leaving 4
    await limiter.consume(key, 1, now);

    // Wait 10 seconds (would generate 20 tokens, but max is 5)
    now += 10000;

    const res = await limiter.consume(key, 1, now);
    assert.equal(res.allowed, true);
    assert.equal(res.remainingTokens, 4); // 5 - 1 = 4
  });
});