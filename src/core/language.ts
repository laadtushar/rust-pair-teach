import type { DiagnosticSignature } from './types.js';

/**
 * The small per-language table the design doc promised, built when a second language arrived.
 *
 * Deliberately not a `LanguageProvider` plugin interface. Two languages do not justify one, and an
 * abstraction written before the second language exists is wrong in exactly the ways the second
 * language would have revealed. What is here is what Python actually needed and nothing else:
 * which editor language ids to watch, and whether the compiler can explain itself.
 *
 * Everything genuinely hard — the detector's timing heuristics, the learner model, the interruption
 * budget, the conversation — is language-neutral already and stays out of this file. If a third
 * language needs to change any of those, the abstraction is drawn in the wrong place.
 */
export interface LanguageSupport {
  /** The pack namespace and the `language` field in `chapter.toml`. */
  id: string;
  /** Editor language ids that count as this language. */
  editorIds: readonly string[];
  /** Shown to the learner so they can read the compiler's own words, when it has any. */
  explainCommand?: (signature: DiagnosticSignature) => string | undefined;
}

const RUST_ERROR_CODE = /^E\d{4}$/;

export const LANGUAGES: readonly LanguageSupport[] = [
  {
    id: 'rust',
    editorIds: ['rust'],
    explainCommand: (sig) =>
      sig.kind === 'code' && RUST_ERROR_CODE.test(sig.value)
        ? `rustc --explain ${sig.value}`
        : undefined,
  },
  {
    id: 'python',
    editorIds: ['python'],
    // Python has nothing like `rustc --explain`. Saying so is better than inventing a command that
    // does not exist, which is what a language-blind fallback would have done.
  },
];

const BY_EDITOR_ID = new Map<string, LanguageSupport>(
  LANGUAGES.flatMap((l) => l.editorIds.map((e) => [e, l] as const))
);

/** Every editor language id the extension watches. */
export const WATCHED_EDITOR_IDS: readonly string[] = [...BY_EDITOR_ID.keys()];

export function languageForEditorId(editorId: string): LanguageSupport | undefined {
  return BY_EDITOR_ID.get(editorId);
}

export function isWatched(editorId: string): boolean {
  return BY_EDITOR_ID.has(editorId);
}

/**
 * The compiler's own explanation, if the language has one.
 *
 * Keyed off the signature's language rather than the caller's context, so a hint built from a
 * Python concept can never suggest `rustc --explain`.
 */
export function explainCommandFor(signature: DiagnosticSignature | undefined): string | undefined {
  if (!signature) return undefined;
  const lang = LANGUAGES.find((l) => l.id === signature.language);
  return lang?.explainCommand?.(signature);
}
