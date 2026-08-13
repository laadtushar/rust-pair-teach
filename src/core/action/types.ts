/**
 * Steps a learner performs, and how to tell whether they did.
 *
 * The tutor describes structure and checks whether it appeared. It never creates it — that
 * capability was removed deliberately (Q1), because a tutor that can write files is one refactor
 * away from writing solutions, and nothing was calling it.
 */

export type StepCheck =
  | { kind: 'file_exists'; path: string }
  | { kind: 'file_contains'; path: string; pattern: string }
  | { kind: 'command_run'; command: string };

export interface ActionStep {
  id: string;
  /** What the learner is asked to do, in their words not the compiler's. */
  instruction: string;
  check: StepCheck;
}

export interface ActionCard {
  title: string;
  /** Why this structure is needed — a step without a reason is an order. */
  rationale: string;
  steps: ActionStep[];
}

export interface StepStatus {
  step: ActionStep;
  done: boolean;
}

/**
 * Read-only view of the workspace, injected so verification is testable without an editor.
 */
export interface WorkspaceView {
  exists(path: string): boolean;
  read(path: string): string | null;
  /** Commands the learner has run in the integrated terminal this session, if known. */
  commandsRun?: readonly string[];
}
