import type { ConceptEntry } from '../pack/types.js';
import type { DiagnosticSignature } from '../types.js';
import type { CodeRegion } from './region.js';
import type { HintLevel } from './staticHint.js';

export interface Message {
  role: 'system' | 'user';
  content: string;
}

export interface PromptInput {
  concept: ConceptEntry;
  level: HintLevel;
  signature?: DiagnosticSignature;
  diagnosticMessage: string;
  region: CodeRegion;
  /** At most two lines. The learner model stays local; only this summary ever travels. */
  learnerSummary?: string;
}

const LADDER_RULES: Record<HintLevel, string> = {
  1: 'Ask ONE short Socratic question that makes the learner look at the right thing. Do not explain, do not hint at the fix, and do not include any code.',
  2: "Reframe the compiler's complaint in terms of the learner's own code, naming the specific values and lines involved. Still no fix, and still no code the learner could paste.",
  3: 'Give a worked example that demonstrates the concept on a DIFFERENT, analogous snippet — never on the learner\'s own code. They must still make the change themselves.',
};

/**
 * Build the prompt. Pure, so its output can be snapshot-tested.
 *
 * That snapshot is how privacy stops being an intention and becomes reviewable: it shows exactly
 * what leaves the machine, and any change that widens the context — whole file instead of enclosing
 * block, learner history instead of a two-line summary — shows up as a diff a human has to approve.
 */
export function buildPrompt(input: PromptInput): Message[] {
  const { concept, level, signature, diagnosticMessage, region, learnerSummary } = input;

  const system = [
    'You are a programming teacher sitting beside a learner. You never write their code for them.',
    '',
    `The concept in play is "${concept.title}". Ground everything you say in this canonical explanation, and do not invent competing terminology:`,
    concept.mentalModel,
    '',
    `You are at hint level ${level} of 3. ${LADDER_RULES[level]}`,
    '',
    learnerSummary ? `About this learner: ${learnerSummary}` : 'You know nothing about this learner yet.',
    '',
    'Reply with ONLY a JSON object, no prose and no code fences:',
    '{"text": string, "conceptTag": string, "confidence": number between 0 and 1}',
  ].join('\n');

  const user = [
    signature ? `Compiler error: ${signature.value}` : 'No compiler error — the code compiles.',
    `Message: ${diagnosticMessage}`,
    '',
    `The learner's code (lines ${region.startLine + 1}–${region.startLine + region.text.split('\n').length}${region.truncated ? ', truncated' : ''}):`,
    region.text,
  ].join('\n');

  return [
    { role: 'system', content: system },
    { role: 'user', content: user },
  ];
}

/**
 * Exactly what would be sent, for the learner to inspect before or after it goes.
 *
 * "Visible and controllable" (N3) is unverifiable if the only way to see the payload is a network
 * capture.
 */
export function describeEgress(messages: Message[]): string {
  return messages.map((m) => `--- ${m.role} ---\n${m.content}`).join('\n\n');
}
