import type { Message } from '../lesson/prompt.js';
import type { ChatContext, ChatMessage, ProactiveReason } from './types.js';

/** How many turns of history travel with each request. */
const HISTORY_TURNS = 12;

const PERSONA = `You are a Rust tutor sitting next to a beginner, talking with them while they work.

How you talk:
- Warm, direct, and brief. Two or three sentences most of the time. This is a conversation in a
  narrow sidebar, not an article.
- Always leave them with one concrete thing to do next. End on the action, not on a summary.
- React to what actually changed in their code. If they just fixed something, say so before moving
  on. Noticing is most of what a good teacher does.
- Ask when you are unsure what they meant. You are allowed to say "which of these did you mean?"

The one hard rule: you do not write their code for them.
- You may show a tiny illustrative snippet of a DIFFERENT example — two or three lines at most.
- You never write the line they are currently trying to write, and never paste a fix they can copy.
- When they ask you to just give them the answer, give them the next question instead, or the
  smallest possible piece of the shape and let them fill it in. Say plainly that they will remember
  it if they type it.
- If they are truly stuck after several attempts, narrow it down to one line and tell them exactly
  what to think about on that line — still not what to type.

You are teaching Rust to someone who may be new to it entirely. Assume nothing, explain the why,
and never make them feel slow for asking.`;

const REASON_PROMPTS: Record<ProactiveReason, string> = {
  session_start:
    'The learner just opened the editor. Greet them briefly, say what you can see about where they are, and give them one thing to do to get started.',
  lesson_opened:
    'They just opened this lesson. In two or three sentences, say what they are about to build and why it matters, then tell them the very first thing to do.',
  step_completed:
    'They just completed a step. Acknowledge it specifically — say what they actually did — then point them at the next one.',
  lesson_completed:
    'They just finished the lesson. Say briefly what they now know how to do, then offer the next lesson.',
  new_error:
    'A new compiler error just appeared in their code. Do not tell them the fix. Point them at what the compiler is trying to say, and ask a question that makes them look at the right line.',
  stuck:
    'They have been on the same error for a while. Narrow it down: tell them which single line to look at and what to think about there. Still do not write the fix.',
};

function describeContext(ctx: ChatContext): string {
  const parts: string[] = [];

  // Without a folder every lesson step reads as incomplete, so say so rather than let the tutor
  // confidently discuss a project that does not exist.
  if (ctx.noWorkspace) {
    parts.push(
      'IMPORTANT: no folder is open in the editor, so there is no project yet and no step can be checked. Before anything else, walk them through opening a folder and running `cargo new`.'
    );
  }

  if (ctx.lessonTitle) {
    parts.push(`Current lesson: ${ctx.lessonTitle}${ctx.lessonGoal ? ` — ${ctx.lessonGoal}` : ''}`);
  }
  if (ctx.steps?.length) {
    parts.push(
      'Steps:\n' +
        ctx.steps.map((s) => `  [${s.done ? 'x' : ' '}] ${s.instruction}`).join('\n')
    );
  }
  if (ctx.errors?.length) {
    parts.push(`Compiler errors right now:\n${ctx.errors.map((e) => `  - ${e}`).join('\n')}`);
  } else if (ctx.code) {
    parts.push('Their code currently compiles.');
  }
  if (ctx.code) {
    parts.push(`Their code${ctx.fileName ? ` (${ctx.fileName})` : ''}:\n${ctx.code}`);
  }
  if (ctx.learnerSummary) parts.push(`About this learner: ${ctx.learnerSummary}`);

  return parts.length > 0 ? parts.join('\n\n') : 'No project open yet.';
}

/**
 * Build the request for one conversational turn.
 *
 * Context is rebuilt every time rather than accumulated in the history, so the tutor is always
 * reacting to the code as it is now. A chat that remembers a stale version of your file is worse
 * than one with no memory at all.
 */
export function buildChatPrompt(
  history: ChatMessage[],
  ctx: ChatContext,
  proactive?: ProactiveReason
): Message[] {
  const system = [PERSONA, '', '--- What you can see right now ---', describeContext(ctx)].join(
    '\n'
  );

  const messages: Message[] = [{ role: 'system', content: system }];
  const recent = history.slice(-HISTORY_TURNS);

  for (const m of recent) {
    messages.push({
      role: m.speaker === 'learner' ? 'user' : 'system',
      content: m.speaker === 'learner' ? m.text : `(you said) ${m.text}`,
    });
  }

  if (proactive) {
    messages.push({ role: 'user', content: `[${REASON_PROMPTS[proactive]}]` });
  }

  return messages;
}

