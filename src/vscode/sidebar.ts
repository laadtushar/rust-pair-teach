import * as vscode from 'vscode';

import type { ChatMessage } from '../core/chat/types.js';
import type { CourseMenuView, CourseView, LessonView } from '../core/viewModel.js';

export type SidebarAction =
  | { type: 'escalate' }
  | { type: 'solved' }
  | { type: 'dismissed' }
  | { type: 'teach_me' }
  | { type: 'start_course' }
  | { type: 'open_lesson'; lessonId: string }
  | { type: 'complete_lesson' }
  | { type: 'show_menu' }
  | { type: 'setup_model' }
  | { type: 'send'; text: string }
  | { type: 'reset_chat' };

export type SidebarState =
  | { kind: 'menu'; view: CourseMenuView }
  | { kind: 'course'; view: CourseView }
  | { kind: 'hint'; view: LessonView }
  | {
      kind: 'chat';
      messages: readonly ChatMessage[];
      busy: boolean;
      configured: boolean;
      /** Lesson header, so the learner always knows what they are working on. */
      heading: string | null;
      subheading: string | null;
      error: string | null;
    };

/**
 * The teaching surface.
 *
 * A sidebar rather than inline decorations: inline competes with rust-analyzer's own inlays and
 * turns the editor into a wall of advice. The teacher gets its own space the learner can ignore.
 *
 * Its default state is the course, not emptiness. A tutor that shows nothing until you happen to
 * make a mistake is useless to someone who has not written any Rust yet — which is exactly the
 * person who most needs teaching.
 */
export class TutorSidebar implements vscode.WebviewViewProvider {
  static readonly viewType = 'rustPairTeacher.lesson';

  private view: vscode.WebviewView | undefined;
  private state: SidebarState | null = null;

  constructor(
    private readonly extensionUri: vscode.Uri,
    private readonly onAction: (action: SidebarAction) => void
  ) {}

  resolveWebviewView(view: vscode.WebviewView): void {
    this.view = view;
    view.webview.options = { enableScripts: true, localResourceRoots: [this.extensionUri] };
    view.webview.onDidReceiveMessage((msg: SidebarAction) => {
      if (msg.type) this.onAction(msg);
    });
    this.render();
  }

  show(state: SidebarState): void {
    this.state = state;
    this.render();
  }

  private render(): void {
    if (!this.view) return;
    this.view.webview.html = this.html();
  }

