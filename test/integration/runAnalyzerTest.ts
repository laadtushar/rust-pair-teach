import { spawnSync } from 'node:child_process';
import { resolve } from 'node:path';

import {
  downloadAndUnzipVSCode,
  resolveCliArgsFromVSCodeExecutablePath,
  runTests,
} from '@vscode/test-electron';

/**
 * The last hop in the Python chain, answered by the tool itself.
 *
 * The pack's codes were derived from what Ruff's CLI prints. Whether the *VS Code extension* puts
 * those same strings into `Diagnostic.code` was confirmed only by reading its source — and reading
 * source is how the original Python pack came to be written against traceback text that no analyzer
 * ever emits. So this installs the real extension, opens a real file, and asks.
 *
 * Deliberately separate from the main integration run, which uses `--disable-extensions` so that
 * nothing else can influence its result. That isolation is worth keeping; this needs the opposite.
 */
async function main(): Promise<void> {
  const repoRoot = resolve(__dirname, '..');
  const corpus = resolve(repoRoot, 'test/fixtures/python/corpus');

  try {
    const vscodeExecutablePath = await downloadAndUnzipVSCode();
    const [cli, ...args] = resolveCliArgsFromVSCodeExecutablePath(vscodeExecutablePath);

    // Ruff is the one worth asking: open source, self-contained (it bundles the binary, so no
    // interpreter setup), and it publishes the rule code we key on. Pylance is proprietary and
    // licensed to official builds only, so its code shape stays source-confirmed.
    const install = spawnSync(
      cli!,
      [...args, '--install-extension', 'charliermarsh.ruff', '--force'],
      { encoding: 'utf8', stdio: 'pipe' }
    );
    process.stdout.write(install.stdout ?? '');
    if (install.status !== 0) {
      process.stderr.write(install.stderr ?? '');
      throw new Error(`could not install the Ruff extension (exit ${String(install.status)})`);
    }

    await runTests({
      vscodeExecutablePath,
      extensionDevelopmentPath: repoRoot,
      extensionTestsPath: resolve(__dirname, 'suite/analyzerIndex.cjs'),
      launchArgs: [
        // Everything except Ruff and this extension, so the diagnostics have exactly one author.
        '--disable-extension=ms-python.python',
        '--disable-extension=ms-python.vscode-pylance',
        '--no-sandbox',
        '--disable-gpu',
        corpus,
      ],
    });
  } catch (err) {
    console.error('analyzer integration tests failed:', err);
    process.exit(1);
  }
}

void main();
