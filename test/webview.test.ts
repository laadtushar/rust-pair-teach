import { chromium, type Browser, type Page } from 'playwright';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import type { ChatMessage } from '../src/core/chat/types.js';
import {
  renderMessageFor,
  shellHtml,
  type RenderMessage,
  type SidebarState,
} from '../src/webview/render.js';

/**
 * The panel, rendered.
 *
 * Everything else in this repository tests strings. This loads the actual document into a real
 * browser and drives it, because the shell's comments make claims that a string comparison cannot
 * check: that replacing `#root` leaves a half-typed message alone, that the delegated click handler
 * reaches buttons in freshly-rendered content, and that a tutor reply containing markup is escaped
 * rather than executed. None of those had ever been observed.
 *
 * A VS Code webview is an iframe in Electron, so this is close but not identical. What it does
 * prove is that the HTML parses, the script runs under the CSP, and the behaviour the extension
 * host depends on is real.
 */

let browser: Browser;

beforeAll(async () => {
  // Some environments ship a Chromium that does not match the version Playwright would download.
  // Honour an explicit path when one is given rather than failing with a download instruction.
  const executablePath = process.env['CHROMIUM_PATH'];
  browser = await chromium.launch(executablePath ? { executablePath } : {});
}, 90_000);

afterAll(async () => {
  await browser?.close();
});

const NONCE = 'testnonce0123456789abcdefghijkl';

/**
 * Stands in for the extension host: captures postMessage, and can push a render in.
 *
 * Served over a real navigation rather than `setContent`, for two reasons. Init scripts are not
 * guaranteed to have run before a `setContent` document executes its inline script — when they had
 * not, `acquireVsCodeApi` was undefined, the script threw on its first line, and *every* listener
 * silently failed to register. And a real origin means the `<meta>` CSP is genuinely enforced, so
 * the nonce is doing real work here rather than being decorative.
 */
async function open(): Promise<{
  page: Page;
  push: (m: RenderMessage) => Promise<void>;
  errors: string[];
}> {
  const page = await browser.newPage();
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(String(e)));

  await page.addInitScript(() => {
    const sent: unknown[] = [];
    (window as unknown as Record<string, unknown>).__posted = sent;
    (window as unknown as Record<string, unknown>).acquireVsCodeApi = () => ({
      postMessage: (m: unknown) => sent.push(m),
    });
  });
  await page.route('**/*', (route) =>
    route.fulfill({ status: 200, contentType: 'text/html; charset=utf-8', body: shellHtml(NONCE) })
  );
  await page.goto('https://tutor.test/', { waitUntil: 'domcontentloaded' });

  return {
    page,
    errors,
    push: async (m: RenderMessage) => {
      await page.evaluate((msg) => {
        window.dispatchEvent(new MessageEvent('message', { data: msg }));
      }, m as unknown as Record<string, unknown>);
    },
  };
}

function chat(over: Partial<Extract<SidebarState, { kind: 'chat' }>> = {}): SidebarState {
  return {
    kind: 'chat',
    messages: [],
    busy: false,
    configured: true,
    heading: null,
    subheading: null,
    error: null,
    ...over,
  };
}

function msg(speaker: ChatMessage['speaker'], text: string): ChatMessage {
  return { speaker, text, at: 0 };
}

describe('the panel actually renders', () => {
  it('parses and runs its script under the CSP, with nothing thrown', async () => {
    const { page, push, errors } = await open();
    expect(await page.locator('#root').count()).toBe(1);
    expect(await page.locator('#composer').isVisible()).toBe(false);

    // The listener only exists if the script ran to completion under the nonce. Pushing a render
    // and seeing it land is the proof; an empty `errors` alone would not distinguish "ran" from
    // "was blocked outright".
    await push(renderMessageFor(chat()));
    expect(await page.locator('#root .thread').count()).toBe(1);
    expect(errors, errors.join('\n')).toEqual([]);
    await page.close();
  });

  it('shows a conversation with both speakers labelled', async () => {
    const { page, push } = await open();
    await push(
      renderMessageFor(
        chat({ messages: [msg('learner', 'why is this borrowed?'), msg('tutor', 'What owns it?')] })
      )
    );

    expect(await page.locator('.msg.learner .who').textContent()).toBe('You');
    expect(await page.locator('.msg.tutor .who').textContent()).toBe('Tutor');
    expect(await page.locator('.msg.tutor .say').textContent()).toContain('What owns it?');
    await page.close();
  });

  it('renders a code fence as a block, not as running text', async () => {
    const { page, push } = await open();
    await push(
      renderMessageFor(chat({ messages: [msg('tutor', 'Like this:\n\n```rust\nlet a = 1;\n```')] }))
    );
    expect(await page.locator('.msg.tutor pre').textContent()).toBe('let a = 1;');
    await page.close();
  });

  it('escapes markup in a reply instead of executing it', async () => {
    // The one genuinely dangerous case: a model echoing a learner's HTML back into the panel.
    const { page, push } = await open();
    let alerted = false;
    page.on('dialog', (d) => {
      alerted = true;
      void d.dismiss();
    });

    await push(
      renderMessageFor(
        chat({ messages: [msg('tutor', '<img src=x onerror="alert(1)"><script>alert(2)</script>')] })
      )
    );
    await page.waitForTimeout(150);

    expect(alerted, 'markup in a tutor reply executed').toBe(false);
    expect(await page.locator('.msg.tutor img').count()).toBe(0);
    expect(await page.locator('.msg.tutor .say').textContent()).toContain('<img src=x');
    await page.close();
  });
});

