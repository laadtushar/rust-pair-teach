import type { StepCheck } from '../action/types.js';
import type { Lesson, LessonStep } from './lessonTypes.js';
import { signatureKey, type DiagnosticSignature } from '../types.js';
import {
  PACK_SCHEMA_VERSION,
  PackValidationError,
  type ChapterMeta,
  type ChapterPack,
  type ConceptEntry,
} from './types.js';

const ALLOWED_META_KEYS = new Set([
  'id',
  'language',
  'version',
  'schemaVersion',
  'title',
  'prerequisites',
]);

const ALLOWED_CONCEPT_KEYS = new Set([
  'id',
  'title',
  'codes',
  'patterns',
  'socraticTemplates',
  'checkForUnderstanding',
]);

function requireString(obj: Record<string, unknown>, key: string, where: string): string {
  const v = obj[key];
  if (typeof v !== 'string' || v.trim() === '') {
    throw new PackValidationError(`"${key}" must be a non-empty string`, where);
  }
  return v;
}

/**
 * Reject unknown fields loudly.
 *
 * A pack written against a newer schema must fail on install rather than load with half its
 * meaning silently dropped — a lesson that quietly loses its completion checks is worse than one
 * that refuses to install.
 */
function rejectUnknownKeys(
  obj: Record<string, unknown>,
  allowed: Set<string>,
  where: string
): void {
  for (const key of Object.keys(obj)) {
    if (!allowed.has(key)) {
      throw new PackValidationError(
        `unknown field "${key}" — this pack may target a newer schema version`,
        where
      );
    }
  }
}

export function validateMeta(raw: unknown, where = 'chapter.toml'): ChapterMeta {
  if (typeof raw !== 'object' || raw === null) {
    throw new PackValidationError('expected a table', where);
  }
  const obj = raw as Record<string, unknown>;
  rejectUnknownKeys(obj, ALLOWED_META_KEYS, where);

  const schemaVersion = obj['schemaVersion'];
  if (typeof schemaVersion !== 'number') {
    throw new PackValidationError('"schemaVersion" must be a number', where);
  }
  if (schemaVersion > PACK_SCHEMA_VERSION) {
    throw new PackValidationError(
      `schemaVersion ${schemaVersion} is newer than this extension supports (${PACK_SCHEMA_VERSION}) — update the extension`,
      where
    );
  }

  const prerequisites = obj['prerequisites'] ?? [];
  if (!Array.isArray(prerequisites) || prerequisites.some((p) => typeof p !== 'string')) {
    throw new PackValidationError('"prerequisites" must be an array of strings', where);
  }

  return {
    id: requireString(obj, 'id', where),
    language: requireString(obj, 'language', where),
    version: requireString(obj, 'version', where),
    title: requireString(obj, 'title', where),
    schemaVersion,
    prerequisites: prerequisites as string[],
  };
}

export function validateConcept(
  raw: unknown,
  meta: ChapterMeta,
  body: string,
  where: string
): ConceptEntry {
  if (typeof raw !== 'object' || raw === null) {
    throw new PackValidationError('expected TOML front-matter', where);
  }
  const obj = raw as Record<string, unknown>;
  rejectUnknownKeys(obj, ALLOWED_CONCEPT_KEYS, where);

  const bareId = requireString(obj, 'id', where);
  const codes = obj['codes'] ?? [];
  const patterns = obj['patterns'] ?? [];
  if (!Array.isArray(codes) || codes.some((c) => typeof c !== 'string')) {
    throw new PackValidationError('"codes" must be an array of strings', where);
  }
  if (!Array.isArray(patterns) || patterns.some((p) => typeof p !== 'string')) {
    throw new PackValidationError('"patterns" must be an array of strings', where);
  }

  const signatures: DiagnosticSignature[] = [
    ...(codes as string[]).map((value) => ({
      kind: 'code' as const,
      language: meta.language,
      value,
    })),
    ...(patterns as string[]).map((value) => ({
      kind: 'pattern' as const,
      language: meta.language,
      value,
    })),
  ];
  if (signatures.length === 0) {
    throw new PackValidationError(
      'a concept needs at least one "codes" or "patterns" entry, or nothing can ever trigger it',
      where
    );
  }

  const templates = obj['socraticTemplates'];
  if (!Array.isArray(templates) || templates.length === 0) {
    throw new PackValidationError('"socraticTemplates" must be a non-empty array', where);
  }
  for (const t of templates) {
    if (typeof t !== 'string' || t.trim() === '') {
      throw new PackValidationError('"socraticTemplates" entries must be non-empty strings', where);
    }
    // Level 1 asks. A template that tells is a level-3 worked example wearing a disguise.
    if (!t.includes('?')) {
      throw new PackValidationError(
        `socratic template must be a question: ${JSON.stringify(t)}`,
        where
      );
    }
  }

  if (body.trim() === '') {
    throw new PackValidationError('concept body (the mental model) must not be empty', where);
  }

  return {
    id: `${meta.language}/${bareId}`,
    title: requireString(obj, 'title', where),
    signatures,
    mentalModel: body.trim(),
    socraticTemplates: templates as string[],
    checkForUnderstanding: requireString(obj, 'checkForUnderstanding', where),
  };
}

