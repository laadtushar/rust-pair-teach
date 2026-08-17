import { existsSync, readFileSync } from 'node:fs';
import { appendFile, mkdir } from 'node:fs/promises';

import * as vscode from 'vscode';

import { defaultConfig, type DetectorConfig } from '../core/config.js';
import { MomentDetector } from '../core/detector.js';
import { EditStream } from '../core/editStream.js';
import { isWatched, WATCHED_EDITOR_IDS, languageForEditorId } from '../core/language.js';
import { LearnerStore } from '../core/learner/store.js';
import { discoverPacks } from '../core/pack/discover.js';
import { indexBySignature } from '../core/pack/schema.js';
import type { ConceptEntry } from '../core/pack/types.js';
import { OpenAiCompatibleProvider } from '../core/provider/openaiCompatible.js';
import { diagnoseCredential, PRESETS, testConnection } from '../core/provider/setup.js';
import { describeEgress, type ProviderAdapter } from '../core/provider/types.js';
import { describeDecision, formatDecision } from '../core/log.js';
import { SignatureResolver } from '../core/signature.js';
import { interpret, Telemetry } from '../core/telemetry.js';
import { TutorSession } from '../core/session.js';
import type { DiagnosticObservation } from '../core/types.js';
import type { CourseMenuView } from '../core/viewModel.js';
import { Course, emptyProgress, type CourseProgress } from '../core/course.js';
import type { WorkspaceView } from '../core/action/types.js';
import { fitChatPrompt } from '../core/chat/prompt.js';
import { DEFAULT_MAX_PROMPT_CHARS, TutorChat } from '../core/chat/tutorChat.js';
import { DEFAULT_DAILY_CALL_LIMIT, SpendGuard, type SpendState } from '../core/spend.js';
import type { ChatContext, ChatMessage } from '../core/chat/types.js';
import { extractRegion } from '../core/lesson/region.js';
import { TutorSidebar, type SidebarAction } from './sidebar.js';

const TICK_MS = 1_000;

