import { describe, it, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { CircuitBreaker, CircuitState } from '../src/circuitbreaker/CircuitBreaker.js';
import { createMockBackend } from '../mock-backend/server.js';

describe('Circuit Breaker State Machine', () => {
  let mock;
  let server;
  let port;

  before(async () => {
    mock = createMockBackend();
    server = mock.server;
    await new Promise((resolve) => {
      server.listen(0, () => {
        port = server.address().port;
        resolve();
      });
    });
  });

  after(async () => {
    await new Promise((resolve) => server.close(resolve));
  });

  beforeEach(() => {
    mock.setFailing(false);
  });

  const callBackend = () => {
    return new Promise((resolve, reject) => {
      http.get(`http://localhost:${port}/data`, (res) => {
        if (res.statusCode >= 500) {
          reject(new Error(`Backend failed with status ${res.statusCode}`));
        } else {
          resolve(res.statusCode);
        }
      }).on('error', reject);
    });
  };

  it('stays CLOSED when downstream calls succeed', async () => {
    const cb = new CircuitBreaker({ failureThreshold: 3, cooldownPeriod: 1000 });

    const status = await cb.execute(callBackend);
    assert.equal(status, 200);
    assert.equal(cb.state, CircuitState.CLOSED);
  });

  it('trips from CLOSED to OPEN when failures hit the threshold', async () => {
    const cb = new CircuitBreaker({ failureThreshold: 3, cooldownPeriod: 1000 });
    mock.setFailing(true);

    for (let i = 0; i < 2; i++) {
      await assert.rejects(cb.execute(callBackend), /Backend failed/);
      assert.equal(cb.state, CircuitState.CLOSED);
    }

    await assert.rejects(cb.execute(callBackend), /Backend failed/);
    assert.equal(cb.state, CircuitState.OPEN);
  });

  it('fast-fails requests while OPEN during cooldown period', async () => {
    let fakeTime = 10000;
    const cooldown = 5000;
    const cb = new CircuitBreaker({ failureThreshold: 1, cooldownPeriod: cooldown });

    mock.setFailing(true);
    await assert.rejects(cb.execute(callBackend, fakeTime));
    assert.equal(cb.state, CircuitState.OPEN);

    fakeTime += 2000;
    await assert.rejects(
      cb.execute(callBackend, fakeTime),
      (err) => err.code === 'CIRCUIT_OPEN' && err.retryAfter === 3
    );
  });

  it('transitions to HALF-OPEN after cooldown, tests with probe, and recovers to CLOSED', async () => {
    let fakeTime = 10000;
    const cooldown = 5000;
    const cb = new CircuitBreaker({
      failureThreshold: 2,
      cooldownPeriod: cooldown,
      successThreshold: 2
    });

    mock.setFailing(true);
    await assert.rejects(cb.execute(callBackend, fakeTime));
    await assert.rejects(cb.execute(callBackend, fakeTime));
    assert.equal(cb.state, CircuitState.OPEN);

    mock.setFailing(false);
    fakeTime += 5001;

    const res1 = await cb.execute(callBackend, fakeTime);
    assert.equal(res1, 200);
    assert.equal(cb.state, CircuitState.HALF_OPEN);

    const res2 = await cb.execute(callBackend, fakeTime);
    assert.equal(res2, 200);
    assert.equal(cb.state, CircuitState.CLOSED);
  });

  it('re-opens immediately if a probe fails during HALF-OPEN state', async () => {
    let fakeTime = 10000;
    const cooldown = 5000;
    const cb = new CircuitBreaker({ failureThreshold: 1, cooldownPeriod: cooldown });

    mock.setFailing(true);
    await assert.rejects(cb.execute(callBackend, fakeTime));
    assert.equal(cb.state, CircuitState.OPEN);

    fakeTime += 5001;

    await assert.rejects(cb.execute(callBackend, fakeTime), /Backend failed/);
    assert.equal(cb.state, CircuitState.OPEN);
  });
});