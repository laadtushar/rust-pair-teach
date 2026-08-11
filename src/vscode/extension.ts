import { existsSync, readFileSync } from 'node:fs';
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
import { diagnoseCredential, PRESETS, testConnection } from '../core/provider/setup.js';
import type { ProviderAdapter } from '../core/provider/types.js';
import { describeDecision, formatDecision } from '../core/log.js';
import { toSignature } from '../core/signature.js';
import { interpret, Telemetry } from '../core/telemetry.js';
import { TutorSession } from '../core/session.js';
import type { DiagnosticObservation } from '../core/types.js';
import { lessonView, type CourseMenuView } from '../core/viewModel.js';
import { Course, emptyProgress, type CourseProgress } from '../core/course.js';
import type { WorkspaceView } from '../core/action/types.js';
import { TutorChat } from '../core/chat/tutorChat.js';
import { DEFAULT_DAILY_CALL_LIMIT, SpendGuard, type SpendState } from '../core/spend.js';
import type { ChatContext, ChatMessage } from '../core/chat/types.js';
import { extractRegion } from '../core/lesson/region.js';
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

  // Every pack in the folder, so adding teaching content never means editing this file.
  const conceptIndex = new Map<string, ConceptEntry>();
  const PACK_IDS = ['rust-borrow-basics', 'rust-common-errors', 'rust-from-scratch'];
  for (const id of PACK_IDS) {
    try {
      const pack = await loadPackFromDisk(
        vscode.Uri.joinPath(context.extensionUri, 'packs', id).fsPath
      );
      for (const [key, concept] of indexBySignature(pack)) {
        if (!conceptIndex.has(key)) conceptIndex.set(key, concept);
      }
      output.appendLine(
        `[packs] loaded ${pack.meta.id} — ${String(pack.concepts.length)} concepts, ${String(pack.lessons.length)} lessons`
      );
    } catch (err) {
      // A broken pack must not take the extension down; the others still teach.
      output.appendLine(`[packs] ${id} failed to load: ${String(err)}`);
    }
  }

  // ---- guided course -------------------------------------------------------
  let course: Course | null = null;
  const progressKey = 'rustPairTeacher.courseProgress';
  const loadProgress = (): CourseProgress =>
    context.globalState.get<CourseProgress>(progressKey) ?? emptyProgress();
  const saveProgress = (p: CourseProgress) => void context.globalState.update(progressKey, p);

  try {
    const coursePack = await loadPackFromDisk(
      vscode.Uri.joinPath(context.extensionUri, 'packs', 'rust-from-scratch').fsPath
    );
    course = new Course(coursePack.lessons, loadProgress());
    output.appendLine(`[course] ${String(coursePack.lessons.length)} lessons available`);
  } catch (err) {
    output.appendLine(`[course] failed to load: ${String(err)}`);
  }

  // One provider, shared. Constructing it twice meant two clients, a duplicated [provider] log
  // line, and the credential warning firing twice on activation.
  const providerConfig = await providerFromSettings(output, context.secrets);

  const engine = new LessonEngine({
    ...providerConfig,
    onDegraded: (reason) => output.appendLine(`[lesson] offline hint — ${reason}`),
  });
  const spendKey = 'rustPairTeacher.spend';
  const spend = new SpendGuard(
    {
      dailyCallLimit: vscode.workspace
        .getConfiguration('rustPairTeacher')
        .get('dailyCallLimit', DEFAULT_DAILY_CALL_LIMIT),
      store: {
        load: () => context.globalState.get<SpendState>(spendKey) ?? null,
        save: (st) => void context.globalState.update(spendKey, st),
      },
    },
    new Date().toISOString()
  );

  let chatError: string | null = null;
  const chatHistoryKey = 'rustPairTeacher.chatHistory';
  const chat = new TutorChat({
    ...providerConfig,
    store: {
      // workspaceState, not globalState: a conversation about one project must not surface in
      // another.
      load: () => context.workspaceState.get<ChatMessage[]>(chatHistoryKey) ?? [],
      save: (messages) => void context.workspaceState.update(chatHistoryKey, [...messages]),
    },
    spend,
    strictNoCode: vscode.workspace.getConfiguration('rustPairTeacher').get('strictNoCode', true),
    onChanged: () => refreshSidebar(),
    onError: (message) => {
      chatError = message;
      output.appendLine(`[chat] ${message}`);
      refreshSidebar();
    },
    onDegraded: (reason) => output.appendLine(`[chat] context trimmed: ${reason}`),
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

  const commandsRun: string[] = [];
  context.subscriptions.push(
    vscode.window.onDidStartTerminalShellExecution?.((e) => {
      const line = e.execution.commandLine.value.trim();
      if (line) commandsRun.push(line);
      refreshSidebar();
    }) ?? { dispose: () => undefined }
  );

  /** Everything the tutor can see when it speaks. Rebuilt per turn, never accumulated. */
  function chatContext(): ChatContext {
    const editor = vscode.window.activeTextEditor;
    const doc = editor?.document.languageId === LANGUAGE ? editor.document : undefined;
    const state = course?.refresh(workspaceView()) ?? null;

    const errors = doc
      ? readDiagnostics(doc.uri).slice(0, 3).map((d) => `${d.signature.value}: ${d.message.split('\n')[0]!}`)
      : [];

    const hasWorkspace = (vscode.workspace.workspaceFolders?.length ?? 0) > 0;

    return {
      ...(hasWorkspace ? {} : { noWorkspace: true }),
      ...(state?.lesson.title ? { lessonTitle: state.lesson.title } : {}),
      ...(state?.lesson.goal ? { lessonGoal: state.lesson.goal } : {}),
      ...(state
        ? { steps: state.steps.map((st) => ({ instruction: st.step.instruction, done: st.done })) }
        : {}),
      ...(doc ? { fileName: vscode.workspace.asRelativePath(doc.uri) } : {}),
      // Only the region around the cursor travels, same rule as everywhere else.
      ...(doc
        ? { code: extractRegion(doc.getText(), editor?.selection.active.line ?? 0, 60).text }
        : {}),
      ...(errors.length ? { errors } : {}),
    };
  }

  function workspaceView(): WorkspaceView {
    const root = vscode.workspace.workspaceFolders?.[0]?.uri;
    return {
      exists: (p) => (root ? existsSync(vscode.Uri.joinPath(root, p).fsPath) : false),
      read: (p) => {
        if (!root) return null;
        try {
          return readFileSync(vscode.Uri.joinPath(root, p).fsPath, 'utf8');
        } catch {
          return null;
        }
      },
      commandsRun,
    };
  }

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
    // Step checkmarks are the teaching device — they have to tick as the learner works.
    vscode.workspace.onDidSaveTextDocument(() => {
      refreshSidebar();
      void reactToProgress();
    }),
    vscode.workspace.onDidCreateFiles(() => refreshSidebar()),
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
        if (chat.configured && decision.signature) {
          // In chat mode the tutor raises it in conversation rather than replacing the panel.
          void chat.nudge('new_error', decision.signature.value, chatContext(), now);
        } else {
          void teach(decision.uri, decision, now);
        }
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
      sidebar.show({ kind: 'hint', view: lessonView(outcome.lesson) });
      // A gentle pull, never a modal — the sidebar is the teaching surface, not a popup.
      await vscode.commands.executeCommand('setContext', 'rustPairTeacher.hasLesson', true);
    } else {
      output.appendLine(`[lesson] not offered: ${outcome.reason}`);
    }
  }

  // ---- sidebar state -------------------------------------------------------

  /**
   * Render whatever the learner should see now.
   *
   * A live hint outranks the course, because it is about the code in front of them. Otherwise the
   * course shows — never an empty panel. Someone who has written no Rust yet is exactly the person
   * a "nothing to teach right now" screen fails.
   */
  /** True while the learner is browsing the lesson list. */
  let showingMenu = false;

  /**
   * Render whatever the learner should see now.
   *
   * Chat is the default surface — a conversation they can talk into at any moment. The lesson list
   * is a place they visit deliberately, not somewhere they get dumped.
   */
  function refreshSidebar(): void {
    if (showingMenu && course) {
      sidebar.show({ kind: 'menu', view: menuView() });
      return;
    }

    const state = course?.refresh(workspaceView()) ?? null;
    sidebar.show({
      kind: 'chat',
      messages: chat.messages,
      busy: chat.isBusy,
      configured: chat.configured,
      heading: state && course?.state.current ? state.lesson.title : null,
      subheading:
        state && course?.state.current
          ? `Lesson ${String(state.index + 1)} of ${String(state.total)} — ${state.lesson.goal}`
          : null,
      error: chatError,
    });
  }

  /**
   * Let the tutor notice progress out loud.
   *
   * Noticing is most of what a good teacher does — a step ticking silently is a missed moment.
   */
  let lastDoneCount = -1;
  async function reactToProgress(): Promise<void> {
    if (!course || !course.state.current) return;
    const state = course.refresh(workspaceView());
    if (!state) return;

    const done = state.steps.filter((st) => st.done).length;
    if (lastDoneCount === -1) {
      lastDoneCount = done;
      return;
    }
    if (done <= lastDoneCount) {
      lastDoneCount = done;
      return;
    }
    lastDoneCount = done;

    await chat.nudge(
      state.ready ? 'lesson_completed' : 'step_completed',
      `${state.lesson.id}:${String(done)}`,
      chatContext(),
      Date.now()
    );
  }

  function menuView(): CourseMenuView {
    const c = course!;
    const progress = c.overall();
    const settings = vscode.workspace.getConfiguration('rustPairTeacher');
    const configured =
      settings.get<string>('baseUrl', '').trim() !== '' && settings.get<string>('model', '').trim() !== '';

    return {
      kind: 'menu',
      heading: progress.done > 0 ? 'Rust, step by step' : 'Learn Rust from scratch',
      subheading:
        progress.done > 0
          ? 'Pick up where you left off, or jump to any lesson.'
          : 'Eight lessons, from your first program to writing tests. You write every line.',
      progress,
      lessons: c.all.map((l) => ({
        id: l.id,
        title: l.title,
        goal: l.goal,
        done: c.isComplete(l.id),
        current: c.state.current === l.id,
      })),
      setupNotice: configured
        ? null
        : 'Hints come from the built-in material right now. Connecting a model personalises them to your code — Ollama is free and runs locally.',
    };
  }

  async function handleAction(action: SidebarAction): Promise<void> {
    const now = Date.now();
    const lesson = session.activeLesson;

    switch (action.type) {
      case 'escalate': {
        if (!lesson) return;
        const text = documentText(lesson.uri);
        if (text === null) return;
        const next = await session.escalate(text, now);
        if (next) telemetry.hintShown(next.level, lesson.concept.id, next.offline);
        refreshSidebar();
        return;
      }

      case 'solved':
      case 'dismissed': {
        if (!lesson) return;
        telemetry.resolved(
          action.type === 'solved'
            ? (`self_level_${String(lesson.level)}` as never)
            : 'abandoned'
        );
        session.resolve(action.type === 'solved' ? 'solved' : 'dismissed', now);
        refreshSidebar();
        return;
      }

      case 'teach_me':
        await teachOnDemand(now);
        return;

      case 'send':
        chatError = null;
        showingMenu = false;
        await chat.say(action.text, chatContext(), now);
        return;

      case 'reset_chat':
        chatError = null;
        chat.reset();
        return;

      case 'cancel':
        chat.cancel();
        return;

      case 'start_course': {
        if (!course) return;
        const next = course.nextLesson();
        if (next) {
          course.start(next.id, new Date(now).toISOString());
          saveProgress(course.state);
        }
        showingMenu = false;
        lastDoneCount = -1;
        refreshSidebar();
        await chat.nudge('lesson_opened', next?.id ?? 'none', chatContext(), now);
        return;
      }

      case 'open_lesson': {
        if (!course || !action.lessonId) return;
        course.start(action.lessonId, new Date(now).toISOString());
        saveProgress(course.state);
        showingMenu = false;
        lastDoneCount = -1;
        refreshSidebar();
        await chat.nudge('lesson_opened', action.lessonId, chatContext(), now);
        return;
      }

      case 'complete_lesson': {
        if (!course) return;
        const open = course.state.current;
        if (open) saveProgress(course.complete(open));
        lastDoneCount = -1;
        refreshSidebar();
        return;
      }

      case 'show_menu': {
        showingMenu = true;
        refreshSidebar();
        return;
      }

      case 'setup_model':
        await vscode.commands.executeCommand('rustPairTeacher.setupModel');
        return;
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

  refreshSidebar();
  // Speak first. A tutor that waits to be addressed is a search box.
  void chat.nudge('session_start', 'boot', chatContext(), Date.now());

  context.subscriptions.push(
    vscode.commands.registerCommand('rustPairTeacher.chat', async () => {
      await vscode.commands.executeCommand('rustPairTeacher.lesson.focus');
      refreshSidebar();
    }),
    vscode.commands.registerCommand('rustPairTeacher.startCourse', async () => {
      await vscode.commands.executeCommand('rustPairTeacher.lesson.focus');
      await handleAction({ type: 'start_course' });
    }),
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
        content: JSON.stringify(
          { snapshot: snap, reading: interpret(snap), spend: spend.snapshot() },
          null,
          2
        ),
      });
      await vscode.window.showTextDocument(doc);
    }),
    vscode.commands.registerCommand('rustPairTeacher.setupModel', async () => {
      const picked = await vscode.window.showQuickPick(
        PRESETS.map((p) => ({ label: p.label, detail: p.note, preset: p })),
        { title: 'Where should hints come from?', ignoreFocusOut: true }
      );
      if (!picked) return;

      const { preset } = picked;
      const chosenModel =
        (await vscode.window.showInputBox({
          title: 'Model id',
          value: preset.suggestedModel,
          ignoreFocusOut: true,
        })) ?? '';
      if (chosenModel.trim() === '') return;

      const settings = vscode.workspace.getConfiguration('rustPairTeacher');
      await settings.update('baseUrl', preset.baseUrl, vscode.ConfigurationTarget.Global);
      await settings.update('model', chosenModel.trim(), vscode.ConfigurationTarget.Global);

      if (preset.needsKey) {
        const key = await vscode.window.showInputBox({
          title: `API key for ${preset.label}`,
          prompt: 'Stored in the OS keychain. A ChatGPT or Claude subscription is not an API key.',
          password: true,
          ignoreFocusOut: true,
        });
        if (key && key.trim() !== '') await context.secrets.store(API_KEY_SECRET, key.trim());
      }

      const key = (await context.secrets.get(API_KEY_SECRET))?.trim();
      const bad = diagnoseCredential(preset.baseUrl, key);
      if (bad) {
        void vscode.window.showErrorMessage(bad.message);
        return;
      }

      // Prove it works now, rather than letting the learner find out mid-struggle.
      const result = await vscode.window.withProgress(
        { location: vscode.ProgressLocation.Notification, title: 'Testing the connection…' },
        () =>
          testConnection(
            new OpenAiCompatibleProvider({ baseUrl: preset.baseUrl, ...(key ? { apiKey: key } : {}) }),
            chosenModel.trim()
          )
      );

      output.appendLine(`[provider] connection test: ${result.message}`);
      if (result.ok) {
        void vscode.window.showInformationMessage(
          `${result.message} Reload the window to start using it.`
        );
      } else {
        void vscode.window.showErrorMessage(result.message);
      }
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

  // Say so now, plainly, rather than letting it surface as a bare 401 mid-struggle.
  const problem = diagnoseCredential(baseUrl, apiKey);
  if (problem) {
    output.appendLine(`[provider] ${problem.message}`);
    void vscode.window
      .showWarningMessage(problem.message, 'Set up a model')
      .then((choice) => {
        if (choice) void vscode.commands.executeCommand('rustPairTeacher.setupModel');
      });
  }

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
