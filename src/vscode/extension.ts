import { appendFile, mkdir } from 'node:fs/promises';

import * as vscode from 'vscode';

import { defaultConfig, type DetectorConfig } from '../core/config.js';
import { MomentDetector } from '../core/detector.js';
import { EditStream } from '../core/editStream.js';
import { LessonEngine } from '../core/lesson/engine.js';
import { LearnerStore } from '../core/learner/store.js';
import { loadPackFromDisk } from '../core/pack/loadFromDisk.js';
import { indexBySignature } from '../core/pack/schema.js';
import type { ConceptEntry } from '../core/pack/types.js';
import { OpenAiCompatibleProvider } from '../core/provider/openaiCompatible.js';
import type { ProviderAdapter } from '../core/provider/types.js';
import { describeDecision, formatDecision } from '../core/log.js';
import { toSignature } from '../core/signature.js';
import { interpret, Telemetry } from '../core/telemetry.js';
import { TutorSession } from '../core/session.js';
import type { DiagnosticObservation } from '../core/types.js';
import { lessonView } from '../core/viewModel.js';
import { TutorSidebar, type SidebarAction } from './sidebar.js';

const LANGUAGE = 'rust';
const TICK_MS = 1_000;

/**
 * The VS Code adapter — the only place in the project that imports `vscode`.
 *
 * It translates editor events into core calls and renders what core decides. Every judgement about
 * when to speak, what to teach, and how far up the ladder to go lives in `src/core`, which is what
 * keeps the eventual Neovim/Zed sidecar a port of this file rather than a rewrite of the product.
 */
