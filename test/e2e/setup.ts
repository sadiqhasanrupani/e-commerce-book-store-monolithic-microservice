import { DataSource } from 'typeorm';

export const testDataSource = new DataSource({
  type: 'postgres',
  url: process.env.DATABASE_URL || 'postgresql://postgres:postgres123@localhost:5433/magic-pages',
  entities: ['libs/contract/src/**/*.entity.ts'],
  synchronize: true, // Auto-sync for test database
  dropSchema: true, // Drop schema before each test run
  logging: false,
});

export async function setupTestDatabase() {
  try {
    await testDataSource.initialize();
    console.log('✓ Test database initialized');
  } catch (error) {
    console.error('✗ Test database initialization failed:', error);
    throw error;
  }
}

export async function teardownTestDatabase() {
  try {
    if (testDataSource.isInitialized) {
      await testDataSource.destroy();
      console.log('✓ Test database closed');
    }
  } catch (error) {
    console.error('✗ Test database cleanup failed:', error);
    throw error;
  }
}
