# sek-rates

Official Sveriges Riksbank exchange rates for the Swedish krona — 29 currencies,
history back to 1993 — fetched daily by GitHub Actions and served as a static page.

瑞典中央银行官方汇率：29 个币种、1993 年至今的历史，由 GitHub Actions 每工作日自动
抓取，以静态网页呈现。

## Not a live market feed / 不是实时行情

The Riksbank publishes **one** mid rate per currency per Swedish bank day, at
around 16:15 CET. That is the ceiling on how fresh this data can be. If you need
tick-level FX quotes, this is the wrong source — these are official reference
rates, not tradeable prices.

瑞典央行每个**瑞典银行工作日**只发布**一次**中间价（约 16:15 CET）。本项目的更新频率
上限即为每天一条，不存在秒级行情。这里提供的是官方参考汇率，不是可交易报价。

## How it works

The Riksbank API sends no CORS headers, so a browser cannot call it directly.
A scheduled job fetches the data and commits it; the page only ever reads
same-origin JSON.

```
GitHub Actions (weekdays)  ──1 request──>  api.riksbank.se/swea/v1
        │
        └──> data/*.json  ──mirrored──>  docs/data/*.json  ──>  GitHub Pages
```

Git history doubles as the time series database: every published rate is a commit.

## Data files

| File | Shape |
|---|---|
| `data/latest.json` | `{"date":"2026-09-01","updatedAt":"…Z","rates":[{"code":"USD","value":9.58973,"d1":0.0009,"d7":0.0105,"d30":0.0026}]}` |
| `data/history/<CODE>.json` | `[["1993-01-04",7.125], …]` — compact `[date, rate]` pairs |
| `data/meta.json` | currency list with `code`, `seriesId`, `nameZh`, `nameEn`, `observationMinDate` |

`value` is always **SEK per 1 unit of the foreign currency** — including for JPY,
KRW and IDR. The old SOAP API's per-100 quoting does not apply to SWEA v1.
Deltas (`d1`/`d7`/`d30`) are fractions, not percentages, and are `null` when there
is no baseline. Dates are ISO `YYYY-MM-DD`.

## Running it

Requires Node 24+ (for native TypeScript execution). No dependencies, no build.

```bash
node scripts/riksbank.ts --selftest   # list live currencies, sanity-check filters
node scripts/backfill.ts              # one-off: full history for all currencies
node scripts/fetch-latest.ts          # daily incremental (exactly 1 API request)

cd docs && python3 -m http.server 8000   # preview the page
```

### The API key is optional

Every endpoint answers without authentication, but anonymously the quota is
roughly one request per 30 seconds (HTTP 429 with `Retry-After`). Register at
[developer.api.riksbank.se](https://developer.api.riksbank.se/) and set
`RIKSBANK_API_KEY` to raise it — the client sends it as `Ocp-Apim-Subscription-Key`
and retries on 429 either way. A full backfill takes ~7 minutes anonymously.

## Deploying

1. Push to a public GitHub repository.
2. Settings → Secrets and variables → Actions → new secret `RIKSBANK_API_KEY`.
3. Settings → Pages → Deploy from a branch → `main` / `/docs`.

The workflow runs at 14:30 and 15:30 UTC on weekdays (Sweden shifts between CET
and CEST, so it tries both) and commits only when the data actually moved.

## Known data quirks

- Group 130 also contains retired pre-euro series (ATS, BEF, CYP …) frozen in
  2002/2007. They are filtered out via `seriesClosed` and staleness.
- **MYR has a real 17-year gap** (2006–2022) where the Riksbank suspended
  publication. The chart breaks the line rather than interpolating across it.

## Source

Data: [Sveriges Riksbank](https://www.riksbank.se/en-gb/statistics/interest-rates-and-exchange-rates/)
(SWEA v1 API). For reference only; not investment advice.
