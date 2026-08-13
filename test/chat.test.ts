import { describe, expect, it, vi } from 'vitest';

import { buildChatPrompt, fitChatPrompt, limitCodeInReply } from '../src/core/chat/prompt.js';
import { MAX_STORED_MESSAGES, TutorChat } from '../src/core/chat/tutorChat.js';
import type { ChatContext, ChatMessage, ChatTelemetryEvent } from '../src/core/chat/types.js';
import { describeEgress, ProviderError, type ProviderAdapter } from '../src/core/provider/types.js';

const CTX: ChatContext = {
  lessonTitle: 'Lending things out',
  lessonGoal: 'Hit a borrow conflict and fix it.',
  steps: [
    { instruction: 'Make a mutable vector', done: true },
    { instruction: 'Take a reference to the first element', done: false },
  ],
  fileName: 'src/main.rs',
  code: 'fn main() {\n    let numbers = vec![1, 2, 3];\n}',
  errors: ['E0502: cannot borrow `numbers` as mutable'],
  learnerSummary: 'Met borrows twice, still shaky.',
};

function provider(reply: string | (() => Promise<never>)): ProviderAdapter {
  return {
    id: 'stub',
    complete: typeof reply === 'string' ? async () => ({ text: reply }) : reply,
  };
}

function chat(p: ProviderAdapter | undefined, extra: Partial<ConstructorParameters<typeof TutorChat>[0]> = {}) {
  return new TutorChat({ model: 'm', ...(p ? { provider: p } : {}), ...extra });
}

describe('what actually leaves the machine', () => {
  it('matches the reviewed snapshot', () => {
    // This snapshot IS the privacy review. Widening what travels — the whole file instead of the
    // region around the cursor, learner history instead of the two-line summary — shows up here as
    // a diff a human has to approve before it can ship.
    expect(describeEgress(buildChatPrompt([], CTX))).toMatchSnapshot();
  });

  it('never sends the learner model itself, only a summary', () => {
    const text = describeEgress(buildChatPrompt([], CTX));
    expect(text).toContain('Met borrows twice, still shaky.');
    expect(text).not.toContain('episodes');
    expect(text).not.toContain('unresolvedStreak');
  });
});

describe('what the tutor can see', () => {
  it('carries the lesson, the steps and what is still undone', () => {
    const system = buildChatPrompt([], CTX)[0]!.content;
    expect(system).toContain('Lending things out');
    expect(system).toContain('[x] Make a mutable vector');
    expect(system).toContain('[ ] Take a reference');
  });

  it('carries the current errors and the code', () => {
    const system = buildChatPrompt([], CTX)[0]!.content;
    expect(system).toContain('E0502');
    expect(system).toContain('let numbers = vec!');
  });

  it('says so plainly when the code compiles', () => {
    const system = buildChatPrompt([], { code: 'fn main() {}' })[0]!.content;
    expect(system).toContain('currently compiles');
  });

  it('handles having no project open', () => {
    expect(buildChatPrompt([], {})[0]!.content).toContain('No project open yet');
  });

  it('tells the model, every time, not to write their code', () => {
    expect(buildChatPrompt([], {})[0]!.content).toMatch(/do not write their code/i);
  });

  it('rebuilds context each turn rather than trusting stale history', () => {
    const history: ChatMessage[] = [{ speaker: 'learner', text: 'help', at: 0 }];
    const fresh = buildChatPrompt(history, { code: 'NEW CODE' })[0]!.content;
    expect(fresh).toContain('NEW CODE');
  });

  it('keeps only a recent window of turns', () => {
    const history: ChatMessage[] = Array.from({ length: 40 }, (_, i) => ({
      speaker: i % 2 ? 'tutor' : 'learner',
      text: `m${String(i)}`,
      at: i,
    }));
    // system + at most 12 turns
    expect(buildChatPrompt(history, {}).length).toBeLessThanOrEqual(13);
  });

  it('asks for a proactive opener when given a reason', () => {
    const msgs = buildChatPrompt([], CTX, 'new_error');
    expect(msgs[msgs.length - 1]!.content).toMatch(/Do not tell them the fix/);
  });
});

