import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import RedisMock from 'ioredis-mock';
import { RedisTokenBucketStore } from '../src/ratelimit/RedisTokenBucketStore.js';
import { NaiveRedisTokenBucketStore } from '../src/ratelimit/NaiveRedisTokenBucketStore.js';
import { RedisTokenBucketLimiter } from '../src/ratelimit/RedisTokenBucketLimiter.js';

describe('Redis Rate Limiter Concurrency Tests', () => {
  let redisClient;

  beforeEach(async () => {
    // Spins up an in-memory Redis instance with full Lua engine support
    redisClient = new RedisMock();
    await redisClient.flushdb();
  });

  it('correctly limits concurrent requests using atomic Lua script', async () => {
    const capacity = 10;
    const refillRate = 1;
    const concurrentRequests = 50;
    const clientKey = 'user_atomic_test';

    const store = new RedisTokenBucketStore(redisClient);
    const limiter = new RedisTokenBucketLimiter({ capacity, refillRate, store });

    const now = Date.now();
    const tasks = Array.from({ length: concurrentRequests }, () =>
      limiter.consume(clientKey, 1, now)
    );

    const results = await Promise.all(tasks);

    const allowedCount = results.filter((r) => r.allowed).length;
    const rejectedCount = results.filter((r) => !r.allowed).length;

    assert.equal(allowedCount, capacity, `Expected exactly ${capacity} allowed requests, but got ${allowedCount}`);
    assert.equal(rejectedCount, concurrentRequests - capacity);
  });

  it('fails rate-limiting guarantees when using Naive (GET-then-SET) store', async () => {
    const capacity = 10;
    const refillRate = 1;
    const concurrentRequests = 50;
    const clientKey = 'user_naive_test';

    const naiveStore = new NaiveRedisTokenBucketStore(redisClient);
    const naiveLimiter = new RedisTokenBucketLimiter({ capacity, refillRate, store: naiveStore });

    const now = Date.now();
    const tasks = Array.from({ length: concurrentRequests }, () =>
      naiveLimiter.consume(clientKey, 1, now)
    );

    const results = await Promise.all(tasks);
    const allowedCount = results.filter((r) => r.allowed).length;

    assert.ok(
      allowedCount > capacity,
      `Race condition failed to trigger: Naive store allowed ${allowedCount}, expected > ${capacity}`
    );
  });
});