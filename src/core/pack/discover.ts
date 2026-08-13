import { readdir } from 'node:fs/promises';
import { join } from 'node:path';

import { loadPackFromDisk } from './loadFromDisk.js';
import type { ChapterPack } from './types.js';

export interface DiscoveredPacks {
  packs: ChapterPack[];
  /** Directory name and why it did not load, for the output channel. */
  failures: Array<{ id: string; reason: string }>;
}

/**
 * Load every pack in the packs directory.
 *
 * Previously this was a hard-coded array of three ids, directly under a comment claiming that
 * adding teaching content never means editing this file. Discovery makes the comment true: a new
 * language pack is a directory, and nothing in `src/` mentions it.
 *
 * A pack that fails to validate is reported and skipped rather than thrown, because the failure of
 * one language's content must not take the others' teaching down with it.
 */
export async function discoverPacks(packsDir: string): Promise<DiscoveredPacks> {
  let entries: string[];
  try {
    entries = (await readdir(packsDir, { withFileTypes: true }))
      .filter((e) => e.isDirectory())
      .map((e) => e.name)
      .sort();
  } catch (err) {
    return { packs: [], failures: [{ id: packsDir, reason: String(err) }] };
  }

  const packs: ChapterPack[] = [];
  const failures: DiscoveredPacks['failures'] = [];
  for (const id of entries) {
    try {
      packs.push(await loadPackFromDisk(join(packsDir, id)));
    } catch (err) {
      failures.push({ id, reason: String(err) });
    }
  }
  return { packs, failures };
}
