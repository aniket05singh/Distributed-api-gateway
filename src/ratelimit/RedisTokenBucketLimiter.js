export class RedisTokenBucketLimiter {
  constructor({ capacity, refillRate, store }) {
    this.capacity = capacity;
    this.refillRate = refillRate;
    this.store = store;
  }

  async consume(key, tokensRequested = 1, now = Date.now()) {
    return this.store.consume(key, this.capacity, this.refillRate, tokensRequested, now);
  }
}