const SLIDING_WINDOW_COUNTER_LUA = `
local keyPrefix = KEYS[1]
local windowMs = tonumber(ARGV[1])
local limit = tonumber(ARGV[2])
local now = tonumber(ARGV[3])

-- Determine current and previous window bucket keys
local currentBucket = math.floor(now / windowMs)
local prevBucket = currentBucket - 1

local currentKey = keyPrefix .. ':' .. currentBucket
local prevKey = keyPrefix .. ':' .. prevBucket

local currentCount = tonumber(redis.call('GET', currentKey) or '0')
local prevCount = tonumber(redis.call('GET', prevKey) or '0')

-- Calculate time elapsed within the current window
local timeIntoCurrentWindow = now % windowMs
local weight = (windowMs - timeIntoCurrentWindow) / windowMs

-- Use math.ceil to prevent underestimating previous window overlap
local estimatedCount = math.ceil(prevCount * weight) + currentCount

if estimatedCount < limit then
    redis.call('INCR', currentKey)
    if currentCount == 0 then
        redis.call('PEXPIRE', currentKey, windowMs * 2)
    end
    return { 1, limit - estimatedCount - 1, 0 }
else
    local retryAfter = math.ceil((windowMs - timeIntoCurrentWindow) / 1000)
    return { 0, 0, math.max(1, retryAfter) }
end
`;

export class RedisSlidingWindowCounterStore {
  constructor(redisClient) {
    this.redis = redisClient;
  }

  async consume(key, limit, windowMs, now = Date.now()) {
    const result = await this.redis.eval(
      SLIDING_WINDOW_COUNTER_LUA,
      1,
      `ratelimit:swc:${key}`,
      windowMs.toString(),
      limit.toString(),
      now.toString()
    );

    return {
      allowed: result[0] === 1,
      remaining: Number(result[1]),
      retryAfter: Number(result[2])
    };
  }
}