export const CircuitState = {
  CLOSED: 'CLOSED',
  OPEN: 'OPEN',
  HALF_OPEN: 'HALF_OPEN'
};

export class CircuitBreaker {
  /**
   * @param {Object} options
   * @param {number} [options.failureThreshold=5] Consecutive failures to trip circuit.
   * @param {number} [options.cooldownPeriod=5000] Cooldown in ms before attempting half-open probe.
   * @param {number} [options.successThreshold=2] Consecutive successes in half-open state to close circuit.
   */
  constructor({ failureThreshold = 5, cooldownPeriod = 5000, successThreshold = 2 } = {}) {
    this.failureThreshold = failureThreshold;
    this.cooldownPeriod = cooldownPeriod;
    this.successThreshold = successThreshold;

    this.state = CircuitState.CLOSED;
    this.failureCount = 0;
    this.successCount = 0;
    this.nextAttempt = Date.now();
  }

  async execute(action, now = Date.now()) {
    if (this.state === CircuitState.OPEN) {
      if (now >= this.nextAttempt) {
        this.state = CircuitState.HALF_OPEN;
        this.successCount = 0;
      } else {
        const error = new Error('Circuit breaker is OPEN');
        error.code = 'CIRCUIT_OPEN';
        error.retryAfter = Math.ceil((this.nextAttempt - now) / 1000);
        throw error;
      }
    }

    try {
      const result = await action();
      this.onSuccess();
      return result;
    } catch (err) {
      this.onFailure(now);
      throw err;
    }
  }

  onSuccess() {
    this.failureCount = 0;
    if (this.state === CircuitState.HALF_OPEN) {
      this.successCount += 1;
      if (this.successCount >= this.successThreshold) {
        this.state = CircuitState.CLOSED;
      }
    }
  }

  onFailure(now) {
    this.failureCount += 1;
    if (this.state === CircuitState.HALF_OPEN || this.failureCount >= this.failureThreshold) {
      this.state = CircuitState.OPEN;
      this.nextAttempt = now + this.cooldownPeriod;
    }
  }
}