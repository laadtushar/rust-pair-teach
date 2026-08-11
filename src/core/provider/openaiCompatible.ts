import type { Message } from '../lesson/prompt.js';
import {
  ProviderError,
  type Completion,
  type CompletionOptions,
  type ProviderAdapter,
} from './types.js';

export interface OpenAiCompatibleConfig {
  /** e.g. https://openrouter.ai/api/v1, or http://localhost:11434/v1 for Ollama. */
  baseUrl: string;
  /** Absent for most local servers, which is a supported configuration, not an error. */
  apiKey?: string;
  /** Injected so tests never touch a network. */
  fetchImpl?: typeof fetch;
}

/**
 * The workhorse adapter: one config covers every OpenAI-compatible endpoint.
 *
 * Notably this includes Ollama and LM Studio on localhost, which is the zero-cost, zero-egress path
 * — with those configured, a fired teachable moment never leaves the machine at all.
 */
export class OpenAiCompatibleProvider implements ProviderAdapter {
  readonly id = 'openai-compatible';
  private readonly fetchImpl: typeof fetch;

  constructor(private config: OpenAiCompatibleConfig) {
    this.fetchImpl = config.fetchImpl ?? globalThis.fetch;
  }

  async complete(messages: Message[], opts: CompletionOptions): Promise<Completion> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), opts.timeoutMs);
    // Caller-driven cancellation rides the same controller as the timeout.
    const onExternalAbort = () => controller.abort();
    opts.signal?.addEventListener('abort', onExternalAbort, { once: true });

    try {
      const res = await this.fetchImpl(`${trimSlash(this.config.baseUrl)}/chat/completions`, {
        method: 'POST',
        signal: controller.signal,
        headers: {
          'content-type': 'application/json',
          ...(this.config.apiKey ? { authorization: `Bearer ${this.config.apiKey}` } : {}),
        },
        body: JSON.stringify({
          model: opts.model,
          max_tokens: opts.maxTokens,
          temperature: 0.4,
          messages,
        }),
      });

      if (res.status === 401 || res.status === 403) {
        throw new ProviderError('provider rejected the credentials', 'auth');
      }
      if (res.status === 429) {
        throw new ProviderError('provider rate limited the request', 'rate_limit');
      }
      if (!res.ok) {
        throw new ProviderError(`provider returned ${res.status}`, 'network');
      }

      const body = (await res.json()) as {
        choices?: Array<{ message?: { content?: string } }>;
        usage?: { prompt_tokens?: number; completion_tokens?: number };
      };
      const text = body.choices?.[0]?.message?.content;
      if (typeof text !== 'string') {
        throw new ProviderError('provider response had no message content', 'bad_response');
      }

      const usage =
        body.usage &&
        ({
          ...(body.usage.prompt_tokens !== undefined
            ? { promptTokens: body.usage.prompt_tokens }
            : {}),
          ...(body.usage.completion_tokens !== undefined
            ? { completionTokens: body.usage.completion_tokens }
            : {}),
        } as const);

      return { text, ...(usage ? { usage } : {}) };
    } catch (err) {
      if (err instanceof ProviderError) throw err;
      if (err instanceof Error && err.name === 'AbortError') {
        if (opts.signal?.aborted) throw new ProviderError('cancelled by the learner', 'cancelled');
        throw new ProviderError(`provider timed out after ${opts.timeoutMs}ms`, 'timeout');
      }
      throw new ProviderError(String(err), 'network');
    } finally {
      clearTimeout(timer);
      opts.signal?.removeEventListener('abort', onExternalAbort);
    }
  }
}

function trimSlash(url: string): string {
  return url.replace(/\/+$/, '');
}
