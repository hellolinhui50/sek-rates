/**
 * Daily incremental update. Deliberately costs exactly ONE API request:
 * `/Observations/Latest/ByGroup/130` returns every currency at once.
 *
 * Appends anything new to data/history/<CODE>.json, then derives 1d/7d/30d
 * changes and writes data/latest.json. Idempotent: running it twice in a row
 * leaves the working tree untouched, which is what lets CI skip the commit on
 * weekends and Swedish bank holidays.
 *
 *   node scripts/fetch-latest.ts
 */

import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fetchLatestRates, type Currency } from './riksbank.ts';
import { DATA_DIR, HISTORY_DIR, writeJson, type HistoryPoint } from './paths.ts';

interface Meta {
  currencies: Currency[];
}

interface Rate {
  code: string;
  value: number;
  /** Fractional change (not percent), or null when there is no baseline. */
  d1: number | null;
  d7: number | null;
  d30: number | null;
}

const historyPath = (code: string) => join(HISTORY_DIR, `${code}.json`);

function readHistory(code: string): HistoryPoint[] {
  const path = historyPath(code);
  if (!existsSync(path)) return [];
  try {
    return JSON.parse(readFileSync(path, 'utf8')) as HistoryPoint[];
  } catch {
    return [];
  }
}

/**
 * Value as of `daysAgo` calendar days before `from`, using the most recent
 * observation at or before that target. Rates are only published on bank days,
 * so an exact date match would miss most of the time.
 */
function valueDaysAgo(rows: HistoryPoint[], from: string, daysAgo: number): number | null {
  const target = new Date(Date.parse(from) - daysAgo * 86_400_000).toISOString().slice(0, 10);
  for (let i = rows.length - 1; i >= 0; i--) {
    if (rows[i][0] <= target) return rows[i][1];
  }
  return null;
}

function change(current: number, past: number | null): number | null {
  if (past === null || past === 0) return null;
  return (current - past) / past;
}

async function main() {
  const metaPath = join(DATA_DIR, 'meta.json');
  if (!existsSync(metaPath)) {
    console.error('data/meta.json missing — run `node scripts/backfill.ts` first.');
    process.exit(1);
  }
  const meta = JSON.parse(readFileSync(metaPath, 'utf8')) as Meta;
  const bySeriesId = new Map(meta.currencies.map((c) => [c.seriesId, c]));

  const observations = await fetchLatestRates();

  const rates: Rate[] = [];
  let latestDate = '';
  let historyChanged = 0;

  for (const obs of observations) {
    // Skips SEKETT and the retired pre-euro series, which are absent from meta.
    const currency = bySeriesId.get(obs.seriesId);
    if (!currency) continue;

    const rows = readHistory(currency.code);
    const last = rows[rows.length - 1];

    if (!last || obs.date > last[0]) {
      rows.push([obs.date, obs.value]);
      writeJson(historyPath(currency.code), rows);
      historyChanged++;
    } else if (obs.date === last[0] && obs.value !== last[1]) {
      // Riksbank occasionally restates a same-day figure.
      rows[rows.length - 1] = [obs.date, obs.value];
      writeJson(historyPath(currency.code), rows);
      historyChanged++;
    }

    if (obs.date > latestDate) latestDate = obs.date;

    rates.push({
      code: currency.code,
      value: obs.value,
      d1: change(obs.value, valueDaysAgo(rows, obs.date, 1)),
      d7: change(obs.value, valueDaysAgo(rows, obs.date, 7)),
      d30: change(obs.value, valueDaysAgo(rows, obs.date, 30)),
    });
  }

  rates.sort((a, b) => a.code.localeCompare(b.code));

  // `updatedAt` is deliberately excluded from the comparison: restamping it on
  // every run would create a commit each time CI fires, even on holidays.
  const latestPath = join(DATA_DIR, 'latest.json');
  const previous = existsSync(latestPath)
    ? JSON.parse(readFileSync(latestPath, 'utf8'))
    : null;
  const ratesChanged = JSON.stringify(previous?.rates) !== JSON.stringify(rates);

  if (ratesChanged || historyChanged > 0) {
    writeJson(latestPath, {
      updatedAt: new Date().toISOString(),
      date: latestDate,
      source: 'Sveriges Riksbank (SWEA v1)',
      rates,
    });
  }

  console.log(`observation date : ${latestDate}`);
  console.log(`currencies       : ${rates.length}`);
  console.log(`history updated  : ${historyChanged}`);
  console.log(`result           : ${ratesChanged || historyChanged > 0 ? 'CHANGED' : 'no change'}`);
}

await main();
