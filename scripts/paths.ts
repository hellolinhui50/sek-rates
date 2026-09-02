/**
 * Shared output locations and JSON writing.
 *
 * Everything is written twice: once to `data/` at the repo root (the stable,
 * citable copy) and once to `docs/data/` (what GitHub Pages serves, so the
 * page can fetch `./data/latest.json` same-origin). The Riksbank API sends no
 * CORS headers, so the browser can never call it directly — these files are
 * the only thing the frontend ever reads.
 */

import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

export const DATA_DIR = join(ROOT, 'data');
export const HISTORY_DIR = join(DATA_DIR, 'history');
export const DOCS_DATA_DIR = join(ROOT, 'docs', 'data');

/** One observation as stored on disk: [date (YYYY-MM-DD), rate in SEK]. */
export type HistoryPoint = [string, number];

/**
 * Write JSON to `path` and mirror it under docs/data/ at the same relative
 * position. Returns true if the bytes on disk changed, so callers can leave
 * the working tree untouched on a no-op run and let CI skip the commit.
 */
export function writeJson(path: string, value: unknown): boolean {
  const json = JSON.stringify(value);
  let changed = false;

  for (const target of [path, mirrorPath(path)]) {
    mkdirSync(dirname(target), { recursive: true });
    if (readIfExists(target) === json) continue;
    writeFileSync(target, json);
    changed = true;
  }
  return changed;
}

function mirrorPath(path: string): string {
  return join(DOCS_DATA_DIR, path.slice(DATA_DIR.length + 1));
}

function readIfExists(path: string): string | null {
  try {
    return readFileSync(path, 'utf8');
  } catch {
    return null;
  }
}
