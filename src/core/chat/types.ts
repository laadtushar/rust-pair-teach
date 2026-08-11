export type Speaker = 'tutor' | 'learner';

export interface ChatMessage {
  speaker: Speaker;
  text: string;
  at: number;
  /** True when the tutor spoke without being asked. */
  proactive?: boolean;
}

/**
 * What the tutor can see when it speaks.
 *
 * Assembled fresh for every turn rather than accumulated, so the tutor is always talking about the
 * code as it is now — not as it was fifteen messages ago.
 */
export interface ChatContext {
  /** Lesson title and goal, when a course lesson is open. */
  lessonTitle?: string;
  lessonGoal?: string;
  /** Steps with their done state, so the tutor knows what is left. */
  steps?: Array<{ instruction: string; done: boolean }>;
  /** The file the learner is looking at. */
  fileName?: string;
  /** The relevant region of their code — never the whole file. */
  code?: string;
  /** Current compiler errors, most important first. */
  errors?: string[];
  /** Two-line summary from the learner model. */
  learnerSummary?: string;
}

/** Why the tutor is about to speak unprompted. */
export type ProactiveReason =
  | 'session_start'
  | 'lesson_opened'
  | 'step_completed'
  | 'lesson_completed'
  | 'new_error'
  | 'stuck';
