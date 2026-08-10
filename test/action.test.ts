import { describe, expect, it } from 'vitest';

import {
  generateSkeleton,
  generatedIsSkeletonOnly,
  type SkeletonSpec,
} from '../src/core/action/skeleton.js';
import type { ActionCard, WorkspaceView } from '../src/core/action/types.js';
import { allDone, progress, verifySteps } from '../src/core/action/verify.js';

const SPEC: SkeletonSpec = {
  path: 'src/parser.rs',
  purpose: 'Turns raw config text into a Config, or explains why it cannot.',
  items: [
    {
      signature: 'pub fn parse(input: &str) -> Result<Config, ParseError>',
      intent: 'Parse one key=value per line, ignoring blanks and # comments',
    },
    {
      signature: 'fn parse_line(line: &str) -> Option<(String, String)>',
      intent: 'Split a single line into its key and value',
    },
  ],
};

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
  scaffolds: [],
};

describe('skeleton generation', () => {
  it('produces only todo!() bodies', () => {
    const file = generateSkeleton(SPEC);
    expect(generatedIsSkeletonOnly(file.contents).ok).toBe(true);
    expect(file.contents).toContain('pub fn parse(input: &str) -> Result<Config, ParseError>');
    expect(file.contents).toContain('todo!(');
  });

  it('explains why the file exists, so a step is not just an order', () => {
    expect(generateSkeleton(SPEC).contents).toContain('Turns raw config text into a Config');
  });

  it('carries the intent into the todo so the learner knows what to write', () => {
    expect(generateSkeleton(SPEC).contents).toContain('Parse one key=value per line');
  });

  it('escapes quotes rather than emitting broken Rust', () => {
    const file = generateSkeleton({
      path: 'a.rs',
      purpose: 'x',
      items: [{ signature: 'fn f()', intent: 'handle the "quoted" case' }],
    });
    expect(file.contents).toContain('\\"quoted\\"');
    expect(generatedIsSkeletonOnly(file.contents).ok).toBe(true);
  });
});

describe('the bright line, as an executable check', () => {
  it('accepts an empty body', () => {
    expect(generatedIsSkeletonOnly('fn f() {}').ok).toBe(true);
  });

  it('rejects a real implementation', () => {
    // This is the check that has to survive every future PR arguing for "just a little" code.
    const verdict = generatedIsSkeletonOnly('fn f() -> i32 {\n    let x = 1;\n    x + 1\n}');
    expect(verdict.ok).toBe(false);
    expect(verdict.reason).toMatch(/not a bare todo/);
  });

  it('rejects a body that does something before the todo', () => {
    expect(
      generatedIsSkeletonOnly('fn f() {\n    let cheat = 5;\n    todo!()\n}').ok
    ).toBe(false);
  });

  it('is not fooled by a comment claiming it is a todo', () => {
    expect(generatedIsSkeletonOnly('fn f() {\n    // todo!()\n    do_work();\n}').ok).toBe(false);
  });

  it('ignores commented-out code entirely', () => {
    expect(generatedIsSkeletonOnly('// fn g() { let x = 1; }\nfn f() { todo!() }').ok).toBe(true);
  });

  it('catches unbalanced braces rather than passing them silently', () => {
    expect(generatedIsSkeletonOnly('fn f() { todo!()').ok).toBe(false);
  });
});

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
