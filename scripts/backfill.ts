/**
 * One-off historical backfill: pulls every live currency's full series and
 * writes data/history/<CODE>.json, plus data/meta.json.
 *
 * Costs one request per currency (~29 total). Anonymously that means several
 * minutes of enforced waiting — riksbank.ts absorbs the 429s, this script just
 * paces itself and can be re-run to resume.
 *
 *   node scripts/backfill.ts            # skip currencies already current
 *   node scripts/backfill.ts --force    # refetch everything
 */

import { existsSync, mkdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fetchHistory, isoDate, listLiveCurrencies, type Currency } from './riksbank.ts';
import { DATA_DIR, HISTORY_DIR, writeJson, type HistoryPoint } from './paths.ts';

const force = process.argv.includes('--force');

/** Space out requests so a full run does not sit permanently in penalty. */
const PACE_MS = 1_500;

/** Weekend + holiday slack when judging whether a stored file is current. */
const FRESH_WITHIN_DAYS = 5;

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

const historyPath = (code: string) => join(HISTORY_DIR, `${code}.json`);

/** A stored file is worth keeping only if it parses and reaches roughly today. */
function alreadyCurrent(code: string, today: string): boolean {
  const path = historyPath(code);
  if (!existsSync(path)) return false;
  try {
    const rows = JSON.parse(readFileSync(path, 'utf8')) as HistoryPoint[];
    if (rows.length === 0) return false;
    const cutoff = isoDate(new Date(Date.parse(today) - FRESH_WITHIN_DAYS * 86_400_000));
    return rows[rows.length - 1][0] >= cutoff;
  } catch {
    return false;
  }
}

async function main() {
  mkdirSync(HISTORY_DIR, { recursive: true });
  const today = isoDate();

  console.log('Fetching series list...');
  const currencies: Currency[] = await listLiveCurrencies();
  console.log(`${currencies.length} live currencies\n`);

  writeJson(join(DATA_DIR, 'meta.json'), {
    generatedAt: new Date().toISOString(),
    source: 'Sveriges Riksbank (SWEA v1)',
    currencies,
  });

  let fetched = 0;
  let skipped = 0;

  for (const [i, c] of currencies.entries()) {
    const label = `[${String(i + 1).padStart(2)}/${currencies.length}] ${c.code}`;

    if (!force && alreadyCurrent(c.code, today)) {
      console.log(`${label} skip (already current)`);
      skipped++;
      continue;
    }

    const obs = await fetchHistory(c.seriesId, c.observationMinDate, today);
    // Compact 2-tuples: ~40% smaller than objects across 8k+ rows per currency.
    const rows: HistoryPoint[] = obs.map((o) => [o.date, o.value]);
    writeJson(historyPath(c.code), rows);

    console.log(
      `${label} ${String(rows.length).padStart(5)} obs  ${rows[0]?.[0]} -> ${rows[rows.length - 1]?.[0]}`,
    );
    fetched++;
    await sleep(PACE_MS);
  }

  console.log(`\nDone. fetched=${fetched} skipped=${skipped}`);
  console.log('Next: node scripts/fetch-latest.ts');
}

await main();
