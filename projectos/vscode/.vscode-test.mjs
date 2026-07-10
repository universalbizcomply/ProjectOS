import { defineConfig } from '@vscode/test-cli';

// Runs the extension inside a real downloaded VS Code Extension Host (not compile-only).
export default defineConfig({
  files: 'dist/test/**/*.test.js',
  version: 'stable',
});
