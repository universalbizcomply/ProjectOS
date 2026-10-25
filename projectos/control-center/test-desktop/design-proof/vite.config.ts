/**
 * Vite config for the TEST-ONLY design-fidelity proof harness. Serves the real shell against the
 * fixture in `proofState.ts` so every screen and state the approved design draws can be opened at a
 * given viewport and compared with the prototype. Separate from the production `vite.config.ts`;
 * never invoked by `npm run build`.
 */
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('.', import.meta.url));

export default defineConfig({
  root,
  base: './',
  plugins: [react()],
  publicDir: fileURLToPath(new URL('../../public', import.meta.url)),
  resolve: {
    // Same stub the production config uses: `@projectos/core`'s barrel binds node:crypto even
    // though nothing in a browser bundle calls it. See src/shims/nodeCryptoStub.ts.
    alias: {
      'node:crypto': fileURLToPath(new URL('../../src/shims/nodeCryptoStub.ts', import.meta.url)),
    },
  },
  server: { port: 5199, strictPort: true },
  clearScreen: false,
});
