'use strict';
// ══════════════════════════════════════════════════════
//  i18n — Korean / English UI Toggle
//  ----------------------------------------------------
//  • <button>나 <a>의 data-i18n="key" 속성 → 자동 번역
//  • t('key') 함수로 JS에서도 호출
//  • 사용자 선호도는 localStorage에 저장
//  • 기본값: 한국어 (이중 표기 "EN / 한글" 형태 유지)
// ══════════════════════════════════════════════════════

const I18N = {
  // Common
  'app.title':            {kr:'JEY & Company SB — 회계 시스템', en:'JEY & Company SB — Accounting System'},
  'btn.save':             {kr:'저장',          en:'Save'},
  'btn.cancel':           {kr:'취소',          en:'Cancel'},
  'btn.delete':           {kr:'삭제',          en:'Delete'},
  'btn.edit':             {kr:'수정',          en:'Edit'},
  'btn.add':              {kr:'추가',          en:'Add'},
  'btn.print':            {kr:'인쇄',          en:'Print'},
  'btn.export':           {kr:'내보내기',      en:'Export'},
  'btn.import':           {kr:'가져오기',      en:'Import'},
  'btn.generate':         {kr:'조회',          en:'Generate'},
  'btn.refresh':          {kr:'새로고침',      en:'Refresh'},
  'btn.close':            {kr:'닫기',          en:'Close'},
  'btn.confirm':          {kr:'확인',          en:'Confirm'},
  // Navigation
  'nav.dashboard':        {kr:'대시보드',      en:'Dashboard'},
  'nav.quickentry':       {kr:'빠른입력',      en:'Quick Entry'},
  'nav.bankstatement':    {kr:'은행명세서',    en:'Bank Statement'},
  'nav.gl':               {kr:'General Ledger',en:'General Ledger'},
  'nav.coa':              {kr:'계정과목',      en:'Chart of Accounts'},
  'nav.journal':          {kr:'전표/분개',     en:'Journal Entry'},
  'nav.ledger':           {kr:'원장',          en:'General Ledger'},
  'nav.ar':               {kr:'매출채권',      en:'Accounts Receivable'},
  'nav.customers':        {kr:'고객',          en:'Customers'},
  'nav.salesinv':         {kr:'판매송장',      en:'Sales Invoices'},
  'nav.receipts':         {kr:'고객수령',      en:'Customer Receipts'},
  'nav.araging':          {kr:'AR 연령분석',   en:'AR Aging'},
  'nav.ap':               {kr:'매입채무',      en:'Accounts Payable'},
  'nav.suppliers':        {kr:'공급업체',      en:'Suppliers'},
  'nav.purchaseinv':      {kr:'매입송장',      en:'Purchase Invoices'},
  'nav.payments':         {kr:'공급업체 지급', en:'Supplier Payments'},
  'nav.apaging':          {kr:'AP 연령분석',   en:'AP Aging'},
  'nav.others':           {kr:'기타',          en:'Others'},
  'nav.assets':           {kr:'고정자산',      en:'Fixed Assets'},
  'nav.assetregister':    {kr:'자산대장',      en:'Asset Register'},
  'nav.sst':              {kr:'SST 요약',      en:'SST Summary'},
  'nav.tax':              {kr:'세무',          en:'Tax'},
  'nav.cp58':             {kr:'CP58 수수료신고',en:'CP58 Commission'},
  'nav.incometax':        {kr:'법인세',        en:'Income Tax'},
  'nav.taxcalendar':      {kr:'세무 일정',     en:'Tax Calendar'},
  'nav.wht':              {kr:'원천징수세',    en:'Withholding Tax'},
  'nav.reports':          {kr:'보고서',        en:'Reports'},
  'nav.pl':               {kr:'손익계산서',    en:'Profit & Loss'},
  'nav.bs':               {kr:'대차대조표',    en:'Balance Sheet'},
  'nav.trial':            {kr:'시산표',        en:'Trial Balance'},
  'nav.ratios':           {kr:'재무비율',      en:'Financial Ratios'},
  'nav.closing':          {kr:'연말결산',      en:'Year-End Closing'},
  'nav.payroll':          {kr:'급여',          en:'Payroll'},
  'nav.employees':        {kr:'직원',          en:'Employees'},
  'nav.payrollrun':       {kr:'급여 정산',     en:'Payroll Run'},
  'nav.forex':            {kr:'외환',          en:'Forex'},
  'nav.exchangerates':    {kr:'환율',          en:'Exchange Rates'},
  'nav.system':           {kr:'시스템',        en:'System'},
  'nav.importbackup':     {kr:'가져오기/백업', en:'Import/Backup'},
  'nav.users':            {kr:'사용자 관리',   en:'User Management'},
  'nav.cloudbackup':      {kr:'클라우드 백업', en:'Cloud Backup'},
  // Misc
  'lbl.date':             {kr:'날짜',          en:'Date'},
  'lbl.from':             {kr:'시작일',        en:'From'},
  'lbl.to':               {kr:'종료일',        en:'To'},
  'lbl.amount':           {kr:'금액',          en:'Amount'},
  'lbl.description':      {kr:'설명',          en:'Description'},
  'lbl.reference':        {kr:'참조번호',      en:'Reference'},
  'lbl.status':           {kr:'상태',          en:'Status'},
  'lbl.action':           {kr:'동작',          en:'Action'},
};

