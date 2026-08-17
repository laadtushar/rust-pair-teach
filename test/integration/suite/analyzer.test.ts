import * as assert from 'node:assert';

import * as vscode from 'vscode';

import { discoverPacks } from '../../../src/core/pack/discover.js';
import { indexBySignature } from '../../../src/core/pack/schema.js';
import { SignatureResolver } from '../../../src/core/signature.js';
import { signatureKey } from '../../../src/core/types.js';

/**
 * Ask the real analyzer what it puts in `Diagnostic.code`.
 *
 * The Python pack's codes were derived from what Ruff's CLI prints, and the claim that its VS Code
 * extension carries the same strings was confirmed by reading source. That is exactly how the first
 * version of this pack came to be written against CPython traceback text no analyzer ever emits —
 * a plausible reading of something real, believed without being asked.
 *
 * So this asks. It installs Ruff, opens a file that provokes a rule the pack claims, and checks
 * that the diagnostic which actually arrives resolves to the concept the pack intends.
 */
suite('what a real analyzer sends', () => {
  const EXTENSION_ID = 'laadtushar.rust-pair-teacher';

  /** Diagnostics settle asynchronously; a language server has to start first. */
  async function waitForDiagnostics(uri: vscode.Uri, timeoutMs = 60_000): Promise<vscode.Diagnostic[]> {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      const found = vscode.languages.getDiagnostics(uri);
      if (found.length > 0) return found;
      await new Promise((r) => setTimeout(r, 500));
    }
    return vscode.languages.getDiagnostics(uri);
  }

  /** The same extraction `extension.ts` performs, kept in step deliberately. */
  function codeOf(d: vscode.Diagnostic): string | undefined {
    const code = d.code;
    if (code === undefined) return undefined;
    if (typeof code === 'string') return code;
    if (typeof code === 'number') return String(code);
    return typeof code.value === 'string' ? code.value : String(code.value);
  }

  test('the Ruff extension is present', async () => {
    const ruff = vscode.extensions.getExtension('charliermarsh.ruff');
    assert.ok(ruff, 'Ruff did not install — the runner should have failed before here');
    await ruff.activate();
  });

  test('a real Ruff diagnostic reaches the concept the pack claims', async () => {
    const ext = vscode.extensions.getExtension(EXTENSION_ID);
    assert.ok(ext);
    await ext.activate();

    // F823 (used before assignment) is in Ruff's default rule set, so this needs no ruff.toml —
    // one fewer thing whose format could disagree with whatever version the extension bundles.
    const files = await vscode.workspace.findFiles('scope_assignment.py', undefined, 1);
    assert.ok(files.length > 0, 'the corpus workspace is missing scope_assignment.py');

    const doc = await vscode.workspace.openTextDocument(files[0]!);
    await vscode.window.showTextDocument(doc);
    assert.strictEqual(doc.languageId, 'python');

    const diagnostics = await waitForDiagnostics(doc.uri);
    const described = diagnostics.map((d) => `${String(codeOf(d))} :: ${d.message}`);
    assert.ok(
      diagnostics.length > 0,
      'Ruff produced no diagnostics at all — the extension may not have started'
    );

    // Load the packs exactly as the extension does, and resolve what actually arrived.
    const packsDir = vscode.Uri.joinPath(ext.extensionUri, 'packs').fsPath;
    const { packs, failures } = await discoverPacks(packsDir);
    assert.deepStrictEqual(failures, [], 'packs failed to load');

    const index = new Map<string, string>();
    for (const pack of packs) {
      for (const [key, concept] of indexBySignature(pack)) {
        if (!index.has(key)) index.set(key, concept.id);
      }
    }
    const resolver = new SignatureResolver(packs);

    const taught = diagnostics
      .map((d) => index.get(signatureKey(resolver.resolve('python', codeOf(d), d.message))))
      .filter((id): id is string => id !== undefined);

    assert.ok(
      taught.includes('python/scope.assignment'),
      `no diagnostic reached python/scope.assignment. Ruff sent:\n  ${described.join('\n  ')}`
    );
  });

  test('the code arrives in a shape codeOf can read', async () => {
    const files = await vscode.workspace.findFiles('scope_assignment.py', undefined, 1);
    const doc = await vscode.workspace.openTextDocument(files[0]!);
    const diagnostics = await waitForDiagnostics(doc.uri);

    for (const d of diagnostics) {
      const extracted = codeOf(d);
      assert.ok(
        extracted !== undefined && extracted !== 'undefined' && extracted.trim() !== '',
        `a diagnostic arrived with an unreadable code: ${JSON.stringify(d.code)} (${d.message})`
      );
    }
  });
});
