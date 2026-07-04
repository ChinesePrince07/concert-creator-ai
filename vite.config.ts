/// <reference types="vitest/config" />
import { defineConfig } from 'vite';

export default defineConfig({
  build: {
    target: 'es2022',
    chunkSizeWarningLimit: 4096,
  },
  worker: {
    format: 'es',
  },
  server: {
    headers: {
      // Allow SharedArrayBuffer-free operation; keep simple. WebCodecs needs no COOP/COEP.
    },
  },
  test: {
    include: ['src/**/*.test.ts', 'scripts/**/*.test.ts'],
    environment: 'node',
  },
});
