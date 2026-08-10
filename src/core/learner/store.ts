import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';

import { newModel } from './model.js';
import { LEARNER_MODEL_VERSION, type LearnerModel } from './types.js';

/**
 * Persistence for the learner model.
 *
 * Reliability priority #2 in the design, after "never degrade the editing experience": never lose
 * the learner model. Months of a person's learning history is not something to trade for a
 * convenient `writeFile` that can be interrupted mid-flush and leave truncated JSON.
 *
 * So: write to a temp file, fsync-by-rename. A crash leaves either the old model or the new one,
 * never half of either.
 */
export class LearnerStore {
  private readonly path: string;

  constructor(dir: string, filename = 'learner-model.json') {
    this.path = join(dir, filename);
  }

  async load(now: number): Promise<LearnerModel> {
    let raw: string;
    try {
      raw = await readFile(this.path, 'utf8');
    } catch {
      return newModel(now);
    }

    try {
      const parsed = JSON.parse(raw) as LearnerModel;
      if (typeof parsed.version !== 'number' || parsed.version > LEARNER_MODEL_VERSION) {
        // A model written by a newer extension. Starting fresh would silently destroy history, so
        // refuse and let the caller surface it instead.
        throw new Error(
          `learner model version ${String(parsed.version)} is newer than this extension supports`
        );
      }
      return { ...newModel(now), ...parsed };
    } catch (err) {
      if (err instanceof SyntaxError) {
        // Corrupt file: keep it for forensics rather than overwriting the only copy.
        await rename(this.path, `${this.path}.corrupt-${String(now)}`).catch(() => undefined);
        return newModel(now);
      }
      throw err;
    }
  }

  async save(model: LearnerModel): Promise<void> {
    await mkdir(dirname(this.path), { recursive: true });
    const tmp = `${this.path}.tmp`;
    await writeFile(tmp, JSON.stringify(model, null, 2), 'utf8');
    await rename(tmp, this.path);
  }
}
