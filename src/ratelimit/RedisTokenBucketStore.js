const TOKEN_BUCKET_LUA = `
local key = KEYS[1]
local capacity = tonumber(ARGV[1])
local refillRate = tonumber(ARGV[2])
local tokensRequested = tonumber(ARGV[3])
local now = tonumber(ARGV[4])

-- 1. Fetch existing bucket state
local data = redis.call('HMGET', key, 'tokens', 'lastRefill')
local tokens = tonumber(data[1])
local lastRefill = tonumber(data[2])

-- 2. Initialize bucket if it does not exist
if not tokens or not lastRefill then
    tokens = capacity
    lastRefill = now
else
    -- 3. Calculate refilled tokens based on delta time (in seconds)
    local delta = math.max(0, (now - lastRefill) / 1000)
    tokens = math.min(capacity, tokens + (delta * refillRate))
    lastRefill = now
end

-- 4. Check capacity and consume
local allowed = 0
local retryAfter = 0

if tokens >= tokensRequested then
    allowed = 1
    tokens = tokens - tokensRequested
else
    local needed = tokensRequested - tokens
    retryAfter = math.ceil(needed / refillRate)
end

-- 5. Save state back to Redis
redis.call('HMSET', key, 'tokens', tokens, 'lastRefill', lastRefill)

local ttl = math.ceil(capacity / refillRate) + 60
redis.call('EXPIRE', key, math.max(ttl, 3600))

return { allowed, math.floor(tokens), retryAfter }
`;

export class RedisTokenBucketStore {
  constructor(redisClient) {
    this.redis = redisClient;
  }

  async consume(key, capacity, refillRate, tokensRequested = 1, now = Date.now()) {
    // ioredis syntax: eval(script, numberOfKeys, ...keys, ...args)
    const result = await this.redis.eval(
      TOKEN_BUCKET_LUA,
      1,
      `ratelimit:tb:${key}`,
      capacity.toString(),
      refillRate.toString(),
      tokensRequested.toString(),
      now.toString()
    );

    return {
      allowed: result[0] === 1,
      remainingTokens: Number(result[1]),
      retryAfter: Number(result[2])
    };
  }
}