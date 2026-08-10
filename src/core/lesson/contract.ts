import type { HintLevel } from './staticHint.js';

/**
 * The strict output contract every provider must satisfy.
 *
 * Provider-agnostic is a product promise, which means this contract has to survive a 7B model
 * running locally as well as a frontier one. So: a tiny schema, one repair retry, and a static
 * fallback that is always available. Never a crash, never a blocking spinner.
 */
export interface HintResponse {
  text: string;
  level: HintLevel;
  conceptTag: string;
  confidence: number;
}

export type ParseResult =
  | { ok: true; value: HintResponse }
  | { ok: false; reason: string; repairable: boolean };

/**
 * Pull JSON out of a model response.
 *
 * Small models wrap JSON in prose or fences no matter how firmly the system prompt forbids it, so
 * a bare `JSON.parse` would fail constantly on exactly the configurations this project promises to
 * support. Extracting the first balanced object is not sloppiness — it is the difference between
 * "works on GPT-4" and "works on what the learner actually has".
 */
export function extractJson(raw: string): string | null {
  // Order matters. Scanning the raw text first is what lets a level-3 worked example contain a
  // fenced code block: unfence-first would grab the ```rust block from *inside* the JSON string and
  // hand back something that isn't an object at all.
  const candidates: string[] = [];
  const direct = balancedObject(raw);
  if (direct) candidates.push(direct);

  const fenced = /```(?:json)?\s*([\s\S]*?)```/.exec(raw);
  if (fenced) {
    const inner = balancedObject(fenced[1]!);
    if (inner) candidates.push(inner);
  }

  for (const candidate of candidates) {
    try {
      JSON.parse(candidate);
      return candidate;
    } catch {
      // Try the next candidate.
    }
  }
  return candidates[0] ?? null;
}

/** First brace-balanced object in the text, ignoring braces inside string literals. */
function balancedObject(candidate: string): string | null {
  const start = candidate.indexOf('{');
  if (start === -1) return null;

  let depth = 0;
  let inString = false;
  let escaped = false;
  for (let i = start; i < candidate.length; i++) {
    const c = candidate[i]!;
    if (escaped) {
      escaped = false;
      continue;
    }
    if (c === '\\') {
      escaped = true;
      continue;
    }
    if (c === '"') inString = !inString;
    if (inString) continue;
    if (c === '{') depth++;
    if (c === '}') {
      depth--;
      if (depth === 0) return candidate.slice(start, i + 1);
    }
  }
  return null;
}

export function parseHintResponse(raw: string, expectedLevel: HintLevel): ParseResult {
  const json = extractJson(raw);
  if (json === null) {
    return { ok: false, reason: 'no JSON object found in response', repairable: true };
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(json);
  } catch (err) {
    return { ok: false, reason: `malformed JSON: ${String(err)}`, repairable: true };
  }

  if (typeof parsed !== 'object' || parsed === null) {
    return { ok: false, reason: 'response is not an object', repairable: true };
  }
  const obj = parsed as Record<string, unknown>;

  const text = obj['text'] ?? obj['question'];
  if (typeof text !== 'string' || text.trim() === '') {
    return { ok: false, reason: 'missing "text"', repairable: true };
  }

  const conceptTag = obj['conceptTag'];
  if (typeof conceptTag !== 'string' || conceptTag.trim() === '') {
    return { ok: false, reason: 'missing "conceptTag"', repairable: true };
  }

  const rawConfidence = obj['confidence'];
  const confidence =
    typeof rawConfidence === 'number' && rawConfidence >= 0 && rawConfidence <= 1
      ? rawConfidence
      : 0.5;

  // A model claiming a different level than we asked for does not get to overrule us — the ladder
  // is the product, and a level-3 answer to a level-1 request is exactly the failure being guarded.
  return {
    ok: true,
    value: { text: text.trim(), level: expectedLevel, conceptTag, confidence },
  };
}

export const REPAIR_INSTRUCTION =
  'Your previous reply was not valid JSON in the required shape. Reply with ONLY a JSON object, no prose and no code fences: {"text": string, "conceptTag": string, "confidence": number between 0 and 1}';
