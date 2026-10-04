import { svelte } from '@sveltejs/vite-plugin-svelte';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  // Relative base so the build works from a GitHub Pages subpath.
  base: './',
  plugins: [svelte()],
  worker: { format: 'es' },
  test: {
    include: ['src/**/*.test.ts'],
    environment: 'node',
  },
});
