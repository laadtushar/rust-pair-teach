import type { ActionCard, ActionStep, StepStatus, WorkspaceView } from './types.js';

/**
 * Check which steps the learner has completed.
 *
 * The live checkmark is itself a teaching device: it confirms that what the learner did and what
 * the teacher meant are the same thing. A step that silently never ticks is worse than no step at
 * all, so checks are deliberately loose about *how* something was done and strict about *whether*
 * it exists.
 */
export function verifySteps(card: ActionCard, workspace: WorkspaceView): StepStatus[] {
  return card.steps.map((step) => ({ step, done: isDone(step, workspace) }));
}

function isDone(step: ActionStep, workspace: WorkspaceView): boolean {
  const check = step.check;
  switch (check.kind) {
    case 'file_exists':
      return workspace.exists(check.path);

    case 'file_contains': {
      const contents = workspace.read(check.path);
      if (contents === null) return false;
      try {
        return new RegExp(check.pattern).test(contents);
      } catch {
        // A malformed pattern in a pack must not crash the lesson.
        return false;
      }
    }

    case 'command_run':
      return (workspace.commandsRun ?? []).some((c) => c.trim() === check.command.trim());
  }
}

export function allDone(statuses: StepStatus[]): boolean {
  return statuses.length > 0 && statuses.every((s) => s.done);
}

/** How far along, for the sidebar's progress line. */
export function progress(statuses: StepStatus[]): { done: number; total: number } {
  return { done: statuses.filter((s) => s.done).length, total: statuses.length };
}
