import type { CandidateDecision } from './types.js';

/**
 * Where candidate decisions go. The VS Code adapter writes JSONL under globalStorageUri; tests
 * collect in memory.
 */
export interface LogSink {
  write(line: string): void;
}

export class MemoryLogSink implements LogSink {
  readonly lines: string[] = [];
  write(line: string): void {
    this.lines.push(line);
  }
}

export function formatDecision(d: CandidateDecision): string {
  return JSON.stringify(d);
}

export function parseDecision(line: string): CandidateDecision {
  return JSON.parse(line) as CandidateDecision;
}

/**
 * One-line human summary, for reviewing a session by eye during dogfooding.
 * The suppressed lines are the interesting ones — silence through a real struggle is the failure
 * mode that no amount of "it didn't annoy me" will surface.
 */
export function describeDecision(d: CandidateDecision): string {
  const t = new Date(d.at).toISOString().slice(11, 19);
  const verb = d.fired ? 'FIRE' : `skip(${d.suppressedBy})`;
  return `${t} ${verb} ${d.kind} ${d.uri}:${d.startLine} — ${d.reason}`;
}
