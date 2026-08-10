import { fileURLToPath } from 'node:url';

import { beforeAll, describe, expect, it, vi } from 'vitest';

import { extractJson, parseHintResponse } from '../src/core/lesson/contract.js';
import { LessonEngine } from '../src/core/lesson/engine.js';
import { buildPrompt, describeEgress } from '../src/core/lesson/prompt.js';
import { extractRegion } from '../src/core/lesson/region.js';
import { loadPackFromDisk } from '../src/core/pack/loadFromDisk.js';
import { indexBySignature } from '../src/core/pack/schema.js';
import type { ConceptEntry } from '../src/core/pack/types.js';
import { OpenAiCompatibleProvider } from '../src/core/provider/openaiCompatible.js';
import { ProviderError, type ProviderAdapter } from '../src/core/provider/types.js';
import { signatureKey, type DiagnosticSignature } from '../src/core/types.js';

const PACK_DIR = fileURLToPath(new URL('../packs/rust-borrow-basics', import.meta.url));
const SIG: DiagnosticSignature = { kind: 'code', language: 'rust', value: 'E0502' };

const FILE = `use std::collections::HashMap;

fn secret_helper(token: &str) -> String {
    format!("bearer {token}")
}

fn tally(items: &mut Vec<i32>) {
    let first = &items[0];
    items.push(*first);
}
`;

let concept: ConceptEntry;

beforeAll(async () => {
  const pack = await loadPackFromDisk(PACK_DIR);
  concept = indexBySignature(pack).get(signatureKey(SIG))!;
});

function request(level: 1 | 2 | 3 = 1) {
  return {
    concept,
    level,
    signature: SIG,
    diagnosticMessage: 'cannot borrow `*items` as mutable because it is also borrowed as immutable',
    region: extractRegion(FILE, 7),
    learnerSummary: 'has hit E0502 three times this week; prefers analogies',
  };
}

function providerReturning(...texts: string[]): ProviderAdapter & { calls: number } {
  let i = 0;
  return {
    id: 'stub',
    calls: 0,
    async complete() {
      this.calls++;
      return { text: texts[Math.min(i++, texts.length - 1)]! };
    },
  };
}

describe('code region — the privacy control', () => {
  it('sends the enclosing function, not the whole file', () => {
    const region = extractRegion(FILE, 7);
    expect(region.text).toContain('fn tally');
    // The unrelated helper above it must not travel just because it shares a file.
    expect(region.text).not.toContain('secret_helper');
    expect(region.text).not.toContain('bearer');
  });

  it('caps the region even when the block is enormous', () => {
    const huge = ['fn big() {', ...Array.from({ length: 500 }, (_, i) => `    let x${i} = ${i};`), '}'].join('\n');
    const region = extractRegion(huge, 250, 20);
    expect(region.truncated).toBe(true);
    expect(region.text.split('\n').length).toBeLessThanOrEqual(20);
  });

  it('survives an out-of-range line without throwing', () => {
    expect(() => extractRegion(FILE, 9_999)).not.toThrow();
  });
});

describe('prompt — what actually leaves the machine', () => {
  it('matches the reviewed snapshot', () => {
    // This snapshot IS the privacy review. Widening the context from the enclosing block to the
    // whole file, or leaking learner history beyond the two-line summary, shows up here as a diff
    // a human has to approve.
    expect(describeEgress(buildPrompt(request(1)))).toMatchSnapshot();
  });

  it('carries the pack mental model so the model personalizes rather than invents', () => {
    const text = describeEgress(buildPrompt(request(1)));
    expect(text).toContain(concept.mentalModel.split('\n')[0]!);
  });

  it('tells the model not to include code at levels 1 and 2', () => {
    expect(describeEgress(buildPrompt(request(1)))).toMatch(/do not include any code/i);
    expect(describeEgress(buildPrompt(request(2)))).toMatch(/no code the learner could paste/i);
  });

  it('never sends the learner model itself, only a summary', () => {
    const text = describeEgress(buildPrompt(request(1)));
    expect(text).toContain('has hit E0502 three times this week');
    expect(text).not.toContain('episodes');
    expect(text).not.toContain('unresolvedStreak');
  });
});

describe('response contract', () => {
  it('extracts JSON from a fenced block', () => {
    expect(extractJson('Sure!\n```json\n{"a":1}\n```')).toBe('{"a":1}');
  });

  it('extracts JSON surrounded by prose, which small models emit constantly', () => {
    expect(extractJson('Here you go: {"a":{"b":2}} hope that helps')).toBe('{"a":{"b":2}}');
  });

  it('is not fooled by braces inside strings', () => {
    expect(extractJson('{"text":"use } carefully"}')).toBe('{"text":"use } carefully"}');
  });

  it('returns null when there is no object at all', () => {
    expect(extractJson('I cannot help with that')).toBeNull();
  });

  it('accepts "question" as an alias for "text"', () => {
    const r = parseHintResponse('{"question":"Where?","conceptTag":"x","confidence":0.9}', 1);
    expect(r.ok && r.value.text).toBe('Where?');
  });

  it('overrules a model that claims a different ladder level', () => {
    // The ladder is the product; a level-3 answer to a level-1 request does not get to promote
    // itself.
    const r = parseHintResponse('{"text":"Q?","level":3,"conceptTag":"x","confidence":1}', 1);
    expect(r.ok && r.value.level).toBe(1);
  });

  it('defaults an out-of-range confidence rather than rejecting the hint', () => {
    const r = parseHintResponse('{"text":"Q?","conceptTag":"x","confidence":42}', 1);
    expect(r.ok && r.value.confidence).toBe(0.5);
  });
});

