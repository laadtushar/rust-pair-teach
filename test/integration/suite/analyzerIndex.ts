import { resolve } from 'node:path';

import Mocha from 'mocha';

export function run(): Promise<void> {
  // Longer than the main suite: a language server has to start and produce diagnostics.
  const mocha = new Mocha({ ui: 'tdd', color: true, timeout: 90_000 });
  mocha.addFile(resolve(__dirname, 'analyzer.test.cjs'));

  return new Promise((res, rej) => {
    try {
      mocha.run((failures) => (failures > 0 ? rej(new Error(`${String(failures)} failing`)) : res()));
    } catch (err) {
      rej(err instanceof Error ? err : new Error(String(err)));
    }
  });
}
