export const gatewayConfig = {
  defaultStrategy: 'TOKEN_BUCKET',
  clients: {
    'tier-premium': {
      strategy: 'TOKEN_BUCKET',
      capacity: 100,
      refillRate: 20
    },
    'tier-standard': {
      strategy: 'SLIDING_WINDOW_COUNTER',
      limit: 60,
      windowMs: 60000 // 60 requests per minute
    },
    'tier-strict-financial': {
      strategy: 'SLIDING_WINDOW_LOG',
      limit: 10,
      windowMs: 1000 // 10 requests per second exact
    }
  },
  routes: {
    '/api/checkout': {
      strategy: 'SLIDING_WINDOW_LOG',
      limit: 5,
      windowMs: 5000
    },
    '/api/search': {
      strategy: 'TOKEN_BUCKET',
      capacity: 20,
      refillRate: 5
    }
  }
};