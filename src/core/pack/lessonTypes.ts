import type { StepCheck } from '../action/types.js';

/**
 * A lesson is a guided path to a working program the learner wrote themselves.
 *
 * Same rule as everywhere else: the lesson describes what to build and checks whether it exists.
 * It never contains the answer. Steps are declarative data, evaluated by the same machinery that
 * watches free-form code — a lesson is just a teachable moment we saw coming.
 */
export interface LessonStep {
  instruction: string;
  /** Optional nudge shown only if the learner asks — still not the answer. */
  hint?: string;
  check: StepCheck;
}

export interface Lesson {
  id: string;
  title: string;
  /** One line: what the learner will have when this is done. */
  goal: string;
  /** Concept ids this lesson exercises, for the learner model. */
  concepts: string[];
  /** The teaching narrative, in markdown. */
  body: string;
  steps: LessonStep[];
}
