import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  server: { port: 5178, strictPort: true },
  clearScreen: false,
  resolve: {
    alias: {
      // See src/shims/nodeCryptoStub.ts: @projectos/core's barrel export forces Rollup to bind
      // node:crypto even though nothing in this browser bundle calls it.
      'node:crypto': fileURLToPath(new URL('./src/shims/nodeCryptoStub.ts', import.meta.url)),
    },
  },
});
