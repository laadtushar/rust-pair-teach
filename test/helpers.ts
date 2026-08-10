export { normalizeMessage } from '../src/core/signature.js';
export { signatureKey as signatureKeyOf } from '../src/core/types.js';

import { fileURLToPath } from 'node:url';

export function fixturePath(name: string): string {
  return fileURLToPath(new URL(`./fixtures/sessions/${name}`, import.meta.url));
}
