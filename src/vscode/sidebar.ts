import * as vscode from 'vscode';

import type { LessonView } from '../core/viewModel.js';

export type SidebarAction = 'escalate' | 'solved' | 'dismissed' | 'teach_me';

/**
 * The teaching surface.
 *
 * A sidebar rather than inline decorations: inline competes with rust-analyzer's own inlays and
 * turns the editor into a wall of advice. The teacher gets its own space that the learner can
 * ignore.
 */
export class TutorSidebar implements vscode.WebviewViewProvider {
  static readonly viewType = 'rustPairTeacher.lesson';

  private view: vscode.WebviewView | undefined;
  private current: LessonView | null = null;

  constructor(
    private readonly extensionUri: vscode.Uri,
    private readonly onAction: (action: SidebarAction) => void
  ) {}

  resolveWebviewView(view: vscode.WebviewView): void {
    this.view = view;
    view.webview.options = { enableScripts: true, localResourceRoots: [this.extensionUri] };
    view.webview.onDidReceiveMessage((msg: { action?: SidebarAction }) => {
      if (msg.action) this.onAction(msg.action);
    });
    this.render();
  }

  show(lesson: LessonView): void {
    this.current = lesson;
    this.render();
  }

  clear(): void {
    this.current = null;
    this.render();
  }

  private render(): void {
    if (!this.view) return;
    this.view.webview.html = this.html();
  }

  private html(): string {
    const nonce = makeNonce();
    // Strict CSP: the webview runs exactly one inline script and loads nothing from the network.
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
         padding: 12px; line-height: 1.5; }
  h2 { font-size: 1.05em; margin: 0 0 12px; }
  .rung { border-left: 2px solid var(--vscode-textLink-foreground); padding: 0 0 0 10px;
          margin: 0 0 14px; }
  .level { font-size: 0.75em; text-transform: uppercase; letter-spacing: .06em;
           color: var(--vscode-descriptionForeground); margin-bottom: 4px; }
  .text { white-space: pre-wrap; }
  .actions { display: flex; flex-wrap: wrap; gap: 8px; margin-top: 16px; }
  button { font-family: inherit; font-size: inherit; padding: 5px 12px; border: none;
           border-radius: 2px; cursor: pointer;
           background: var(--vscode-button-background); color: var(--vscode-button-foreground); }
  button.secondary { background: var(--vscode-button-secondaryBackground);
                     color: var(--vscode-button-secondaryForeground); }
  .note, .empty { color: var(--vscode-descriptionForeground); font-size: 0.9em; }
  .note { margin-top: 14px; }
  code { background: var(--vscode-textCodeBlock-background); padding: 1px 5px; border-radius: 2px; }
</style>
</head>
<body>
${this.current ? this.lessonHtml(this.current) : this.emptyHtml()}
<script nonce="${nonce}">
  const vscodeApi = acquireVsCodeApi();
  for (const el of document.querySelectorAll('button[data-action]')) {
    el.addEventListener('click', () => vscodeApi.postMessage({ action: el.dataset.action }));
  }
</script>
</body>
</html>`;
  }

  private lessonHtml(view: LessonView): string {
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
    const explain = view.explainCommand
      ? `<p class="note">The compiler can explain this one itself: <code>${escapeHtml(view.explainCommand)}</code></p>`
      : '';
    const offline = view.offlineNotice
      ? `<p class="note">${escapeHtml(view.offlineNotice)}</p>`
      : '';

    return `<h2>${escapeHtml(view.conceptTitle)}</h2>
${rungs}
<div class="actions">
  ${next}
  <button class="secondary" data-action="solved">I solved it</button>
  <button class="secondary" data-action="dismissed">Not now</button>
</div>
${explain}
${offline}`;
  }

  private emptyHtml(): string {
    return `<p class="empty">Nothing to teach right now — keep writing.</p>
<div class="actions">
  <button class="secondary" data-action="teach_me">Explain what I'm stuck on</button>
</div>`;
  }
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
