import http from 'node:http';
import Redis from 'ioredis';
import { RateLimiterFactory } from './ratelimit/RateLimiterFactory.js';
import { CircuitBreaker } from './circuitbreaker/CircuitBreaker.js';
import { ReverseProxy } from './proxy/ReverseProxy.js';
import { gatewayConfig } from './config/gatewayConfig.js';

const PORT = process.env.PORT || 3000;
const REDIS_URL = process.env.REDIS_URL || 'redis://localhost:6379';

const redisClient = new Redis(REDIS_URL);

const rateLimiterFactory = new RateLimiterFactory(redisClient);
const circuitBreakers = new Map([
  ['mock-backend', new CircuitBreaker({ failureThreshold: 3, cooldownPeriod: 10000 })]
]);

const proxy = new ReverseProxy({
  rateLimiterFactory,
  circuitBreakers,
  config: gatewayConfig
});

const server = http.createServer((req, res) => {
  proxy.handleRequest(req, res);
});

server.listen(PORT, () => {
  console.log(JSON.stringify({
    level: 'INFO',
    message: `Gateway instance started`,
    instance: process.env.INSTANCE_ID || 'standalone',
    port: PORT
  }));
});