import type { ProviderAdapter } from '../provider/types.js';
import { buildChatPrompt, limitCodeInReply } from './prompt.js';
import type { ChatContext, ChatMessage, ProactiveReason } from './types.js';

/**
 * Where the conversation is kept between sessions.
 *
 * Injected rather than assumed, so the core stays editor-agnostic and the persistence rules are
 * testable against a fake.
 */
export interface ChatStore {
  load(): ChatMessage[];
  save(messages: readonly ChatMessage[]): void;
}

export interface TutorChatOptions {
  provider?: ProviderAdapter;
  model: string;
  maxTokens?: number;
  timeoutMs?: number;
  /** Set false to allow long code blocks through. Default true. */
  strictNoCode?: boolean;
  onChanged?: (history: readonly ChatMessage[]) => void;
  onError?: (message: string) => void;
  /** Omit for an ephemeral conversation, as the tests do. */
  store?: ChatStore;
}

/** Kept small enough to load instantly and large enough to hold a real session. */
export const MAX_STORED_MESSAGES = 200;

/**
 * A conversation with the tutor.
 *
 * Unlike the hint ladder, this is a genuine back-and-forth: it speaks first, reacts to what changes
 * in the code, and answers whatever the learner types. What it will not do — enforced in the
 * persona and again on the way out — is write the code they are trying to write.
 *
 * This path requires a configured model. There is no useful canned version of a conversation, and
 * pretending otherwise would be worse than saying so.
 */
export class TutorChat {
  private history: ChatMessage[] = [];
  private busy = false;
  /** Deduplicates proactive nudges so the tutor does not repeat itself on every tick. */
  private lastProactive: { reason: ProactiveReason; key: string } | null = null;

  constructor(private opts: TutorChatOptions) {
    // Reloading the window is something the setup wizard actively tells people to do; losing the
    // conversation to it would be an unforced insult.
    this.history = opts.store?.load() ?? [];
  }

  get messages(): readonly ChatMessage[] {
    return this.history;
  }

  get isBusy(): boolean {
    return this.busy;
  }

  get configured(): boolean {
    return this.opts.provider !== undefined;
  }

  /** Drop the conversation but keep the configuration. */
  reset(): void {
    this.history = [];
    this.lastProactive = null;
    this.opts.store?.save(this.history);
    this.opts.onChanged?.(this.history);
  }

  /** The learner typed something. */
  async say(text: string, ctx: ChatContext, now: number): Promise<void> {
    const trimmed = text.trim();
    if (trimmed === '') return;

    this.push({ speaker: 'learner', text: trimmed, at: now });
    await this.respond(ctx, now, undefined);
  }

  /**
   * The tutor speaks unprompted because something happened.
   *
   * `key` identifies the event — a step index, an error code — so the same thing happening twice
   * does not produce the same remark twice. Repetition is how an attentive tutor turns into
   * wallpaper.
   */
  async nudge(
    reason: ProactiveReason,
    key: string,
    ctx: ChatContext,
    now: number
  ): Promise<void> {
    if (this.busy) return;
    if (this.lastProactive?.reason === reason && this.lastProactive.key === key) return;
    this.lastProactive = { reason, key };
    await this.respond(ctx, now, reason);
  }

  private async respond(
    ctx: ChatContext,
    now: number,
    proactive: ProactiveReason | undefined
  ): Promise<void> {
    if (!this.opts.provider) {
      this.opts.onError?.(
        'No model is connected yet, so I cannot talk back. Run "Rust Pair Teacher: Set up a teaching model" — Ollama is free and runs on your machine.'
      );
      return;
    }

    this.busy = true;
    this.opts.onChanged?.(this.history);

    try {
      const completion = await this.opts.provider.complete(
        buildChatPrompt(this.history, ctx, proactive),
        {
          model: this.opts.model,
          maxTokens: this.opts.maxTokens ?? 500,
          timeoutMs: this.opts.timeoutMs ?? 30_000,
        }
      );

      const reply =
        this.opts.strictNoCode === false
          ? { text: completion.text, redacted: false }
          : limitCodeInReply(completion.text);

      const text = reply.text.trim();
      if (text !== '') {
        this.push({
          speaker: 'tutor',
          text,
          at: now,
          ...(proactive ? { proactive: true } : {}),
        });
      }
    } catch (err) {
      this.opts.onError?.(String(err));
    } finally {
      this.busy = false;
      this.opts.onChanged?.(this.history);
    }
  }

  private push(message: ChatMessage): void {
    this.history.push(message);
    // Keep memory bounded; the prompt only carries the recent window anyway.
    if (this.history.length > MAX_STORED_MESSAGES) {
      this.history = this.history.slice(-MAX_STORED_MESSAGES);
    }
    this.opts.store?.save(this.history);
    this.opts.onChanged?.(this.history);
  }
}
