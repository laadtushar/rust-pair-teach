import { resolve } from 'node:path';

import Mocha from 'mocha';

export function run(): Promise<void> {
  const mocha = new Mocha({ ui: 'tdd', color: true, timeout: 30_000 });
  mocha.addFile(resolve(__dirname, 'extension.test.cjs'));

  return new Promise((res, rej) => {
    try {
      mocha.run((failures) => (failures > 0 ? rej(new Error(`${String(failures)} failing`)) : res()));
    } catch (err) {
      rej(err instanceof Error ? err : new Error(String(err)));
    }
  });
}
