import * as vscode from 'vscode';

import { renderMessageFor, shellHtml, type SidebarState } from '../webview/render.js';

export type { SidebarState } from '../webview/render.js';

export type SidebarAction =
  | { type: 'teach_me' }
  | { type: 'start_course' }
  | { type: 'open_lesson'; lessonId: string }
  | { type: 'complete_lesson' }
  | { type: 'show_menu' }
  | { type: 'setup_model' }
  | { type: 'send'; text: string }
  | { type: 'reset_chat' }
  | { type: 'cancel' };

/**
 * The teaching surface.
 *
 * A sidebar rather than inline decorations: inline competes with rust-analyzer's own inlays and
 * turns the editor into a wall of advice. The teacher gets its own space the learner can ignore.
 *
 * This class is now only plumbing — lifecycle, message passing, and the nonce. Every byte of HTML
 * lives in `src/webview/render.ts`, which imports no editor API and can therefore be rendered in a
 * real browser. That split exists because the panel's HTML had never rendered anywhere.
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
    // The shell is written exactly once. Everything after this is a message.
    view.webview.html = shellHtml(makeNonce());
    this.render();
  }

  show(state: SidebarState): void {
    this.state = state;
    this.render();
  }

  private render(): void {
    if (!this.view || !this.state) return;
    void this.view.webview.postMessage(renderMessageFor(this.state));
  }
}

/**
 * A fresh nonce per document, so the CSP admits exactly the one inline script.
 *
 * `Math.random` rather than `crypto` because this is not a secret: the page is generated and
 * consumed in the same process, and the nonce exists to let one known script run under a policy
 * that denies everything else, not to resist guessing.
 */
function makeNonce(): string {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  let out = '';
  for (let i = 0; i < 32; i++) out += chars[Math.floor(Math.random() * chars.length)];
  return out;
}