/** Index a pack's concepts by signature key, so lookup at moment-time is O(1). */
export function indexBySignature(pack: ChapterPack): Map<string, ConceptEntry> {
  const index = new Map<string, ConceptEntry>();
  for (const concept of pack.concepts) {
    for (const sig of concept.signatures) {
      const key = signatureKey(sig);
      const existing = index.get(key);
      if (existing && existing.id !== concept.id) {
        throw new PackValidationError(
          `signature ${key} is claimed by both "${existing.id}" and "${concept.id}"`,
          pack.meta.id
        );
      }
      index.set(key, concept);
    }
  }
  return index;
}


const ALLOWED_LESSON_KEYS = new Set(['id', 'title', 'goal', 'concepts', 'steps']);
const ALLOWED_STEP_KEYS = new Set(['instruction', 'hint', 'check']);

/**
 * Validate one guided lesson.
 *
 * The vocabulary of checks is fixed and small on purpose: a downloaded pack must never be able to
 * describe an arbitrary command to run. If a lesson cannot be expressed here, the vocabulary grows
 * through a reviewed extension release.
 */
export function validateLesson(raw: unknown, body: string, where: string): Lesson {
  if (typeof raw !== 'object' || raw === null) {
    throw new PackValidationError('expected TOML front-matter', where);
  }
  const obj = raw as Record<string, unknown>;
  rejectUnknownKeys(obj, ALLOWED_LESSON_KEYS, where);

  const concepts = obj['concepts'] ?? [];
  if (!Array.isArray(concepts) || concepts.some((c) => typeof c !== 'string')) {
    throw new PackValidationError('"concepts" must be an array of strings', where);
  }

  const rawSteps = obj['steps'];
  if (!Array.isArray(rawSteps) || rawSteps.length === 0) {
    throw new PackValidationError('a lesson needs at least one step', where);
  }

  const steps: LessonStep[] = rawSteps.map((rawStep, i) => {
    const stepWhere = `${where} step ${String(i + 1)}`;
    if (typeof rawStep !== 'object' || rawStep === null) {
      throw new PackValidationError('step must be a table', stepWhere);
    }
    const step = rawStep as Record<string, unknown>;
    rejectUnknownKeys(step, ALLOWED_STEP_KEYS, stepWhere);

    const hint = step['hint'];
    if (hint !== undefined && typeof hint !== 'string') {
      throw new PackValidationError('"hint" must be a string', stepWhere);
    }

    return {
      instruction: requireString(step, 'instruction', stepWhere),
      ...(typeof hint === 'string' ? { hint } : {}),
      check: validateCheck(step['check'], stepWhere),
    };
  });

  if (body.trim() === '') {
    throw new PackValidationError('lesson body (the teaching narrative) must not be empty', where);
  }

  return {
    id: requireString(obj, 'id', where),
    title: requireString(obj, 'title', where),
    goal: requireString(obj, 'goal', where),
    concepts: concepts as string[],
    body: body.trim(),
    steps,
  };
}

function validateCheck(raw: unknown, where: string): StepCheck {
  if (typeof raw !== 'object' || raw === null) {
    throw new PackValidationError('step needs a "check"', where);
  }
  const check = raw as Record<string, unknown>;
  const kind = check['kind'];

  switch (kind) {
    case 'file_exists':
      return { kind: 'file_exists', path: requireString(check, 'path', where) };
    case 'file_contains':
      return {
        kind: 'file_contains',
        path: requireString(check, 'path', where),
        pattern: requireString(check, 'pattern', where),
      };
    case 'command_run':
      return { kind: 'command_run', command: requireString(check, 'command', where) };
    default:
      throw new PackValidationError(
        `unknown check kind ${JSON.stringify(kind)} — allowed: file_exists, file_contains, command_run`,
        where
      );
  }
}
