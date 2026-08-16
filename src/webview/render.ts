import type { ChatMessage } from '../core/chat/types.js';
import type { CourseMenuView } from '../core/viewModel.js';

/**
 * Every byte of HTML the tutor panel shows, with no editor API anywhere near it.
 *
 * Split out of `TutorSidebar` for one reason: a module that imports `vscode` can only be exercised
 * inside a running editor, and this HTML had never rendered anywhere at all. The comments in the
 * shell script make load-bearing claims — that replacing only `#root` preserves a half-typed
 * message, that everything is escaped before markdown is re-introduced — and neither had ever been
 * observed to be true. Now they run in a real browser (`test/webview.test.ts`).
 *
 * The nonce is a parameter rather than generated here, so the output is a pure function of its
 * input and a rendered page can be diffed.
 */

export type SidebarState =
  | { kind: 'menu'; view: CourseMenuView }
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

/** What the extension host posts into the page on every update. */
export interface RenderMessage {
  type: 'render';
  body: string;
  showComposer: boolean;
  composerEnabled: boolean;
  busy: boolean;
  scrollToEnd: boolean;
}

export function renderMessageFor(state: SidebarState | null): RenderMessage {
  const chat = state?.kind === 'chat' ? state : null;
  return {
    type: 'render',
    body: contentHtml(state),
    showComposer: chat !== null,
    composerEnabled: chat ? chat.configured && !chat.busy : false,
    busy: chat?.busy ?? false,
    scrollToEnd: chat !== null,
  };
}

export function contentHtml(state: SidebarState | null): string {
  if (!state) return `<p class="goal">Loading your course…</p>`;
  return state.kind === 'menu' ? menuHtml(state.view) : chatHtml(state);
}

export function menuHtml(view: CourseMenuView): string {
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

export function chatHtml(state: Extract<SidebarState, { kind: 'chat' }>): string {
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
`;
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

export function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/**
 * The document, written exactly once. Everything after this arrives as a message.
 *
 * Reassigning `webview.html` destroys the DOM, which takes the composer, its focus, its caret and
 * whatever was half-typed with it. That was survivable when updates came from a button click; it is
 * not once replies stream a token at a time. So the composer lives here and is never replaced —
 * only `#root` changes.
 */
export function shellHtml(nonce: string): string {
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
         line-height: 1.55; font-size: var(--vscode-font-size); padding: 0; }
  h2 { font-size: 1.1em; margin: 0 0 4px; }
  .position, .goal { color: var(--vscode-descriptionForeground); font-size: 0.88em; }
  .goal { margin: 0 0 14px; }
  pre { background: var(--vscode-textCodeBlock-background); padding: 8px 10px;
        border-radius: 3px; overflow-x: auto; white-space: pre-wrap; }
  code { background: var(--vscode-textCodeBlock-background); padding: 1px 5px; border-radius: 2px; }
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
  .thread { display: flex; flex-direction: column; gap: 14px; padding-bottom: 12px;
            max-height: 70vh; overflow-y: auto; }
  .msg .who { font-size: 0.72em; text-transform: uppercase; letter-spacing: .07em;
              color: var(--vscode-descriptionForeground); margin-bottom: 3px; }
  .msg.learner .say { background: var(--vscode-editorWidget-background);
                      padding: 7px 10px; border-radius: 4px; }
  .msg .say p { margin: 0 0 8px; }
  .msg .say p:last-child { margin-bottom: 0; }
  .typing { color: var(--vscode-descriptionForeground); }
  .err { color: var(--vscode-errorForeground); font-size: 0.9em; }
  .composer { position: sticky; bottom: 0; padding: 8px 12px 12px;
              background: var(--vscode-sideBar-background); }
  #root { padding: 12px 12px 0; }
  textarea { width: 100%; box-sizing: border-box; resize: vertical; font-family: inherit;
             font-size: inherit; padding: 6px 8px; border-radius: 3px;
             color: var(--vscode-input-foreground); background: var(--vscode-input-background);
             border: 1px solid var(--vscode-input-border, transparent); }
</style>
</head>
<body>
<div id="root"></div>
<div id="composer" class="composer" hidden>
  <textarea id="input" rows="2" placeholder="Ask anything — or tell me what you are trying to do"></textarea>
  <div class="actions">
    <button id="send">Send</button>
    <button id="stop" class="secondary" hidden data-action="cancel">Stop</button>
    <button class="secondary" data-action="show_menu">Lessons</button>
    <button class="secondary" data-action="reset_chat">Clear</button>
  </div>
</div>
<script nonce="${nonce}">
  const api = acquireVsCodeApi();
  const root = document.getElementById('root');
  const composer = document.getElementById('composer');
  const input = document.getElementById('input');
  const send = document.getElementById('send');
  const stop = document.getElementById('stop');

  // Delegated, so buttons inside freshly-rendered content need no re-binding.
  document.addEventListener('click', (e) => {
    const el = e.target.closest('button[data-action]');
    if (!el) return;
    api.postMessage({ type: el.dataset.action, lessonId: el.dataset.lesson });
  });

  const submit = () => {
    const text = input.value.trim();
    if (!text) return;
    input.value = '';
    api.postMessage({ type: 'send', text });
  };
  send.addEventListener('click', submit);
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); submit(); }
  });

  window.addEventListener('message', (event) => {
    const msg = event.data;
    if (msg.type !== 'render') return;

    // Only the content region is replaced. The composer element survives, so focus, caret and any
    // half-typed message survive with it — no state round-trip needed.
    root.innerHTML = msg.body;
    composer.hidden = !msg.showComposer;
    input.disabled = !msg.composerEnabled;
    send.disabled = !msg.composerEnabled;
    stop.hidden = !msg.busy;

    if (msg.scrollToEnd) {
      const thread = document.getElementById('thread');
      if (thread) thread.scrollTop = thread.scrollHeight;
    }
    if (msg.composerEnabled && document.activeElement !== input) input.focus();
  });
</script>
</body>
</html>`;
}
