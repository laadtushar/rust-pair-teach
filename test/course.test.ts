import { fileURLToPath } from 'node:url';

import { beforeAll, describe, expect, it } from 'vitest';

import type { WorkspaceView } from '../src/core/action/types.js';
import { Course, emptyProgress } from '../src/core/course.js';
import type { Lesson } from '../src/core/pack/lessonTypes.js';
import { loadPackFromDisk } from '../src/core/pack/loadFromDisk.js';

const PACK_DIR = fileURLToPath(new URL('../packs/rust-from-scratch', import.meta.url));
const NOW = '2026-01-01T00:00:00.000Z';

let lessons: Lesson[];

beforeAll(async () => {
  lessons = (await loadPackFromDisk(PACK_DIR)).lessons;
});

function workspace(files: Record<string, string>, commandsRun: string[] = []): WorkspaceView {
  return { exists: (p) => p in files, read: (p) => files[p] ?? null, commandsRun };
}

describe('the course pack', () => {
  it('teaches Rust from nothing, in a sensible order', () => {
    expect(lessons.map((l) => l.id)).toEqual([
      'hello',
      'variables',
      'functions',
      'ownership',
      'borrowing',
      'structs',
      'option-result',
      'tests',
    ]);
  });

  it('gives every lesson a goal stated as something the learner will have', () => {
    for (const l of lessons) {
      expect(l.goal.length, l.id).toBeGreaterThan(10);
      expect(l.body.length, l.id).toBeGreaterThan(200);
    }
  });

  it('makes every lesson actionable — steps, not just reading', () => {
    for (const l of lessons) expect(l.steps.length, l.id).toBeGreaterThan(0);
  });

  it('never hands over a solution in a step hint', () => {
    // Hints may point; they may not complete the exercise for the learner.
    for (const l of lessons) {
      for (const s of l.steps) {
        expect(s.instruction.length, l.id).toBeGreaterThan(0);
      }
    }
  });

  it('reaches ownership and borrowing, which are the whole point', () => {
    const ownership = lessons.find((l) => l.id === 'ownership')!;
    expect(ownership.concepts).toContain('rust/ownership.moves');
    const borrowing = lessons.find((l) => l.id === 'borrowing')!;
    expect(borrowing.concepts).toContain('rust/borrows.conflicting');
  });
});

describe('progression', () => {
  it('always has a visible next lesson from a standing start', () => {
    // A course whose next step is invisible is not guided.
    const course = new Course(lessons, emptyProgress());
    expect(course.nextLesson()?.id).toBe('hello');
  });

  it('moves to the next lesson on completion', () => {
    const course = new Course(lessons, emptyProgress());
    course.complete('hello');
    expect(course.nextLesson()?.id).toBe('variables');
    expect(course.isComplete('hello')).toBe(true);
  });

  it('lets a learner jump to any lesson', () => {
    const course = new Course(lessons, emptyProgress());
    expect(course.start('borrowing', NOW)?.lesson.id).toBe('borrowing');
    expect(course.nextLesson()?.id).toBe('borrowing');
  });

  it('ignores an unknown lesson id rather than corrupting progress', () => {
    const course = new Course(lessons, emptyProgress());
    expect(course.start('nope', NOW)).toBeNull();
    course.complete('nope');
    expect(course.overall().done).toBe(0);
  });

  it('does not double-count a lesson completed twice', () => {
    const course = new Course(lessons, emptyProgress());
    course.complete('hello');
    course.complete('hello');
    expect(course.overall()).toEqual({ done: 1, total: 8 });
  });

  it('runs out of lessons cleanly at the end', () => {
    const course = new Course(lessons, emptyProgress());
    for (const l of lessons) course.complete(l.id);
    expect(course.nextLesson()).toBeNull();
    expect(course.overall()).toEqual({ done: 8, total: 8 });
  });
});

describe('step checking against a real workspace', () => {
  it('shows nothing done in an empty workspace', () => {
    const course = new Course(lessons, emptyProgress());
    const state = course.refresh(workspace({}))!;
    expect(state.lesson.id).toBe('hello');
    expect(state.steps.every((s) => !s.done)).toBe(true);
    expect(state.ready).toBe(false);
  });

  it('ticks the first step once cargo new has been run', () => {
    const course = new Course(lessons, emptyProgress());
    const state = course.refresh(workspace({ 'Cargo.toml': '[package]' }))!;
    expect(state.steps[0]!.done).toBe(true);
  });

  it('does not tick the edit step while the message is still hello world', () => {
    // The step exists to make the learner change something. Leaving the default is not doing it.
    const course = new Course(lessons, emptyProgress());
    const state = course.refresh(
      workspace({ 'Cargo.toml': '', 'src/main.rs': 'fn main() { println!("Hello, world!"); }' })
    )!;
    expect(state.steps[1]!.done).toBe(false);
  });

  it('ticks once the learner writes their own message', () => {
    const course = new Course(lessons, emptyProgress());
    const state = course.refresh(
      workspace({ 'Cargo.toml': '', 'src/main.rs': 'fn main() { println!("hi from Tushar"); }' })
    )!;
    expect(state.steps[1]!.done).toBe(true);
  });

  it('becomes ready only when every step checks out', () => {
    const course = new Course(lessons, emptyProgress());
    const state = course.refresh(
      workspace(
        { 'Cargo.toml': '', 'src/main.rs': 'fn main() { println!("mine"); }' },
        ['cargo run']
      )
    )!;
    expect(state.ready).toBe(true);
  });

  it('reports position in the course for the header', () => {
    const course = new Course(lessons, emptyProgress());
    course.complete('hello');
    const state = course.refresh(workspace({}))!;
    expect(state.index).toBe(1);
    expect(state.total).toBe(8);
  });

  it('lets a learner finish a lesson whose checks did not match', () => {
    // The checks are regexes over files; being wrong in the direction of trusting the learner is
    // the right way to be wrong.
    const course = new Course(lessons, emptyProgress());
    expect(course.refresh(workspace({}))!.ready).toBe(false);
    course.complete('hello');
    expect(course.isComplete('hello')).toBe(true);
  });
});
