import { beforeEach, describe, expect, it } from 'vitest';

import { defaultConfig } from '../src/core/config.js';
import { MomentDetector } from '../src/core/detector.js';
import { EditStream } from '../src/core/editStream.js';
import { toSignature } from '../src/core/signature.js';
import type { DiagnosticObservation } from '../src/core/types.js';

const URI = 'file:///p/src/main.rs';

function obs(code: string, message = 'boom', startLine = 3): DiagnosticObservation {
  return {
    uri: URI,
    signature: toSignature('rust', code, message),
    message,
    startLine,
    endLine: startLine,
  };
}

describe('MomentDetector', () => {
  let editStream: EditStream;
  let detector: MomentDetector;

  beforeEach(() => {
    editStream = new EditStream(defaultConfig);
    detector = new MomentDetector({ config: defaultConfig, editStream });
  });

  it('stays silent while the diagnostic is young', () => {
    detector.onDiagnostics(URI, [obs('E0382')], 0);
    expect(detector.tick(5_000)).toEqual([]);
  });

  it('stays silent while the learner is still typing', () => {
    detector.onDiagnostics(URI, [obs('E0382')], 0);
    editStream.onEdit(URI, 'a\n', 0);
    editStream.onEdit(URI, 'b\n', 29_000);
    // Old enough, but they are actively working — interrupting here is the failure mode.
    expect(detector.tick(30_000)).toEqual([]);
  });

  it('fires once the diagnostic has lingered and the learner has gone quiet', () => {
    detector.onDiagnostics(URI, [obs('E0382')], 0);
    editStream.onEdit(URI, 'a\n', 0);
    editStream.onEdit(URI, 'b\n', 1_000);

    const decisions = detector.tick(30_000);
    expect(decisions).toHaveLength(1);
    expect(decisions[0]?.fired).toBe(true);
    expect(decisions[0]?.kind).toBe('novel_signature');
  });

  it('does not re-fire for the same unresolved diagnostic', () => {
    // The 40-minutes-away-from-desk case: one nudge, not one per tick.
    detector.onDiagnostics(URI, [obs('E0382')], 0);
    expect(detector.tick(30_000)).toHaveLength(1);
    expect(detector.tick(60_000)).toEqual([]);
    expect(detector.tick(600_000)).toEqual([]);
  });

  it('calls a repeat signature lingering rather than novel', () => {
    detector.onDiagnostics(URI, [obs('E0382', 'first', 1)], 0);
    expect(detector.tick(30_000)[0]?.kind).toBe('novel_signature');

    detector.onDiagnostics(URI, [], 40_000);
    detector.onDiagnostics(URI, [obs('E0382', 'again', 9)], 40_000);
    const later = detector.tick(40_000 + defaultConfig.signatureCooldownMs + 30_000);
    expect(later[0]?.kind).toBe('lingering_diagnostic');
  });

  it('suppresses within the global cooldown and says so', () => {
    detector.onDiagnostics(URI, [obs('E0382', 'a', 1)], 0);
    expect(detector.tick(30_000)[0]?.fired).toBe(true);

    detector.onDiagnostics(URI, [obs('E0382', 'a', 1), obs('E0499', 'b', 20)], 31_000);
    const decisions = detector.tick(60_000);
    expect(decisions).toHaveLength(1);
    expect(decisions[0]?.fired).toBe(false);
    expect(decisions[0]?.suppressedBy).toBe('global_cooldown');
  });

  it('suppresses a repeat of the same signature past the global cooldown', () => {
    detector.onDiagnostics(URI, [obs('E0382', 'a', 1)], 0);
    detector.tick(30_000);

    detector.onDiagnostics(URI, [], 31_000);
    detector.onDiagnostics(URI, [obs('E0382', 'a', 50)], 31_000);
    // The learner has since gone back to work, so only the per-signature cooldown is left holding
    // this back — the same error twice in ten minutes is one lesson, not two.
    editStream.onEdit(URI, 'x\n', 31_000);
    editStream.onEdit(URI, 'y\n', 32_000);
    const after = 30_000 + defaultConfig.globalCooldownMs + 1_000;
    const decisions = detector.tick(after);
    expect(decisions[0]?.suppressedBy).toBe('signature_cooldown');
  });

  it('will not nudge a second time if the learner has not typed since the first', () => {
    // Found by the borrow-struggle replay, not by reasoning: without this the cooldown recharges
    // while the learner is away, and they return to a second nudge about an unchanged screen.
    editStream.onEdit(URI, 'a\n', 0);
    editStream.onEdit(URI, 'b\n', 1_000);
    detector.onDiagnostics(URI, [obs('E0382', 'a', 1)], 0);
    expect(detector.tick(30_000)[0]?.fired).toBe(true);

    detector.onDiagnostics(URI, [obs('E0382', 'a', 1), obs('E0499', 'b', 40)], 31_000);
    const wayLater = 30_000 + defaultConfig.globalCooldownMs + 10_000;
    const decisions = detector.tick(wayLater);
    expect(decisions[0]?.suppressedBy).toBe('no_activity_since_last_nudge');
  });

  it('records suppression rather than silence when ambient is off', () => {
    // On-demand mode still needs the log — "would have fired" is the data that justifies the mode.
    detector.ambient = false;
    detector.onDiagnostics(URI, [obs('E0382')], 0);
    const decisions = detector.tick(30_000);
    expect(decisions[0]).toMatchObject({ fired: false, suppressedBy: 'ambient_disabled' });
  });

  it('forgets a diagnostic once it clears', () => {
    detector.onDiagnostics(URI, [obs('E0382')], 0);
    detector.onDiagnostics(URI, [], 5_000);
    expect(detector.activeSignatures()).toEqual([]);
    expect(detector.tick(30_000)).toEqual([]);
  });

  it('raises churn without any diagnostic at all', () => {
    for (let i = 0; i <= 4; i++) editStream.onEdit(URI, `let a = ${i};\n`, i * 1_000);
    const decisions = detector.tick(10_000);
    expect(decisions).toHaveLength(1);
    expect(decisions[0]?.kind).toBe('churn');
    expect(decisions[0]?.signature).toBeUndefined();
  });
});
