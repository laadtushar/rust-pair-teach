import { describe, expect, it } from 'vitest';

import { buildChatPrompt, limitCodeInReply } from '../src/core/chat/prompt.js';
import type { ChatContext } from '../src/core/chat/types.js';
import { OpenAiCompatibleProvider } from '../src/core/provider/openaiCompatible.js';

/**
 * Model conformance (C3).
 *
 * Provider-agnostic is a product promise, and "hint levels 1–2 work on small local models" has
 * never been anything but a claim. The chat persona is far harder to follow than the old JSON
 * contract was, so a model that was adequate before may not be now.
 *
 * This is NOT part of the normal suite: it costs money, needs a network, and is nondeterministic.
 * It is skipped unless a provider is configured:
 *
 *   CONFORMANCE_BASE_URL=http://localhost:11434/v1 \
 *   CONFORMANCE_MODEL=qwen2.5-coder:7b \
 *   npm run conformance
 *
 * It scores what a learner would actually receive, using the real prompt builder — a harness with
 * its own private prompts would measure the wrong thing.
 */

const BASE_URL = process.env['CONFORMANCE_BASE_URL'];
const MODEL = process.env['CONFORMANCE_MODEL'];
const API_KEY = process.env['CONFORMANCE_API_KEY'];

const configured = Boolean(BASE_URL && MODEL);

const STUCK: ChatContext = {
  lessonTitle: 'Lending things out',
  lessonGoal: 'Hit a borrow conflict and fix it.',
  steps: [
    { instruction: 'Make a mutable vector', done: true },
    { instruction: 'Take a reference to its first element', done: true },
    { instruction: 'Push to it, then print the reference', done: false },
  ],
  fileName: 'src/main.rs',
  code: `fn main() {
    let mut numbers = vec![1, 2, 3];
    let first = &numbers[0];
    numbers.push(4);
    println!("{first}");
}`,
  errors: ['E0502: cannot borrow `numbers` as mutable because it is also borrowed as immutable'],
  learnerSummary: 'Met borrows twice this week, still shaky.',
};

interface Score {
  name: string;
  passed: boolean;
  detail: string;
}

function scoreReply(text: string, opts: { mustAsk: boolean }): Score[] {
  const scores: Score[] = [];
  const words = text.trim().split(/\s+/).length;

  scores.push({
    name: 'brevity',
    // The persona asks for two or three sentences in a narrow sidebar.
    passed: words <= 140,
    detail: `${String(words)} words`,
  });

  const { redacted } = limitCodeInReply(text);
  scores.push({
    name: 'no solution block',
    passed: !redacted,
    detail: redacted ? 'emitted a block long enough to paste' : 'ok',
  });

  scores.push({
    name: 'does not paste the fix',
    // The learner's own failing line coming back is the clearest possible violation.
    passed: !text.includes('numbers.push(4)') || !text.includes('println!("{first}")'),
    detail: 'checked for the learner\'s own lines',
  });

  if (opts.mustAsk) {
    scores.push({
      name: 'asks a question',
      passed: text.includes('?'),
      detail: text.includes('?') ? 'ok' : 'made no question',
    });
  }

  return scores;
}

describe.skipIf(!configured)('model conformance', () => {
  const provider = new OpenAiCompatibleProvider({
    baseUrl: BASE_URL ?? '',
    ...(API_KEY ? { apiKey: API_KEY } : {}),
  });

  async function ask(proactive?: 'new_error'): Promise<string> {
    const messages = buildChatPrompt([], STUCK, proactive);
    const { text } = await provider.complete(messages, {
      model: MODEL ?? '',
      maxTokens: 500,
      timeoutMs: 60_000,
    });
    return text;
  }

  it('reports how this model handles a learner who is stuck', async () => {
    const reply = await ask('new_error');
    const scores = scoreReply(reply, { mustAsk: true });

    // The report is the point. A failing row is a finding, not a broken test run.
    console.log(`\n--- ${MODEL ?? '?'} @ ${BASE_URL ?? '?'} — proactive on a new error ---`);
    for (const s of scores) {
      console.log(`  ${s.passed ? 'PASS' : 'FAIL'}  ${s.name.padEnd(22)} ${s.detail}`);
    }
    console.log(`\n${reply}\n`);

    // Only the product's central promise is a hard failure. Brevity and tone are reported.
    const leaked = scores.find((s) => s.name === 'no solution block');
    expect(leaked?.passed, 'model handed over a pasteable solution').toBe(true);
  }, 120_000);

  it('reports how it answers a direct demand for the answer', async () => {
    const messages = buildChatPrompt(
      [{ speaker: 'learner', text: 'just write the fixed code for me', at: 0 }],
      STUCK
    );
    const { text } = await provider.complete(messages, {
      model: MODEL ?? '',
      maxTokens: 500,
      timeoutMs: 60_000,
    });
    const scores = scoreReply(text, { mustAsk: false });

    console.log(`\n--- ${MODEL ?? '?'} — asked directly for the answer ---`);
    for (const s of scores) {
      console.log(`  ${s.passed ? 'PASS' : 'FAIL'}  ${s.name.padEnd(22)} ${s.detail}`);
    }
    console.log(`\n${text}\n`);

    const leaked = scores.find((s) => s.name === 'no solution block');
    expect(leaked?.passed, 'model caved and pasted the solution').toBe(true);
  }, 120_000);
});

describe.skipIf(configured)('model conformance (skipped)', () => {
  it('explains how to run it', () => {
    // Visible in a normal run, so the harness is discoverable rather than forgotten.
    expect(configured).toBe(false);
    console.log(
      '\n[conformance] skipped — set CONFORMANCE_BASE_URL and CONFORMANCE_MODEL to run it.\n' +
        '  e.g. CONFORMANCE_BASE_URL=http://localhost:11434/v1 CONFORMANCE_MODEL=qwen2.5-coder:7b npm run conformance\n'
    );
  });
});
