import type { DiagnosticSignature } from './types.js';

const RUST_ERROR_CODE = /^E\d{4}$/;

/**
 * Collapse a diagnostic message into a stable shape.
 *
 * Learner-specific detail — variable names, types, paths, line numbers — is exactly what makes two
 * occurrences of the *same* mistake look different, so it is stripped. What survives is the
 * skeleton of the complaint, which is what a concept lookup and a cache key actually want.
 *
 * This path is what makes codeless languages (Python, Go, Ruby) possible at all; Rust rarely needs
 * it, since rustc gives us a code.
 */
export function normalizeMessage(message: string): string {
  return message
    .split('\n')[0]!
    .replace(/`[^`]*`/g, '<id>')
    .replace(/'[^']*'/g, '<id>')
    .replace(/"[^"]*"/g, '<id>')
    .replace(/\b\d+\b/g, '<n>')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase()
    .slice(0, 200);
}

/**
 * Normalize a raw diagnostic into a signature.
 *
 * `code` is whatever the language server gave us — for rust-analyzer that is usually `E0382`, but
 * it can also be a clippy lint name or nothing at all.
 */
export function toSignature(
  language: string,
  code: string | undefined,
  message: string
): DiagnosticSignature {
  if (code && RUST_ERROR_CODE.test(code)) {
    return { kind: 'code', language, value: code };
  }
  if (code && code.trim() !== '') {
    // Named lints (clippy::needless_range_loop, TS2345) are stable identifiers too.
    return { kind: 'code', language, value: code.trim() };
  }
  return { kind: 'pattern', language, value: normalizeMessage(message) };
}

/** The seven borrow-checker codes the first chapter pack teaches. */
export const CORE_BORROW_CODES = [
  'E0382',
  'E0499',
  'E0502',
  'E0505',
  'E0515',
  'E0597',
  'E0716',
] as const;
