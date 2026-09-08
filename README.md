# High-Throughput Distributed API Gateway & Resilience Engine

A distributed API gateway built in plain Node.js that provides atomic multi-strategy rate limiting, stateful circuit breaking, and reverse proxy routing across clustered instances via Redis and Nginx.

---

## Architecture

```
                       ┌──────────────────────┐
                       │  Downstream Clients  │
                       └──────────┬───────────┘
                                  │
                                  ▼
                       ┌──────────────────────┐
                       │ Nginx Load Balancer  │ (Port 8080)
                       └──────────┬───────────┘
                                  │ (Round-Robin)
                 ┌────────────────┴────────────────┐
                 ▼                                 ▼
    ┌─────────────────────────┐       ┌─────────────────────────┐
    │    Gateway Node 1       │       │     Gateway Node 2      │
    │  (Reverse Proxy Core)   │       │  (Reverse Proxy Core)   │
    └───────┬─────────┬───────┘       └───────┬─────────┬───────┘
            │         │                       │         │
            │         └───────────┬───────────┘         │
            ▼                     ▼                     ▼
┌───────────────────────┐  ┌─────────────────────────────────────┐
│ Mock Backend Services │  │        Redis State Store            │
│ (with Failure Toggle) │  │ (Atomic Lua Token Bucket / Windows) │
└───────────────────────┘  └─────────────────────────────────────┘

```

Each gateway instance:

* Identifies the client via `x-api-key` or IP.
* Executes an atomic Redis Lua evaluation for rate limiting.
* Wraps upstream forwarding in a stateful Circuit Breaker.
* Fast-fails with `429 Too Many Requests` or `503 Service Unavailable` before impacting downstream services.

---

## Load Test Benchmark Results (k6)

Load-tested using a dual-scenario benchmark (55 Concurrent Virtual Users) targeting 2 clustered gateway instances behind Nginx.

| Metric | Result | Target / Standard |
| --- | --- | --- |
| **Total Requests Handled** | **14,021 requests** | 35-second continuous run |
| **Sustained Throughput** | **399.48 req/sec** | ~400 req/sec |
| **Median Latency ($p_{50}$)** | **6.73 ms** | < 10 ms |
| **90th Percentile Latency ($p_{90}$)** | **13.38 ms** | < 25 ms |
| **95th Percentile Latency ($p_{95}$)** | **16.72 ms** | < 50 ms |
| **Allowed Requests (200 OK)** | **151** | Adhered to standard client quota |
| **Rate-Limited Rejections (429)** | **13,870** | 100% strict limit enforcement |
| **Uncaught Failures** | **0.00%** | Zero 5xx leaks under saturation |

---

## Redis Race Condition & Atomicity

**The Flaw: Naive Read-Modify-Write**
A naive `GET -> Calculate -> SET` pattern causes a Check-Then-Act race condition:

1. Gateway Instance A reads remaining tokens = 5.
2. Gateway Instance B reads remaining tokens = 5.
3. Instance A decrements to 4 and writes to Redis.
4. Instance B decrements to 4 and writes to Redis.

Result: 2 requests were processed, but only 1 token was subtracted, allowing clients to breach their quotas.

**The Fix: Redis Lua Scripts**
Redis executes Lua scripts as single atomic units. No other script or command can interleave during execution. State retrieval, elapsed time calculation, token refill, threshold evaluation, and state persistence execute atomically within a single round-trip.

---

## Rate Limiting Algorithms Comparison

| Dimension | Token Bucket | Sliding Window Log | Sliding Window Counter |
| --- | --- | --- | --- |
| **Memory Complexity** | $\mathcal{O}(1)$ (~64 bytes/client) | $\mathcal{O}(N)$ (ZSET scaling with req count) | $\mathcal{O}(1)$ (~32 bytes/client) |
| **Accuracy** | Continuous exact refill | 100% millisecond precision | ~95–99% weighted approximation |
| **Burst Capacity** | Configurable burst size | Clamped strictly to window | Smoothed across bucket borders |
| **Optimal Use Case** | General public REST APIs | Financial/auth endpoints | High-scale edge traffic |

---

## Circuit Breaker State Transitions

Wraps downstream calls to isolate failing dependencies:

* **CLOSED:** Normal operation. Requests forward to the backend.
* **OPEN:** When downstream consecutive failures hit `failureThreshold` (default: 3), the circuit trips to `OPEN`. Requests immediately return `503 Service Unavailable` with a `Retry-After` header without invoking the backend.
* **HALF-OPEN:** After `cooldownPeriod` (default: 10s), the gateway permits a probe request. If successful, the circuit resets to `CLOSED`; if it fails, it returns to `OPEN`.

---

## Quickstart & Local Reproduction

**1. Run Unit & Integration Tests**

```bash
npm test

```

**2. Start the Clustered Environment**

```bash
docker compose up --build

```

**3. Trigger Mock Backend Failure**

```bash
# Toggle failure ON
curl -X POST http://localhost:3001/toggle-fail -H "Content-Type: application/json" -d "{\"fail\": true}"

# Fast-fails with 503
curl -i http://localhost:8080/data -H "x-api-key: tier-standard"

```

**4. Run the k6 Load Test**

```bash
docker run --rm -i -v "${PWD}/loadtest:/loadtest" grafana/k6 run /loadtest/rateLimitTest.js

```
