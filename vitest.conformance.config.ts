import { defineConfig } from 'vitest/config';

/**
 * The manual suites, which the default config deliberately hides.
 *
 * A separate config rather than a CLI flag because vitest's --exclude appends to the configured
 * excludes rather than replacing them, so the manual tests can never be reached from the default
 * config no matter what is passed.
 */
export default defineConfig({
  test: {
    include: ['test/*.manual.test.ts'],
    exclude: ['node_modules/**', 'out/**'],
    testTimeout: 120_000,
  },
});