describe('the composer survives a re-render', () => {
  it('keeps a half-typed message when the thread updates', async () => {
    // This is the claim the whole shell/message split exists for, and it had never been checked.
    const { page, push } = await open();
    await push(renderMessageFor(chat()));

    await page.locator('#input').fill('I think the problem is');
    await page.locator('#input').focus();

    // A reply streams in: four updates in quick succession, as tokens arrive.
    for (const text of ['W', 'What', 'What owns', 'What owns it?']) {
      await push(renderMessageFor(chat({ messages: [msg('tutor', text)] })));
    }

    expect(await page.locator('#input').inputValue()).toBe('I think the problem is');
    expect(await page.evaluate(() => document.activeElement?.id)).toBe('input');
    await page.close();
  });

  it('disables the composer when no model is connected, and enables it when one arrives', async () => {
    const { page, push } = await open();
    await push(renderMessageFor(chat({ configured: false })));
    expect(await page.locator('#input').isDisabled()).toBe(true);
    expect(await page.locator('#send').isDisabled()).toBe(true);

    await push(renderMessageFor(chat({ configured: true })));
    expect(await page.locator('#input').isDisabled()).toBe(false);
    await page.close();
  });

  it('shows Stop only while a reply is arriving', async () => {
    const { page, push } = await open();
    await push(renderMessageFor(chat({ busy: true })));
    expect(await page.locator('#stop').isVisible()).toBe(true);

    await push(renderMessageFor(chat({ busy: false })));
    expect(await page.locator('#stop').isVisible()).toBe(false);
    await page.close();
  });
});

describe('what the panel sends back', () => {
  async function sent(page: Page): Promise<unknown[]> {
    return page.evaluate(() => (window as unknown as { __posted: unknown[] }).__posted);
  }

  it('sends the typed message on Enter and clears the box', async () => {
    const { page, push } = await open();
    await push(renderMessageFor(chat()));

    await page.locator('#input').fill('what is a move?');
    await page.locator('#input').press('Enter');

    expect(await sent(page)).toEqual([{ type: 'send', text: 'what is a move?' }]);
    expect(await page.locator('#input').inputValue()).toBe('');
    await page.close();
  });

  it('inserts a newline on Shift+Enter rather than sending', async () => {
    const { page, push } = await open();
    await push(renderMessageFor(chat()));

    await page.locator('#input').fill('line one');
    await page.locator('#input').press('Shift+Enter');
    await page.locator('#input').pressSequentially('line two');

    expect(await sent(page)).toEqual([]);
    expect(await page.locator('#input').inputValue()).toBe('line one\nline two');
    await page.close();
  });

  it('sends nothing for a blank message', async () => {
    const { page, push } = await open();
    await push(renderMessageFor(chat()));
    await page.locator('#input').fill('   ');
    await page.locator('#input').press('Enter');
    expect(await sent(page)).toEqual([]);
    await page.close();
  });

  it('reaches a button that only appeared in the latest render', async () => {
    // The handler is delegated precisely so freshly-rendered content needs no re-binding. Nothing
    // proved the delegation worked.
    const { page, push } = await open();
    await push(renderMessageFor(chat({ configured: false })));
    await page.locator('button[data-action="setup_model"]').click();
    expect(await sent(page)).toEqual([{ type: 'setup_model' }]);
    await page.close();
  });

  it('carries the lesson id from a lesson-list button', async () => {
    const { page, push } = await open();
    await push(
      renderMessageFor({
        kind: 'menu',
        view: {
          kind: 'menu',
          heading: 'Learn Rust from scratch',
          subheading: 'Sixteen lessons.',
          progress: { done: 1, total: 16 },
          lessons: [
            { id: '02-ownership', title: 'Ownership', goal: 'Who owns it', done: false, current: true },
          ],
          setupNotice: null,
        },
      })
    );
    await page.locator('button[data-action="open_lesson"]').click();
    expect(await sent(page)).toEqual([{ type: 'open_lesson', lessonId: '02-ownership' }]);
    await page.close();
  });

  it('hides the composer entirely on the lesson list', async () => {
    const { page, push } = await open();
    await push(
      renderMessageFor({
        kind: 'menu',
        view: {
          kind: 'menu',
          heading: 'h',
          subheading: 's',
          progress: { done: 0, total: 1 },
          lessons: [],
          setupNotice: null,
        },
      })
    );
    expect(await page.locator('#composer').isVisible()).toBe(false);
    await page.close();
  });
});
