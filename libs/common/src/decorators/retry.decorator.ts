import { Logger } from '@nestjs/common';

export interface RetryOptions {
  maxAttempts?: number;
  delayMs?: number;
  exponentialBackoff?: boolean;
  maxDelayMs?: number;
  retryableErrors?: Array<new (...args: any[]) => Error>;
}

/**
 * Decorator to add retry logic with exponential backoff
 * Implements resilience pattern for transient failures
 */
export function Retry(options: RetryOptions = {}) {
  const {
    maxAttempts = 3,
    delayMs = 1000,
    exponentialBackoff = true,
    maxDelayMs = 30000,
    retryableErrors = [],
  } = options;

  return function (
    target: any,
    propertyKey: string,
    descriptor: PropertyDescriptor,
  ) {
    const originalMethod = descriptor.value;
    const logger = new Logger(`${target.constructor.name}.${propertyKey}`);

    descriptor.value = async function (...args: any[]) {
      let lastError: Error | undefined;

      for (let attempt = 1; attempt <= maxAttempts; attempt++) {
        try {
          return await originalMethod.apply(this, args);
        } catch (error) {
          lastError = error;

          // Check if error is retryable
          if (
            retryableErrors.length > 0 &&
            !retryableErrors.some((ErrorClass) => error instanceof ErrorClass)
          ) {
            throw error; // Not retryable, throw immediately
          }

          if (attempt === maxAttempts) {
            logger.error(
              `Failed after ${maxAttempts} attempts: ${error.message}`,
            );
            throw error;
          }

          // Calculate delay with exponential backoff
          const delay = exponentialBackoff
            ? Math.min(delayMs * Math.pow(2, attempt - 1), maxDelayMs)
            : delayMs;

          logger.warn(
            `Attempt ${attempt}/${maxAttempts} failed: ${error.message}. Retrying in ${delay}ms...`,
          );

          await new Promise((resolve) => setTimeout(resolve, delay));
        }
      }

      throw lastError || new Error('Operation failed after retries');
    };

    return descriptor;
  };
}
