import type { ScaffoldFile } from './types.js';

export interface SkeletonItem {
  /** e.g. `pub fn parse(input: &str) -> Result<Config, ParseError>` */
  signature: string;
  /** What the learner should make this do. A prompt, never an implementation. */
  intent: string;
}

export interface SkeletonSpec {
  path: string;
  /** Why this file exists at all. */
  purpose: string;
  items: SkeletonItem[];
}

const HEADER = (purpose: string): string =>
  `//! ${purpose}
//!
//! Scaffolded by Rust Pair Teacher. Every body below is \`todo!()\` on purpose — filling them in
//! is the exercise, and the shape of the file is the only part worth handing you.
`;

/**
 * Build a file that describes work without doing it.
 *
 * Signatures, doc comments and `todo!()` markers only. This is the narrow exception to "never
 * writes code", and it stays narrow because `generatedIsSkeletonOnly` below can prove it.
 */
export function generateSkeleton(spec: SkeletonSpec): ScaffoldFile {
  const body = spec.items
    .map(
      (item) => `
/// ${item.intent}
${item.signature} {
    todo!("${escapeForRustString(item.intent)}")
}`
    )
    .join('\n');

  return { path: spec.path, contents: `${HEADER(spec.purpose)}${body}\n` };
}

export interface SkeletonVerdict {
  ok: boolean;
  reason?: string;
}

/**
 * Prove a generated file contains no implementation.
 *
 * This is the contributor bright line as an executable check. Every PR that touches scaffolding
 * will feel pressure to emit "just a little" real code — one helper, one obvious `let` binding —
 * and that pressure is exactly what this product exists to resist. A rule enforced by review
 * erodes; a rule enforced by a test does not.
 *
 * The check: every brace-delimited body must contain nothing but a `todo!(...)` call.
 */
export function generatedIsSkeletonOnly(contents: string): SkeletonVerdict {
  const withoutComments = contents
    .split('\n')
    .filter((l) => !l.trimStart().startsWith('//'))
    .join('\n');

  let depth = 0;
  let body = '';
  for (const ch of withoutComments) {
    if (ch === '{') {
      depth++;
      if (depth === 1) {
        body = '';
        continue;
      }
    }
    if (ch === '}') {
      depth--;
      if (depth === 0) {
        const verdict = bodyIsTodo(body);
        if (!verdict.ok) return verdict;
        continue;
      }
    }
    if (depth >= 1) body += ch;
  }

  if (depth !== 0) return { ok: false, reason: 'unbalanced braces in generated file' };
  return { ok: true };
}

function bodyIsTodo(body: string): SkeletonVerdict {
  const trimmed = body.trim();
  if (trimmed === '') return { ok: true };
  if (/^todo!\((?:[^()]*)\);?$/s.test(trimmed)) return { ok: true };
  return {
    ok: false,
    reason: `generated body is not a bare todo!(): ${JSON.stringify(trimmed.slice(0, 60))}`,
  };
}

function escapeForRustString(s: string): string {
  return s.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
}
