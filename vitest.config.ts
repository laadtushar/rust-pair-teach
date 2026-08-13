import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    // Only the unit suite. Deliberately explicit, because two things here look like tests and are
    // not runnable by vitest: the integration suite imports `vscode` and only exists inside a real
    // editor, and its build output lands in out/.
    include: ['test/*.test.ts'],
    exclude: ['**/*.manual.test.ts', 'test/integration/**', 'out/**', 'node_modules/**'],
  },
});
