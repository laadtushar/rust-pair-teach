import type { ConceptEntry } from '../pack/types.js';
import type { ProviderAdapter } from '../provider/types.js';
import { parseHintResponse, REPAIR_INSTRUCTION } from './contract.js';
import { buildPrompt, type Message, type PromptInput } from './prompt.js';
import { checkHintRespectsLadder, checkLevelOneAsks } from './refusal.js';
import { staticHint, type Hint, type HintLevel } from './staticHint.js';

export interface EngineOptions {
  provider?: ProviderAdapter;
  model: string;
  maxTokens?: number;
  timeoutMs?: number;
  /** Reports why a hint fell back, for the conformance matrix and for local debugging. */
  onDegraded?: (reason: string) => void;
}

export interface LessonRequest extends Omit<PromptInput, 'level'> {
  level: HintLevel;
  encounters?: number;
}

/**
 * Turns a teachable moment into a hint.
 *
 * The design rule this encodes: there is always a hint. A missing key, a dead network, a model that
 * returns prose, a model that tries to hand over the answer — every one of those degrades to the
 * pack's own teaching rather than to an error message or a spinner. The learner is mid-struggle;
 * that is the worst possible moment to show them a stack trace.
 */
export class LessonEngine {
  constructor(private opts: EngineOptions) {}

  async hint(req: LessonRequest): Promise<Hint> {
    const fallback = (reason: string): Hint => {
      this.opts.onDegraded?.(reason);
      return staticHint(req.concept, req.level, {
        ...(req.signature ? { signature: req.signature } : {}),
        ...(req.encounters !== undefined ? { encounters: req.encounters } : {}),
      });
    };

    if (!this.opts.provider) return fallback('no provider configured');

    const messages = buildPrompt(req);
    const callOpts = {
      model: this.opts.model,
      maxTokens: this.opts.maxTokens ?? 400,
      timeoutMs: this.opts.timeoutMs ?? 5_000,
    };

    let raw: string;
    try {
      raw = (await this.opts.provider.complete(messages, callOpts)).text;
    } catch (err) {
      return fallback(`provider failed: ${String(err)}`);
    }

    let parsed = parseHintResponse(raw, req.level);

    // One repair retry, then stop. A model that cannot produce a small JSON object twice in a row
    // is not going to on the third attempt, and the learner is waiting.
    if (!parsed.ok && parsed.repairable) {
      const repairMessages: Message[] = [
        ...messages,
        { role: 'user', content: REPAIR_INSTRUCTION },
      ];
      try {
        const retry = (await this.opts.provider.complete(repairMessages, callOpts)).text;
        parsed = parseHintResponse(retry, req.level);
      } catch (err) {
        return fallback(`repair attempt failed: ${String(err)}`);
      }
    }

    if (!parsed.ok) return fallback(`unusable response: ${parsed.reason}`);

    // The bright line is enforced here, on the way out, regardless of which model produced it.
    const ladder = checkHintRespectsLadder(parsed.value.text, req.level);
    if (!ladder.ok) return fallback(`refused: ${ladder.reason ?? 'ladder violation'}`);

    if (req.level === 1) {
      const asks = checkLevelOneAsks(parsed.value.text);
      if (!asks.ok) return fallback(`refused: ${asks.reason ?? 'not a question'}`);
    }

    return {
      level: req.level,
      conceptId: req.concept.id,
      text: parsed.value.text,
      offline: false,
      ...explain(req.concept, req),
    };
  }
}

function explain(_concept: ConceptEntry, req: LessonRequest): { explainCommand?: string } {
  const sig = req.signature;
  if (sig?.kind === 'code' && /^E\d{4}$/.test(sig.value)) {
    return { explainCommand: `rustc --explain ${sig.value}` };
  }
  return {};
}
