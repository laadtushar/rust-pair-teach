import { describe, expect, it } from 'vitest';

import type { ActionCard, WorkspaceView } from '../src/core/action/types.js';
import { allDone, progress, verifySteps } from '../src/core/action/verify.js';

function workspace(files: Record<string, string>, commandsRun: string[] = []): WorkspaceView {
  return {
    exists: (p) => p in files,
    read: (p) => files[p] ?? null,
    commandsRun,
  };
}

const CARD: ActionCard = {
  title: 'Split the parser into its own module',
  rationale: 'main.rs is doing two jobs; separating them is what makes the borrow error obvious.',
  steps: [
    { id: 'create', instruction: 'Create src/parser.rs', check: { kind: 'file_exists', path: 'src/parser.rs' } },
    {
      id: 'declare',
      instruction: 'Add `mod parser;` to src/main.rs',
      check: { kind: 'file_contains', path: 'src/main.rs', pattern: '^\\s*mod parser;' },
    },
    { id: 'dep', instruction: 'Run `cargo add serde`', check: { kind: 'command_run', command: 'cargo add serde' } },
  ],
};

describe('step verification', () => {
  it('ticks a step once the file exists', () => {
    const statuses = verifySteps(CARD, workspace({ 'src/parser.rs': '' }));
    expect(statuses[0]!.done).toBe(true);
    expect(statuses[1]!.done).toBe(false);
  });

  it('ticks a step when the file contains what was asked for', () => {
    const statuses = verifySteps(
      CARD,
      workspace({ 'src/main.rs': 'mod parser;\n\nfn main() {}' })
    );
    expect(statuses[1]!.done).toBe(true);
  });

  it('does not tick on a near-miss inside a comment', () => {
    const statuses = verifySteps(
      CARD,
      workspace({ 'src/main.rs': '// mod parser; one day\nfn main() {}' })
    );
    expect(statuses[1]!.done).toBe(false);
  });

  it('ticks a command step once the learner has run it', () => {
    const statuses = verifySteps(CARD, workspace({}, ['cargo add serde']));
    expect(statuses[2]!.done).toBe(true);
  });

  it('survives a malformed pattern in a pack rather than crashing the lesson', () => {
    const broken: ActionCard = {
      ...CARD,
      steps: [
        {
          id: 'x',
          instruction: 'y',
          check: { kind: 'file_contains', path: 'a.rs', pattern: '([unclosed' },
        },
      ],
    };
    expect(() => verifySteps(broken, workspace({ 'a.rs': 'anything' }))).not.toThrow();
    expect(verifySteps(broken, workspace({ 'a.rs': 'anything' }))[0]!.done).toBe(false);
  });

  it('reports progress and completion', () => {
    const partial = verifySteps(CARD, workspace({ 'src/parser.rs': '' }));
    expect(progress(partial)).toEqual({ done: 1, total: 3 });
    expect(allDone(partial)).toBe(false);

    const complete = verifySteps(
      CARD,
      workspace({ 'src/parser.rs': '', 'src/main.rs': 'mod parser;' }, ['cargo add serde'])
    );
    expect(allDone(complete)).toBe(true);
  });

  it('is not complete when there are no steps at all', () => {
    expect(allDone([])).toBe(false);
  });
});
