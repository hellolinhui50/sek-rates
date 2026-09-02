/**
 * Reads only the static JSON committed alongside this page. The Riksbank API
 * sends no CORS headers, so the browser must never call it directly — if you
 * ever see a request to api.riksbank.se in the network tab, something is wrong.
 */

const SEK = 'SEK';

/** Gap longer than this between observations breaks the chart line. */
const GAP_DAYS = 45;

const RANGES = [
  { key: 'range1m', days: 30 },
  { key: 'range6m', days: 182 },
  { key: 'range1y', days: 365 },
  { key: 'range5y', days: 1826 },
  { key: 'rangeAll', days: Infinity },
];

const state = {
  rates: new Map(),   // code -> { value, d1, d7, d30 }
  names: new Map(),   // code -> { zh, en }
  selected: 'USD',
  rangeDays: 365,
  sort: { column: 'code', dir: 1 },
  filter: '',
  chart: null,
  historyCache: new Map(),
};

const $ = (sel) => document.querySelector(sel);

// --- formatting ------------------------------------------------------------

const locale = () => (getLang() === 'zh' ? 'zh-CN' : 'en-US');

/** Rates span 0.00054 (IDR) to ~13 (GBP), so fix decimals rather than digits. */
function formatRate(v) {
  return v.toLocaleString(locale(), { minimumFractionDigits: 2, maximumFractionDigits: 5 });
}

function formatAmount(v) {
  const digits = Math.abs(v) >= 1 ? 2 : 6;
  return v.toLocaleString(locale(), { minimumFractionDigits: 2, maximumFractionDigits: digits });
}

function formatDelta(d) {
  if (d === null || d === undefined) return '—';
  return `${d > 0 ? '+' : ''}${(d * 100).toFixed(2)}%`;
}

function deltaClass(d) {
  if (d === null || d === undefined) return 'flat';
  if (d > 0) return 'up';
  if (d < 0) return 'down';
  return 'flat';
}

function displayName(code) {
  const n = state.names.get(code);
  if (!n) return code;
  return getLang() === 'zh' ? n.zh : n.en;
}

// --- data ------------------------------------------------------------------

async function loadJson(path) {
  const res = await fetch(path);
  if (!res.ok) throw new Error(`${path}: ${res.status}`);
  return res.json();
}

async function history(code) {
  if (!state.historyCache.has(code)) {
    state.historyCache.set(code, await loadJson(`./data/history/${code}.json`));
  }
  return state.historyCache.get(code);
}

// --- converter -------------------------------------------------------------

/**
 * Every stored value is "1 unit of X = value SEK", so any cross rate is just
 * the ratio. This is why the converter needs no API call at all.
 */
function rateBetween(from, to) {
  const inSek = (code) => (code === SEK ? 1 : state.rates.get(code)?.value);
  const a = inSek(from);
  const b = inSek(to);
  if (!a || !b) return null;
  return a / b;
}

function renderConverter() {
  const amount = parseFloat($('#amount').value);
  const from = $('#from').value;
  const to = $('#to').value;
  const rate = rateBetween(from, to);

  if (rate === null || !Number.isFinite(amount)) {
    $('#result').textContent = '—';
    $('#rate-line').textContent = '';
    return;
  }

  $('#result').textContent = `${formatAmount(amount * rate)} ${to}`;
  $('#rate-line').textContent = `${t('rateLine')}: 1 ${from} = ${formatRate(rate)} ${to}`;
}

function fillCurrencySelects() {
  const sekLabel = getLang() === 'zh' ? '瑞典克朗' : 'Swedish krona';
  const codes = [SEK, ...[...state.rates.keys()].sort()];

  for (const id of ['#from', '#to']) {
    const select = $(id);
    const keep = select.value;
    select.innerHTML = '';
    for (const code of codes) {
      const opt = document.createElement('option');
      opt.value = code;
      opt.textContent = code === SEK ? `SEK — ${sekLabel}` : `${code} — ${displayName(code)}`;
      select.append(opt);
    }
    select.value = keep || (id === '#from' ? 'USD' : SEK);
  }
}

// --- table -----------------------------------------------------------------

function renderTable() {
  const q = state.filter.trim().toLowerCase();
  const rows = [...state.rates.entries()]
    .map(([code, r]) => ({ code, ...r }))
    .filter((r) => !q || r.code.toLowerCase().includes(q) || displayName(r.code).toLowerCase().includes(q))
    .sort((a, b) => {
      const { column, dir } = state.sort;
      if (column === 'code') return dir * a.code.localeCompare(b.code);
      // Nulls always sort last, whichever direction is active.
      const av = a[column];
      const bv = b[column];
      if (av === null) return 1;
      if (bv === null) return -1;
      return dir * (av - bv);
    });

  const tbody = $('#rates-body');
  tbody.innerHTML = '';

  if (rows.length === 0) {
    const tr = document.createElement('tr');
    const td = document.createElement('td');
    td.colSpan = 5;
    td.className = 'empty';
    td.textContent = t('noMatch');
    tr.append(td);
    tbody.append(tr);
    return;
  }

  for (const r of rows) {
    const tr = document.createElement('tr');
    tr.tabIndex = 0;
    if (r.code === state.selected) tr.classList.add('selected');

    tr.innerHTML = `
      <td class="cur"><span class="code">${r.code}</span><span class="name">${displayName(r.code)}</span></td>
      <td class="num">${formatRate(r.value)}</td>
      <td class="num ${deltaClass(r.d1)}">${formatDelta(r.d1)}</td>
      <td class="num ${deltaClass(r.d7)}">${formatDelta(r.d7)}</td>
      <td class="num ${deltaClass(r.d30)}">${formatDelta(r.d30)}</td>`;

    tr.addEventListener('click', () => select(r.code));
    tr.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        select(r.code);
      }
    });
    tbody.append(tr);
  }

  for (const th of document.querySelectorAll('th[data-sort]')) {
    th.dataset.active = th.dataset.sort === state.sort.column
      ? (state.sort.dir > 0 ? 'asc' : 'desc')
      : '';
  }
}

