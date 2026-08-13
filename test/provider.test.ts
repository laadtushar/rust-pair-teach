import { describe, expect, it, vi } from 'vitest';

import { extractRegion } from '../src/core/lesson/region.js';
import { OpenAiCompatibleProvider } from '../src/core/provider/openaiCompatible.js';

const FILE = `use std::collections::HashMap;

fn secret_helper(token: &str) -> String {
    format!("bearer {token}")
}

fn tally(items: &mut Vec<i32>) {
    let first = &items[0];
    items.push(*first);
}
`;

describe('code region — the privacy control', () => {
  it('sends the enclosing function, not the whole file', () => {
    const region = extractRegion(FILE, 7);
    expect(region.text).toContain('fn tally');
    // The unrelated helper above it must not travel just because it shares a file.
    expect(region.text).not.toContain('secret_helper');
    expect(region.text).not.toContain('bearer');
  });

  it('caps the region even when the block is enormous', () => {
    const huge = [
      'fn big() {',
      ...Array.from({ length: 500 }, (_, i) => `    let x${String(i)} = ${String(i)};`),
      '}',
    ].join('\n');
    const region = extractRegion(huge, 250, 20);
    expect(region.truncated).toBe(true);
    expect(region.text.split('\n').length).toBeLessThanOrEqual(20);
  });

  it('survives an out-of-range line without throwing', () => {
    expect(() => extractRegion(FILE, 9_999)).not.toThrow();
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
