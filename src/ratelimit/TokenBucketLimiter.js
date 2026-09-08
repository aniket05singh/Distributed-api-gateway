export class TokenBucketLimiter {
  /**
   * @param {Object} options
   * @param {number} options.capacity Maximum burst token capacity.
   * @param {number} options.refillRate Tokens added per second.
   * @param {Object} options.store Storage adapter (MemoryStore or RedisStore).
   */
  constructor({ capacity, refillRate, store }) {
    this.capacity = capacity;
    this.refillRate = refillRate;
    this.store = store;
  }

  /**
   * Evaluates if a request from a client should be allowed.
   * @param {string} key Unique client identifier (e.g. API key or IP).
   * @param {number} [tokensRequested=1] Number of tokens needed.
   * @param {number} [now=Date.now()] Injection point for deterministic testing.
   * @returns {Promise<{allowed: boolean, remainingTokens: number, retryAfter: number}>}
   */
  async consume(key, tokensRequested = 1, now = Date.now()) {
    let bucket = await this.store.get(key);

    if (!bucket) {
      bucket = {
        tokens: this.capacity,
        lastRefill: now
      };
    } else {
      // Calculate token refill based on delta time
      const timeElapsedSeconds = (now - bucket.lastRefill) / 1000;
      const tokensToAdd = timeElapsedSeconds * this.refillRate;

      bucket.tokens = Math.min(this.capacity, bucket.tokens + tokensToAdd);
      bucket.lastRefill = now;
    }

    if (bucket.tokens >= tokensRequested) {
      bucket.tokens -= tokensRequested;
      await this.store.set(key, bucket);

      return {
        allowed: true,
        remainingTokens: Math.floor(bucket.tokens),
        retryAfter: 0
      };
    }

    // Save fractional tokens back even when rejecting
    await this.store.set(key, bucket);

    const neededTokens = tokensRequested - bucket.tokens;
    const retryAfter = Math.ceil(neededTokens / this.refillRate);

    return {
      allowed: false,
      remainingTokens: Math.floor(bucket.tokens),
      retryAfter
    };
  }
}