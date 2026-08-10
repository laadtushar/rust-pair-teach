import { verifySteps } from './action/verify.js';
import type { StepStatus, WorkspaceView } from './action/types.js';
import type { Lesson } from './pack/lessonTypes.js';

/**
 * The guided course: an ordered path from "no Rust at all" to "I can write and test a program".
 *
 * The ambient tutor teaches what the learner happens to hit. This teaches what they have not hit
 * yet, which is the difference between a safety net and a curriculum. Both feed the same learner
 * model, because struggling inside a lesson is exactly as informative as struggling outside one.
 */

export interface CourseProgress {
  /** Lesson ids the learner has finished, in completion order. */
  completed: string[];
  /** Lesson currently open, if any. */
  current: string | null;
  startedAt: string | null;
}

export function emptyProgress(): CourseProgress {
  return { completed: [], current: null, startedAt: null };
}

export interface LessonState {
  lesson: Lesson;
  index: number;
  total: number;
  steps: StepStatus[];
  /** True when every step checks out — the lesson can be completed. */
  ready: boolean;
}

export class Course {
  constructor(
    private readonly lessons: Lesson[],
    private progress: CourseProgress
  ) {}

  get state(): CourseProgress {
    return this.progress;
  }

  get all(): readonly Lesson[] {
    return this.lessons;
  }

  isComplete(lessonId: string): boolean {
    return this.progress.completed.includes(lessonId);
  }

  /**
   * The lesson to show. Never null while lessons remain, because a course whose next step is
   * invisible is not guided.
   */
  nextLesson(): Lesson | null {
    if (this.progress.current) {
      const open = this.lessons.find((l) => l.id === this.progress.current);
      if (open) return open;
    }
    return this.lessons.find((l) => !this.isComplete(l.id)) ?? null;
  }

  /** Open a lesson explicitly — used by the lesson list, so learners can skip or revisit. */
  start(lessonId: string, nowIso: string): LessonState | null {
    const lesson = this.lessons.find((l) => l.id === lessonId);
    if (!lesson) return null;
    this.progress = {
      ...this.progress,
      current: lessonId,
      startedAt: this.progress.startedAt ?? nowIso,
    };
    return this.stateOf(lesson, emptyWorkspace);
  }

  /** Re-check the open lesson against the workspace. Called whenever files change. */
  refresh(workspace: WorkspaceView): LessonState | null {
    const lesson = this.nextLesson();
    return lesson ? this.stateOf(lesson, workspace) : null;
  }

  /**
   * Mark the open lesson done and move on.
   *
   * Deliberately allowed even when steps are unchecked: the checks are heuristics over file
   * contents, and a learner who genuinely finished should never be held hostage by a regex that
   * did not match. Being wrong in the direction of trusting the learner is the right way to be
   * wrong.
   */
  complete(lessonId: string): CourseProgress {
    if (!this.lessons.some((l) => l.id === lessonId)) return this.progress;
    const completed = this.progress.completed.includes(lessonId)
      ? this.progress.completed
      : [...this.progress.completed, lessonId];

    const next = this.lessons.find((l) => !completed.includes(l.id));
    this.progress = { ...this.progress, completed, current: next?.id ?? null };
    return this.progress;
  }

  /** How far through the course, for the sidebar header. */
  overall(): { done: number; total: number } {
    return { done: this.progress.completed.length, total: this.lessons.length };
  }

  private stateOf(lesson: Lesson, workspace: WorkspaceView): LessonState {
    const steps = verifySteps(
      { title: lesson.title, rationale: lesson.goal, steps: lesson.steps.map(toActionStep), scaffolds: [] },
      workspace
    );
    return {
      lesson,
      index: this.lessons.indexOf(lesson),
      total: this.lessons.length,
      steps,
      ready: steps.length > 0 && steps.every((s) => s.done),
    };
  }
}

function toActionStep(step: Lesson['steps'][number], i: number) {
  return { id: String(i), instruction: step.instruction, check: step.check };
}

const emptyWorkspace: WorkspaceView = {
  exists: () => false,
  read: () => null,
  commandsRun: [],
};