let _lang = localStorage.getItem('jey_lang') || 'kr';

function t(key, fallback) {
  const entry = I18N[key];
  if (!entry) return fallback !== undefined ? fallback : key;
  return entry[_lang] || entry.kr || fallback || key;
}

function setLang(lang) {
  if (lang !== 'kr' && lang !== 'en') return;
  _lang = lang;
  localStorage.setItem('jey_lang', lang);
  applyI18n();
  // Update language toggle button text
  const btn = document.getElementById('lang-toggle-btn');
  if (btn) {
    btn.innerHTML = lang === 'kr' ? '🇰🇷 한 / EN' : '🇬🇧 EN / 한';
    btn.title = lang === 'kr' ? 'Switch to English' : '한국어로 전환';
  }
}

function getLang() { return _lang; }

// Apply translations to DOM elements with data-i18n attribute
function applyI18n() {
  document.querySelectorAll('[data-i18n]').forEach(el => {
    const key = el.dataset.i18n;
    const txt = t(key);
    // Preserve icons (first child that's a span.nav-icon, etc.)
    const iconEl = el.querySelector('.nav-icon');
    if (iconEl) {
      // Replace only the text node after the icon
      let next = iconEl.nextSibling;
      while (next && next.nodeType !== Node.TEXT_NODE) next = next.nextSibling;
      if (next) next.textContent = ' ' + txt;
    } else {
      el.textContent = txt;
    }
  });
  // Update title
  document.title = t('app.title');
  // Update html lang attribute
  document.documentElement.lang = _lang === 'kr' ? 'ko' : 'en';
}

// Annotate sidebar menus + key headers with data-i18n attributes
function annotateI18n() {
  // Sidebar nav links
  const sidebarMap = {
    'dashboard':       'nav.dashboard',
    'quick-entry':     'nav.quickentry',
    'bank-statement':  'nav.bankstatement',
    'accounts':        'nav.coa',
    'journal':         'nav.journal',
    'ledger':          'nav.ledger',
    'ar-customers':    'nav.customers',
    'ar-invoices':     'nav.salesinv',
    'ar-receipts':     'nav.receipts',
    'ar-aging':        'nav.araging',
    'ap-suppliers':    'nav.suppliers',
    'ap-bills':        'nav.purchaseinv',
    'ap-payments':     'nav.payments',
    'ap-aging':        'nav.apaging',
    'assets':          'nav.assets',
    'asset-register':  'nav.assetregister',
    'sst':             'nav.sst',
    'tax-cp58':        'nav.cp58',
    'tax-computation': 'nav.incometax',
    'tax-calendar':    'nav.taxcalendar',
    'tax-wht':         'nav.wht',
    'pl':              'nav.pl',
    'bs':              'nav.bs',
    'trial':           'nav.trial',
    'ratios':          'nav.ratios',
    'closing':         'nav.closing',
    'employees':       'nav.employees',
    'payroll-run':     'nav.payrollrun',
    'forex':           'nav.exchangerates',
    'import':          'nav.importbackup',
    'users':           'nav.users',
    'cloud-backup':    'nav.cloudbackup',
  };
  Object.entries(sidebarMap).forEach(([section, key]) => {
    const link = document.querySelector(`.nav-link[data-section="${section}"]`);
    if (link && !link.dataset.i18n) link.dataset.i18n = key;
  });
  // Group labels
  const groupMap = {
    'General Ledger':         'nav.gl',
    'Accounts Receivable':    'nav.ar',
    'Accounts Payable':       'nav.ap',
    'Others':                 'nav.others',
    'Tax / 세무':              'nav.tax',
    'Reports':                'nav.reports',
    'Payroll / 급여':          'nav.payroll',
    'Forex / 외환':            'nav.forex',
    'System':                 'nav.system',
  };
  document.querySelectorAll('.nav-group-label').forEach(el => {
    const key = groupMap[el.textContent.trim()];
    if (key && !el.dataset.i18n) el.dataset.i18n = key;
  });
}

// Add lang toggle button in sidebar header
function injectLangToggle() {
  if (document.getElementById('lang-toggle-btn')) return;
  const sidebarHeader = document.querySelector('.sidebar-header');
  if (!sidebarHeader) return;
  const btn = document.createElement('button');
  btn.id = 'lang-toggle-btn';
  btn.style.cssText = `
    position:absolute;top:.75rem;right:.75rem;
    background:rgba(255,255,255,.15);color:white;border:1px solid rgba(255,255,255,.3);
    border-radius:4px;padding:.25rem .5rem;font-size:.7rem;cursor:pointer;
    transition:background .15s;
  `;
  btn.innerHTML = _lang === 'kr' ? '🇰🇷 한 / EN' : '🇬🇧 EN / 한';
  btn.title = _lang === 'kr' ? 'Switch to English' : '한국어로 전환';
  btn.onclick = () => setLang(_lang === 'kr' ? 'en' : 'kr');
  btn.onmouseenter = () => btn.style.background = 'rgba(255,255,255,.25)';
  btn.onmouseleave = () => btn.style.background = 'rgba(255,255,255,.15)';
  sidebarHeader.style.position = 'relative';
  sidebarHeader.appendChild(btn);
}

// Initialize on DOM ready
function initI18n() {
  injectLangToggle();
  annotateI18n();
  applyI18n();
}

// Auto-init after a slight delay (after app.js init runs)
setTimeout(initI18n, 100);
