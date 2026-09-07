/**
 * Riksbank SWEA v1 API client.
 *
 * Design constraint that shapes everything here: the API is heavily rate
 * limited. Without a subscription key it allows roughly one request per 30s
 * and answers 429 with a `Retry-After` header. Every caller must therefore
 * treat requests as a scarce resource and go through `request()`, which
 * honours `Retry-After` and retries.
 *
 * The key is optional: set RIKSBANK_API_KEY to raise the quota. Without it
 * everything still works, just slowly.
 */

const BASE = 'https://api.riksbank.se/swea/v1';
const EXCHANGE_RATE_GROUP = 130;

/** SEK itself lives in group 130 but is not a foreign currency. */
const SELF_SERIES = 'SEKETT';

/** Consider a series dead if it has not been observed within this many days. */
const STALE_AFTER_DAYS = 90;

const MAX_RETRIES = 5;

export interface SeriesMeta {
  seriesId: string;
  groupId: number;
  shortDescription: string;
  longDescription: string;
  observationMinDate: string;
  observationMaxDate: string;
  seriesClosed: boolean;
}

export interface Currency {
  /** ISO 4217 code, e.g. "USD". */
  code: string;
  /** Riksbank series id, e.g. "SEKUSDPMI". */
  seriesId: string;
  nameZh: string;
  nameEn: string;
  /** First date this series has data for (YYYY-MM-DD). */
  observationMinDate: string;
}

export interface Observation {
  date: string;
  value: number;
}

export interface LatestObservation extends Observation {
  seriesId: string;
}

/**
 * Chinese display names. The API only ships English (`longDescription`), so
 * this map is the single place to maintain zh labels. Codes missing here fall
 * back to the code itself rather than breaking the build.
 */
const ZH_NAMES: Record<string, string> = {
  AUD: '澳大利亚元', BRL: '巴西雷亚尔', CAD: '加拿大元', CHF: '瑞士法郎',
  CNY: '人民币', CZK: '捷克克朗', DKK: '丹麦克朗', EUR: '欧元',
  GBP: '英镑', HKD: '港元', HUF: '匈牙利福林', IDR: '印尼盾',
  ILS: '以色列新谢克尔', INR: '印度卢比', ISK: '冰岛克朗', JPY: '日元',
  KRW: '韩元', MXN: '墨西哥比索', MYR: '马来西亚林吉特', NOK: '挪威克朗',
  NZD: '新西兰元', PHP: '菲律宾比索', PLN: '波兰兹罗提', RON: '罗马尼亚列伊',
  SGD: '新加坡元', THB: '泰铢', TRY: '土耳其里拉', USD: '美元',
  ZAR: '南非兰特',
};

/**
 * English overrides for series whose `longDescription` is awkward or wrong
 * upstream: it repeats the code ("PHP Philippine peso"), appends it in
 * parentheses ("Polish zloty (PLN)"), coins its own words ("Euroland euro")
 * or is simply misspelled ("Romanien leu"). Codes absent here keep the API's
 * own wording.
 */
const EN_NAME_OVERRIDES: Record<string, string> = {
  CHF: 'Swiss franc',
  EUR: 'Euro',
  HUF: 'Hungarian forint',
  ISK: 'Icelandic krona',
  MXN: 'Mexican peso',
  PHP: 'Philippine peso',
  PLN: 'Polish zloty',
  RON: 'Romanian leu',
  TRY: 'Turkish lira',
};

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** YYYY-MM-DD for a Date, in UTC. */
export function isoDate(d: Date = new Date()): string {
  return d.toISOString().slice(0, 10);
}

/**
 * GET a path under the SWEA v1 base, retrying on 429 for as long as the
 * server's own `Retry-After` says to wait.
 */
