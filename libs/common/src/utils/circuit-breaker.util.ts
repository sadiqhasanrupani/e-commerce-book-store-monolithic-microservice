import { Logger } from '@nestjs/common';

export enum CircuitState {
  CLOSED = 'CLOSED',
  OPEN = 'OPEN',
  HALF_OPEN = 'HALF_OPEN',
}

export interface CircuitBreakerOptions {
  failureThreshold?: number;
  successThreshold?: number;
  timeout?: number;
  resetTimeout?: number;
}

/**
 * Circuit Breaker implementation to prevent cascading failures
 * Implements the Circuit Breaker pattern for external service calls
 */
export class CircuitBreaker {
  private state: CircuitState = CircuitState.CLOSED;
  private failureCount = 0;
  private successCount = 0;
  private nextAttempt: number = Date.now();
  private readonly logger = new Logger(CircuitBreaker.name);

  constructor(
    private readonly name: string,
    private readonly options: CircuitBreakerOptions = {},
  ) {
    this.options = {
      failureThreshold: 5,
      successThreshold: 2,
      timeout: 60000, // 1 minute
      resetTimeout: 30000, // 30 seconds
      ...options,
    };
  }

  async execute<T>(fn: () => Promise<T>): Promise<T> {
    if (this.state === CircuitState.OPEN) {
      if (Date.now() < this.nextAttempt) {
        throw new Error(
          `Circuit breaker [${this.name}] is OPEN. Try again later.`,
        );
      }
      this.state = CircuitState.HALF_OPEN;
      this.logger.warn(`Circuit breaker [${this.name}] is now HALF_OPEN`);
    }

    try {
      const result = await Promise.race([
        fn(),
        new Promise<never>((_, reject) =>
          setTimeout(
            () => reject(new Error('Circuit breaker timeout')),
            this.options.timeout,
          ),
        ),
      ]);

      this.onSuccess();
      return result;
    } catch (error) {
      this.onFailure();
      throw error;
    }
  }

  private onSuccess(): void {
    this.failureCount = 0;

    if (this.state === CircuitState.HALF_OPEN) {
      this.successCount++;

      const threshold = this.options.successThreshold ?? 2;
      if (this.successCount >= threshold) {
        this.state = CircuitState.CLOSED;
        this.successCount = 0;
        this.logger.log(`Circuit breaker [${this.name}] is now CLOSED`);
      }
    }
  }

  private onFailure(): void {
    this.failureCount++;
    this.successCount = 0;

    const threshold = this.options.failureThreshold ?? 5;
    const resetTimeout = this.options.resetTimeout ?? 30000;

    if (this.failureCount >= threshold) {
      this.state = CircuitState.OPEN;
      this.nextAttempt = Date.now() + resetTimeout;
      this.logger.error(
        `Circuit breaker [${this.name}] is now OPEN. Will retry after ${resetTimeout}ms`,
      );
    }
  }

  getState(): CircuitState {
    return this.state;
  }

  reset(): void {
    this.state = CircuitState.CLOSED;
    this.failureCount = 0;
    this.successCount = 0;
    this.logger.log(`Circuit breaker [${this.name}] has been reset`);
  }
}
