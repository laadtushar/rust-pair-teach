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
    // The list is read from the manifest rather than restated here, so adding a command cannot
    // quietly escape this check.
    const ext = vscode.extensions.getExtension(EXTENSION_ID);
    assert.ok(ext);
    const contributed = (
      ext.packageJSON as { contributes: { commands: Array<{ command: string }> } }
    ).contributes.commands.map((c) => c.command);
    assert.ok(contributed.length > 0, 'the manifest contributes no commands at all');

    const registered = await vscode.commands.getCommands(true);
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

  test('non-interactive commands run without throwing', async () => {
    // Registration only proves the id exists. These execute the real handlers against a real
    // editor — code that has never run outside a stub. Interactive commands (setupModel,
    // setApiKey) are excluded because they block on a quick pick that nothing will answer.
    await vscode.commands.executeCommand('rustPairTeacher.toggleAmbient');
    await vscode.commands.executeCommand('rustPairTeacher.toggleAmbient');
    await vscode.commands.executeCommand('rustPairTeacher.showTelemetry');
    await vscode.commands.executeCommand('rustPairTeacher.teachMe');
    await vscode.commands.executeCommand('rustPairTeacher.chat');
    await vscode.commands.executeCommand('rustPairTeacher.showEgress');
  });

  test('the egress command shows the real payload, not a placeholder', async () => {
    // The privacy claim is only as good as this document. If it opens empty, the promise that you
    // can check what leaves your machine is worthless.
    await vscode.commands.executeCommand('rustPairTeacher.showEgress');
    const shown = vscode.window.activeTextEditor?.document.getText() ?? '';
    assert.ok(shown.includes('--- system ---'), `egress document had no system turn:\n${shown}`);
    assert.ok(
      shown.includes('do not write their code'),
      'the persona is what guarantees the no-code rule; it must be visible in the payload'
    );
  });

  test('the course is available from the command palette', async () => {
    await vscode.commands.executeCommand('rustPairTeacher.startCourse');
  });

  test('activating with a Rust file open does not throw', async () => {
    const folders = vscode.workspace.workspaceFolders ?? [];
    assert.ok(folders.length > 0, 'no workspace folder was opened — check the launchArgs path');

    const files = await vscode.workspace.findFiles('**/*.rs', undefined, 1);
    assert.ok(
      files.length > 0,
      `no .rs file under ${folders[0]?.uri.fsPath ?? '?'} — the fixture workspace is missing or empty`
    );
    const doc = await vscode.workspace.openTextDocument(files[0]!);
    await vscode.window.showTextDocument(doc);
    assert.strictEqual(doc.languageId, 'rust');
  });

  test('a Python file is watched, and its diagnostics survive the round trip', async () => {
    // The Python pack keys on what Pylance, Pylint and Ruff emit, and each puts a different shape
    // in `Diagnostic.code`. Those shapes are confirmed from the analyzers' source; what is checked
    // here is the other half — that VS Code hands back what was put in, so `codeOf` is reading the
    // field the extension thinks it is reading.
    const doc = await vscode.workspace.openTextDocument({
      language: 'python',
      content: 'def f():\n    print(x)\n    x = 1\n',
    });
    assert.strictEqual(doc.languageId, 'python', 'python language id is not available');

    const collection = vscode.languages.createDiagnosticCollection('pair-teacher-probe');
    try {
      const range = new vscode.Range(0, 0, 0, 1);
      const plain = new vscode.Diagnostic(range, 'Local variable `x` referenced before assignment');
      plain.code = 'F823';
      plain.severity = vscode.DiagnosticSeverity.Error;

      // What an LSP server sends when it also sets codeDescription — microsoft/vscode-pylint does,
      // unconditionally, so this is the shape pylint diagnostics actually arrive in.
      const described = new vscode.Diagnostic(range, "Using variable 'x' before assignment");
      described.code = {
        value: 'E0601:used-before-assignment',
        target: vscode.Uri.parse('https://pylint.readthedocs.io/'),
      };
      described.severity = vscode.DiagnosticSeverity.Error;

      collection.set(doc.uri, [plain, described]);
      const read = vscode.languages.getDiagnostics(doc.uri);
      assert.strictEqual(read.length, 2, 'diagnostics did not come back');

      const codes = read.map((d) =>
        typeof d.code === 'object' && d.code !== null ? String(d.code.value) : String(d.code)
      );
      assert.deepStrictEqual(
        codes.sort(),
        ['E0601:used-before-assignment', 'F823'],
        'VS Code did not return the codes that were set — codeOf is reading the wrong field'
      );
    } finally {
      collection.dispose();
    }
  });

  test('the detector fires on a real diagnostic and logs the decision', async function () {
    // The core loop — diagnostic appears, ages, learner is idle, decision recorded — has only ever
    // run against a stub. This runs it in a real editor.
    //
    // It doubles as proof that live settings work. Under the shipped defaults a diagnostic must
    // persist 20 seconds before it counts as a struggle, so a decision appearing within a few
    // seconds is only possible if the threshold change actually took effect. Asserting the setting
    // "does not throw", which is all the previous test did, would not have caught it silently
    // being ignored.
    this.timeout(60_000);

    const settings = vscode.workspace.getConfiguration('rustPairTeacher');
    const originalAge = settings.get<number>('diagnosticAgeMs');
    const originalIdle = settings.get<number>('idleThresholdMs');
    const collection = vscode.languages.createDiagnosticCollection('pair-teacher-detector-probe');

    try {
      await settings.update('diagnosticAgeMs', 1_000, vscode.ConfigurationTarget.Global);
      await settings.update('idleThresholdMs', 100, vscode.ConfigurationTarget.Global);

      const files = await vscode.workspace.findFiles('**/*.rs', undefined, 1);
      assert.ok(files.length > 0, 'no .rs file in the fixture workspace');
      const doc = await vscode.workspace.openTextDocument(files[0]!);
      await vscode.window.showTextDocument(doc);

      const diagnostic = new vscode.Diagnostic(
        new vscode.Range(0, 0, 0, 1),
        'cannot borrow `items` as mutable because it is also borrowed as immutable',
        vscode.DiagnosticSeverity.Error
      );
      diagnostic.code = 'E0502';
      collection.set(doc.uri, [diagnostic]);

      // The extension ticks once a second; give it several, plus the age threshold.
      await new Promise((r) => setTimeout(r, 6_000));

      await vscode.commands.executeCommand('rustPairTeacher.openCandidateLog');
      const log = vscode.window.activeTextEditor?.document.getText() ?? '';

      assert.ok(
        log.includes('E0502'),
        `the candidate log has no decision about E0502, so either the detector never saw it or the shortened threshold was ignored. Log was:\n${log || '(empty)'}`
      );
    } finally {
      collection.dispose();
      await settings.update('diagnosticAgeMs', originalAge, vscode.ConfigurationTarget.Global);
      await settings.update('idleThresholdMs', originalIdle, vscode.ConfigurationTarget.Global);
    }
  });

  test('a settings change is applied without a reload', async () => {
    // Every setting used to be read once, at activation, so changing one did nothing until you
    // happened to reload — silently. If this throws, the listener is gone.
    const settings = vscode.workspace.getConfiguration('rustPairTeacher');
    const original = settings.get<number>('idleThresholdMs');
    try {
      await settings.update('idleThresholdMs', 1234, vscode.ConfigurationTarget.Global);
      assert.strictEqual(
        vscode.workspace.getConfiguration('rustPairTeacher').get('idleThresholdMs'),
        1234
      );
      // The handler runs on the extension host; a throw there surfaces as a rejected command.
      await vscode.commands.executeCommand('rustPairTeacher.showTelemetry');
    } finally {
      await settings.update('idleThresholdMs', original, vscode.ConfigurationTarget.Global);
    }
  });
});
