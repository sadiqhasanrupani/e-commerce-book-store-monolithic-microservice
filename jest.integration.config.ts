import type { Config } from 'jest';

const config: Config = {
  verbose: true,
  testMatch: ['**/*.int-spec.ts'],
  testEnvironment: 'node',
  preset: 'ts-jest',
  moduleFileExtensions: ['ts', 'js', 'json'],
  transform: {
    '^.+\\.ts$': 'ts-jest',
  },
  rootDir: '.',
  modulePaths: ['<rootDir>'],
};

export default config;
