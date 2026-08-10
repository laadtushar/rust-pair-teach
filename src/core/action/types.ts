/**
 * Guided scaffolding (F7).
 *
 * Some lessons need structure — a module file, a test file, a `cargo add`. The teacher may build
 * that classroom. It may never write the essay.
 *
 * Concretely: file bodies are `todo!()` and nothing else, every operation is previewed, and the
 * default path is the learner doing it themselves with the watcher confirming each step. The
 * "do it for me" path exists so multi-file chores are not tedious, not so the work gets done for
 * anyone.
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
  /** Files the "do it for me" path would create. Skeletons only. */
  scaffolds: ScaffoldFile[];
}

export interface ScaffoldFile {
  path: string;
  contents: string;
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
