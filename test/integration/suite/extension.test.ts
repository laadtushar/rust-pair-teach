import * as assert from 'node:assert';

import * as vscode from 'vscode';

const EXTENSION_ID = 'laadtushar.rust-pair-teacher';

/**
 * What only a real editor can tell us.
 *
 * These assertions look trivial and are not: every one of them covers something that has been
 * shipped ten versions in a row without anybody ever confirming it works.
 */
suite('activation', () => {
  test('the extension is present and activates', async () => {
    const ext = vscode.extensions.getExtension(EXTENSION_ID);
    assert.ok(ext, `extension ${EXTENSION_ID} not found`);
    await ext.activate();
    assert.strictEqual(ext.isActive, true);
  });

  test('every contributed command is actually registered', async () => {
    // A command in package.json with no registerCommand is a menu entry that throws when clicked.
    const registered = await vscode.commands.getCommands(true);
    const contributed = [
      'rustPairTeacher.chat',
      'rustPairTeacher.startCourse',
      'rustPairTeacher.setupModel',
      'rustPairTeacher.openCandidateLog',
      'rustPairTeacher.toggleAmbient',
      'rustPairTeacher.teachMe',
      'rustPairTeacher.setApiKey',
      'rustPairTeacher.showTelemetry',
    ];
    const missing = contributed.filter((c) => !registered.includes(c));
    assert.deepStrictEqual(missing, [], `unregistered: ${missing.join(', ')}`);
  });

  test('the packs load from the packaged layout', async () => {
    // The paths resolve differently when running as an installed extension than from source.
    const ext = vscode.extensions.getExtension(EXTENSION_ID);
    assert.ok(ext);
    const chapter = vscode.Uri.joinPath(
      ext.extensionUri,
      'packs',
      'rust-from-scratch',
      'chapter.toml'
    );
    const bytes = await vscode.workspace.fs.readFile(chapter);
    assert.ok(bytes.length > 0);
  });

  test('settings are contributed with the documented defaults', () => {
    const cfg = vscode.workspace.getConfiguration('rustPairTeacher');
    assert.strictEqual(cfg.get('ambient'), true);
    assert.strictEqual(cfg.get('telemetry'), false, 'telemetry must be off by default');
    assert.strictEqual(cfg.get('strictNoCode'), true, 'the no-code rule must default to on');
    assert.strictEqual(cfg.get('baseUrl'), '');
  });

  test('the sidebar view is contributed', async () => {
    // If the view id is wrong, the panel silently never appears.
    await vscode.commands.executeCommand('rustPairTeacher.lesson.focus');
  });

  test('activating with a Rust file open does not throw', async () => {
    const files = await vscode.workspace.findFiles('**/*.rs', undefined, 1);
    assert.ok(files.length > 0, 'fixture workspace should contain a .rs file');
    const doc = await vscode.workspace.openTextDocument(files[0]!);
    await vscode.window.showTextDocument(doc);
    assert.strictEqual(doc.languageId, 'rust');
  });
});
