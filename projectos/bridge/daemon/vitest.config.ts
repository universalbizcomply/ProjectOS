import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['test/**/*.test.ts'],
    coverage: {
      provider: 'v8',
      include: ['src/**/*.ts'],
      // system.ts is the real fs/watch/clock adapter (the I/O boundary); index.ts is
      // a re-export barrel; bin is the process entry. All are exercised at runtime, not
      // by unit tests — the pure engines they wrap carry the coverage.
      exclude: ['src/index.ts', 'src/system.ts'],
      thresholds: {
        lines: 95,
        functions: 95,
        branches: 95,
        statements: 95,
      },
    },
  },
});
