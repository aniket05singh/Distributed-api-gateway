import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import RedisMock from 'ioredis-mock';
import { RateLimiterFactory } from '../src/ratelimit/RateLimiterFactory.js';
import { RedisSlidingWindowLogStore } from '../src/ratelimit/RedisSlidingWindowLogStore.js';
import { RedisSlidingWindowCounterStore } from '../src/ratelimit/RedisSlidingWindowCounterStore.js';

describe('Sliding Window Implementations & Strategy Router', () => {
  let redisClient;
  let factory;

  beforeEach(async () => {
    redisClient = new RedisMock();
    await redisClient.flushdb();
    factory = new RateLimiterFactory(redisClient);
  });

  it('Sliding Window Log: precision enforcement under burst', async () => {
    const swl = new RedisSlidingWindowLogStore(redisClient);
    const windowMs = 1000;
    const limit = 3;
    const now = 10000;

    assert.equal((await swl.consume('client_log', limit, windowMs, now)).allowed, true);
    assert.equal((await swl.consume('client_log', limit, windowMs, now + 100)).allowed, true);
    assert.equal((await swl.consume('client_log', limit, windowMs, now + 200)).allowed, true);

    // 4th request within 1s rejected
    assert.equal((await swl.consume('client_log', limit, windowMs, now + 300)).allowed, false);

    // After window slides past first entry (10000 + 1001ms)
    assert.equal((await swl.consume('client_log', limit, windowMs, now + 1001)).allowed, true);
  });

  it('Sliding Window Counter: weighted boundary approximation', async () => {
    const swc = new RedisSlidingWindowCounterStore(redisClient);
    const windowMs = 1000;
    const limit = 10;

    // Window 0 (0-999ms): send 10 requests at timestamp 500
    for (let i = 0; i < 10; i++) {
      await swc.consume('client_counter', limit, windowMs, 500);
    }

    // At timestamp 1250ms (25% into window 1):
    // prevCount weight is 75% -> 10 * 0.75 = 7 estimated requests.
    // 3 more requests should be allowed (total estimated limit = 10)
    assert.equal((await swc.consume('client_counter', limit, windowMs, 1250)).allowed, true);
    assert.equal((await swc.consume('client_counter', limit, windowMs, 1250)).allowed, true);
    assert.equal((await swc.consume('client_counter', limit, windowMs, 1250)).allowed, false);
  });

  it('RateLimiterFactory: routes dynamically based on configuration', async () => {
    const logClientConfig = { strategy: 'SLIDING_WINDOW_LOG', limit: 2, windowMs: 1000 };
    const tbClientConfig = { strategy: 'TOKEN_BUCKET', capacity: 2, refillRate: 1 };

    const res1 = await factory.checkLimit({ key: 'user1', clientConfig: logClientConfig, now: 1000 });
    const res2 = await factory.checkLimit({ key: 'user2', clientConfig: tbClientConfig, now: 1000 });

    assert.equal(res1.allowed, true);
    assert.equal(res2.allowed, true);
  });
});