interface ProviderConfig {
  provider?: ProviderAdapter;
  model: string;
  /** A credential problem worth telling the learner about, or null. */
  problem: string | null;
}

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
  const { packs, failures } = await discoverPacks(
    vscode.Uri.joinPath(context.extensionUri, 'packs').fsPath
  );
  const conceptIndex = new Map<string, ConceptEntry>();
  for (const pack of packs) {
    for (const [key, concept] of indexBySignature(pack)) {
      if (!conceptIndex.has(key)) conceptIndex.set(key, concept);
    }
    output.appendLine(
      `[packs] loaded ${pack.meta.id} (${pack.meta.language}) — ${String(pack.concepts.length)} concepts, ${String(pack.lessons.length)} lessons`
    );
  }
  for (const { id, reason } of failures) {
    // A broken pack must not take the extension down; the others still teach.
    output.appendLine(`[packs] ${id} failed to load: ${reason}`);
  }

  // A codeless language's errors only reach a concept through this. Built from the packs, so a new
  // language pack needs no code change to start matching.
  const signatures = new SignatureResolver(packs, (pattern, err) =>
    output.appendLine(`[packs] ignoring unusable pattern ${JSON.stringify(pattern)}: ${err}`)
  );
  output.appendLine(`[packs] ${String(signatures.size)} message pattern(s) live`);

  // ---- guided course -------------------------------------------------------
  const progressKey = 'rustPairTeacher.courseProgress';
  const loadProgress = (): CourseProgress =>
    context.globalState.get<CourseProgress>(progressKey) ?? emptyProgress();
  const saveProgress = (p: CourseProgress) => void context.globalState.update(progressKey, p);

  // The course is whichever pack ships lessons. Only Rust has one today; a second course pack would
  // need a picker, and inventing that UI before a second course exists would be guessing.
  const coursePack = packs.find((p) => p.lessons.length > 0);
  const course: Course | null = coursePack
    ? new Course(coursePack.lessons, loadProgress())
    : null;
  output.appendLine(
    coursePack
      ? `[course] ${String(coursePack.lessons.length)} lessons available from ${coursePack.meta.id}`
      : '[course] no pack ships lessons'
  );

  // One provider, shared. Constructing it twice meant two clients, a duplicated [provider] log
  // line, and the credential warning firing twice on activation.
  const providerConfig = await providerFromSettings(output, context.secrets);
  let lastCredentialWarning = warnAboutCredential(providerConfig.problem, null);

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
    model: providerConfig.model,
    ...(providerConfig.provider ? { provider: providerConfig.provider } : {}),
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
    onTelemetry: (event) => telemetry.chatEvent(event),
  });

  const session = new TutorSession({
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

  /**
   * Read the editor's diagnostics through the resolver.
   *
   * A closure rather than a module function because it needs the packs: a Python message only
   * becomes a teachable signature by matching a pattern some pack declared.
   */
  function readDiagnostics(uri: vscode.Uri, editorId: string): DiagnosticObservation[] {
    const language = languageForEditorId(editorId)?.id ?? editorId;
    return vscode.languages
      .getDiagnostics(uri)
      .filter((d) => d.severity === vscode.DiagnosticSeverity.Error)
      .map((d) => ({
        uri: uri.toString(),
        signature: signatures.resolve(language, codeOf(d), d.message),
        message: d.message,
        startLine: d.range.start.line,
        endLine: d.range.end.line,
      }));
  }

  /** Everything the tutor can see when it speaks. Rebuilt per turn, never accumulated. */
  function chatContext(): ChatContext {
    const editor = vscode.window.activeTextEditor;
    const doc =
      editor && isWatched(editor.document.languageId) ? editor.document : undefined;
    const state = course?.refresh(workspaceView()) ?? null;

    const errors = doc
      ? readDiagnostics(doc.uri, doc.languageId)
          .slice(0, 3)
          .map((d) => `${d.signature.value}: ${d.message.split('\n')[0]!}`)
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
      // The compiler decides something was resolved; what the tutor did decides the credit (A5).
      const resolution = session.noteResolved(
        cleared.signature,
        cleared.wasTaught ? 'discussed' : 'silent',
        cleared.firstSeenAt,
        now
      );
      if (resolution) telemetry.resolved(resolution);
    },
  });

  // ---- settings, applied while running -------------------------------------

  /**
   * Adopt changed settings without a window reload.
   *
   * Every setting used to be read exactly once, at activation. Narrowing `idleThresholdMs` to see
   * the tutor sooner did nothing, silently, until you happened to reload — and the setup wizard had
   * to end by *instructing* people to reload, which is a strange first experience from something
   * whose pitch is that it notices things for you.
   *
   * Detector and edit-stream state deliberately survive: someone who shortens the threshold while
   * staring at an error wants it applied to that error, and rebuilding would forget the
   * `firstSeenAt` the threshold is measured against.
   */
  async function applySettings(reason: string): Promise<void> {
    try {
      await reapply(reason);
    } catch (err) {
      // Nothing here is worth taking the extension down for, and an unhandled rejection in the
      // extension host is invisible to the learner. Keep the old settings and say so.
      output.appendLine(`[settings] could not reapply after ${reason}: ${String(err)}`);
    }
  }

  async function reapply(reason: string): Promise<void> {
    const settings = vscode.workspace.getConfiguration('rustPairTeacher');
    const thresholds = readConfig();
    editStream.reconfigure(thresholds);
    detector.reconfigure(thresholds);
    detector.ambient = settings.get('ambient', true);
    telemetry.enabled = settings.get('telemetry', false);
    spend.setDailyLimit(settings.get('dailyCallLimit', DEFAULT_DAILY_CALL_LIMIT));

    const next = await providerFromSettings(output, context.secrets);
    lastCredentialWarning = warnAboutCredential(next.problem, lastCredentialWarning);
    chat.reconfigure({
      provider: next.provider,
      model: next.model,
      strictNoCode: settings.get('strictNoCode', true),
    });

    output.appendLine(`[settings] reapplied after ${reason}`);
    refreshSidebar();
  }

  context.subscriptions.push(
    vscode.workspace.onDidChangeConfiguration((e) => {
      if (e.affectsConfiguration('rustPairTeacher')) void applySettings('a settings change');
    }),
    // The API key does not live in settings, so it needs its own listener — otherwise storing a key
    // is the one part of setup that still demands a reload.
    context.secrets.onDidChange((e) => {
      if (e.key === API_KEY_SECRET) void applySettings('an API key change');
    })
  );

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
      if (!isWatched(e.document.languageId)) return;
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
        // An unopened document cannot be classified, and teaching about a file the learner is not
        // looking at was never the point — so it is skipped rather than assumed to be Rust.
        const doc = vscode.workspace.textDocuments.find((d) => d.uri.toString() === uri.toString());
        if (!doc || !isWatched(doc.languageId)) continue;
        detector.onDiagnostics(uri.toString(), readDiagnostics(uri, doc.languageId), now);
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
        void raise(decision.signature, now);
      } else if (decision.suppressedBy) {
        telemetry.momentSuppressed(decision.suppressedBy);
      }
    }
    void flush();
  }, TICK_MS);
  context.subscriptions.push({ dispose: () => clearInterval(timer) });

  // ---- actions ---------------------------------------------------------------

  /**
   * Bring an error into the conversation.
   *
   * One path, whether or not a model is configured: with one, the tutor talks about it; without,
   * the built-in material is delivered into the same panel as a tutor message. There is no second
   * UI whose appearance depends on configuration (A3).
   */
  async function raise(
    signature: import('../core/types.js').DiagnosticSignature | undefined,
    now: number,
    onDemand = false
  ): Promise<void> {
    if (!signature) return;
    if (!onDemand && !session.shouldSpeakUnprompted(signature, now)) {
      output.appendLine(`[lesson] not raised: mastered, fading`);
      return;
    }

    const concept = session.conceptFor(signature);
    if (!concept) {
      // Improvising for an unmapped code is how the concept table's grounding gets lost.
      output.appendLine(`[lesson] no concept teaches ${signature.value}`);
      return;
    }

    session.noteDiscussed(signature, now);
    telemetry.hintShown(1, concept.id, !chat.configured);

    if (chat.configured) {
      await chat.nudge(onDemand ? 'stuck' : 'new_error', signature.value, chatContext(), now);
      return;
    }

    const offline = session.offlineTeaching(signature, now);
    if (offline) chat.addTutorMessage(offline.text, now);
  }

  // ---- sidebar state -------------------------------------------------------

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

    switch (action.type) {
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
    if (!editor || !isWatched(editor.document.languageId)) {
      void vscode.window.showInformationMessage(
        `Open a file in one of the languages I teach first: ${WATCHED_EDITOR_IDS.join(', ')}.`
      );
      return;
    }
    const uri = editor.document.uri;
    const line = editor.selection.active.line;
    const observations = readDiagnostics(uri, editor.document.languageId);
    const at =
      observations.find((o) => o.startLine <= line && line <= o.endLine) ?? observations[0];

    if (!at) {
      void vscode.window.showInformationMessage('Nothing is failing to compile right now.');
      return;
    }

    await raise(at.signature, now, true);
  }

  // Closing the window on an error the tutor was discussing is a real outcome, and the only one
  // the model would otherwise never see — every other path records a success.
  onDeactivate = async () => {
    session.noteAbandoned(Date.now());
    await store.save(model).catch((err: unknown) => {
      output.appendLine(`[learner] final save failed: ${String(err)}`);
    });
    await flush();
  };

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
    // "Nothing leaves your machine except this" is only a claim until you can read it.
    vscode.commands.registerCommand('rustPairTeacher.showEgress', async () => {
      const fitted = fitChatPrompt(
        [...chat.messages],
        chatContext(),
        undefined,
        { maxChars: DEFAULT_MAX_PROMPT_CHARS }
      );
      const header = chat.configured
        ? `# What would be sent to ${vscode.workspace.getConfiguration('rustPairTeacher').get<string>('baseUrl', '')}\n`
        : '# Nothing is sent — no model is configured.\n# This is what would be sent if one were.\n';
      const notes = fitted.degradations.length
        ? `\n# Trimmed to fit: ${fitted.degradations.join('; ')}\n`
        : '';

      const doc = await vscode.workspace.openTextDocument({
        language: 'markdown',
        content: `${header}${notes}\n${describeEgress(fitted.messages)}\n`,
      });
      await vscode.window.showTextDocument(doc, { preview: true });
    }),
    vscode.commands.registerCommand('rustPairTeacher.openCandidateLog', async () => {
      await flush();
      await vscode.window.showTextDocument(await vscode.workspace.openTextDocument(logUri));
    }),
    vscode.commands.registerCommand('rustPairTeacher.toggleAmbient', async () => {
      // Writes the setting rather than the runtime flag, so the command and the setting are the
      // same fact. Mutating `detector.ambient` directly used to be fine; once settings became live,
      // `applySettings` reapplies `ambient` from configuration on *every* change, so a toggle would
      // silently revert the next time any unrelated setting moved — and switching ambient off is
      // the single loudest signal this project collects, so losing it is not a small thing.
      const settings = vscode.workspace.getConfiguration('rustPairTeacher');
      const next = !settings.get('ambient', true);
      await settings.update('ambient', next, vscode.ConfigurationTarget.Global);
      telemetry.ambientToggled(next);
      void vscode.window.showInformationMessage(
        `Rust Pair Teacher: ambient watching ${next ? 'on' : 'off'}`
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
          `${result.message} It is live now — no reload needed.`
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
        'Rust Pair Teacher: API key stored, and in use now.'
      );
    })
  );
}

