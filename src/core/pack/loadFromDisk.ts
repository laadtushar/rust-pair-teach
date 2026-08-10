import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';

import { parsePack, type RawPackFiles } from './loader.js';
import type { ChapterPack } from './types.js';

/**
 * Read a pack directory off disk.
 *
 * Kept separate from `parsePack` so that every validation rule stays testable from string literals
 * without touching a filesystem.
 */
export async function loadPackFromDisk(dir: string): Promise<ChapterPack> {
  const chapter = await readFile(join(dir, 'chapter.toml'), 'utf8');
  const conceptDir = join(dir, 'concepts');
  const names = (await readdir(conceptDir)).filter((n) => n.endsWith('.md')).sort();

  const concepts: RawPackFiles['concepts'] = [];
  for (const name of names) {
    concepts.push({ name, content: await readFile(join(conceptDir, name), 'utf8') });
  }

  return parsePack({ chapter, concepts });
}
