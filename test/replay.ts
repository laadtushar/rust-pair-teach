import { readFileSync } from 'node:fs';

import { defaultConfig, type DetectorConfig } from '../src/core/config.js';
import { MomentDetector } from '../src/core/detector.js';
import { EditStream } from '../src/core/editStream.js';
import { toSignature } from '../src/core/signature.js';
import type { CandidateDecision } from '../src/core/types.js';

export interface RawDiagnostic {
  code?: string;
  message: string;
  startLine: number;
  endLine: number;
}

export type SessionEvent =
  | { at: number; type: 'edit'; uri: string; text: string }
  | { at: number; type: 'diagnostics'; uri: string; diagnostics: RawDiagnostic[] };

export function loadSession(path: string): SessionEvent[] {
  return readFileSync(path, 'utf8')
    .split('\n')
    .filter((l) => l.trim() !== '')
    .map((l) => JSON.parse(l) as SessionEvent)
    .sort((a, b) => a.at - b.at);
}

/**
 * Replay a recorded session through the pure detector with a synthetic clock.
 *
 * This is the technique the whole test strategy rests on: a subjective judgement about *when* the
 * tutor should speak gets made once, by hand, and is then defended forever by a golden file. A
 * 45-minute session replays in milliseconds, so retuning a threshold is a reviewable diff rather
 * than a gamble. See docs/engineering-plan.md §3.2.
 */
export function replaySession(
  events: SessionEvent[],
  opts: { config?: Partial<DetectorConfig>; tickMs?: number; tailMs?: number } = {}
): CandidateDecision[] {
  const config = { ...defaultConfig, ...opts.config };
  const tickMs = opts.tickMs ?? 1_000;
  const tailMs = opts.tailMs ?? 0;

  const editStream = new EditStream(config);
  const detector = new MomentDetector({ config, editStream });

  const decisions: CandidateDecision[] = [];
  if (events.length === 0) return decisions;

  const start = events[0]!.at;
  const end = events[events.length - 1]!.at + tailMs;

  let cursor = 0;
  for (let now = start; now <= end; now += tickMs) {
    while (cursor < events.length && events[cursor]!.at <= now) {
      const ev = events[cursor]!;
      if (ev.type === 'edit') {
        editStream.onEdit(ev.uri, ev.text, ev.at);
      } else {
        detector.onDiagnostics(
          ev.uri,
          ev.diagnostics.map((d) => ({
            uri: ev.uri,
            signature: toSignature('rust', d.code, d.message),
            message: d.message,
            startLine: d.startLine,
            endLine: d.endLine,
          })),
          ev.at
        );
      }
      cursor++;
    }
    decisions.push(...detector.tick(now));
  }

  return decisions;
}

export const fired = (ds: CandidateDecision[]): CandidateDecision[] => ds.filter((d) => d.fired);