describe('LessonEngine degradation', () => {
  it('falls back to the pack when no provider is configured', async () => {
    const engine = new LessonEngine({ model: 'm' });
    const hint = await engine.hint(request(1));
    expect(hint.offline).toBe(true);
    expect(hint.text).toContain('?');
  });

  it('falls back when the provider times out, and says why', async () => {
    const reasons: string[] = [];
    const engine = new LessonEngine({
      model: 'm',
      onDegraded: (r) => reasons.push(r),
      provider: {
        id: 'dead',
        complete: () => Promise.reject(new ProviderError('timed out', 'timeout')),
      },
    });
    const hint = await engine.hint(request(1));
    expect(hint.offline).toBe(true);
    expect(reasons[0]).toMatch(/provider failed/);
  });

  it('retries once with a repair instruction, then succeeds', async () => {
    const provider = providerReturning(
      'I think the issue is your borrow.',
      '{"text":"Which borrow is still alive on that line?","conceptTag":"borrows","confidence":0.8}'
    );
    const engine = new LessonEngine({ model: 'm', provider });
    const hint = await engine.hint(request(1));
    expect(provider.calls).toBe(2);
    expect(hint.offline).toBe(false);
    expect(hint.text).toContain('Which borrow');
  });

  it('gives up after one repair rather than looping', async () => {
    const provider = providerReturning('nope', 'still nope');
    const engine = new LessonEngine({ model: 'm', provider });
    const hint = await engine.hint(request(1));
    expect(provider.calls).toBe(2);
    expect(hint.offline).toBe(true);
  });

  it('refuses a model that hands over the answer at level 1', async () => {
    // The whole product promise, enforced at the boundary rather than trusted.
    const reasons: string[] = [];
    const provider = providerReturning(
      '{"text":"Just write let first = items[0].clone(); and it compiles","conceptTag":"b","confidence":1}'
    );
    const engine = new LessonEngine({ model: 'm', provider, onDegraded: (r) => reasons.push(r) });
    const hint = await engine.hint(request(1));
    expect(hint.offline).toBe(true);
    expect(reasons.join(' ')).toMatch(/refused/);
  });

  it('refuses a level-1 answer that explains instead of asking', async () => {
    const provider = providerReturning(
      '{"text":"The immutable borrow is still live when you push.","conceptTag":"b","confidence":1}'
    );
    const engine = new LessonEngine({ model: 'm', provider });
    expect((await engine.hint(request(1))).offline).toBe(true);
  });

  it('allows code at level 3, where the worked example belongs', async () => {
    const provider = providerReturning(
      '{"text":"Consider this analogous case:\\n```rust\\nlet a = v[0];\\n```","conceptTag":"b","confidence":1}'
    );
    const engine = new LessonEngine({ model: 'm', provider });
    const hint = await engine.hint(request(3));
    expect(hint.offline).toBe(false);
  });
});

describe('OpenAiCompatibleProvider', () => {
  const opts = { model: 'm', maxTokens: 100, timeoutMs: 1_000 };

  it('posts to the chat completions path and reads the message content', async () => {
    const fetchImpl = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
      expect(String(url)).toBe('https://example.test/v1/chat/completions');
      expect((init?.headers as Record<string, string>)['authorization']).toBe('Bearer k');
      return new Response(JSON.stringify({ choices: [{ message: { content: 'hi' } }] }), {
        status: 200,
      });
    }) as unknown as typeof fetch;

    const p = new OpenAiCompatibleProvider({
      baseUrl: 'https://example.test/v1/',
      apiKey: 'k',
      fetchImpl,
    });
    expect((await p.complete([], opts)).text).toBe('hi');
  });

  it('omits the auth header when there is no key, which is normal for local models', async () => {
    const fetchImpl = vi.fn(async (_url: string | URL | Request, init?: RequestInit) => {
      expect((init?.headers as Record<string, string>)['authorization']).toBeUndefined();
      return new Response(JSON.stringify({ choices: [{ message: { content: 'ok' } }] }), {
        status: 200,
      });
    }) as unknown as typeof fetch;

    const p = new OpenAiCompatibleProvider({ baseUrl: 'http://localhost:11434/v1', fetchImpl });
    expect((await p.complete([], opts)).text).toBe('ok');
  });

  it('classifies auth and rate-limit failures distinctly', async () => {
    const status = (code: number): typeof fetch =>
      (async () => new Response('{}', { status: code })) as unknown as typeof fetch;

    const auth = new OpenAiCompatibleProvider({ baseUrl: 'x', fetchImpl: status(401) });
    await expect(auth.complete([], opts)).rejects.toMatchObject({ kind: 'auth' });

    const limited = new OpenAiCompatibleProvider({ baseUrl: 'x', fetchImpl: status(429) });
    await expect(limited.complete([], opts)).rejects.toMatchObject({ kind: 'rate_limit' });
  });
});
