import { RedisTokenBucketStore } from './RedisTokenBucketStore.js';
import { RedisSlidingWindowLogStore } from './RedisSlidingWindowLogStore.js';
import { RedisSlidingWindowCounterStore } from './RedisSlidingWindowCounterStore.js';

export class RateLimiterFactory {
  constructor(redisClient) {
    this.redis = redisClient;
    this.tbStore = new RedisTokenBucketStore(redisClient);
    this.swlStore = new RedisSlidingWindowLogStore(redisClient);
    this.swcStore = new RedisSlidingWindowCounterStore(redisClient);
  }

  async checkLimit({ key, routeConfig, clientConfig, now = Date.now() }) {
    const config = routeConfig || clientConfig;
    const strategy = config.strategy;

    switch (strategy) {
      case 'TOKEN_BUCKET':
        return this.tbStore.consume(key, config.capacity, config.refillRate, 1, now);
      case 'SLIDING_WINDOW_LOG':
        return this.swlStore.consume(key, config.limit, config.windowMs, now);
      case 'SLIDING_WINDOW_COUNTER':
        return this.swcStore.consume(key, config.limit, config.windowMs, now);
      default:
        throw new Error(`Unsupported rate limiting strategy: ${strategy}`);
    }
  }
}