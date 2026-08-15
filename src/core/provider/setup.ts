import { systemClock, type Clock } from '../clock.js';
import { ProviderError, type ProviderAdapter } from './types.js';

/**
 * Getting a model configured, and explaining clearly when it cannot be.
 *
 * The failure this exists for: someone pays for ChatGPT Plus or Claude Pro, assumes that buys API
 * access, pastes a session token, and gets a bare 401. The subscription/API distinction is a
 * genuine billing fact that trips up experienced developers, and a tutor whose own setup is
 * confusing has no business teaching anyone.
 */

export interface ProviderPreset {
  id: string;
  label: string;
  baseUrl: string;
  suggestedModel: string;
  needsKey: boolean;
  note: string;
}

export const PRESETS: ProviderPreset[] = [
  {
    id: 'ollama',
    label: 'Ollama (local, free, nothing leaves your machine)',
    baseUrl: 'http://localhost:11434/v1',
    suggestedModel: 'qwen2.5-coder:7b',
    needsKey: false,
    note: 'Recommended. Hint levels 1–2 work well on a 7B coder model; level 3 worked examples benefit from something larger.',
  },
  {
    id: 'openai',
    label: 'OpenAI API (pay-as-you-go)',
    baseUrl: 'https://api.openai.com/v1',
    suggestedModel: 'gpt-4o-mini',
    needsKey: true,
    note: 'Billed separately from any ChatGPT subscription. Get a key at platform.openai.com/api-keys. These prompts are small — realistically pennies a month.',
  },
  {
    id: 'openrouter',
    label: 'OpenRouter (one key, many models, some free)',
    baseUrl: 'https://openrouter.ai/api/v1',
    suggestedModel: 'meta-llama/llama-3.3-70b-instruct',
    needsKey: true,
    note: 'Lets you switch models without touching the extension. Has free-tier model ids.',
  },
];

export type CredentialProblem =
  | 'subscription_endpoint'
  | 'session_token'
  | 'wrong_vendor_key'
  | 'missing_key'
  | 'not_a_base_url';

export interface CredentialDiagnosis {
  problem: CredentialProblem;
  message: string;
}

const SUBSCRIPTION_HOSTS = ['chatgpt.com', 'chat.openai.com', 'claude.ai'];

/**
 * Catch the configurations that cannot work, before a request is ever made.
 *
 * Each message says what is wrong *and* what to do instead. "Invalid API key" is technically true
 * and practically useless when the real problem is that the person bought a different product.
 */
export function diagnoseCredential(baseUrl: string, apiKey: string | undefined): CredentialDiagnosis | null {
  const url = baseUrl.trim();
  const key = apiKey?.trim() ?? '';

  if (url === '') return null;

  if (!/^https?:\/\//i.test(url)) {
    return {
      problem: 'not_a_base_url',
      message: `"${url}" is not a URL. It should look like https://api.openai.com/v1 or http://localhost:11434/v1 — the base, not a full endpoint path.`,
    };
  }

  const host = hostOf(url);
  if (host && SUBSCRIPTION_HOSTS.some((h) => host === h || host.endsWith(`.${h}`))) {
    return {
      problem: 'subscription_endpoint',
      message:
        `${host} serves the chat apps, not a developer API, and there is no supported way to point this extension at it. ` +
        'A ChatGPT Plus/Pro or Claude Pro/Max subscription pays for those apps; API calls are billed separately with their own key. ' +
        'Use the OpenAI API preset with a key from platform.openai.com, or Ollama for a free local model.',
    };
  }

  if (key !== '') {
    // A JWT or a sess- token means someone copied a browser session, not an API key.
    if (key.startsWith('eyJ') || key.startsWith('sess-')) {
      return {
        problem: 'session_token',
        message:
          'That looks like a browser session token rather than an API key. Session tokens authenticate the vendor’s own apps and are not accepted by the API — they also expire quickly and are not licensed for third-party use. ' +
          'API keys start with sk- (OpenAI), sk-or- (OpenRouter), or sk-ant- (Anthropic).',
      };
    }

    if (host?.endsWith('openai.com') && key.startsWith('sk-ant-')) {
      return {
        problem: 'wrong_vendor_key',
        message: 'That is an Anthropic key pointed at OpenAI. Match the key to the endpoint.',
      };
    }
    if (host?.endsWith('openrouter.ai') && !key.startsWith('sk-or-')) {
      return {
        problem: 'wrong_vendor_key',
        message: 'OpenRouter keys start with sk-or-. This key looks like it belongs to a different provider.',
      };
    }
  }

  const preset = PRESETS.find((p) => hostOf(p.baseUrl) === host);
  if (preset?.needsKey && key === '') {
    return {
      problem: 'missing_key',
      message: `${preset.label} needs an API key. Run "Rust Pair Teacher: Set API key", or switch to Ollama, which needs none.`,
    };
  }

  return null;
}

export interface ConnectionResult {
  ok: boolean;
  message: string;
  /** Round-trip time, when the call succeeded. */
  latencyMs?: number;
}

/**
 * Make one real, tiny call and report plainly what happened.
 *
 * Setup that "looks configured" but has never been exercised is how someone discovers a broken key
 * mid-struggle, which is the worst possible moment.
 */
export async function testConnection(
  provider: ProviderAdapter,
  model: string,
  clock: Clock = systemClock
): Promise<ConnectionResult> {
  const started = clock.now();
  try {
    const completion = await provider.complete(
      [
        { role: 'system', content: 'Reply with the single word: ready' },
        { role: 'user', content: 'ready?' },
      ],
      { model, maxTokens: 16, timeoutMs: 15_000 }
    );
    return {
      ok: true,
      latencyMs: clock.now() - started,
      message: `Connected. The model replied: ${completion.text.trim().slice(0, 40)}`,
    };
  } catch (err) {
    return { ok: false, message: explainProviderError(err, model) };
  }
}

/** Lowercased hostname, or null if the URL will not parse. */
function hostOf(url: string): string | null {
  try {
    return new URL(url).hostname.toLowerCase();
  } catch {
    return null;
  }
}

/** Turn a transport failure into something a person can act on. */
export function explainProviderError(err: unknown, model: string): string {
  if (!(err instanceof ProviderError)) return `Unexpected failure: ${String(err)}`;

  switch (err.kind) {
    case 'auth':
      return (
        'The provider rejected the key. If you are trying to use a ChatGPT or Claude subscription: those pay for the chat apps, ' +
        'and API access is billed separately with its own key. Create one at platform.openai.com/api-keys (OpenAI) or openrouter.ai/keys.'
      );
    case 'rate_limit':
      return 'Rate limited. On a free tier this usually means waiting a minute; on a paid one, check your credit balance.';
    case 'timeout':
      return 'The provider did not respond in time. If this is Ollama, check it is running (`ollama serve`) and the model is pulled (`ollama pull <model>`).';
    case 'bad_response':
      return `The endpoint answered but not in the expected shape. Check that the base URL ends in /v1 and that "${model}" exists on this provider.`;
    case 'cancelled':
      return 'Cancelled.';
    case 'network':
      return `Could not reach the provider: ${err.message}. If this is a local model, confirm the port. Otherwise check connectivity or a proxy.`;
  }
}