export async function activate(context: vscode.ExtensionContext): Promise<void> {
  const output = vscode.window.createOutputChannel('Rust Pair Teacher');
  context.subscriptions.push(output);

  const config = readConfig();
  const editStream = new EditStream(config);

  const telemetry = new Telemetry(
    vscode.workspace.getConfiguration('rustPairTeacher').get('telemetry', false),
    new Date().toISOString()
  );

  const store = new LearnerStore(context.globalStorageUri.fsPath);
  let model = await store.load(Date.now());

  let conceptIndex = new Map<string, ConceptEntry>();
  try {
    const pack = await loadPackFromDisk(
      vscode.Uri.joinPath(context.extensionUri, 'packs', 'rust-borrow-basics').fsPath
    );
    conceptIndex = indexBySignature(pack);
    output.appendLine(`[packs] loaded ${pack.meta.id} with ${String(pack.concepts.length)} concepts`);
  } catch (err) {
    // A broken pack must not take the extension down — detection and logging still have value.
    output.appendLine(`[packs] failed to load: ${String(err)}`);
  }

  const engine = new LessonEngine({
    ...(await providerFromSettings(output, context.secrets)),
    onDegraded: (reason) => output.appendLine(`[lesson] offline hint — ${reason}`),
  });

  const session = new TutorSession({
    engine,
    conceptIndex,
    model,
    onModelChanged: (m) => {
      model = m;
      void store.save(m).catch((err: unknown) => {
        output.appendLine(`[learner] save failed: ${String(err)}`);
      });
    },
  });

  const sidebar = new TutorSidebar(context.extensionUri, (action) => {
    void handleAction(action);
  });
  context.subscriptions.push(
    vscode.window.registerWebviewViewProvider(TutorSidebar.viewType, sidebar)
  );

  const detector = new MomentDetector({
    config,
    editStream,
    ambient: vscode.workspace.getConfiguration('rustPairTeacher').get('ambient', true),
    onCleared: (cleared, now) => {
      // Solved with no help at all — the signal a struggle-only tutor never sees.
      if (!cleared.wasTaught) {
        session.noteResolvedUnaided(cleared.signature, cleared.firstSeenAt, now);
      }
    },
  });

  // ---- candidate log -------------------------------------------------------
  const logUri = vscode.Uri.joinPath(context.globalStorageUri, 'candidates.jsonl');
  const pending: string[] = [];
  let flushChain: Promise<void> = Promise.resolve();
  const flush = (): Promise<void> => {
    if (pending.length === 0) return flushChain;
    const chunk = pending.splice(0, pending.length).join('\n') + '\n';
    flushChain = flushChain
      .then(async () => {
        await mkdir(context.globalStorageUri.fsPath, { recursive: true });
        await appendFile(logUri.fsPath, chunk, 'utf8');
      })
      .catch((err: unknown) => output.appendLine(`[log] write failed: ${String(err)}`));
    return flushChain;
  };

  // ---- editor wiring -------------------------------------------------------
  context.subscriptions.push(
    vscode.workspace.onDidChangeTextDocument((e) => {
      if (e.document.languageId !== LANGUAGE) return;
      editStream.onEdit(e.document.uri.toString(), e.document.getText(), Date.now());
    }),
    vscode.languages.onDidChangeDiagnostics((e) => {
      const now = Date.now();
      for (const uri of e.uris) {
        const doc = vscode.workspace.textDocuments.find((d) => d.uri.toString() === uri.toString());
        if (doc && doc.languageId !== LANGUAGE) continue;
        detector.onDiagnostics(uri.toString(), readDiagnostics(uri), now);
      }
    })
  );

  const timer = setInterval(() => {
    const now = Date.now();
    for (const decision of detector.tick(now)) {
      pending.push(formatDecision(decision));
      output.appendLine(describeDecision(decision));
      if (decision.fired) {
        telemetry.momentFired();
        void teach(decision.uri, decision, now);
      } else if (decision.suppressedBy) {
        telemetry.momentSuppressed(decision.suppressedBy);
      }
    }
    void flush();
  }, TICK_MS);
  context.subscriptions.push({ dispose: () => clearInterval(timer) });

  // ---- actions -------------------------------------------------------------
  async function teach(
    uri: string,
    decision: Parameters<TutorSession['offer']>[0],
    now: number,
    onDemand = false
  ): Promise<void> {
    const text = documentText(uri);
    if (text === null) return;

    const outcome = await session.offer(decision, text, now, { onDemand });
    if (outcome.kind === 'offered') {
      const shown = outcome.lesson.hints[outcome.lesson.hints.length - 1]!;
      telemetry.hintShown(shown.level, outcome.lesson.concept.id, shown.offline);
      sidebar.show(lessonView(outcome.lesson));
      // A gentle pull, never a modal — the sidebar is the teaching surface, not a popup.
      await vscode.commands.executeCommand('setContext', 'rustPairTeacher.hasLesson', true);
    } else {
      output.appendLine(`[lesson] not offered: ${outcome.reason}`);
    }
  }

  async function handleAction(action: SidebarAction): Promise<void> {
    const now = Date.now();
    const lesson = session.activeLesson;

    if (action === 'escalate' && lesson) {
      const text = documentText(lesson.uri);
      if (text === null) return;
      const next = await session.escalate(text, now);
      if (next) telemetry.hintShown(next.level, lesson.concept.id, next.offline);
      if (session.activeLesson) sidebar.show(lessonView(session.activeLesson));
      return;
    }

    if ((action === 'solved' || action === 'dismissed') && lesson) {
      telemetry.resolved(action === 'solved' ? `self_level_${String(lesson.level)}` as never : 'abandoned');
      session.resolve(action === 'solved' ? 'solved' : 'dismissed', now);
      sidebar.clear();
      return;
    }

    if (action === 'teach_me') {
      await teachOnDemand(now);
    }
  }

  /** On-demand: teach whatever is wrong at the cursor, bypassing every cooldown and fade rule. */
  async function teachOnDemand(now: number): Promise<void> {
    telemetry.onDemand();
    const editor = vscode.window.activeTextEditor;
    if (!editor || editor.document.languageId !== LANGUAGE) {
      void vscode.window.showInformationMessage('Open a Rust file first.');
      return;
    }
    const uri = editor.document.uri;
    const line = editor.selection.active.line;
    const observations = readDiagnostics(uri);
    const at =
      observations.find((o) => o.startLine <= line && line <= o.endLine) ?? observations[0];

    if (!at) {
      void vscode.window.showInformationMessage('Nothing is failing to compile right now.');
      return;
    }

    await teach(
      uri.toString(),
      {
        at: now,
        kind: 'lingering_diagnostic',
        uri: uri.toString(),
        signature: at.signature,
        startLine: at.startLine,
        fired: true,
        reason: 'requested by the learner',
      },
      now,
      true
    );
  }

  context.subscriptions.push(
    vscode.commands.registerCommand('rustPairTeacher.openCandidateLog', async () => {
      await flush();
      await vscode.window.showTextDocument(await vscode.workspace.openTextDocument(logUri));
    }),
    vscode.commands.registerCommand('rustPairTeacher.toggleAmbient', () => {
      detector.ambient = !detector.ambient;
      telemetry.ambientToggled(detector.ambient);
      void vscode.window.showInformationMessage(
        `Rust Pair Teacher: ambient watching ${detector.ambient ? 'on' : 'off'}`
      );
    }),
    vscode.commands.registerCommand('rustPairTeacher.teachMe', () => teachOnDemand(Date.now())),
    vscode.commands.registerCommand('rustPairTeacher.showTelemetry', async () => {
      if (!telemetry.enabled) {
        void vscode.window.showInformationMessage(
          'Telemetry is off. Enable rustPairTeacher.telemetry to collect it — it stays on this machine.'
        );
        return;
      }
      const snap = telemetry.snapshot();
      const doc = await vscode.workspace.openTextDocument({
        language: 'json',
        content: JSON.stringify({ snapshot: snap, reading: interpret(snap) }, null, 2),
      });
      await vscode.window.showTextDocument(doc);
    }),
    vscode.commands.registerCommand('rustPairTeacher.setApiKey', async () => {
      const key = await vscode.window.showInputBox({
        prompt: 'API key for your chosen provider. Stored in the OS keychain, never in settings.',
        password: true,
        ignoreFocusOut: true,
      });
      if (key === undefined) return;
      if (key.trim() === '') {
        await context.secrets.delete(API_KEY_SECRET);
        void vscode.window.showInformationMessage('Rust Pair Teacher: API key cleared.');
        return;
      }
      await context.secrets.store(API_KEY_SECRET, key.trim());
      void vscode.window.showInformationMessage(
        'Rust Pair Teacher: API key stored. Reload the window to use it.'
      );
    })
  );
}