/**
 * Set by `activate`, awaited by `deactivate`.
 *
 * A closure rather than a disposable because the work is asynchronous — VS Code awaits the promise
 * `deactivate` returns, but disposables are fire-and-forget, and a learner model written into a
 * process that is already exiting is a learner model lost.
 */
let onDeactivate: (() => Promise<void>) | undefined;

export async function deactivate(): Promise<void> {
  // Everything else is disposed through context.subscriptions.
  await onDeactivate?.();
  onDeactivate = undefined;
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
): Promise<ProviderConfig> {
  const settings = vscode.workspace.getConfiguration('rustPairTeacher');
  const baseUrl = settings.get<string>('baseUrl', '').trim();
  const model = settings.get<string>('model', '').trim();

  if (!baseUrl || !model) {
    output.appendLine(
      '[provider] none configured — teaching from the built-in material only. Set rustPairTeacher.baseUrl and .model to personalize.'
    );
    return { model: model || 'unconfigured', problem: null };
  }

  const apiKey = (await secrets.get(API_KEY_SECRET))?.trim();

  // Reported rather than shown here: whether a dialog is warranted depends on whether this is the
  // first time we have seen this particular problem, which only the caller knows.
  const problem = diagnoseCredential(baseUrl, apiKey);
  if (problem) output.appendLine(`[provider] ${problem.message}`);

  output.appendLine(`[provider] ${baseUrl} (${model})${apiKey ? '' : ' — no key stored'}`);
  return {
    model,
    provider: new OpenAiCompatibleProvider({ baseUrl, ...(apiKey ? { apiKey } : {}) }),
    problem: problem ? problem.message : null,
  };
}

/**
 * Warn about a credential problem, but only when it is news.
 *
 * Settings are re-read on every change now, and `onDidChangeConfiguration` can fire more than once
 * for a single edit. Warning unconditionally would stack identical dialogs on top of a learner who
 * is mid-edit; warning never would silently drop the one diagnostic that saves someone from pasting
 * a ChatGPT URL and wondering why nothing answers. So: warn when the problem changes.
 */
function warnAboutCredential(problem: string | null, lastShown: string | null): string | null {
  if (problem === null || problem === lastShown) return problem;
  void vscode.window.showWarningMessage(problem, 'Set up a model').then((choice) => {
    if (choice) void vscode.commands.executeCommand('rustPairTeacher.setupModel');
  });
  return problem;
}

function codeOf(d: vscode.Diagnostic): string | undefined {
  const code = d.code;
  if (code === undefined) return undefined;
  if (typeof code === 'string') return code;
  if (typeof code === 'number') return String(code);
  return typeof code.value === 'string' ? code.value : String(code.value);
}
