/**
 * Minimal bilingual layer. Elements carry data-i18n="key" (text content) or
 * data-i18n-attr="attr:key" (attribute), and applyI18n() rewrites them.
 */

const STRINGS = {
  zh: {
    title: '瑞典克朗汇率',
    tagline: '瑞典中央银行官方中间价 · 29 个币种 · 1993 年至今',
    liveNotice: '每个瑞典银行工作日更新一次（约 16:15 CET），非实时行情',
    observedOn: '数据日期',
    updatedAt: '抓取于',
    loading: '加载中…',
    loadError: '数据加载失败，请刷新重试。',

    converterTitle: '货币换算',
    amount: '金额',
    from: '从',
    to: '到',
    swap: '交换',
    rateLine: '汇率',

    chartTitle: '历史走势',
    chartHint: '点击下方表格中的任一币种查看走势',
    range1m: '1月',
    range6m: '6月',
    range1y: '1年',
    range5y: '5年',
    rangeAll: '全部',
    gapNote: '该币种历史存在中断，瑞典央行曾停止发布',

    overviewTitle: '汇率总览',
    search: '搜索币种…',
    noMatch: '没有匹配的币种',
    colCurrency: '币种',
    colRate: '1 单位 = SEK',
    col1d: '1 日',
    col7d: '7 日',
    col30d: '30 日',

    footerSource: '数据来源：瑞典中央银行 (Sveriges Riksbank)',
    footerLicense: '本页仅供参考，不构成交易依据。',
    langToggle: 'English',
  },

  en: {
    title: 'Swedish Krona Exchange Rates',
    tagline: 'Official Riksbank mid rates · 29 currencies · since 1993',
    liveNotice: 'Published once per Swedish bank day (~16:15 CET) — not a live market feed',
    observedOn: 'Observation date',
    updatedAt: 'Fetched',
    loading: 'Loading…',
    loadError: 'Could not load the data. Try reloading.',

    converterTitle: 'Converter',
    amount: 'Amount',
    from: 'From',
    to: 'To',
    swap: 'Swap',
    rateLine: 'Rate',

    chartTitle: 'History',
    chartHint: 'Pick a currency in the table below to see its history',
    range1m: '1M',
    range6m: '6M',
    range1y: '1Y',
    range5y: '5Y',
    rangeAll: 'All',
    gapNote: 'This series has a gap — the Riksbank suspended publication',

    overviewTitle: 'All rates',
    search: 'Search currency…',
    noMatch: 'No matching currency',
    colCurrency: 'Currency',
    colRate: '1 unit = SEK',
    col1d: '1d',
    col7d: '7d',
    col30d: '30d',

    footerSource: 'Source: Sveriges Riksbank',
    footerLicense: 'For reference only; not investment advice.',
    langToggle: '中文',
  },
};

let lang = pickInitialLang();

function pickInitialLang() {
  const fromQuery = new URLSearchParams(location.search).get('lang');
  if (fromQuery === 'zh' || fromQuery === 'en') return fromQuery;
  try {
    const saved = localStorage.getItem('lang');
    if (saved === 'zh' || saved === 'en') return saved;
  } catch {
    // Private mode or blocked storage — fall through to the browser locale.
  }
  return navigator.language?.startsWith('zh') ? 'zh' : 'en';
}

function t(key, vars) {
  let s = STRINGS[lang][key] ?? STRINGS.en[key] ?? key;
  if (vars) for (const [k, v] of Object.entries(vars)) s = s.replaceAll(`{${k}}`, v);
  return s;
}

function getLang() {
  return lang;
}

function setLang(next) {
  lang = next;
  try {
    localStorage.setItem('lang', next);
  } catch {
    // Not fatal: the choice just will not survive a reload.
  }
  document.documentElement.lang = next === 'zh' ? 'zh-CN' : 'en';
  applyI18n();
}

function applyI18n() {
  for (const el of document.querySelectorAll('[data-i18n]')) {
    el.textContent = t(el.dataset.i18n);
  }
  for (const el of document.querySelectorAll('[data-i18n-attr]')) {
    const [attr, key] = el.dataset.i18nAttr.split(':');
    el.setAttribute(attr, t(key));
  }
  document.title = t('title');
  document.dispatchEvent(new CustomEvent('langchange'));
}
