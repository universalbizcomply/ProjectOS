import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    // Service-layer tests run in node; component tests opt into jsdom per-file
    // via `// @vitest-environment jsdom`.
    environment: 'node',
    include: ['test/**/*.test.{ts,tsx}'],
    coverage: {
      provider: 'v8',
      // The daemon client service layer carries the coverage. React components (*.tsx),
      // the browser scheduler, and the barrel are thin glue verified by component/build.
      include: ['src/daemon/**/*.ts'],
      exclude: [
        'src/daemon/**/*.tsx',
        'src/daemon/index.ts',
        'src/daemon/realScheduler.ts',
        // I/O boundary: dynamically imports @tauri-apps/api (only runs inside a Tauri webview).
        'src/daemon/tauriBridge.ts',
        // Type-only modules — no runtime code to cover.
        'src/daemon/types.ts',
        'src/daemon/ports.ts',
        'src/daemon/ipcBridge.ts',
      ],
      thresholds: {
        lines: 95,
        functions: 95,
        branches: 95,
        statements: 95,
      },
    },
  },
});