describe('the no-code rule, on the way out', () => {
  it('lets a short illustrative snippet through', () => {
    const reply = 'Like this:\n```rust\nlet x = &v[0];\n```\nNow try yours.';
    expect(limitCodeInReply(reply).redacted).toBe(false);
  });

  it('redacts a block long enough to be the answer', () => {
    const reply = '```rust\nfn main() {\n    let v = vec![1];\n    let f = &v[0];\n    println!("{f}");\n}\n```';
    const out = limitCodeInReply(reply);
    expect(out.redacted).toBe(true);
    expect(out.text).toMatch(/you will remember it far better if you type it/);
  });

  it('leaves prose completely alone', () => {
    const reply = 'What does the compiler say about line 3?';
    expect(limitCodeInReply(reply).text).toBe(reply);
  });
});

describe('conversation', () => {
  it('records both sides', async () => {
    const c = chat(provider('Try looking at line 3.'));
    await c.say('I am stuck', CTX, 1);
    expect(c.messages.map((m) => m.speaker)).toEqual(['learner', 'tutor']);
    expect(c.messages[1]!.text).toBe('Try looking at line 3.');
  });

  it('ignores an empty message', async () => {
    const c = chat(provider('x'));
    await c.say('   ', CTX, 1);
    expect(c.messages).toHaveLength(0);
  });

  it('speaks first when something happens', async () => {
    const c = chat(provider('Nice — you made the vector. Now borrow its first element.'));
    await c.nudge('step_completed', 'step-1', CTX, 1);
    expect(c.messages[0]!.proactive).toBe(true);
  });

  it('does not repeat itself about the same event', async () => {
    // Repetition is how an attentive tutor turns into wallpaper.
    const complete = vi.fn(async () => ({ text: 'again' }));
    const c = chat({ id: 's', complete });
    await c.nudge('new_error', 'E0502', CTX, 1);
    await c.nudge('new_error', 'E0502', CTX, 2);
    expect(complete).toHaveBeenCalledTimes(1);
  });

  it('does speak again when a different thing happens', async () => {
    const complete = vi.fn(async () => ({ text: 'ok' }));
    const c = chat({ id: 's', complete });
    await c.nudge('new_error', 'E0502', CTX, 1);
    // Far enough apart to clear the proactive floor (F2). Two events a millisecond apart are not
    // a realistic sequence, and the floor deliberately suppresses them.
    await c.nudge('new_error', 'E0382', CTX, 60_000);
    expect(complete).toHaveBeenCalledTimes(2);
  });

  it('says plainly that it needs a model, rather than failing silently', async () => {
    const errors: string[] = [];
    const c = chat(undefined, { onError: (e) => errors.push(e) });
    await c.say('hello?', CTX, 1);
    expect(c.configured).toBe(false);
    expect(errors[0]).toMatch(/Set up a teaching model/);
  });

  it('surfaces a provider failure instead of hanging', async () => {
    const errors: string[] = [];
    const c = chat(
      provider(() => Promise.reject(new ProviderError('down', 'network'))),
      { onError: (e) => errors.push(e) }
    );
    await c.say('hi', CTX, 1);
    expect(errors).toHaveLength(1);
    expect(c.isBusy).toBe(false);
  });

  it('notifies the view as the conversation changes', async () => {
    const changes: number[] = [];
    const c = chat(provider('hi'), { onChanged: (h) => changes.push(h.length) });
    await c.say('hello', CTX, 1);
    expect(changes.length).toBeGreaterThan(1);
  });

  it('can be cleared without losing its configuration', async () => {
    const c = chat(provider('hi'));
    await c.say('hello', CTX, 1);
    c.reset();
    expect(c.messages).toHaveLength(0);
    expect(c.configured).toBe(true);
  });

  it('applies the no-code rule to what it stores, not just what it renders', async () => {
    const long = '```rust\nfn a() {\n    let x = 1;\n    let y = 2;\n    println!("{x}{y}");\n}\n```';
    const c = chat(provider(long));
    await c.say('just give me the code', CTX, 1);
    expect(c.messages[1]!.text).not.toContain('println!');
  });

  it('honours strictNoCode: false for learners who want full examples', async () => {
    const long = '```rust\nfn a() {\n    let x = 1;\n    let y = 2;\n    let z = 3;\n}\n```';
    const c = chat(provider(long), { strictNoCode: false });
    await c.say('show me', CTX, 1);
    expect(c.messages[1]!.text).toContain('let z = 3;');
  });
});

