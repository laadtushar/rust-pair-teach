export interface Message {
  role: 'system' | 'user';
  content: string;
}

/**
 * Exactly what would be sent, for the learner to inspect before or after it goes.
 *
 * "Visible and controllable" (N3) is unverifiable if the only way to see the payload is a network
 * capture, so this is surfaced through a command rather than left as an intention.
 */
export function describeEgress(messages: readonly Message[]): string {
  return messages.map((m) => `--- ${m.role} ---\n${m.content}`).join('\n\n');
}

export interface CompletionOptions {
  model: string;
  maxTokens: number;
  timeoutMs: number;
  /** Abort from outside — a learner who asked the wrong question should not have to wait it out. */
  signal?: AbortSignal;
}

export interface Completion {
  text: string;
  usage?: { promptTokens?: number; completionTokens?: number };
}

/**
 * The single seam every LLM goes through.
 *
 * Deliberately tiny. One OpenAI-compatible implementation covers OpenRouter, OpenAI, Groq,
 * DeepSeek, Ollama and LM Studio, which is what makes "run it locally for free" a real option
 * rather than a bullet point.
 */
export interface ProviderAdapter {
  readonly id: string;
  complete(messages: Message[], opts: CompletionOptions): Promise<Completion>;
  /**
   * Optional. Adapters without it fall back to `complete`, so a provider that cannot stream still
   * works — it just feels slower.
   */
  stream?(
    messages: Message[],
    opts: CompletionOptions,
    onDelta: (text: string) => void
  ): Promise<Completion>;
}

export class ProviderError extends Error {
  constructor(
    message: string,
    readonly kind: 'timeout' | 'network' | 'auth' | 'rate_limit' | 'bad_response' | 'cancelled'
  ) {
    super(message);
    this.name = 'ProviderError';
  }
}
