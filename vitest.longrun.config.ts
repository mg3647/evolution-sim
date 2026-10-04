import { defineConfig } from 'vitest/config';

// Runs the tuning scripts in scripts/, which are kept out of the normal test run.
export default defineConfig({
  test: {
    include: ['scripts/**/*.run.ts'],
    environment: 'node',
    testTimeout: 0,
    disableConsoleIntercept: true,
  },
});
