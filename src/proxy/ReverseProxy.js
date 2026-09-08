import http from 'node:http';
import { URL } from 'node:url';

export class ReverseProxy {
  constructor({ rateLimiterFactory, circuitBreakers, config }) {
    this.rateLimiterFactory = rateLimiterFactory;
    this.circuitBreakers = circuitBreakers; // Map<targetServiceName, CircuitBreaker>
    this.config = config;
  }

  getClientKey(req) {
    return req.headers['x-api-key'] || req.socket.remoteAddress || 'anonymous';
  }

  getClientConfig(key) {
    return this.config.clients[key] || this.config.clients['tier-standard'] || {
      strategy: 'TOKEN_BUCKET',
      capacity: 10,
      refillRate: 2
    };
  }

  logRequest(data) {
    console.log(JSON.stringify({
      timestamp: new Date().toISOString(),
      level: data.level || 'INFO',
      instance: process.env.INSTANCE_ID || 'gateway-standalone',
      ...data
    }));
  }

  async handleRequest(req, res) {
    const startTime = Date.now();
    const clientKey = this.getClientKey(req);
    const routeConfig = this.config.routes[req.url];
    const clientConfig = this.getClientConfig(clientKey);

    // 1. Rate Limiting Check
    const rateLimitResult = await this.rateLimiterFactory.checkLimit({
      key: clientKey,
      routeConfig,
      clientConfig
    });

    if (!rateLimitResult.allowed) {
      res.writeHead(429, {
        'Content-Type': 'application/json',
        'Retry-After': rateLimitResult.retryAfter
      });
      res.end(JSON.stringify({
        error: 'Too Many Requests',
        retryAfter: rateLimitResult.retryAfter
      }));

      this.logRequest({
        method: req.method,
        url: req.url,
        clientKey,
        statusCode: 429,
        latencyMs: Date.now() - startTime,
        rateLimited: true
      });
      return;
    }

    // 2. Circuit Breaker & Request Forwarding
    const targetService = 'mock-backend';
    const breaker = this.circuitBreakers.get(targetService);
    const backendUrl = process.env.BACKEND_URL || 'http://localhost:3001';

    try {
      await breaker.execute(() => this.forward(req, res, backendUrl));

      this.logRequest({
        method: req.method,
        url: req.url,
        clientKey,
        statusCode: res.statusCode,
        latencyMs: Date.now() - startTime,
        circuitState: breaker.state
      });
    } catch (err) {
      const isCircuitOpen = err.code === 'CIRCUIT_OPEN';
      const statusCode = isCircuitOpen ? 503 : 502;

      if (!res.headersSent) {
        res.writeHead(statusCode, {
          'Content-Type': 'application/json',
          ...(isCircuitOpen ? { 'Retry-After': err.retryAfter } : {})
        });
        res.end(JSON.stringify({
          error: isCircuitOpen ? 'Service Unavailable (Circuit Open)' : 'Bad Gateway',
          message: err.message
        }));
      }

      this.logRequest({
        level: 'WARN',
        method: req.method,
        url: req.url,
        clientKey,
        statusCode,
        latencyMs: Date.now() - startTime,
        circuitState: breaker.state,
        error: err.message
      });
    }
  }

  forward(req, res, targetBaseUrl) {
    return new Promise((resolve, reject) => {
      const targetUrl = new URL(req.url, targetBaseUrl);

      const options = {
        hostname: targetUrl.hostname,
        port: targetUrl.port,
        path: targetUrl.pathname + targetUrl.search,
        method: req.method,
        headers: {
          ...req.headers,
          host: targetUrl.host,
          'x-forwarded-for': req.socket.remoteAddress
        }
      };

      const proxyReq = http.request(options, (proxyRes) => {
        if (proxyRes.statusCode >= 500) {
          reject(new Error(`Upstream returned ${proxyRes.statusCode}`));
          return;
        }

        res.writeHead(proxyRes.statusCode, proxyRes.headers);
        proxyRes.pipe(res);
        proxyRes.on('end', resolve);
      });

      proxyReq.on('error', reject);
      req.pipe(proxyReq);
    });
  }
}