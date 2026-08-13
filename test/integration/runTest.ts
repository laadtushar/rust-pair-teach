import { resolve } from 'node:path';

import { runTests } from '@vscode/test-electron';

/**
 * Launch a real VS Code and run the suite inside it (C1).
 *
 * Everything else in this project is tested against a stub. This is the only thing that answers
 * "does the extension actually activate", which no amount of unit coverage can.
 */
async function main(): Promise<void> {
  const extensionDevelopmentPath = resolve(__dirname, '..');
  const extensionTestsPath = resolve(__dirname, 'suite/index.cjs');

  try {
    await runTests({
      extensionDevelopmentPath,
      extensionTestsPath,
      launchArgs: [
        // No other extension may influence the result, and the sandbox is unavailable in CI
        // containers.
        '--disable-extensions',
        '--no-sandbox',
        '--disable-gpu',
        resolve(__dirname, '../fixtures/workspace'),
      ],
    });
  } catch (err) {
    console.error('integration tests failed:', err);
    process.exit(1);
  }
}

void main();