export async function request<T>(path: string): Promise<T> {
  const key = process.env.RIKSBANK_API_KEY;
  const headers: Record<string, string> = { Accept: 'application/json' };
  if (key) headers['Ocp-Apim-Subscription-Key'] = key;

  let lastError = '';

  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    const res = await fetch(`${BASE}${path}`, { headers });

    if (res.ok) return (await res.json()) as T;

    if (res.status === 429) {
      // Trust the server's own backoff hint; fall back to exponential.
      const hinted = Number(res.headers.get('retry-after'));
      const waitSec = Number.isFinite(hinted) && hinted > 0
        ? hinted + 1
        : Math.min(60, 2 ** attempt * 5);
      console.warn(`  429 rate limited on ${path} — waiting ${waitSec}s (attempt ${attempt + 1}/${MAX_RETRIES + 1})`);
      await sleep(waitSec * 1000);
      lastError = `429 after ${attempt + 1} attempts`;
      continue;
    }

    // 4xx other than 429 will not fix themselves; fail loudly.
    const body = await res.text().catch(() => '');
    throw new Error(`Riksbank ${res.status} on ${path}: ${body.slice(0, 200)}`);
  }

  throw new Error(`Riksbank request failed on ${path}: ${lastError}`);
}

/**
 * The currencies actually in use today.
 *
 * Group 130 also contains pre-euro legacy series (ATS, BEF, CYP, ...) whose
 * last observation is from 2002 or 2007. Those are filtered out here — leaving
 * them in would put permanently frozen rows in the overview table.
 */
export async function listLiveCurrencies(): Promise<Currency[]> {
  const all = await request<SeriesMeta[]>('/Series');
  const cutoff = isoDate(new Date(Date.now() - STALE_AFTER_DAYS * 86_400_000));

  return all
    .filter((s) =>
      s.groupId === EXCHANGE_RATE_GROUP &&
      !s.seriesClosed &&
      s.seriesId !== SELF_SERIES &&
      s.observationMaxDate >= cutoff)
    .map((s) => ({
      code: s.shortDescription,
      seriesId: s.seriesId,
      nameZh: ZH_NAMES[s.shortDescription] ?? s.shortDescription,
      nameEn: EN_NAME_OVERRIDES[s.shortDescription] ?? s.longDescription,
      observationMinDate: s.observationMinDate,
    }))
    .sort((a, b) => a.code.localeCompare(b.code));
}

/** Latest published rate for every series in the exchange-rate group. One request. */
export function fetchLatestRates(): Promise<LatestObservation[]> {
  return request<LatestObservation[]>(`/Observations/Latest/ByGroup/${EXCHANGE_RATE_GROUP}`);
}

/** Full or partial history for one series. */
export function fetchHistory(seriesId: string, from: string, to: string): Promise<Observation[]> {
  return request<Observation[]>(`/Observations/${seriesId.toLowerCase()}/${from}/${to}`);
}

/** The Swedish bank days in [from, to] — the days a rate is expected on. */
export async function bankDaysBetween(from: string, to: string): Promise<string[]> {
  if (from > to) return [];
  const days = await request<{ calendarDate: string; swedishBankday: boolean }[]>(
    `/CalendarDays/${from}/${to}`,
  );
  return days.filter((d) => d.swedishBankday).map((d) => d.calendarDate);
}

/** Whether a given date is a Swedish bank day (i.e. a rate is expected). */
export async function isBankDay(date: string): Promise<boolean> {
  return (await bankDaysBetween(date, date)).length > 0;
}

/** The day after `date`, as YYYY-MM-DD. */
export function nextDay(date: string): string {
  return isoDate(new Date(Date.parse(date) + 86_400_000));
}

// --- self test -------------------------------------------------------------
// `node scripts/riksbank.ts --selftest`
if (process.argv.includes('--selftest')) {
  const currencies = await listLiveCurrencies();
  console.log(`Live currencies: ${currencies.length}`);
  for (const c of currencies) {
    console.log(`  ${c.code}  ${c.seriesId.padEnd(12)} ${c.observationMinDate}  ${c.nameZh} / ${c.nameEn}`);
  }

  const zombies = ['ATS', 'BEF', 'CYP', 'DEM', 'FRF', 'ITL'];
  const found = currencies.filter((c) => zombies.includes(c.code));
  console.log(found.length === 0
    ? '\nOK: no retired currencies leaked through'
    : `\nFAIL: retired currencies present: ${found.map((c) => c.code).join(', ')}`);

  const usd = currencies.find((c) => c.code === 'USD');
  console.log(usd?.observationMinDate === '1993-01-04'
    ? 'OK: USD history starts 1993-01-04'
    : `FAIL: USD starts ${usd?.observationMinDate}`);

  console.log(`\nAPI key: ${process.env.RIKSBANK_API_KEY ? 'present' : 'absent (anonymous, heavily throttled)'}`);
}
