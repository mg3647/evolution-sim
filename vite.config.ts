import { svelte } from '@sveltejs/vite-plugin-svelte';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  // Relative base so the build works from a GitHub Pages subpath.
  base: './',
  plugins: [svelte()],
  worker: { format: 'es' },
  // Native file events were missed on Windows during development; polling is reliable.
  server: { watch: { usePolling: true, interval: 300 } },
  test: {
    include: ['src/**/*.test.ts'],
    environment: 'node',
  },
});
