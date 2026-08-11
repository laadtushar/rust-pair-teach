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

  /**
   * Server-sent events, decoded as they arrive.
   *
   * Waiting for a whole reply before showing anything is fine for a hint card and wrong for a
   * conversation: on a local 7B model that is several seconds of staring at a dot.
   */
  async stream(
    messages: Message[],
    opts: CompletionOptions,
    onDelta: (text: string) => void
  ): Promise<Completion> {
    const res = await this.request(messages, opts, true);
    const body = res.body;
    if (!body) throw new ProviderError('provider returned no stream body', 'bad_response');

    const reader = body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    let text = '';

    try {
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });

        // SSE frames are separated by a blank line; a frame can straddle two chunks.
        const frames = buffer.split('\n\n');
        buffer = frames.pop() ?? '';

        for (const frame of frames) {
          for (const line of frame.split('\n')) {
            if (!line.startsWith('data:')) continue;
            const payload = line.slice(5).trim();
            if (payload === '' || payload === '[DONE]') continue;
            try {
              const parsed = JSON.parse(payload) as {
                choices?: Array<{ delta?: { content?: string } }>;
              };
              const delta = parsed.choices?.[0]?.delta?.content;
              if (typeof delta === 'string' && delta !== '') {
                text += delta;
                onDelta(delta);
              }
            } catch {
              // A malformed frame is not worth failing a whole reply over.
            }
          }
        }
      }
    } finally {
      reader.releaseLock();
    }

    return { text };
  }

  private async request(
    messages: Message[],
    opts: CompletionOptions,
    stream: boolean
  ): Promise<Response> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), opts.timeoutMs);
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
          ...(stream ? { stream: true } : {}),
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
      return res;
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

  async complete(messages: Message[], opts: CompletionOptions): Promise<Completion> {
    try {
      const res = await this.request(messages, opts, false);
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
      throw new ProviderError(String(err), 'network');
    }
  }
}

function trimSlash(url: string): string {
  return url.replace(/\/+$/, '');
}
