import type { Hint } from './lesson/staticHint.js';
import type { LessonState } from './course.js';
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

// ---------------------------------------------------------------------------
// Course view
// ---------------------------------------------------------------------------


export interface CourseStepView {
  instruction: string;
  hint: string | null;
  done: boolean;
}

export interface CourseView {
  kind: 'course';
  lessonTitle: string;
  goal: string;
  /** Teaching narrative, markdown. */
  body: string;
  position: string;
  steps: CourseStepView[];
  ready: boolean;
  /** Null on the last lesson. */
  nextLabel: string | null;
}

export interface CourseMenuView {
  kind: 'menu';
  heading: string;
  subheading: string;
  progress: { done: number; total: number };
  lessons: Array<{ id: string; title: string; goal: string; done: boolean; current: boolean }>;
  /** Shown when no model is configured — the course works regardless. */
  setupNotice: string | null;
}

export function courseView(state: LessonState, hints: Array<string | undefined>): CourseView {
  return {
    kind: 'course',
    lessonTitle: state.lesson.title,
    goal: state.lesson.goal,
    body: state.lesson.body,
    position: `Lesson ${String(state.index + 1)} of ${String(state.total)}`,
    steps: state.steps.map((s, i) => ({
      instruction: s.step.instruction,
      hint: hints[i] ?? null,
      done: s.done,
    })),
    ready: state.ready,
    nextLabel: state.index + 1 < state.total ? 'Mark done and continue' : 'Finish the course',
  };
}
