import type { Config } from 'jest';

const config: Config = {
  verbose: true,
  testMatch: ['**/*.int-spec.ts', '**/*.integration-spec.ts'],
  testEnvironment: 'node',
  preset: 'ts-jest',
  moduleFileExtensions: ['ts', 'js', 'json'],
  transform: {
    '^.+\\.ts$': 'ts-jest',
  },
  rootDir: '.',
  roots: ['<rootDir>'],
  modulePaths: ['<rootDir>'],
  moduleNameMapper: {
    '^@app/contract(|/.*)$': '<rootDir>/libs/contract/src/$1',
    '^@app/database(|/.*)$': '<rootDir>/libs/database/src/$1',
    '^@app/global-config(|/.*)$': '<rootDir>/libs/global-config/src/$1',
    '^@app/redis(|/.*)$': '<rootDir>/libs/redis/src/$1',
    '^@rmq/rmq(|/.*)$': '<rootDir>/libs/rmq/src/$1',
    '^apps/(.*)$': '<rootDir>/apps/$1',
  },
  transformIgnorePatterns: ['/node_modules/(?!uuid)/'],
};

export default config;