export function deactivate(): void {
  // Everything is disposed through context.subscriptions.
}

function documentText(uri: string): string | null {
  const doc = vscode.workspace.textDocuments.find((d) => d.uri.toString() === uri);
  return doc ? doc.getText() : null;
}

function readConfig(): DetectorConfig {
  const settings = vscode.workspace.getConfiguration('rustPairTeacher');
  return {
    ...defaultConfig,
    diagnosticAgeMs: settings.get('diagnosticAgeMs', defaultConfig.diagnosticAgeMs),
    idleThresholdMs: settings.get('idleThresholdMs', defaultConfig.idleThresholdMs),
  };
}

export const API_KEY_SECRET = 'rustPairTeacher.apiKey';

/**
 * The key lives in SecretStorage, never in settings.json.
 *
 * A settings-based key ends up in a synced profile or a committed workspace file sooner or later,
 * and this project's audience is specifically people learning — the ones least likely to notice
 * they just pushed a credential. Local models need no key at all, which stays the recommended path.
 */
async function providerFromSettings(
  output: vscode.OutputChannel,
  secrets: vscode.SecretStorage
): Promise<{ provider?: ProviderAdapter; model: string }> {
  const settings = vscode.workspace.getConfiguration('rustPairTeacher');
  const baseUrl = settings.get<string>('baseUrl', '').trim();
  const model = settings.get<string>('model', '').trim();

  if (!baseUrl || !model) {
    output.appendLine(
      '[provider] none configured — teaching from the built-in material only. Set rustPairTeacher.baseUrl and .model to personalize.'
    );
    return { model: model || 'unconfigured' };
  }

  const apiKey = (await secrets.get(API_KEY_SECRET))?.trim();
  output.appendLine(`[provider] ${baseUrl} (${model})${apiKey ? '' : ' — no key stored'}`);
  return {
    model,
    provider: new OpenAiCompatibleProvider({ baseUrl, ...(apiKey ? { apiKey } : {}) }),
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
