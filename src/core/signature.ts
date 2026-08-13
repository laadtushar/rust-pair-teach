import type { ChapterPack } from './pack/types.js';
import type { DiagnosticSignature } from './types.js';

const RUST_ERROR_CODE = /^E\d{4}$/;

/**
 * Collapse a diagnostic message into a stable shape.
 *
 * Learner-specific detail — variable names, types, paths, line numbers — is exactly what makes two
 * occurrences of the *same* mistake look different, so it is stripped. What survives is the
 * skeleton of the complaint, which is what a concept lookup and a cache key actually want.
 *
 * This is the fallback for a message no pack claims. When a pack *does* claim it, the pattern the
 * pack declared becomes the signature instead — see `SignatureResolver`.
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
 * Normalize a raw diagnostic into a signature, knowing nothing about any pack.
 *
 * `code` is whatever the language server gave us — for rust-analyzer that is usually `E0382`, but
 * it can also be a clippy lint name or nothing at all.
 *
 * For a language that has codes this is the whole story. For a language that does not, the result
 * is a normalized message, which is stable enough for cooldowns and novelty but will not match a
 * concept: see `SignatureResolver`, which is what the extension actually uses.
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

interface PatternRule {
  language: string;
  /** The pack's declared pattern, verbatim — this becomes the signature value on a match. */
  value: string;
  regex: RegExp;
}

/**
 * Every form a language server might put in `Diagnostic.code`, most specific first.
 *
 * The `:` split is not speculative. `microsoft/vscode-pylint` builds its diagnostics with
 * `code=f"{msg_id}:{data.get('symbol')}"`, so a pylint diagnostic arrives as
 * `E0601:used-before-assignment` — a string no pack author would think to declare, and which
 * matches neither the id nor the symbol on its own. Ruff sends `F823`, Pylance sends
 * `reportUnboundVariable`; both are already single tokens and split to themselves.
 */
export function codeCandidates(code: string): string[] {
  const raw = code.trim();
  if (raw === '') return [];
  const parts = raw
    .split(':')
    .map((p) => p.trim())
    .filter((p) => p !== '' && p !== raw);
  return [raw, ...parts];
}

/**
 * Turns a raw diagnostic into the signature the packs actually key on.
 *
 * Without this, `kind: 'pattern'` was decoration. A pack declared a regex
 * (`^local variable '\w+' referenced before assignment$`), the detector produced a normalized
 * message (`local variable <id> referenced before assignment`), and the concept index — an exact
 * map — could never bring the two together. Every codeless language silently taught nothing.
 *
 * The fix is to resolve *before* keying rather than to match at lookup time. A message a pack
 * claims takes the pack's own pattern as its signature, so it is one stable string for concept
 * lookup, cooldowns, novelty and episode records alike. A message nobody claims still gets a
 * normalized signature, so the detector's timing heuristics keep working on errors we cannot teach.
 */
export class SignatureResolver {
  private rules: PatternRule[] = [];
  /** `language/value` for every code any pack claims. */
  private codes = new Set<string>();

  /**
   * Compile what the loaded packs claim.
   *
   * A malformed regex in a downloaded pack disables that one rule and is reported, rather than
   * throwing — one bad pattern must not take the other languages' teaching down with it.
   */
  constructor(packs: readonly ChapterPack[], onInvalid?: (pattern: string, err: string) => void) {
    for (const pack of packs) {
      for (const concept of pack.concepts) {
        for (const sig of concept.signatures) {
          if (sig.kind === 'code') {
            this.codes.add(`${sig.language}/${sig.value}`);
            continue;
          }
          try {
            this.rules.push({
              language: sig.language,
              value: sig.value,
              regex: new RegExp(sig.value, 'i'),
            });
          } catch (err) {
            onInvalid?.(sig.value, String(err));
          }
        }
      }
    }
  }

  /** How many message patterns are live. Zero for a Rust-only install, which is fine. */
  get size(): number {
    return this.rules.length;
  }

  /**
   * Turn a raw diagnostic into the signature the packs key on.
   *
   * The order is the whole design. A code a pack claims wins, because it is the most stable
   * identifier any analyzer offers. Failing that, the message is tried against the patterns —
   * which is what rescues a *generic* rule with a *specific* message, the shape Pylance produces
   * constantly (`reportAttributeAccessIssue` fires for typos and for `None` alike, but only one of
   * them says `for class "None"`). Failing both, the bare code or normalized message keeps
   * cooldowns and novelty working on an error nobody can teach.
   */
  resolve(language: string, code: string | undefined, message: string): DiagnosticSignature {
    if (code !== undefined) {
      for (const candidate of codeCandidates(code)) {
        if (this.codes.has(`${language}/${candidate}`)) {
          return { kind: 'code', language, value: candidate };
        }
      }
    }

    // Patterns are authored against what the analyzer actually prints, not against the normalized
    // form — asking pack authors to write regexes over `<id>` placeholders would be a trap.
    const first = message.split('\n')[0]!.trim();
    for (const rule of this.rules) {
      if (rule.language !== language) continue;
      if (rule.regex.test(first)) {
        return { kind: 'pattern', language, value: rule.value };
      }
    }

    return toSignature(language, code, message);
  }
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
