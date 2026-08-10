import type { Hint } from './lesson/staticHint.js';
import type { ActiveLesson } from './session.js';

/**
 * What the sidebar shows, computed in core so it can be tested without a webview.
 *
 * Keeping this out of the rendering layer is not ceremony: "is the next-hint button available"
 * encodes the ladder rule, and the ladder rule is the product.
 */
export interface LessonView {
  conceptTitle: string;
  /** Every rung shown so far, oldest first — the trail, not just the latest. */
  hints: Array<{ level: 1 | 2 | 3; text: string; offline: boolean }>;
  currentLevel: 1 | 2 | 3;
  /** Label for the escalate button, or null when the ladder is exhausted. */
  nextStep: string | null;
  explainCommand: string | null;
  /** Shown when any hint came from the pack rather than a model. */
  offlineNotice: string | null;
}

const NEXT_LABEL: Record<1 | 2, string> = {
  1: 'Another nudge',
  2: 'Show me a worked example',
};

export function lessonView(lesson: ActiveLesson): LessonView {
  const anyOffline = lesson.hints.some((h) => h.offline);
  const last = lesson.hints[lesson.hints.length - 1];

  return {
    conceptTitle: lesson.concept.title,
    hints: lesson.hints.map((h) => ({ level: h.level, text: h.text, offline: h.offline })),
    currentLevel: lesson.level,
    nextStep: lesson.level < 3 ? NEXT_LABEL[lesson.level as 1 | 2] : null,
    explainCommand: explainOf(last),
    offlineNotice: anyOffline
      ? 'Taught from the built-in material — no model was called for this.'
      : null,
  };
}

function explainOf(hint: Hint | undefined): string | null {
  return hint?.explainCommand ?? null;
}