  private html(): string {
    const nonce = makeNonce();
    const csp = [
      "default-src 'none'",
      "style-src 'unsafe-inline'",
      `script-src 'nonce-${nonce}'`,
    ].join('; ');

    return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta http-equiv="Content-Security-Policy" content="${csp}">
<style>
  body { font-family: var(--vscode-font-family); color: var(--vscode-foreground);
         padding: 12px; line-height: 1.55; font-size: var(--vscode-font-size); }
  h2 { font-size: 1.1em; margin: 0 0 4px; }
  .position, .goal { color: var(--vscode-descriptionForeground); font-size: 0.88em; }
  .goal { margin: 0 0 14px; }
  .body p { margin: 0 0 10px; }
  .body pre { background: var(--vscode-textCodeBlock-background); padding: 8px 10px;
              border-radius: 3px; overflow-x: auto; }
  code { background: var(--vscode-textCodeBlock-background); padding: 1px 5px; border-radius: 2px; }
  ol.steps { list-style: none; padding: 0; margin: 16px 0 0; }
  ol.steps li { display: flex; gap: 8px; margin: 0 0 12px; align-items: flex-start; }
  .box { flex: 0 0 auto; width: 1.15em; }
  .done .txt { color: var(--vscode-descriptionForeground); text-decoration: line-through; }
  .hint { display: block; margin-top: 4px; font-size: 0.88em;
          color: var(--vscode-descriptionForeground); }
  .rung { border-left: 2px solid var(--vscode-textLink-foreground); padding-left: 10px;
          margin: 0 0 14px; }
  .level { font-size: 0.75em; text-transform: uppercase; letter-spacing: .06em;
           color: var(--vscode-descriptionForeground); margin-bottom: 4px; }
  .text { white-space: pre-wrap; }
  .actions { display: flex; flex-wrap: wrap; gap: 8px; margin-top: 18px; }
  button { font-family: inherit; font-size: inherit; padding: 6px 13px; border: none;
           border-radius: 2px; cursor: pointer;
           background: var(--vscode-button-background); color: var(--vscode-button-foreground); }
  button.secondary { background: var(--vscode-button-secondaryBackground);
                     color: var(--vscode-button-secondaryForeground); }
  button:disabled { opacity: .5; cursor: default; }
  .note { color: var(--vscode-descriptionForeground); font-size: 0.9em; margin-top: 14px; }
  .lessons { list-style: none; padding: 0; margin: 14px 0 0; }
  .lessons li { padding: 8px 0; border-bottom: 1px solid var(--vscode-widget-border, transparent); }
  .lessons button { background: none; color: var(--vscode-textLink-foreground); padding: 0;
                    text-align: left; font-weight: 600; }
  .lessons .sub { color: var(--vscode-descriptionForeground); font-size: 0.87em; }
  .bar { height: 4px; background: var(--vscode-editorWidget-background); border-radius: 2px;
         overflow: hidden; margin: 10px 0 4px; }
  .bar > div { height: 100%; background: var(--vscode-textLink-foreground); }
  .chat-head { padding-bottom: 8px; margin-bottom: 8px;
               border-bottom: 1px solid var(--vscode-widget-border, transparent); }
  .thread { display: flex; flex-direction: column; gap: 14px; padding-bottom: 12px; }
  .msg .who { font-size: 0.72em; text-transform: uppercase; letter-spacing: .07em;
              color: var(--vscode-descriptionForeground); margin-bottom: 3px; }
  .msg.learner .say { background: var(--vscode-editorWidget-background);
                      padding: 7px 10px; border-radius: 4px; }
  .msg .say p { margin: 0 0 8px; }
  .msg .say p:last-child { margin-bottom: 0; }
  .typing { color: var(--vscode-descriptionForeground); }
  .err { color: var(--vscode-errorForeground); font-size: 0.9em; }
  .composer { position: sticky; bottom: 0; padding-top: 8px;
              background: var(--vscode-sideBar-background); }
  textarea { width: 100%; box-sizing: border-box; resize: vertical; font-family: inherit;
             font-size: inherit; padding: 6px 8px; border-radius: 3px;
             color: var(--vscode-input-foreground); background: var(--vscode-input-background);
             border: 1px solid var(--vscode-input-border, transparent); }
</style>
</head>
<body>
${this.content()}
<script nonce="${nonce}">
  const api = acquireVsCodeApi();
  for (const el of document.querySelectorAll('button[data-action]')) {
    el.addEventListener('click', () =>
      api.postMessage({ type: el.dataset.action, lessonId: el.dataset.lesson }));
  }

  const input = document.getElementById('input');
  const send = document.getElementById('send');
  if (input && send) {
    // Restore what was half-typed: the panel re-renders on every message and every file save,
    // and losing a sentence mid-thought would make the thing unusable.
    const saved = api.getState() || {};
    if (saved.draft) input.value = saved.draft;
    input.addEventListener('input', () => api.setState({ draft: input.value }));

    const submit = () => {
      const text = input.value.trim();
      if (!text) return;
      input.value = '';
      api.setState({ draft: '' });
      api.postMessage({ type: 'send', text });
    };
    send.addEventListener('click', submit);
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); submit(); }
    });
    input.focus();
  }

  const thread = document.getElementById('thread');
  if (thread) thread.scrollIntoView({ block: 'end' });
</script>
</body>
</html>`;
  }

  private content(): string {
    if (!this.state) return this.loading();
    switch (this.state.kind) {
      case 'menu':
        return this.menuHtml(this.state.view);
      case 'course':
        return this.courseHtml(this.state.view);
      case 'hint':
        return this.hintHtml(this.state.view);
      case 'chat':
        return this.chatHtml(this.state);
    }
  }

  private loading(): string {
    return `<p class="goal">Loading your course…</p>`;
  }

  private menuHtml(view: CourseMenuView): string {
    const pct = view.progress.total
      ? Math.round((view.progress.done / view.progress.total) * 100)
      : 0;

    const items = view.lessons
      .map(
        (l) => `<li>
        <button data-action="open_lesson" data-lesson="${escapeHtml(l.id)}">
          ${l.done ? '✓ ' : l.current ? '▸ ' : ''}${escapeHtml(l.title)}
        </button>
        <div class="sub">${escapeHtml(l.goal)}</div>
      </li>`
      )
      .join('\n');

    const setup = view.setupNotice
      ? `<p class="note">${escapeHtml(view.setupNotice)}</p>
         <div class="actions"><button class="secondary" data-action="setup_model">Set up a model</button></div>`
      : '';

    return `<h2>${escapeHtml(view.heading)}</h2>
<p class="goal">${escapeHtml(view.subheading)}</p>
<div class="bar"><div style="width:${String(pct)}%"></div></div>
<p class="position">${String(view.progress.done)} of ${String(view.progress.total)} lessons done</p>
<div class="actions">
  <button data-action="start_course">${view.progress.done > 0 ? 'Continue' : 'Start learning Rust'}</button>
