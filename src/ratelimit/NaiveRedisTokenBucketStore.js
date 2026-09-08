export class NaiveRedisTokenBucketStore {
  constructor(redisClient) {
    this.redis = redisClient;
  }

  async consume(key, capacity, refillRate, tokensRequested = 1, now = Date.now()) {
    const redisKey = `ratelimit:naive:${key}`;
    const data = await this.redis.hgetall(redisKey);

    let tokens = data.tokens ? parseFloat(data.tokens) : capacity;
    let lastRefill = data.lastRefill ? parseInt(data.lastRefill, 10) : now;

    if (data.tokens && data.lastRefill) {
      const delta = Math.max(0, (now - lastRefill) / 1000);
      tokens = Math.min(capacity, tokens + (delta * refillRate));
    }

    // Small artificial delay to create a wide race window
    await new Promise((resolve) => setTimeout(resolve, 5));

    let allowed = false;
    let retryAfter = 0;

    if (tokens >= tokensRequested) {
      allowed = true;
      tokens -= tokensRequested;
    } else {
      const needed = tokensRequested - tokens;
      retryAfter = Math.ceil(needed / refillRate);
    }

    await this.redis.hmset(redisKey, {
      tokens: tokens.toString(),
      lastRefill: now.toString()
    });

    return {
      allowed,
      remainingTokens: Math.floor(tokens),
      retryAfter
    };
  }
}