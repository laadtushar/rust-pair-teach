import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    // The panel, rendered in a real browser. Separate from the unit run because it needs a Chromium
    // binary, which not every machine checking out this repo will have.
    include: ['test/webview.test.ts'],
    // Launching a browser and driving a page is not a 5-second affair on a cold cache.
    testTimeout: 30_000,
    hookTimeout: 90_000,
  },
});
