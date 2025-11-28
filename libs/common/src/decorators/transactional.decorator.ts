import { DataSource } from 'typeorm';

/**
 * Decorator to wrap method execution in a database transaction (ACID: Atomicity)
 * Ensures all database operations succeed or fail together
 */
export function Transactional() {
  return function (
    target: any,
    propertyKey: string,
    descriptor: PropertyDescriptor,
  ) {
    const originalMethod = descriptor.value;

    descriptor.value = async function (...args: any[]) {
      // Get DataSource from the class instance
      const dataSource: DataSource = this.dataSource || this.connection;

      if (!dataSource) {
        throw new Error(
          '@Transactional decorator requires DataSource to be injected as "dataSource" or "connection"',
        );
      }

      // Execute method within transaction
      return await dataSource.transaction(async (manager) => {
        // Replace the repository/manager temporarily
        const originalManager = this.manager;
        this.manager = manager;

        try {
          const result = await originalMethod.apply(this, args);
          return result;
        } finally {
          this.manager = originalManager;
        }
      });
    };

    return descriptor;
  };
}