describe('persistence (A4)', () => {
  function fakeStore(seed: ChatMessage[] = []) {
    let saved = [...seed];
    return {
      store: {
        load: () => [...saved],
        save: (m: readonly ChatMessage[]) => {
          saved = [...m];
        },
      },
      get saved() {
        return saved;
      },
    };
  }

  it('restores a conversation from storage on construction', () => {
    // Reloading the window is what the setup wizard tells people to do; the conversation must
    // survive it.
    const f = fakeStore([{ speaker: 'tutor', text: 'welcome back', at: 1 }]);
    const c = chat(provider('x'), { store: f.store });
    expect(c.messages.map((m) => m.text)).toEqual(['welcome back']);
  });

  it('saves both sides of an exchange', async () => {
    const f = fakeStore();
    const c = chat(provider('a reply'), { store: f.store });
    await c.say('a question', CTX, 1);
    expect(f.saved.map((m) => m.speaker)).toEqual(['learner', 'tutor']);
  });

  it('clears storage when the conversation is cleared', async () => {
    const f = fakeStore();
    const c = chat(provider('x'), { store: f.store });
    await c.say('hi', CTX, 1);
    c.reset();
    expect(f.saved).toEqual([]);
  });

  it('caps what it stores', async () => {
    const f = fakeStore();
    const c = chat(provider('r'), { store: f.store });
    for (let i = 0; i < MAX_STORED_MESSAGES; i++) await c.say(`m${String(i)}`, CTX, i);
    expect(f.saved.length).toBe(MAX_STORED_MESSAGES);
    // Oldest dropped, newest kept.
    expect(f.saved.at(-1)!.text).toBe('r');
  });

  it('works with no store at all, for an ephemeral conversation', async () => {
    const c = chat(provider('x'));
    await c.say('hi', CTX, 1);
    expect(c.messages).toHaveLength(2);
  });
});

describe('cancellation (B2)', () => {
  it('aborts an in-flight reply and records nothing', async () => {
    const errors: string[] = [];
    let capturedSignal: AbortSignal | undefined;
    const c = chat(
      {
        id: 'slow',
        complete: (_m, opts) =>
          new Promise((_resolve, reject) => {
            capturedSignal = opts.signal;
            opts.signal?.addEventListener('abort', () => {
              const e = new Error('aborted');
              e.name = 'AbortError';
              reject(e);
            });
          }),
      },
      { onError: (e) => errors.push(e) }
    );

    const pending = c.say('a question I regret', CTX, 1);
    c.cancel();
    await pending;

    expect(capturedSignal?.aborted).toBe(true);
    // Only the learner's own message survives; no half-formed tutor reply.
    expect(c.messages.map((m) => m.speaker)).toEqual(['learner']);
    // A cancellation is the learner getting what they asked for, not a failure to report.
    expect(errors).toEqual([]);
    expect(c.isBusy).toBe(false);
  });

  it('is harmless when nothing is in flight', () => {
    expect(() => chat(provider('x')).cancel()).not.toThrow();
  });
});