// --- chart -----------------------------------------------------------------

/**
 * uPlot draws a break wherever y is null. MYR (and others) have multi-year
 * publication gaps, and joining across them with a straight line would invent
 * a trend that never happened.
 */
function toSeries(rows) {
  const xs = [];
  const ys = [];
  let prevMs = null;

  for (const [date, value] of rows) {
    const ms = Date.parse(date);
    if (prevMs !== null && ms - prevMs > GAP_DAYS * 86_400_000) {
      xs.push((prevMs + 86_400_000) / 1000);
      ys.push(null);
    }
    xs.push(ms / 1000);
    ys.push(value);
    prevMs = ms;
  }
  return [xs, ys];
}

function chartTheme() {
  const dark = matchMedia('(prefers-color-scheme: dark)').matches;
  return {
    stroke: dark ? '#6ea8fe' : '#1a56db',
    fill: dark ? 'rgba(110,168,254,.14)' : 'rgba(26,86,219,.10)',
    grid: dark ? 'rgba(255,255,255,.08)' : 'rgba(0,0,0,.07)',
    axis: dark ? '#9aa4b2' : '#5b6472',
  };
}

function hasGap(rows) {
  for (let i = 1; i < rows.length; i++) {
    if (Date.parse(rows[i][0]) - Date.parse(rows[i - 1][0]) > GAP_DAYS * 86_400_000) return true;
  }
  return false;
}

async function renderChart() {
  const code = state.selected;
  const box = $('#chart');
  const all = await history(code);

  const cutoff = state.rangeDays === Infinity
    ? ''
    : new Date(Date.now() - state.rangeDays * 86_400_000).toISOString().slice(0, 10);
  const rows = cutoff ? all.filter(([d]) => d >= cutoff) : all;

  $('#chart-title-code').textContent = `${code} → SEK`;
  $('#gap-note').hidden = !hasGap(rows);

  state.chart?.destroy();
  box.innerHTML = '';

  const theme = chartTheme();
  state.chart = new uPlot({
    width: box.clientWidth,
    height: 300,
    padding: [12, 8, 0, 0],
    legend: { show: false },
    cursor: { y: false, points: { size: 6 } },
    scales: { x: { time: true } },
    axes: [
      { stroke: theme.axis, grid: { stroke: theme.grid, width: 1 }, ticks: { stroke: theme.grid } },
      { stroke: theme.axis, grid: { stroke: theme.grid, width: 1 }, ticks: { stroke: theme.grid }, size: 62 },
    ],
    series: [
      { value: (_, ts) => (ts ? new Date(ts * 1000).toISOString().slice(0, 10) : '') },
      {
        label: code,
        stroke: theme.stroke,
        fill: theme.fill,
        width: 1.5,
        spanGaps: false,
        value: (_, v) => (v == null ? '—' : `${formatRate(v)} SEK`),
      },
    ],
  }, toSeries(rows), box);
}

function select(code) {
  state.selected = code;
  renderTable();
  renderChart();
}

// --- wiring ----------------------------------------------------------------

function renderRangeButtons() {
  const box = $('#ranges');
  box.innerHTML = '';
  for (const r of RANGES) {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.textContent = t(r.key);
    btn.className = state.rangeDays === r.days ? 'active' : '';
    btn.addEventListener('click', () => {
      state.rangeDays = r.days;
      renderRangeButtons();
      renderChart();
    });
    box.append(btn);
  }
}

function renderAll() {
  fillCurrencySelects();
  renderRangeButtons();
  renderTable();
  renderConverter();
  renderChart();
}

async function init() {
  applyI18n();

  try {
    const [latest, meta] = await Promise.all([
      loadJson('./data/latest.json'),
      loadJson('./data/meta.json'),
    ]);

    for (const c of meta.currencies) state.names.set(c.code, { zh: c.nameZh, en: c.nameEn });
    for (const r of latest.rates) state.rates.set(r.code, { value: r.value, d1: r.d1, d7: r.d7, d30: r.d30 });

    $('#observed-date').textContent = latest.date;
    $('#fetched-at').textContent = new Date(latest.updatedAt).toLocaleString(locale());
    $('#status').hidden = true;
    $('#content').hidden = false;

    renderAll();
  } catch (err) {
    $('#status').textContent = t('loadError');
    console.error(err);
    return;
  }

  $('#lang-toggle').addEventListener('click', () => setLang(getLang() === 'zh' ? 'en' : 'zh'));
  document.addEventListener('langchange', renderAll);

  $('#search').addEventListener('input', (e) => {
    state.filter = e.target.value;
    renderTable();
  });

  for (const th of document.querySelectorAll('th[data-sort]')) {
    th.addEventListener('click', () => {
      const col = th.dataset.sort;
      state.sort = state.sort.column === col
        ? { column: col, dir: -state.sort.dir }
        : { column: col, dir: col === 'code' ? 1 : -1 };
      renderTable();
    });
  }

  for (const id of ['#amount', '#from', '#to']) {
    $(id).addEventListener('input', renderConverter);
  }
  $('#swap').addEventListener('click', () => {
    const from = $('#from').value;
    $('#from').value = $('#to').value;
    $('#to').value = from;
    renderConverter();
  });

  addEventListener('resize', () => state.chart?.setSize({ width: $('#chart').clientWidth, height: 300 }));
  matchMedia('(prefers-color-scheme: dark)').addEventListener('change', renderChart);
}

init();
