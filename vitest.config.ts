import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    // Only the unit suite. Deliberately explicit, because three things here look like tests and are
    // not runnable by a plain `vitest run`: the integration suite imports `vscode` and only exists
    // inside a real editor, its build output lands in out/, and the webview suite needs a browser
    // binary (see vitest.webview.config.ts).
    include: ['test/*.test.ts'],
    exclude: [
      '**/*.manual.test.ts',
      'test/webview.test.ts',
      'test/integration/**',
      'out/**',
      'node_modules/**',
    ],
  },
});
