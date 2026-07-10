/**
 * Vite config for the TEST-ONLY Mission Control desktop fixture. Builds this directory into
 * ../fixture-dist with relative asset paths (loaded by the fixture Tauri shell via file://).
 * Separate from the production vite.config.ts; never invoked by `npm run build`.
 */
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('.', import.meta.url));

export default defineConfig({
  root,
  base: './',
  plugins: [react()],
  build: {
    outDir: fileURLToPath(new URL('../fixture-dist', import.meta.url)),
    emptyOutDir: true,
  },
  clearScreen: false,
});
