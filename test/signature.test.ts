import { describe, expect, it } from 'vitest';

import { normalizeMessage, signatureKeyOf } from './helpers.js';
import { toSignature } from '../src/core/signature.js';

describe('toSignature', () => {
  it('uses the rustc code when there is one', () => {
    const sig = toSignature('rust', 'E0382', 'borrow of moved value: `s`');
    expect(sig).toEqual({ kind: 'code', language: 'rust', value: 'E0382' });
  });

  it('treats named lints as stable identifiers too', () => {
    const sig = toSignature('rust', 'clippy::needless_range_loop', 'the loop variable is used…');
    expect(sig.kind).toBe('code');
    expect(sig.value).toBe('clippy::needless_range_loop');
  });

  it('falls back to a normalized message pattern when the language has no codes', () => {
    const sig = toSignature(
      'python',
      undefined,
      "local variable 'total' referenced before assignment"
    );
    expect(sig).toEqual({
      kind: 'pattern',
      language: 'python',
      value: 'local variable <id> referenced before assignment',
    });
  });

  it('gives two occurrences of the same mistake the same key', () => {
    // The whole point of pattern signatures: different learner code, same underlying confusion.
    const a = toSignature('python', undefined, "local variable 'total' referenced before assignment");
    const b = toSignature('python', undefined, "local variable 'count' referenced before assignment");
    expect(signatureKeyOf(a)).toBe(signatureKeyOf(b));
  });
});

describe('normalizeMessage', () => {
  it('strips identifiers, quotes and numbers', () => {
    expect(normalizeMessage('expected `u32`, found `String` at index 12')).toBe(
      'expected <id>, found <id> at index <n>'
    );
  });

  it('keeps only the first line', () => {
    expect(normalizeMessage('cannot borrow as mutable\nnote: first borrow here')).toBe(
      'cannot borrow as mutable'
    );
  });
});
