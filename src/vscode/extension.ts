import { appendFile, mkdir } from 'node:fs/promises';

import * as vscode from 'vscode';

import { defaultConfig, type DetectorConfig } from '../core/config.js';
import { MomentDetector } from '../core/detector.js';
import { EditStream } from '../core/editStream.js';
import { describeDecision, formatDecision } from '../core/log.js';
import { toSignature } from '../core/signature.js';
import type { DiagnosticObservation } from '../core/types.js';

const LANGUAGE = 'rust';
const TICK_MS = 1_000;

/**
 * The VS Code adapter — the only file in the project allowed to import `vscode`.
 *
 * It does no thinking. It translates editor events into core events, runs the clock, and writes the
 * decisions out. Everything that constitutes a judgement lives in `src/core`, which is what makes
 * the eventual Neovim/Zed sidecar a port of this file rather than a rewrite of the product.
 */
export function activate(context: vscode.ExtensionContext): void {
  const config = readConfig();
  const editStream = new EditStream(config);
  const detector = new MomentDetector({
    config,
    editStream,
    ambient: vscode.workspace.getConfiguration('rustPairTeacher').get('ambient', true),
  });

  const logUri = vscode.Uri.joinPath(context.globalStorageUri, 'candidates.jsonl');
  const output = vscode.window.createOutputChannel('Rust Pair Teacher');
  context.subscriptions.push(output);

  const pending: string[] = [];

  /**
   * Append pending decisions to the log.
   *
   * Two things this must not do, both learned the hard way. It must not read-modify-write the whole
   * file, because a long session turns that into quadratic work on every tick. And it must not run
   * concurrently with itself: the tick loop fires this without awaiting, so two overlapping flushes
   * would both read the pre-write file and the first one's lines would vanish. Hence a genuine
   * append plus a serializing chain.
   */
  let flushChain: Promise<void> = Promise.resolve();
  const flush = (): Promise<void> => {
    if (pending.length === 0) return flushChain;
    const chunk = pending.splice(0, pending.length).join('\n') + '\n';
    flushChain = flushChain
      .then(async () => {
        await mkdir(context.globalStorageUri.fsPath, { recursive: true });
        await appendFile(logUri.fsPath, chunk, 'utf8');
      })
      .catch((err: unknown) => {
        // Never let logging break the editing experience (N4).
        output.appendLine(`[log] write failed: ${String(err)}`);
      });
    return flushChain;
  };

  context.subscriptions.push(
    vscode.workspace.onDidChangeTextDocument((e) => {
      if (e.document.languageId !== LANGUAGE) return;
      editStream.onEdit(e.document.uri.toString(), e.document.getText(), Date.now());
    })
  );

  context.subscriptions.push(
    vscode.languages.onDidChangeDiagnostics((e) => {
      const now = Date.now();
      for (const uri of e.uris) {
        const doc = vscode.workspace.textDocuments.find(
          (d) => d.uri.toString() === uri.toString()
        );
        if (doc && doc.languageId !== LANGUAGE) continue;
        detector.onDiagnostics(uri.toString(), readDiagnostics(uri), now);
      }
    })
  );

  const timer = setInterval(() => {
    const decisions = detector.tick(Date.now());
    for (const d of decisions) {
      pending.push(formatDecision(d));
      output.appendLine(describeDecision(d));
    }
    void flush();
  }, TICK_MS);
  context.subscriptions.push({ dispose: () => clearInterval(timer) });

  context.subscriptions.push(
    vscode.commands.registerCommand('rustPairTeacher.openCandidateLog', async () => {
      await flush();
      const doc = await vscode.workspace.openTextDocument(logUri);
      await vscode.window.showTextDocument(doc);
    }),
    vscode.commands.registerCommand('rustPairTeacher.toggleAmbient', () => {
      detector.ambient = !detector.ambient;
      vscode.window.showInformationMessage(
        `Rust Pair Teacher: ambient watching ${detector.ambient ? 'on' : 'off'}`
      );
    })
  );
}

export function deactivate(): void {
  // The interval is disposed via context.subscriptions.
}

function readConfig(): DetectorConfig {
  const settings = vscode.workspace.getConfiguration('rustPairTeacher');
  return {
    ...defaultConfig,
    diagnosticAgeMs: settings.get('diagnosticAgeMs', defaultConfig.diagnosticAgeMs),
    idleThresholdMs: settings.get('idleThresholdMs', defaultConfig.idleThresholdMs),
  };
}

function readDiagnostics(uri: vscode.Uri): DiagnosticObservation[] {
  return vscode.languages
    .getDiagnostics(uri)
    .filter((d) => d.severity === vscode.DiagnosticSeverity.Error)
    .map((d) => ({
      uri: uri.toString(),
      signature: toSignature(LANGUAGE, codeOf(d), d.message),
      message: d.message,
      startLine: d.range.start.line,
      endLine: d.range.end.line,
    }));
}

function codeOf(d: vscode.Diagnostic): string | undefined {
  const code = d.code;
  if (code === undefined) return undefined;
  if (typeof code === 'string') return code;
  if (typeof code === 'number') return String(code);
  return typeof code.value === 'string' ? code.value : String(code.value);
}