/**
 * Keep a tutor reply from becoming a copy-paste answer.
 *
 * The persona forbids it, and models mostly comply — but "mostly" is not a guarantee, and the one
 * thing this product promises is that it will not write your code. Short illustrative snippets are
 * allowed through; anything long enough to be a solution is replaced by a nudge.
 */
export function limitCodeInReply(text: string, maxLines = 3): { text: string; redacted: boolean } {
  let redacted = false;

  const out = text.replace(/```[a-z]*\n([\s\S]*?)```/g, (whole, body: string) => {
    const lines = body.trimEnd().split('\n').filter((l) => l.trim() !== '');
    if (lines.length <= maxLines) return whole;
    redacted = true;
    return '_(I started writing that out for you — but you will remember it far better if you type it. Ask me about any single line of it.)_';
  });

  return { text: out, redacted };
}


/**
 * Hide a code fence that has not finished arriving.
 *
 * Mid-stream, an opened ``` with no closing pair would render as a code block containing whatever
 * has been typed so far — which looks exactly like a complete answer for as long as it takes the
 * rest to arrive. Better to withhold the partial block than to flash a plausible-looking solution.
 */
export function maskIncompleteFence(partial: string): string {
  const fences = (partial.match(/```/g) ?? []).length;
  if (fences % 2 === 0) return partial;
  const lastOpen = partial.lastIndexOf('```');
  return partial.slice(0, lastOpen).trimEnd() + '\n\n…';
}

export interface PromptLimits {
  /** Rough ceiling on the whole request. Characters, not tokens — see the note below. */
  maxChars: number;
}

export interface FittedPrompt {
  messages: Message[];
  /** What had to be given up to fit, in the order it was dropped. */
  degradations: string[];
}

/**
 * Build a prompt that fits (B5).
 *
 * Characters rather than tokens on purpose: a real tokenizer is a large dependency for a bound that
 * only needs to be roughly right, and every provider tokenizes differently anyway. Four characters
 * per token is the usual rule of thumb, so a 4k-context model is served by roughly 12k characters
 * once the reply is allowed for.
 *
 * The order of sacrifice matters and is deliberate: older conversation goes first because the code
 * in front of the learner is what the tutor is actually discussing.
 */
export function fitChatPrompt(
  history: ChatMessage[],
  ctx: ChatContext,
  proactive: ProactiveReason | undefined,
  limits: PromptLimits
): FittedPrompt {
  const degradations: string[] = [];
  const size = (m: Message[]): number => m.reduce((n, x) => n + x.content.length, 0);

  let turns = history.slice(-HISTORY_TURNS);
  let messages = buildChatPrompt(turns, ctx, proactive);
  if (size(messages) <= limits.maxChars) return { messages, degradations };

  // 1. Drop the oldest turns.
  while (turns.length > 0 && size(messages) > limits.maxChars) {
    turns = turns.slice(1);
    messages = buildChatPrompt(turns, ctx, proactive);
  }
  if (turns.length < Math.min(history.length, HISTORY_TURNS)) {
    degradations.push('dropped older conversation');
  }
  if (size(messages) <= limits.maxChars) return { messages, degradations };

  // 2. Narrow the code region.
  if (ctx.code) {
    const lines = ctx.code.split('\n');
    let keep = Math.max(4, Math.floor(lines.length / 2));
    let narrowed = ctx;
    while (keep >= 4) {
      narrowed = { ...ctx, code: lines.slice(0, keep).join('\n') };
      messages = buildChatPrompt(turns, narrowed, proactive);
      if (size(messages) <= limits.maxChars) break;
      keep = Math.floor(keep / 2);
    }
    degradations.push('narrowed the code region');
  }

  // 3. Nothing left to give. Send it and say so, rather than silently truncating at the provider.
  if (size(messages) > limits.maxChars) {
    degradations.push('still over the limit — the model may truncate');
  }
  return { messages, degradations };
}
