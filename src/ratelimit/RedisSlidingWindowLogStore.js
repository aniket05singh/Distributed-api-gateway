const SLIDING_WINDOW_LOG_LUA = `
local key = KEYS[1]
local windowMs = tonumber(ARGV[1])
local maxRequests = tonumber(ARGV[2])
local now = tonumber(ARGV[3])
local requestId = ARGV[4]

local clearBefore = now - windowMs

-- 1. Remove timestamps older than the sliding window
redis.call('ZREMRANGEBYSCORE', key, '-inf', clearBefore)

-- 2. Count current valid requests in window
local currentRequests = redis.call('ZCARD', key)

if currentRequests < maxRequests then
    -- Add the unique request timestamp
    redis.call('ZADD', key, now, requestId)
    redis.call('PEXPIRE', key, windowMs)
    return { 1, maxRequests - currentRequests - 1, 0 }
else
    -- Find oldest request timestamp in window to compute retryAfter
    local oldest = redis.call('ZRANGE', key, 0, 0, 'WITHSCORES')
    local retryAfter = 0
    if oldest and #oldest >= 2 then
        local oldestTimestamp = tonumber(oldest[2])
        retryAfter = math.ceil((oldestTimestamp + windowMs - now) / 1000)
    end
    return { 0, 0, math.max(1, retryAfter) }
end
`;

export class RedisSlidingWindowLogStore {
  constructor(redisClient) {
    this.redis = redisClient;
  }

  async consume(key, limit, windowMs, now = Date.now()) {
    const requestId = `${now}-${Math.random().toString(36).substring(2, 9)}`;
    const result = await this.redis.eval(
      SLIDING_WINDOW_LOG_LUA,
      1,
      `ratelimit:swl:${key}`,
      windowMs.toString(),
      limit.toString(),
      now.toString(),
      requestId
    );

    return {
      allowed: result[0] === 1,
      remaining: Number(result[1]),
      retryAfter: Number(result[2])
    };
  }
}
