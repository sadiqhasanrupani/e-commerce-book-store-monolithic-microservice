import { RequestTimeoutException } from '@nestjs/common';

/**
 * Decorator to add timeout to async operations
 * Prevents hanging requests and ensures timely responses
 */
export function Timeout(timeoutMs: number = 30000) {
  return function (
    target: any,
    propertyKey: string,
    descriptor: PropertyDescriptor,
  ) {
    const originalMethod = descriptor.value;

    descriptor.value = async function (...args: any[]) {
      return await Promise.race([
        originalMethod.apply(this, args),
        new Promise((_, reject) =>
          setTimeout(
            () =>
              reject(
                new RequestTimeoutException(
                  `Operation ${propertyKey} timed out after ${timeoutMs}ms`,
                ),
              ),
            timeoutMs,
          ),
        ),
      ]);
    };

    return descriptor;
  };
}