</div>
<ul class="lessons">${items}</ul>
${setup}`;
  }

  private courseHtml(view: CourseView): string {
    const steps = view.steps
      .map(
        (s) => `<li class="${s.done ? 'done' : ''}">
        <span class="box">${s.done ? '✓' : '○'}</span>
        <span class="txt">${escapeHtml(s.instruction)}
          ${s.hint ? `<span class="hint">${escapeHtml(s.hint)}</span>` : ''}
        </span>
      </li>`
      )
      .join('\n');

    return `<p class="position">${escapeHtml(view.position)}</p>
<h2>${escapeHtml(view.lessonTitle)}</h2>
<p class="goal">${escapeHtml(view.goal)}</p>
<div class="body">${renderMarkdown(view.body)}</div>
<ol class="steps">${steps}</ol>
<div class="actions">
  <button data-action="complete_lesson">${escapeHtml(view.nextLabel ?? 'Done')}</button>
  <button class="secondary" data-action="show_menu">All lessons</button>
</div>
${view.ready ? '' : '<p class="note">Steps tick themselves as you go. You can continue anyway if you have done the work — the checks are hints, not a gate.</p>'}`;
  }

  private chatHtml(state: Extract<SidebarState, { kind: 'chat' }>): string {
    const bubbles = state.messages
      .map(
        (m) => `<div class="msg ${m.speaker}">
        <div class="who">${m.speaker === 'tutor' ? 'Tutor' : 'You'}</div>
        <div class="say">${renderMarkdown(m.text)}</div>
      </div>`
      )
      .join('\n');

    const empty = state.configured
      ? '<p class="goal">Say hello, or just start writing Rust — I am watching along.</p>'
      : `<p class="goal">I need a model connected before I can talk. Ollama is free and runs on your machine.</p>
         <div class="actions"><button data-action="setup_model">Connect a model</button></div>`;

    return `${state.heading ? `<div class="chat-head"><strong>${escapeHtml(state.heading)}</strong>${state.subheading ? `<div class="position">${escapeHtml(state.subheading)}</div>` : ''}</div>` : ''}
<div class="thread" id="thread">
  ${state.messages.length === 0 ? empty : bubbles}
  ${state.busy ? '<div class="msg tutor"><div class="who">Tutor</div><div class="say typing">…</div></div>' : ''}
  ${state.error ? `<div class="err">${escapeHtml(state.error)}</div>` : ''}
</div>
<div class="composer">
  <textarea id="input" rows="2" placeholder="Ask anything — or tell me what you are trying to do" ${state.configured ? '' : 'disabled'}></textarea>
  <div class="actions">
    <button id="send" ${state.configured ? '' : 'disabled'}>Send</button>
    <button class="secondary" data-action="show_menu">Lessons</button>
    <button class="secondary" data-action="reset_chat">Clear</button>
  </div>
</div>`;
  }

  private hintHtml(view: LessonView): string {
    const rungs = view.hints
      .map(
        (h) => `<div class="rung">
        <div class="level">Hint ${String(h.level)} of 3</div>
        <div class="text">${escapeHtml(h.text)}</div>
      </div>`
      )
      .join('\n');

    const next = view.nextStep
      ? `<button data-action="escalate">${escapeHtml(view.nextStep)}</button>`
      : '';

    return `<h2>${escapeHtml(view.conceptTitle)}</h2>
${rungs}
<div class="actions">
  ${next}
  <button class="secondary" data-action="solved">I solved it</button>
  <button class="secondary" data-action="dismissed">Not now</button>
</div>
${view.explainCommand ? `<p class="note">The compiler can explain this one itself: <code>${escapeHtml(view.explainCommand)}</code></p>` : ''}
${view.offlineNotice ? `<p class="note">${escapeHtml(view.offlineNotice)}</p>` : ''}`;
  }
}

/**
 * The smallest markdown renderer that does the job.
 *
 * Lessons are authored markdown and a webview needs HTML. Pulling in a parser for paragraphs, code
 * fences and inline code would add a dependency and an escaping surface for no benefit — everything
 * is escaped first, then a fixed set of patterns is re-introduced.
 */
export function renderMarkdown(src: string): string {
  const escaped = escapeHtml(src);
  const blocks = escaped.split(/\n\s*\n/);

  return blocks
    .map((block) => {
      const fence = /^```[a-z]*\n([\s\S]*?)\n?```$/.exec(block.trim());
      if (fence) return `<pre>${fence[1]!}</pre>`;

      const inline = block
        .replace(/`([^`]+)`/g, '<code>$1</code>')
        .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
        .replace(/(?<![*\w])\*([^*\n]+)\*(?![*\w])/g, '<em>$1</em>');
      return `<p>${inline.replace(/\n/g, ' ')}</p>`;
    })
    .join('\n');
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function makeNonce(): string {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  let out = '';
  for (let i = 0; i < 32; i++) out += chars[Math.floor(Math.random() * chars.length)];
  return out;
}
