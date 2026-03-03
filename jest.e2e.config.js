'use strict';

module.exports = {
  testEnvironment: 'node',
  testMatch: ['**/tests/e2e/**/*.test.js'],
  testTimeout: 60000,
  verbose: true,
  // No coverage for E2E tests — coverage is collected in unit test runs
  collectCoverage: false,
  reporters: [
    'default',
    ['jest-junit', {
      outputDirectory: './test-results',
      outputName: 'junit-e2e.xml',
      suiteName: 'E2E Tests',
    }],
  ],
};
