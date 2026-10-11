/// <reference types="node" />
import { svelte } from '@sveltejs/vite-plugin-svelte';
import { execSync } from 'node:child_process';
import { defineConfig } from 'vitest/config';

/** The commit being built, so a run report says which code made it. */
function appVersion(): string {
  try {
    return execSync('git rev-parse --short HEAD', { stdio: ['ignore', 'pipe', 'ignore'] }).toString().trim();
  } catch {
    return 'unknown';
  }
}

export default defineConfig({
  // Relative base so the build works from a GitHub Pages subpath.
  base: './',
  define: { __APP_VERSION__: JSON.stringify(appVersion()) },
  plugins: [svelte()],
  worker: { format: 'es' },
  // Native file events were missed on Windows during development; polling is reliable.
  server: { watch: { usePolling: true, interval: 300 } },
  test: {
    include: ['src/**/*.test.ts'],
    environment: 'node',
  },
});
