/**
 * The bright line, as an assertion.
 *
 * "The teacher may build the classroom, never write the essay" is the product's central promise, and
 * a promise defended only by code review erodes one well-meaning PR at a time. So it is checked.
 *
 * Scope matters here. This guards *model-generated* text, not pack content. Concept entries are
 * authored and reviewed by a human and legitimately contain illustrative snippets; a level-3 worked
 * example is supposed to show code. What must never happen is a model handing back a working fix at
 * level 1 or 2, where the learner is meant to be thinking.
 */

const FENCED_BLOCK = /```[\s\S]*?```/;
/** Rust constructs that only appear in something you could paste and compile. */
const SOLUTION_SHAPED = [
  /\bfn\s+\w+\s*\([^)]*\)\s*(->[^{]+)?\{/, // a function definition with a body
  /\blet\s+\w+\s*(:[^=]+)?=\s*[^;]+;/, // a complete binding statement
  /\bimpl\s+\w+/,
];

export interface RefusalVerdict {
  ok: boolean;
  reason?: string;
}

/**
 * Would this hint hand the learner the answer?
 *
 * Levels 1 and 2 must contain no code the learner could paste. Level 3 is the worked example and is
 * exempt by design — the ladder exists so that reaching code is a deliberate choice the learner
 * clicked through to, not the default.
 */
export function checkHintRespectsLadder(text: string, level: 1 | 2 | 3): RefusalVerdict {
  if (level === 3) return { ok: true };

  if (FENCED_BLOCK.test(text)) {
    return { ok: false, reason: `level ${level} hint contains a fenced code block` };
  }
  for (const pattern of SOLUTION_SHAPED) {
    if (pattern.test(text)) {
      return {
        ok: false,
        reason: `level ${level} hint contains solution-shaped code (${String(pattern)})`,
      };
    }
  }
  return { ok: true };
}

/**
 * A level-1 hint should ask, not tell.
 *
 * Weak models drift into explaining when asked to question, and the drift is gradual enough that
 * nobody notices until the tutor has quietly become a chatbot.
 */
export function checkLevelOneAsks(text: string): RefusalVerdict {
  if (!text.includes('?')) {
    return { ok: false, reason: 'level 1 hint is not a question' };
  }
  return { ok: true };
}