describe('conversation counters (A5)', () => {
  function counted(p: ProviderAdapter | undefined, extra = {}) {
    const events: ChatTelemetryEvent[] = [];
    return { c: chat(p, { onTelemetry: (e) => events.push(e), ...extra }), events };
  }

  it('reports a learner turn and the reason the tutor spoke first', async () => {
    const { c, events } = counted(provider('ok'));
    await c.say('hello', CTX, 1);
    await c.nudge('new_error', 'E0502', CTX, 100_000);
    expect(events).toEqual([
      { kind: 'learner_message' },
      { kind: 'proactive', reason: 'new_error' },
    ]);
  });

  it('does not report a nudge that was throttled away', async () => {
    const { c, events } = counted(provider('ok'), { minProactiveIntervalMs: 20_000 });
    await c.nudge('new_error', 'a', CTX, 1);
    await c.nudge('new_error', 'b', CTX, 2);
    expect(events.filter((e) => e.kind === 'proactive')).toHaveLength(1);
  });

  it('reports a reply that had to be redacted', async () => {
    const answer = '```rust\nlet a = 1;\nlet b = 2;\nlet c = 3;\nlet d = 4;\n```';
    const { c, events } = counted(provider(answer));
    await c.say('just tell me', CTX, 1);
    expect(events).toContainEqual({ kind: 'redacted' });
  });

  it('reports the provider failure kind rather than its message', async () => {
    const { c, events } = counted(
      provider(() => Promise.reject(new ProviderError('502 from https://host/v1', 'network')))
    );
    await c.say('hi', CTX, 1);
    expect(events).toContainEqual({ kind: 'provider_error', error: 'network' });
    // The URL and the body stay out of the counters entirely.
    expect(JSON.stringify(events)).not.toContain('host');
  });

  it('reports a cancellation, but not the failure it causes', async () => {
    const { c, events } = counted({
      id: 'slow',
      complete: (_m, opts) =>
        new Promise((_resolve, reject) => {
          opts.signal?.addEventListener('abort', () => reject(new Error('aborted')));
        }),
    });
    const pending = c.say('never mind', CTX, 1);
    c.cancel();
    await pending;

    expect(events).toContainEqual({ kind: 'cancelled' });
    expect(events.some((e) => e.kind === 'provider_error')).toBe(false);
  });

  it('says nothing about a cancel with nothing in flight', () => {
    const { c, events } = counted(provider('ok'));
    c.cancel();
    expect(events).toEqual([]);
  });
});

describe('proactive floor (F2)', () => {
  it('will not speak twice in quick succession, even about different things', async () => {
    // Alternating events — save, error appears, save, error clears — could otherwise produce a
    // nudge on every save.
    const complete = vi.fn(async () => ({ text: 'ok' }));
    const c = chat({ id: 's', complete }, { minProactiveIntervalMs: 20_000 });

    await c.nudge('new_error', 'E0502', CTX, 0);
    await c.nudge('step_completed', 'step-1', CTX, 5_000);
    await c.nudge('new_error', 'E0382', CTX, 10_000);

    expect(complete).toHaveBeenCalledTimes(1);
  });

  it('speaks again once the floor has passed', async () => {
    const complete = vi.fn(async () => ({ text: 'ok' }));
    const c = chat({ id: 's', complete }, { minProactiveIntervalMs: 20_000 });

    await c.nudge('new_error', 'E0502', CTX, 0);
    await c.nudge('new_error', 'E0382', CTX, 25_000);

    expect(complete).toHaveBeenCalledTimes(2);
  });

  it('never throttles what the learner directly asks', async () => {
    // The floor governs unprompted remarks only. A question always gets an answer.
    const complete = vi.fn(async () => ({ text: 'ok' }));
    const c = chat({ id: 's', complete }, { minProactiveIntervalMs: 60_000 });

    await c.nudge('session_start', 'boot', CTX, 0);
    await c.say('but what about this?', CTX, 1_000);
    await c.say('and this?', CTX, 2_000);

    expect(complete).toHaveBeenCalledTimes(3);
  });
});

describe('no workspace open (F3)', () => {
  it('tells the model there is no project, rather than discussing an imaginary one', () => {
    const system = buildChatPrompt([], { noWorkspace: true })[0]!.content;
    expect(system).toMatch(/no folder is open/i);
    expect(system).toMatch(/cargo new/);
  });

  it('says nothing about it when a folder is open', () => {
    expect(buildChatPrompt([], CTX)[0]!.content).not.toMatch(/no folder is open/i);
  });
});

