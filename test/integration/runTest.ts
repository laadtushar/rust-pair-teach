import { resolve } from 'node:path';

import { runTests } from '@vscode/test-electron';

/**
 * Launch a real VS Code and run the suite inside it (C1).
 *
 * Everything else in this project is tested against a stub. This is the only thing that answers
 * "does the extension actually activate", which no amount of unit coverage can.
 */
async function main(): Promise<void> {
  // Paths resolve from out/, where esbuild puts this file — not from test/integration/ where it
  // is written. The first CI run failed on exactly this: the fixture path was one directory off
  // and findFiles matched nothing.
  const repoRoot = resolve(__dirname, '..');
  const extensionDevelopmentPath = repoRoot;
  const extensionTestsPath = resolve(__dirname, 'suite/index.cjs');
  const fixtureWorkspace = resolve(repoRoot, 'test/fixtures/workspace');

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
        fixtureWorkspace,
      ],
    });
  } catch (err) {
    console.error('integration tests failed:', err);
    process.exit(1);
  }
}

void main();
