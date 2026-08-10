import { describe, expect, it } from 'vitest';

import {
  diagnoseCredential,
  explainProviderError,
  PRESETS,
  testConnection,
} from '../src/core/provider/setup.js';
import { ProviderError, type ProviderAdapter } from '../src/core/provider/types.js';

const OPENAI = 'https://api.openai.com/v1';

function provider(impl: ProviderAdapter['complete']): ProviderAdapter {
  return { id: 'stub', complete: impl };
}

describe('subscriptions are not API access', () => {
  it('explains why chatgpt.com cannot be used as an endpoint', () => {
    // The specific confusion this whole module exists for.
    const d = diagnoseCredential('https://chatgpt.com/backend-api', 'anything');
    expect(d?.problem).toBe('subscription_endpoint');
    expect(d?.message).toMatch(/billed separately/);
    expect(d?.message).toMatch(/platform\.openai\.com|Ollama/);
  });

  it('catches chat.openai.com and claude.ai too', () => {
    expect(diagnoseCredential('https://chat.openai.com/v1', 'x')?.problem).toBe(
      'subscription_endpoint'
    );
    expect(diagnoseCredential('https://claude.ai/api', 'x')?.problem).toBe(
      'subscription_endpoint'
    );
  });

  it('recognises a pasted browser session token', () => {
    const jwt = diagnoseCredential(OPENAI, 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.abc.def');
    expect(jwt?.problem).toBe('session_token');
    expect(jwt?.message).toMatch(/not licensed for third-party use/);

    expect(diagnoseCredential(OPENAI, 'sess-abc123')?.problem).toBe('session_token');
  });

  it('says what a real key looks like instead of only what is wrong', () => {
    const d = diagnoseCredential(OPENAI, 'eyJabc.def.ghi');
    expect(d?.message).toMatch(/sk-/);
  });

  it('turns a 401 into an explanation of the billing distinction', () => {
    const msg = explainProviderError(new ProviderError('nope', 'auth'), 'gpt-4o-mini');
    expect(msg).toMatch(/subscription/i);
    expect(msg).toMatch(/billed separately/);
  });
});

describe('other misconfigurations', () => {
  it('catches a vendor mismatch', () => {
    expect(diagnoseCredential(OPENAI, 'sk-ant-abc')?.problem).toBe('wrong_vendor_key');
    expect(diagnoseCredential('https://openrouter.ai/api/v1', 'sk-abc')?.problem).toBe(
      'wrong_vendor_key'
    );
  });

  it('catches a missing key on a provider that needs one', () => {
    expect(diagnoseCredential(OPENAI, '')?.problem).toBe('missing_key');
  });

  it('accepts Ollama with no key at all', () => {
    expect(diagnoseCredential('http://localhost:11434/v1', '')).toBeNull();
  });

  it('catches something that is not a URL', () => {
    expect(diagnoseCredential('api.openai.com', 'sk-abc')?.problem).toBe('not_a_base_url');
  });

  it('passes a correctly configured OpenAI setup', () => {
    expect(diagnoseCredential(OPENAI, 'sk-proj-abc123')).toBeNull();
  });

  it('says nothing when nothing is configured yet', () => {
    expect(diagnoseCredential('', '')).toBeNull();
  });
});

describe('connection test', () => {
  it('reports success with the model reply and a latency', async () => {
    let t = 1_000;
    const result = await testConnection(
      provider(async () => {
        t += 250;
        return { text: 'ready' };
      }),
      'gpt-4o-mini',
      () => t
    );
    expect(result.ok).toBe(true);
    expect(result.latencyMs).toBe(250);
    expect(result.message).toMatch(/ready/);
  });

  it('never throws — a failed test is a message, not a crash', async () => {
    const result = await testConnection(
      provider(() => Promise.reject(new ProviderError('down', 'network'))),
      'm'
    );
    expect(result.ok).toBe(false);
    expect(result.message).toMatch(/Could not reach/);
  });

  it('tells an Ollama user to check the daemon and the pulled model', async () => {
    const result = await testConnection(
      provider(() => Promise.reject(new ProviderError('slow', 'timeout'))),
      'qwen2.5-coder:7b'
    );
    expect(result.message).toMatch(/ollama serve/);
    expect(result.message).toMatch(/ollama pull/);
  });

  it('names the model when the endpoint answers in the wrong shape', async () => {
    const result = await testConnection(
      provider(() => Promise.reject(new ProviderError('huh', 'bad_response'))),
      'my-model'
    );
    expect(result.message).toMatch(/my-model/);
  });
});

describe('presets', () => {
  it('recommends the free local option first', () => {
    expect(PRESETS[0]!.id).toBe('ollama');
    expect(PRESETS[0]!.needsKey).toBe(false);
  });

  it('states plainly that the OpenAI preset is separate from a subscription', () => {
    const openai = PRESETS.find((p) => p.id === 'openai')!;
    expect(openai.note).toMatch(/separately from any ChatGPT subscription/);
  });

  it('every preset carries a usable base URL and model suggestion', () => {
    for (const p of PRESETS) {
      expect(p.baseUrl).toMatch(/^https?:\/\//);
      expect(p.suggestedModel.length).toBeGreaterThan(0);
    }
  });
});