describe('streaming (B1)', () => {
  function streamingProvider(chunks: string[]): ProviderAdapter {
    return {
      id: 'stream',
      complete: async () => ({ text: chunks.join('') }),
      stream: async (_m, _o, onDelta) => {
        for (const c of chunks) onDelta(c);
        return { text: chunks.join('') };
      },
    };
  }

  it('shows the reply as it arrives', async () => {
    const seen: string[] = [];
    const c = chat(streamingProvider(['Where ', 'does ', 'it move?']), {
      onChanged: (h) => {
        const last = h[h.length - 1];
        if (last?.speaker === 'tutor') seen.push(last.text);
      },
    });
    await c.say('help', CTX, 1);

    expect(seen.length).toBeGreaterThan(1);
    expect(c.messages.at(-1)!.text).toBe('Where does it move?');
  });

  it('falls back to complete() for a provider that cannot stream', async () => {
    const c = chat(provider('all at once'));
    await c.say('hi', CTX, 1);
    expect(c.messages.at(-1)!.text).toBe('all at once');
  });

  it('withholds a code fence until it has finished arriving', async () => {
    // A half-arrived block renders as a complete-looking answer for as long as the rest takes.
    const partials: string[] = [];
    const c = chat(
      streamingProvider(['Try this:\n```rust\nlet a = 1;\n', 'let b = 2;\n```']),
      {
        strictNoCode: false,
        onChanged: (h) => {
          const last = h[h.length - 1];
          if (last?.speaker === 'tutor') partials.push(last.text);
        },
      }
    );
    await c.say('show me', CTX, 1);

    // The first partial is the genuine mid-stream state: one fence opened, none closed.
    const midStream = partials[0] ?? '';
    expect(midStream).not.toContain('let a = 1;');
    expect(midStream).toMatch(/…$/);
    // The finished message is intact.
    expect(c.messages.at(-1)!.text).toContain('let b = 2;');
  });

  it('applies redaction to the finished text, not to fragments', async () => {
    const c = chat(
      streamingProvider(['```rust\nfn a() {\n', '  let x = 1;\n  let y = 2;\n  let z = 3;\n}\n```'])
    );
    await c.say('write it for me', CTX, 1);
    expect(c.messages.at(-1)!.text).toMatch(/remember it far better/);
    expect(c.messages.filter((m) => m.speaker === 'tutor')).toHaveLength(1);
  });

  it('leaves no half-sentence behind when a stream fails', async () => {
    const c = chat({
      id: 'broken',
      complete: async () => ({ text: '' }),
      stream: async (_m, _o, onDelta) => {
        onDelta('I was about to say');
        throw new ProviderError('died', 'network');
      },
    });
    await c.say('hi', CTX, 1);
    expect(c.messages.map((m) => m.speaker)).toEqual(['learner']);
  });
});

describe('context that will not fit (B5)', () => {
  const bigHistory: ChatMessage[] = Array.from({ length: 12 }, (_, i) => ({
    speaker: i % 2 ? 'tutor' : 'learner',
    text: 'x'.repeat(400),
    at: i,
  }));

  it('sends everything when it fits', () => {
    const fitted = fitChatPrompt([], { code: 'fn main() {}' }, undefined, { maxChars: 100_000 });
    expect(fitted.degradations).toEqual([]);
  });

  it('drops older conversation first, keeping the code', () => {
    // The code in front of the learner is what the tutor is discussing; old turns are not.
    const fitted = fitChatPrompt(bigHistory, { code: 'let marker = 1;' }, undefined, {
      maxChars: 3_000,
    });
    expect(fitted.degradations[0]).toMatch(/dropped older conversation/);
    expect(fitted.messages[0]!.content).toContain('let marker = 1;');
  });

  it('narrows the code only once there is no conversation left to drop', () => {
    const hugeCode = Array.from({ length: 200 }, (_, i) => `let v${String(i)} = ${String(i)};`).join('\n');
    const fitted = fitChatPrompt([], { code: hugeCode }, undefined, { maxChars: 2_500 });
    expect(fitted.degradations).toContain('narrowed the code region');
  });

  it('says so rather than silently overflowing when nothing more can go', () => {
    const fitted = fitChatPrompt([], {}, undefined, { maxChars: 10 });
    expect(fitted.degradations.at(-1)).toMatch(/still over the limit/);
  });
});
