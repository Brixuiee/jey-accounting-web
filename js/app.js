'use strict';
// ======================================================
//  JEY & Company SB — Accounting System
//  Pure JS + localStorage, no external dependencies
// ======================================================

// ── Helpers ───────────────────────────────────────────
const uid  = () => Math.random().toString(36).slice(2,10);
const fmt  = (n) => 'MYR ' + Number(n||0).toLocaleString('en-MY', {minimumFractionDigits:2, maximumFractionDigits:2});
const fmtN = (n) => Number(n||0).toLocaleString('en-MY', {minimumFractionDigits:2, maximumFractionDigits:2});
const today = () => new Date().toISOString().slice(0,10);
const nowMonth = () => new Date().toISOString().slice(0,7);

// ── Default Data ──────────────────────────────────────
const DEFAULT_ACCOUNTS = [
  // Assets
  {id:'a1001',code:'1001',nameKr:'현금',nameEn:'Cash in Hand',type:'asset'},
  {id:'a1002',code:'1002',nameKr:'은행 (CIMB)',nameEn:'Bank - CIMB',type:'asset'},
  {id:'a1003',code:'1003',nameKr:'매출채권',nameEn:'Accounts Receivable',type:'asset'},
  {id:'a1004',code:'1004',nameKr:'재고자산',nameEn:'Inventory',type:'asset'},
  {id:'a1005',code:'1005',nameKr:'선급금',nameEn:'Prepaid Expenses',type:'asset'},
  {id:'a1500',code:'1500',nameKr:'고정자산',nameEn:'Fixed Assets',type:'asset'},
  {id:'a1501',code:'1501',nameKr:'감가상각누계액',nameEn:'Accumulated Depreciation',type:'asset',contra:true},
  // Liabilities
  {id:'a2001',code:'2001',nameKr:'매입채무',nameEn:'Accounts Payable',type:'liability'},
  {id:'a2002',code:'2002',nameKr:'미지급세금',nameEn:'Tax Payable',type:'liability'},
  {id:'a2003',code:'2003',nameKr:'미지급비용',nameEn:'Accrued Expenses',type:'liability'},
  {id:'a2004',code:'2004',nameKr:'선수금',nameEn:'Advance from Customers',type:'liability'},
  // Equity
  {id:'a3001',code:'3001',nameKr:'자본금',nameEn:'Share Capital',type:'equity'},
  {id:'a3002',code:'3002',nameKr:'이익잉여금',nameEn:'Retained Earnings',type:'equity'},
  // Revenue
  {id:'a4001',code:'4001',nameKr:'매출',nameEn:'Sales Revenue',type:'revenue'},
  {id:'a4002',code:'4002',nameKr:'수수료수익',nameEn:'Commission Income',type:'revenue'},
  {id:'a4003',code:'4003',nameKr:'기타수익',nameEn:'Other Income',type:'revenue'},
  // Expenses
  {id:'a5001',code:'5001',nameKr:'매출원가',nameEn:'Cost of Goods Sold',type:'expense'},
  {id:'a5002',code:'5002',nameKr:'급여',nameEn:'Salaries & Wages',type:'expense'},
  {id:'a5003',code:'5003',nameKr:'임차료',nameEn:'Rent',type:'expense'},
  {id:'a5004',code:'5004',nameKr:'공과금',nameEn:'Utilities',type:'expense'},
  {id:'a5005',code:'5005',nameKr:'운반비',nameEn:'Transportation',type:'expense'},
  {id:'a5006',code:'5006',nameKr:'통신비',nameEn:'Communication',type:'expense'},
  {id:'a5007',code:'5007',nameKr:'전문가수수료',nameEn:'Professional Fees',type:'expense'},
  {id:'a5008',code:'5008',nameKr:'감가상각비',nameEn:'Depreciation',type:'expense'},
  {id:'a5009',code:'5009',nameKr:'은행수수료',nameEn:'Bank Charges',type:'expense'},
  {id:'a5010',code:'5010',nameKr:'기타비용',nameEn:'Other Expenses',type:'expense'},
];

// ── Audit-firm chart alignment ────────────────────────
// The external auditor's GL numbers accounts differently (assets 1xxxx,
// liabilities 3xxxx, equity 4xxxx, revenue 5xxxx, COGS 6xxxx, expenses 7xxxx).
// This app keeps its own 4-digit codes — well over a hundred places look
// accounts up by them — and carries the auditor's code alongside as
// `auditCode`, so the two ledgers reconcile line by line.
//
// Codes 2010-2015 and 5011-5017 are claimed by the payroll / WHT / tax /
// assets / forex modules, which auto-create them on demand. New detail
// accounts therefore start at 2016 and 5018.
const AUDIT_CODE_MAP = {
  '1001':'11200', '1002':'11310', '1003':'12100', '1006':'32100', '1007':'11320',
  '1500':'25100', '1501':'25110',
  '2001':'31100', '2002':'35100', '2003':'33000',
  '3001':'41100', '3002':'40067',
  '4002':'51300',
  // 5004 공과금은 여기 없다 — 상위(총괄) 계정이라 감사법인 단일 계정에 대응하지
  // 않는다(72700 Electricity + 72810 Chilled Water 를 아우름). 세부 계정인
  // 5033 전기료가 72700을 갖는다.
  '5001':'61100', '5003':'72100', '5006':'72500', '5009':'70400',
  // 아래 셋은 기존 설치본의 잘못된/누락된 매핑을 덮어쓰기 위해 여기에 둔다.
  // (MySoft 원장 실물 확인 결과 — 5013은 71500 EPF, 5034는 72510 Office internet)
  '5013':'71500', '5014':'71600', '5034':'72510',
  // MySoft 과거 원장(2017.7~2022.6) 이관 시 대응 계정이 이미 있었는데 감사코드만
  // 안 달려 있던 것들.
  '5002':'71100', '5008':'70600', '5012':'70940',
};

const AUDIT_DETAIL_ACCOUNTS = [
  // Balance-sheet items the auditor tracks as their own accounts
  {id:'a1008',code:'1008',nameKr:'보증금',    nameEn:'Deposits Paid',      type:'asset',    auditCode:'14100'},
  {id:'a1009',code:'1009',nameKr:'기타채권',  nameEn:'Other Debtors',      type:'asset',    auditCode:'12300'},
  {id:'a1010',code:'1010',nameKr:'이사계정',  nameEn:"Director's Account", type:'asset',    auditCode:'16100'},
  {id:'a2016',code:'2016',nameKr:'이사 소득세 미지급금',nameEn:"Director's Income Tax Payable",type:'liability',auditCode:'34400'},
  {id:'a2017',code:'2017',nameKr:'SST 매출세액',nameEn:'Sales/Output Tax', type:'liability',auditCode:'32200'},
  // Expense detail — the categories a director's monthly claim splits into
  {id:'a5018',code:'5018',nameKr:'이사보수',      nameEn:'Director Fee',              type:'expense',auditCode:'71300'},
  {id:'a5019',code:'5019',nameKr:'사무용품비',    nameEn:'Office Supplies',           type:'expense',auditCode:'72200'},
  {id:'a5020',code:'5020',nameKr:'인쇄비',        nameEn:'Printing & Stationery',     type:'expense',auditCode:'72400'},
  {id:'a5021',code:'5021',nameKr:'냉방비',        nameEn:'Chilled Water',             type:'expense',auditCode:'72810'},
  {id:'a5022',code:'5022',nameKr:'주유/통행료/주차',nameEn:'Petrol/Toll/Parking',     type:'expense',auditCode:'72900'},
  {id:'a5023',code:'5023',nameKr:'차량유지비',    nameEn:'Motor Vehicle Maintenance', type:'expense',auditCode:'73100'},
  {id:'a5024',code:'5024',nameKr:'숙박비',        nameEn:'Accommodation',             type:'expense',auditCode:'73210'},
  {id:'a5025',code:'5025',nameKr:'여비교통비',    nameEn:'Travelling',                type:'expense',auditCode:'73310'},
  {id:'a5026',code:'5026',nameKr:'접대비',        nameEn:'Entertainment',             type:'expense',auditCode:'73320'},
  {id:'a5027',code:'5027',nameKr:'체육활동비',    nameEn:'Sports Activities',         type:'expense',auditCode:'73360'},
  {id:'a5028',code:'5028',nameKr:'비자수수료',    nameEn:'Visa Fees',                 type:'expense',auditCode:'73820'},
  {id:'a5029',code:'5029',nameKr:'다과/식대',     nameEn:'Refreshment',               type:'expense',auditCode:'76000'},
  {id:'a5030',code:'5030',nameKr:'기장수수료',    nameEn:'Bookkeeping',               type:'expense',auditCode:'70910'},
  {id:'a5031',code:'5031',nameKr:'법인비서수수료',nameEn:'Secretarial Fees',          type:'expense',auditCode:'70930'},
  {id:'a5032',code:'5032',nameKr:'세무수수료',    nameEn:'Taxation Fees',             type:'expense',auditCode:'70931'},
  // 공과금(5004) 세부 — 5004는 상위 총괄, 실제 기표는 아래 4개로 나눠 한다.
  // Telecom은 기존 5006 통신비, Airconditioning은 기존 5021 냉방비를 그대로 쓴다.
  // 인터넷(Unifi)은 감사법인 원장에서 72510 Office internet으로 별도 계정이다
  // (한때 5006과 합산되는 것으로 잘못 문서화되어 있었음 — 실제 auditCode는 아래
  // 5034 정의를 참조).
  {id:'a5033',code:'5033',nameKr:'전기료',        nameEn:'Electricity',               type:'expense',auditCode:'72700'},
  {id:'a5034',code:'5034',nameKr:'인터넷',        nameEn:'Internet',                  type:'expense',auditCode:'72510'},
  // EPF — payroll.js의 ensurePayrollAccounts()도 같은 코드로 정의한다.
  // 양쪽 다 code로 존재 여부를 확인한 뒤 만들므로 중복 생성되지 않는다.
  // 이름을 바꿀 때는 payroll.js:14~ 정의도 같이 맞출 것.
  // 2025-10-01부터 비말레이시아 국적자 EPF 의무화(노사 각 2%) — 감사법인 원장에는
  // 그전 규정이라 대응 계정이 없어 감사코드를 두지 않는다.
  {id:'a2011',code:'2011',nameKr:'EPF 미지급금',  nameEn:'EPF Payable',               type:'liability'},
  {id:'a5013',code:'5013',nameKr:'EPF 회사부담분',nameEn:'EPF Employer Contribution', type:'expense',auditCode:'71500'},
  // SOCSO — payroll.js와 코드·이름을 맞춘다(중복 생성 방지).
  {id:'a2012',code:'2012',nameKr:'SOCSO 미지급금',nameEn:'SOCSO Payable',             type:'liability'},
  {id:'a5014',code:'5014',nameKr:'SOCSO 회사부담분',nameEn:'SOCSO Employer Contribution',type:'expense',auditCode:'71600'},
  // MySoft(Mr. Accounting) 원장에는 있으나 이 앱에 없던 비용 계정들.
  // 구 유통사업 계정(Spare Parts·Import Duty·Freight 등)과 파트너십 자본계정은
  // 현재 사업과 무관해 의도적으로 제외했다.
  {id:'a5035',code:'5035',nameKr:'상여금',        nameEn:'Bonus',                     type:'expense',auditCode:'71400'},
  {id:'a5036',code:'5036',nameKr:'복리후생비',    nameEn:'Staff Welfare',             type:'expense',auditCode:'72000'},
  {id:'a5037',code:'5037',nameKr:'우편·택배비',   nameEn:'Postage & Courier',         type:'expense',auditCode:'72300'},
  {id:'a5038',code:'5038',nameKr:'휴대폰',        nameEn:'Mobile Phone',              type:'expense',auditCode:'72600'},
  {id:'a5039',code:'5039',nameKr:'수도료',        nameEn:'Water',                     type:'expense',auditCode:'72800'},
  {id:'a5040',code:'5040',nameKr:'정기주차',      nameEn:'Season Parking',            type:'expense',auditCode:'73000'},
  {id:'a5041',code:'5041',nameKr:'출장지경비',    nameEn:'Outstation Expense',        type:'expense',auditCode:'73200'},
  {id:'a5042',code:'5042',nameKr:'클럽회비',      nameEn:'Club Membership',           type:'expense',auditCode:'73330'},
  {id:'a5043',code:'5043',nameKr:'운동용품',      nameEn:'Sport Equipment',           type:'expense',auditCode:'73340'},
  {id:'a5044',code:'5044',nameKr:'도서',          nameEn:'Books',                     type:'expense',auditCode:'73350'},
  {id:'a5045',code:'5045',nameKr:'기부·선물',     nameEn:'Gifts & Donations',         type:'expense',auditCode:'73600'},
  {id:'a5046',code:'5046',nameKr:'유지보수',      nameEn:'Maintenance',               type:'expense',auditCode:'73700'},
  {id:'a5047',code:'5047',nameKr:'사무실·기기 관리',nameEn:'Upkeep of Office & Equipment',type:'expense',auditCode:'73710'},
  // 2026-08 추가: EPF를 회사부담분(기존 5013)/직원부담분/통합납부로 세분화하고
  // 연체료 계정을 신설. 은행수수료(기존 5009)도 SST·이체수수료를 별도 계정으로
  // 분리 — 은행 명세서에 'SERVICE TAX 8%', 'OTHER TRANSFER FEE'처럼 성격이 다른
  // 항목이 뭉뚱그려 잡히던 것을 갈라내기 위함. 감사법인 원장에 대응 계정이 없어
  // auditCode는 비워둔다.
  {id:'a5048',code:'5048',nameKr:'EPF 직원부담분',    nameEn:'EPF Contribution (Employee)',type:'expense'},
  {id:'a5049',code:'5049',nameKr:'EPF 통합납부',      nameEn:'EPF Contribution (Combined)',type:'expense'},
  {id:'a5050',code:'5050',nameKr:'EPF 연체료',        nameEn:'EPF Late Payment Charge',    type:'expense'},
  {id:'a5051',code:'5051',nameKr:'은행 SST',          nameEn:'Bank SST Tax',               type:'expense'},
  {id:'a5052',code:'5052',nameKr:'계좌이체 수수료',    nameEn:'Bank Transfer Fee',          type:'expense'},
  {id:'a4007',code:'4007',nameKr:'세금환급',          nameEn:'Tax Refund',                 type:'revenue'},
  // 2026-09 추가: MySoft 원장(2017.7~2022.6, 감사 안 된 5개 회계연도)을 JEY로
  // 이관하면서 대응 계정이 없던 것들. 구 유통사업(무역업) 매출은 현재의 수수료
  // 사업과 성격이 달라 별도 계정으로 분리했다.
  {id:'a4008',code:'4008',nameKr:'매출-구유통사업',    nameEn:'Sales (Legacy Trading)',     type:'revenue',auditCode:'51100'},
  {id:'a5053',code:'5053',nameKr:'컨설팅수수료',      nameEn:'Consultancy Fees',           type:'expense',auditCode:'65100'},
  {id:'a5054',code:'5054',nameKr:'인허가수수료',      nameEn:'Licence Fees',               type:'expense',auditCode:'70920'},
  {id:'a5056',code:'5056',nameKr:'감사보수',          nameEn:'Audit Fee',                  type:'expense',auditCode:'71000'},
  {id:'a5057',code:'5057',nameKr:'의료비',            nameEn:'Medical Fee',                type:'expense',auditCode:'74600'},
  // 2026-09 추가: 감사보고서(AF2025) 대조 결과 기초잔액에서 뭉뚱그려져 있던
  // 항목을 세분화하기 위해 신설.
  {id:'a1011',code:'1011',nameKr:'미수법인세',        nameEn:'Income Tax Recoverable',     type:'asset'},
  {id:'a2018',code:'2018',nameKr:'기타미지급금',      nameEn:'Other Payables',             type:'liability'},
];

// Idempotent — safe to run on every load. Returns true if anything changed.
function ensureAuditChartAccounts() {
  let changed = false;
  // The bank-import suspense account was first created as 2010, which
  // payroll.js also claims for 미지급 급여; move it clear of that block.
  const suspense = DB.accounts.find(a => /은행거래\s*미정리/.test(a.nameKr || ''));
  if (suspense && suspense.code !== '2020') { suspense.code = '2020'; changed = true; }

  // 5004 공과금은 예전 버전에서 72700(Electricity)을 달고 있었다. 이제 그 코드는
  // 세부 계정인 5033 전기료가 갖고, 5004는 총괄 계정으로 감사코드를 갖지 않는다.
  // 5034 인터넷의 영문명이 예전 설치본에는 5006과 같은 'Communication'으로
  // 남아있는 경우가 있다(계정은 만들어지고 나면 코드가 이름을 다시 안 고침).
  // 표시·검색 모두 nameEn을 쓰므로 여기서 명시적으로 맞춰준다.
  const internet = DB.accounts.find(a => a.code === '5034');
  if (internet && internet.nameEn !== 'Internet') { internet.nameEn = 'Internet'; changed = true; }
  const umbrella = DB.accounts.find(a => a.code === '5004');
  if (umbrella && umbrella.auditCode) { delete umbrella.auditCode; changed = true; }

  for (const acc of DB.accounts) {
    const mapped = AUDIT_CODE_MAP[acc.code];
    if (mapped && acc.auditCode !== mapped) { acc.auditCode = mapped; changed = true; }
  }
  for (const def of AUDIT_DETAIL_ACCOUNTS) {
    if (!DB.accounts.find(a => a.code === def.code)) { DB.accounts.push({...def}); changed = true; }
  }
  return changed;
}

// ── State ─────────────────────────────────────────────
const DEFAULT_SETTINGS = {
  companyName: 'JEY & Company Sdn Bhd',
  currency: 'MYR',
  sstRegistered: false,
  sstRate: 6,
  sstNo: '',
  defaultArAccount: 'a1003',     // Accounts Receivable
  defaultApAccount: 'a2001',     // Accounts Payable
  defaultSalesAccount: 'a4002',  // Commission Income (primary revenue)
  defaultBankAccount: 'a1002',   // Bank
  defaultSstOutput: 'a2002',     // Tax Payable (SST output)
  defaultSstInput: 'a1006',      // SST Input (added below if missing)
  fiscalYearStart: '07-01',  // Malaysian fiscal year: Jul 1 - Jun 30
};

let DB = {
  accounts: [], entries: [], assets: [],
  customers: [], suppliers: [],
  invoices: [], bills: [],
  receipts: [], payments: [],
  pendingEntries: [],
  bankTransactions: [],
  settings: {...DEFAULT_SETTINGS},
};

function loadDB() {
  const raw = localStorage.getItem('jey_accounting');
  if (raw) {
    DB = JSON.parse(raw);
    // Migration: ensure all keys exist
    if (!DB.customers) DB.customers = [];
    if (!DB.suppliers) DB.suppliers = [];
    if (!DB.invoices)  DB.invoices  = [];
    if (!DB.bills)     DB.bills     = [];
    if (!DB.receipts)       DB.receipts       = [];
    if (!DB.payments)       DB.payments       = [];
    if (!DB.pendingEntries) DB.pendingEntries = [];
    if (!DB.bankTransactions) DB.bankTransactions = [];
    if (!DB.settings)  DB.settings  = {...DEFAULT_SETTINGS};
    else DB.settings  = {...DEFAULT_SETTINGS, ...DB.settings};
    // Ensure SST Input account exists if SST registered
    if (!DB.accounts.find(a=>a.code==='1006')) {
      DB.accounts.push({id:'a1006',code:'1006',nameKr:'SST 매입세액',nameEn:'SST Input Tax',type:'asset'});
    }
    // Persist immediately when the migration adds/moves accounts, so the new
    // chart reaches localStorage and the cloud even if the user only reads.
    if (ensureAuditChartAccounts()) saveDB();
    // 디버그 정보
    console.log('✅ DB 로드됨:', {
      accounts: DB.accounts.length,
      entries: DB.entries.length,
      settings: DB.settings.companyName
    });
  } else {
    DB = {
      accounts: JSON.parse(JSON.stringify(DEFAULT_ACCOUNTS)),
      entries:[], assets:[],
      customers:[], suppliers:[],
      invoices:[], bills:[],
      receipts:[], payments:[],
      settings: {...DEFAULT_SETTINGS},
    };
    // Add SST input account by default
    DB.accounts.push({id:'a1006',code:'1006',nameKr:'SST 매입세액',nameEn:'SST Input Tax',type:'asset'});
    ensureAuditChartAccounts();
    console.log('⚠️ localStorage 없음 - 기본값으로 초기화됨');
    saveDB();
  }
}
function saveDB() {
  localStorage.setItem('jey_accounting', JSON.stringify(DB));
  autoBackup();
  // Async: sync to Supabase if supabase-db.js is loaded
  if (typeof syncAllToSupabase === 'function') {
    syncAllToSupabase().catch(e => console.warn('Supabase sync failed:', e));
  }
}

// ── Auto-Backup: rolling daily snapshots in localStorage ──
// Keeps last 14 daily snapshots; reminds user to download full backup every 14 days
const AUTOBACKUP_KEY = 'jey_accounting_autobackups';
const AUTOBACKUP_MAX = 14;

function autoBackup() {
  try {
    const today_ = today();
    let snaps = JSON.parse(localStorage.getItem(AUTOBACKUP_KEY) || '[]');
    // Replace today's snapshot if it exists, else prepend
    snaps = snaps.filter(s => s.date !== today_);
    snaps.unshift({date: today_, ts: Date.now(), data: localStorage.getItem('jey_accounting')});
    // Keep last N
    snaps = snaps.slice(0, AUTOBACKUP_MAX);
    localStorage.setItem(AUTOBACKUP_KEY, JSON.stringify(snaps));
  } catch (e) {
    console.warn('Auto-backup failed:', e);
  }
}

function listAutoBackups() {
  try { return JSON.parse(localStorage.getItem(AUTOBACKUP_KEY) || '[]'); }
  catch { return []; }
}

function restoreAutoBackup(date) {
  const snaps = listAutoBackups();
  const snap = snaps.find(s => s.date === date);
  if (!snap) return alert('백업을 찾을 수 없습니다.');
  if (!confirm(`${date} 스냅샷으로 복구하시겠습니까?\n현재 데이터를 덮어쓰며 페이지가 새로고침됩니다.`)) return;
  // Save current state as emergency backup before restoring
  localStorage.setItem('jey_accounting_pre_restore', localStorage.getItem('jey_accounting'));
  localStorage.setItem('jey_accounting', snap.data);
  location.reload();
}

function deleteAutoBackup(date) {
  if (!confirm(`${date} 스냅샷을 삭제하시겠습니까?`)) return;
  const snaps = listAutoBackups().filter(s => s.date !== date);
  localStorage.setItem(AUTOBACKUP_KEY, JSON.stringify(snaps));
  renderBackupPanel();
}

function getLastExportDate() {
  return localStorage.getItem('jey_accounting_last_export') || null;
}

function setLastExportDate() {
  localStorage.setItem('jey_accounting_last_export', today());
}

function daysSinceLastExport() {
  const last = getLastExportDate();
  if (!last) return Infinity;
  return Math.floor((Date.now() - new Date(last).getTime()) / 86400000);
}

function renderBackupPanel() {
  const el = document.getElementById('autobackup-panel');
  if (!el) return;
  const snaps = listAutoBackups();
  const days = daysSinceLastExport();
  const warn = days >= 14
    ? `<div style="background:#fef3c7;border-left:4px solid #d97706;padding:.6rem .8rem;border-radius:4px;margin-bottom:.75rem;font-size:.82rem">
        ⚠️ 마지막 파일 백업 ${days===Infinity?'기록 없음':days+'일 전'} — 클라우드/USB에 JSON Export 권장
      </div>`
    : `<div style="font-size:.78rem;color:#0ea572;margin-bottom:.5rem">✓ 마지막 파일 백업: ${days}일 전</div>`;
  el.innerHTML = `
    ${warn}
    <p style="font-size:.78rem;color:var(--text-muted);margin-bottom:.5rem">매 저장 시 자동 스냅샷 (최근 ${AUTOBACKUP_MAX}일)</p>
    <table class="table" style="font-size:.8rem">
      <thead><tr><th>날짜</th><th>크기</th><th></th></tr></thead>
      <tbody>
        ${snaps.length ? snaps.map(s=>`<tr>
          <td><strong>${s.date}</strong></td>
          <td style="font-size:.75rem;color:var(--text-muted)">${(s.data.length/1024).toFixed(1)} KB</td>
          <td style="text-align:right">
            <button class="btn btn-sm btn-outline" onclick="restoreAutoBackup('${s.date}')">복구</button>
            <button class="btn btn-sm btn-danger" onclick="deleteAutoBackup('${s.date}')">✕</button>
          </td>
        </tr>`).join('') : '<tr><td colspan="3" class="empty-msg">스냅샷 없음</td></tr>'}
      </tbody>
    </table>
  `;
}

// ── Common helpers ────────────────────────────────────
const getCustomer = (id) => DB.customers.find(c=>c.id===id);
const getSupplier = (id) => DB.suppliers.find(s=>s.id===id);
const getInvoice  = (id) => DB.invoices.find(i=>i.id===id);
const getBill     = (id) => DB.bills.find(b=>b.id===id);

function findAccountByCode(code) {
  return DB.accounts.find(a=>a.code===String(code).trim());
}

function customerOutstanding(customerId, asOfDate=null) {
  let total = 0;
  for (const inv of DB.invoices) {
    if (inv.customerId !== customerId) continue;
    if (asOfDate && inv.date > asOfDate) continue;
    total += Number(inv.total||0) - Number(inv.paid||0);
  }
  return total;
}

function supplierOutstanding(supplierId, asOfDate=null) {
  let total = 0;
  for (const bill of DB.bills) {
    if (bill.supplierId !== supplierId) continue;
    if (asOfDate && bill.date > asOfDate) continue;
    total += Number(bill.total||0) - Number(bill.paid||0);
  }
  return total;
}

function invoiceStatus(inv) {
  const total = Number(inv.total||0);
  const paid  = Number(inv.paid||0);
  if (paid >= total - 0.001) return 'paid';
  if (paid > 0) return 'partial';
  if (inv.dueDate && inv.dueDate < today()) return 'overdue';
  return 'outstanding';
}
function billStatus(b) { return invoiceStatus(b); }

// Auto-numbering
function nextNumber(prefix, list, dateStr) {
  const ym = (dateStr||today()).slice(0,7).replace('-','');
  const n = list.filter(x=>(x.number||'').startsWith(prefix+ym)).length + 1;
  return `${prefix}${ym}${String(n).padStart(3,'0')}`;
}

// ── Account Helpers ───────────────────────────────────
function getAccount(id) { return DB.accounts.find(a=>a.id===id); }
function accountLabel(a) { return a ? `${a.code} ${a.nameKr}` : ''; }

// Normal balance: debit-side = asset, expense; credit-side = liability, equity, revenue
function normalBalance(type) {
  return ['asset','expense'].includes(type) ? 'debit' : 'credit';
}

// Compute running balance for an account across all entries (optionally up to a date)
function accountBalance(accountId, upToDate=null) {
  const acc = getAccount(accountId);
  if (!acc) return 0;
  let dr=0, cr=0;
  for (const entry of DB.entries) {
    if (upToDate && entry.date > upToDate) continue;
    for (const line of entry.lines) {
      if (line.accountId === accountId) {
        dr += Number(line.debit||0);
        cr += Number(line.credit||0);
      }
    }
  }
  if (acc.contra) return cr - dr;
  return normalBalance(acc.type)==='debit' ? dr-cr : cr-dr;
}

// Compute balance for an account within a date range
function accountBalanceRange(accountId, fromDate, toDate) {
  let dr=0, cr=0;
  for (const entry of DB.entries) {
    if (entry.date < fromDate || entry.date > toDate) continue;
    for (const line of entry.lines) {
      if (line.accountId === accountId) {
        dr += Number(line.debit||0);
        cr += Number(line.credit||0);
      }
    }
  }
  return {dr, cr};
}

// ── Navigation ────────────────────────────────────────
function showSection(name) {
  document.querySelectorAll('.section').forEach(s=>s.classList.remove('active'));
  document.querySelectorAll('.nav-link').forEach(a=>a.classList.remove('active'));
  const sec = document.getElementById(`section-${name}`);
  if (sec) sec.classList.add('active');
  const link = document.querySelector(`.nav-link[data-section="${name}"]`);
  if (link) link.classList.add('active');

  // Lazy render
  if (name==='dashboard') renderDashboard();
  if (name==='accounts')  renderAccounts();
  if (name==='journal')   renderJournal();
  if (name==='ledger')    renderLedger();
  if (name==='assets')    renderAssets();
  if (name==='pl')        { setDefaultDates(); renderPL(); }
  if (name==='bs')        { setDefaultDates(); renderBS(); }
  if (name==='trial')     { setDefaultDates(); renderTrial(); }
  if (name==='ar-customers') renderCustomers();
  if (name==='ar-invoices')  renderInvoices();
  if (name==='ar-receipts')  renderReceipts();
  if (name==='ar-aging')     { setDefaultDates(); /* user clicks Generate */ }
  if (name==='ap-suppliers') renderSuppliers();
  if (name==='ap-bills')     renderBills();
  if (name==='ap-payments')  renderPayments();
  if (name==='ap-aging')     { setDefaultDates(); }
  if (name==='sst')          { setDefaultDates(); }
  if (name==='import')       { renderImportSection(); renderBackupPanel(); }
  if (name==='quick-entry')  { if (typeof renderQuickEntry === 'function') renderQuickEntry(); }
  if (name==='bank-statement') { if (typeof renderBankStatement === 'function') renderBankStatement(); }
  if (name==='bank-unclassified') { if (typeof renderUnclassifiedBank === 'function') renderUnclassifiedBank(); }
  if (name==='director-claim')    { if (typeof renderDirectorClaim === 'function') renderDirectorClaim(); }
  if (name==='tax-cp58')        { if (typeof renderCP58 === 'function') renderCP58(); }
  if (name==='tax-computation') { if (typeof renderTaxComputation === 'function') renderTaxComputation(); }
  if (name==='tax-calendar')    { if (typeof renderTaxCalendar === 'function') renderTaxCalendar(); }
  if (name==='ratios')          { if (typeof renderRatios === 'function') renderRatios(); }
  if (name==='closing')         { if (typeof renderYearEndClosing === 'function') renderYearEndClosing(); }
  if (name==='employees')       { if (typeof renderEmployees === 'function') renderEmployees(); }
  if (name==='payroll-run')     { if (typeof renderPayrollRun === 'function') renderPayrollRun(); }
  if (name==='forex')           { if (typeof renderForexSettings === 'function') { renderForexSettings(); renderForexCalculator(); } }
  if (name==='tax-wht')         { if (typeof renderWHTReport === 'function') renderWHTReport(); }
  if (name==='users')           { if (typeof renderUsersManagement === 'function') renderUsersManagement(); }
  if (name==='cloud-backup')    { if (typeof renderCloudBackup === 'function') renderCloudBackup(); }
  if (name==='pending')         { if (typeof renderPendingEntries === 'function') renderPendingEntries(); }
}

function setDefaultDates() {
  // entries가 있으면 그 범위를 기본값으로 사용
  if (DB.entries && DB.entries.length > 0) {
    const dates = DB.entries.map(e => e.date).sort();
    const fromDate = dates[0];
    const toDate = dates[dates.length - 1];
    if (document.getElementById('pl-from') && !document.getElementById('pl-from').value)
      document.getElementById('pl-from').value = fromDate;
    if (document.getElementById('pl-to') && !document.getElementById('pl-to').value)
      document.getElementById('pl-to').value = toDate;
    if (document.getElementById('bs-date') && !document.getElementById('bs-date').value)
      document.getElementById('bs-date').value = toDate;
    if (document.getElementById('trial-date') && !document.getElementById('trial-date').value)
      document.getElementById('trial-date').value = toDate;
  } else {
    // entries가 없으면 Malaysian fiscal year 기본값 사용
    const now = new Date();
    const y = now.getFullYear();
    const m = now.getMonth() + 1;  // 1-12

    // Malaysian fiscal year: Jul 1 - Jun 30
    let fromYear = y;
    if (m < 7) {
      fromYear = y - 1;  // If before July, start from previous year
    }

    const toDate = today();
    const fromDate = `${fromYear}-07-01`;

    if (document.getElementById('pl-from') && !document.getElementById('pl-from').value)
      document.getElementById('pl-from').value = fromDate;
    if (document.getElementById('pl-to') && !document.getElementById('pl-to').value)
      document.getElementById('pl-to').value = toDate;
    if (document.getElementById('bs-date') && !document.getElementById('bs-date').value)
      document.getElementById('bs-date').value = toDate;
    if (document.getElementById('trial-date') && !document.getElementById('trial-date').value)
      document.getElementById('trial-date').value = toDate;
  }
}

// ── Dashboard ─────────────────────────────────────────
function renderDashboard() {
  const now = new Date();
  const y = now.getFullYear();
  const m = now.getMonth() + 1;  // 1-12

  // Malaysian fiscal year: Jul 1 - Jun 30
  let fromYear = y;
  if (m < 7) {
    fromYear = y - 1;
  }

  const fromDate = `${fromYear}-07-01`;
  const toDate   = today();

  const periodLabel = fromYear === y ? `${y} FY` : `${fromYear}-${y} FY`;
  const dataStatus = DB.entries && DB.entries.length > 0
    ? `✅ ${DB.entries.length} entries 로드됨`
    : '⚠️ 데이터 없음';
  document.getElementById('dash-period').textContent = `${periodLabel} | ${dataStatus}`;

  // Key figures
  const totalAssets = DB.accounts.filter(a=>a.type==='asset'&&!a.contra).reduce((s,a)=>s+accountBalance(a.id,toDate),0)
                    - DB.accounts.filter(a=>a.type==='asset'&&a.contra).reduce((s,a)=>s+accountBalance(a.id,toDate),0);
  const totalLiab   = DB.accounts.filter(a=>a.type==='liability').reduce((s,a)=>s+accountBalance(a.id,toDate),0);
  const totalRev    = DB.accounts.filter(a=>a.type==='revenue').reduce((s,a)=>s+accountBalanceRange(a.id,fromDate,toDate).cr - accountBalanceRange(a.id,fromDate,toDate).dr,0);
  const totalExp    = DB.accounts.filter(a=>a.type==='expense').reduce((s,a)=>s+accountBalanceRange(a.id,fromDate,toDate).dr - accountBalanceRange(a.id,fromDate,toDate).cr,0);
  const netIncome   = totalRev - totalExp;

  const cards = [
    {label:'총 자산', value: fmtN(totalAssets), cls:'neutral'},
    {label:'총 부채', value: fmtN(totalLiab),   cls:'negative'},
    {label:'YTD 매출', value: fmtN(totalRev),   cls:'positive'},
    {label:'YTD 순이익', value: fmtN(netIncome), cls: netIncome>=0?'positive':'negative'},
  ];
  document.getElementById('dash-cards').innerHTML = cards.map(c=>`
    <div class="stat-card">
      <div class="label">${c.label}</div>
      <div class="value ${c.cls}">MYR ${c.value}</div>
    </div>`).join('');

  // Recent entries
  const recent = [...DB.entries].sort((a,b)=>b.date.localeCompare(a.date)).slice(0,8);
  const tbody = document.querySelector('#dash-recent-entries tbody');
  tbody.innerHTML = recent.length ? recent.map(e=>{
    const total = e.lines.reduce((s,l)=>s+Number(l.debit||0),0);
    return `<tr>
      <td>${e.date}</td>
      <td>${e.description||e.reference||'—'}</td>
      <td class="num">${fmtN(total)}</td>
    </tr>`;
  }).join('') : '<tr><td colspan="3" class="empty-msg">전표 없음</td></tr>';

  // Monthly chart (last 6 months)
  const months = [];
  for (let i=5; i>=0; i--) {
    const d = new Date(now.getFullYear(), now.getMonth()-i, 1);
    months.push({
      label: `${d.getMonth()+1}월`,
      from: `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-01`,
      to:   `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(new Date(d.getFullYear(),d.getMonth()+1,0).getDate()).padStart(2,'0')}`,
    });
  }
  const monthlyData = months.map(m=>{
    const rev = DB.accounts.filter(a=>a.type==='revenue').reduce((s,a)=>{
      const {dr,cr} = accountBalanceRange(a.id, m.from, m.to);
      return s + cr - dr;
    },0);
    const exp = DB.accounts.filter(a=>a.type==='expense').reduce((s,a)=>{
      const {dr,cr} = accountBalanceRange(a.id, m.from, m.to);
      return s + dr - cr;
    },0);
    return {label:m.label, net:rev-exp, rev};
  });
  const maxVal = Math.max(...monthlyData.map(d=>Math.abs(d.net)),1);
  document.getElementById('dash-monthly-chart').innerHTML = monthlyData.map(d=>{
    const pct = Math.round(Math.abs(d.net)/maxVal*100);
    const color = d.net>=0 ? '#0ea572' : '#dc2626';
    return `<div class="chart-bar-row">
      <span class="chart-bar-label">${d.label}</span>
      <div class="chart-bar-wrap"><div class="chart-bar-fill" style="width:${pct}%;background:${color}"></div></div>
      <span class="chart-bar-val" style="color:${color}">${fmtN(d.net)}</span>
    </div>`;
  }).join('');

  // AR Outstanding summary
  const arSummary = document.getElementById('dash-ar-summary');
  if (arSummary) {
    const outstandingByCust = DB.customers.map(c => ({c, bal: customerOutstanding(c.id)})).filter(x=>x.bal>0.01).sort((a,b)=>b.bal-a.bal).slice(0,5);
    const totalAr = DB.customers.reduce((s,c)=>s+customerOutstanding(c.id),0);
    arSummary.innerHTML = outstandingByCust.length ?
      `<div style="font-size:.78rem;color:var(--text-muted);margin-bottom:.5rem">Top 5 outstanding · Total: <strong style="color:#dc2626">MYR ${fmtN(totalAr)}</strong></div>
      ${outstandingByCust.map(x=>`<div style="display:flex;justify-content:space-between;padding:.3rem 0;font-size:.82rem;border-bottom:1px solid var(--border)">
        <span>${x.c.name}</span><span style="color:#dc2626;font-weight:600">${fmtN(x.bal)}</span>
      </div>`).join('')}` :
      '<p class="empty-msg" style="font-size:.82rem">No outstanding receivables.</p>';
  }
  // AP Overdue summary
  const apOverdue = document.getElementById('dash-ap-overdue');
  if (apOverdue) {
    const todayDate = today();
    const overdueBills = DB.bills.filter(b=>{
      const bal = Number(b.total||0)-Number(b.paid||0);
      return bal>0.01 && b.dueDate && b.dueDate < todayDate;
    }).sort((a,b)=>a.dueDate.localeCompare(b.dueDate)).slice(0,5);
    apOverdue.innerHTML = overdueBills.length ?
      `<div style="font-size:.78rem;color:var(--text-muted);margin-bottom:.5rem">${overdueBills.length} overdue bill(s)</div>
      ${overdueBills.map(b=>{
        const sup = getSupplier(b.supplierId);
        const bal = Number(b.total||0)-Number(b.paid||0);
        return `<div style="display:flex;justify-content:space-between;padding:.3rem 0;font-size:.82rem;border-bottom:1px solid var(--border)">
          <span>${sup?sup.name:'—'} <span style="color:var(--text-muted);font-size:.7rem">· due ${b.dueDate}</span></span>
          <span style="color:#dc2626;font-weight:600">${fmtN(bal)}</span>
        </div>`;
      }).join('')}` :
      '<p class="empty-msg" style="font-size:.82rem">No overdue bills.</p>';
  }
}

// ── Accounts ──────────────────────────────────────────
const TYPE_LABELS = {asset:'자산', liability:'부채', equity:'자본', revenue:'수익', expense:'비용'};
const TYPE_ORDER  = ['asset','liability','equity','revenue','expense'];

function renderAccounts() {
  const groups = TYPE_ORDER.map(type=>({type, accounts: DB.accounts.filter(a=>a.type===type).sort((a,b)=>a.code.localeCompare(b.code))}));
  document.getElementById('account-groups').innerHTML = groups.map(g=>`
    <div class="acc-group-card">
      <div class="acc-group-header ${g.type}">
        <h3>${TYPE_LABELS[g.type]} (${g.type.charAt(0).toUpperCase()+g.type.slice(1)})</h3>
        <span style="font-size:.72rem;color:rgba(255,255,255,.7)">${g.accounts.length}개</span>
      </div>
      ${g.accounts.map(a=>`
        <div class="acc-group-item">
          <div>
            <span class="acc-code">${a.code}</span>
            <span class="acc-name">${a.nameKr}</span>
            ${a.auditCode?`<span title="감사법인 GL 코드" style="font-size:.62rem;color:#6366f1;background:#eef2ff;border-radius:3px;padding:.05rem .3rem;margin-left:.3rem">감사 ${a.auditCode}</span>`:''}
            ${a.contra?'<span style="font-size:.65rem;color:#94a3b8;margin-left:.3rem">[차감]</span>':''}
            <div style="font-size:.68rem;color:#94a3b8">${a.nameEn}</div>
          </div>
          <div class="acc-actions">
            <button onclick="openAccountModal('${a.id}')" title="수정">✏️</button>
            <button onclick="deleteAccount('${a.id}')" title="삭제">🗑️</button>
          </div>
        </div>`).join('')}
    </div>`).join('');
}

function openAccountModal(id=null) {
  const acc = id ? getAccount(id) : null;
  document.getElementById('account-modal-title').textContent = acc ? 'Edit Account / 계정 수정' : 'Add Account / 계정 추가';
  document.getElementById('acc-code').value   = acc ? acc.code    : '';
  // The HTML has a single 'acc-name' field — we display "EN | KR" combined
  const nameField = document.getElementById('acc-name');
  if (nameField) nameField.value = acc ? (acc.nameEn ? `${acc.nameEn} | ${acc.nameKr}` : acc.nameKr) : '';
  document.getElementById('acc-type').value   = acc ? acc.type    : 'asset';
  const auditEl = document.getElementById('acc-audit-code');
  if (auditEl) auditEl.value = acc ? (acc.auditCode || '') : '';
  const contraEl = document.getElementById('acc-contra');
  if (contraEl) contraEl.checked = acc ? !!acc.contra : false;
  document.getElementById('acc-edit-id').value= acc ? acc.id      : '';
  document.getElementById('modal-account').style.display='flex';
}

function saveAccount() {
  const code = document.getElementById('acc-code').value.trim();
  const nameRaw = (document.getElementById('acc-name')?.value||'').trim();
  const type   = document.getElementById('acc-type').value;
  const contra = document.getElementById('acc-contra')?.checked || false;
  const editId = document.getElementById('acc-edit-id').value;
  if (!code||!nameRaw) return alert('Please enter account code and name. / 계정 코드와 명칭을 입력하세요.');
  // Split "English | Korean" if present
  let nameEn = '', nameKr = '';
  if (nameRaw.includes('|')) {
    const [en, kr] = nameRaw.split('|').map(s=>s.trim());
    nameEn = en; nameKr = kr || en;
  } else {
    nameEn = nameRaw; nameKr = nameRaw;
  }
  if (!editId && DB.accounts.find(a=>a.code===code)) return alert('Account code already exists. / 이미 존재하는 계정 코드입니다.');
  // Map 'cogs' (UI) → 'expense' (logic) but flag with subType
  const dbType = (type==='cogs') ? 'expense' : type;
  const subType = (type==='cogs') ? 'cogs' : null;
  const auditCode = (document.getElementById('acc-audit-code')?.value||'').trim();
  if (editId) {
    const a = getAccount(editId);
    Object.assign(a,{code,nameKr,nameEn,type:dbType,subType,contra,auditCode});
  } else {
    DB.accounts.push({id:uid(),code,nameKr,nameEn,type:dbType,subType,contra,auditCode});
  }
  saveDB(); closeModal('modal-account'); renderAccounts();
  populateLedgerSelect();
  populateAccountDropdowns();
}

function deleteAccount(id) {
  const used = DB.entries.some(e=>e.lines.some(l=>l.accountId===id));
  if (used) return alert('이 계정은 전표에 사용 중이므로 삭제할 수 없습니다.');
  if (!confirm('이 계정을 삭제하시겠습니까?')) return;
  DB.accounts = DB.accounts.filter(a=>a.id!==id);
  saveDB(); renderAccounts();
}

// ── Journal Entries ───────────────────────────────────
const SOURCE_LABELS = {manual:'Manual', invoice:'Invoice', receipt:'Receipt', bill:'Bill', payment:'Payment', depreciation:'Depreciation', import:'Imported'};

function renderJournal() {
  const filter = document.getElementById('journal-filter-month').value;
  const search = (document.getElementById('journal-search').value||'').toLowerCase();
  const showAuto = document.getElementById('journal-show-auto')?.checked;
  let entries = [...DB.entries].sort((a,b)=>b.date.localeCompare(a.date)||b.id.localeCompare(a.id));
  if (filter) entries = entries.filter(e=>e.date.startsWith(filter));
  if (search) entries = entries.filter(e=>(e.description||'').toLowerCase().includes(search)||(e.reference||'').toLowerCase().includes(search));
  if (!showAuto) entries = entries.filter(e=>!e.source||e.source==='manual'||e.source==='import');

  const tbody = document.querySelector('#journal-table tbody');
  tbody.innerHTML = entries.length ? entries.map(e=>{
    const dr = e.lines.reduce((s,l)=>s+Number(l.debit||0),0);
    const cr = e.lines.reduce((s,l)=>s+Number(l.credit||0),0);
    const src = e.source || 'manual';
    const isLocked = src!=='manual' && src!=='import';
    return `<tr style="cursor:pointer" onclick="viewEntry('${e.id}')">
      <td>${e.date}</td>
      <td><span style="font-size:.75rem;color:var(--text-muted)">${e.reference||'—'}</span></td>
      <td>${e.description||'—'}</td>
      <td><span class="tag tag-${src}">${SOURCE_LABELS[src]||src}</span></td>
      <td class="num dr">${fmtN(dr)}</td>
      <td class="num cr">${fmtN(cr)}</td>
      <td>
        ${isLocked ? '<span style="font-size:.7rem;color:var(--text-muted)">자동</span>' :
        `<button class="btn btn-sm btn-outline" onclick="event.stopPropagation();openJournalModal('${e.id}')">Edit</button>
         <button class="btn btn-sm btn-danger"  onclick="event.stopPropagation();deleteEntry('${e.id}')" style="margin-left:.25rem">Del</button>`}
      </td>
    </tr>`;
  }).join('') : '<tr><td colspan="7" class="empty-msg">No journal entries.</td></tr>';
}

function viewEntry(id) {
  const e = DB.entries.find(x=>x.id===id);
  if (!e) return;
  document.getElementById('view-entry-content').innerHTML = `
    <div style="margin-bottom:1rem">
      <div style="display:flex;gap:2rem;font-size:.82rem">
        <div><strong>날짜:</strong> ${e.date}</div>
        <div><strong>참조번호:</strong> ${e.reference||'—'}</div>
      </div>
      <div style="margin-top:.4rem"><strong>적요:</strong> ${e.description||'—'}</div>
    </div>
    <table class="table">
      <thead><tr><th>계정과목</th><th class="num">차변 DR</th><th class="num">대변 CR</th></tr></thead>
      <tbody>
        ${e.lines.map(l=>{
          const a = getAccount(l.accountId);
          return `<tr>
            <td>${a?accountLabel(a):'알 수 없음'}</td>
            <td class="num dr">${Number(l.debit||0)>0?fmtN(l.debit):''}</td>
            <td class="num cr">${Number(l.credit||0)>0?fmtN(l.credit):''}</td>
          </tr>`;
        }).join('')}
        <tr style="border-top:2px solid var(--border);font-weight:700">
          <td>합계</td>
          <td class="num dr">${fmtN(e.lines.reduce((s,l)=>s+Number(l.debit||0),0))}</td>
          <td class="num cr">${fmtN(e.lines.reduce((s,l)=>s+Number(l.credit||0),0))}</td>
        </tr>
      </tbody>
    </table>`;
  document.getElementById('modal-view-entry').style.display='flex';
}

let jeLineCount = 0;
function openJournalModal(id=null) {
  const e = id ? DB.entries.find(x=>x.id===id) : null;
  document.getElementById('journal-modal-title').textContent = e ? '전표 수정' : '전표 입력';
  document.getElementById('je-date').value = e ? e.date : today();
  document.getElementById('je-ref').value  = e ? (e.reference||'') : autoRef();
  document.getElementById('je-desc').value = e ? (e.description||'') : '';
  document.getElementById('je-edit-id').value = e ? e.id : '';
  document.getElementById('je-lines').innerHTML = '';
  jeLineCount = 0;
  if (e) {
    e.lines.forEach(l=>addJELine(l.accountId, l.debit, l.credit));
  } else {
    addJELine(); addJELine();
  }
  updateJETotals();
  document.getElementById('modal-journal').style.display='flex';
}

function autoRef() {
  const n = DB.entries.length + 1;
  const d = new Date();
  return `JE${d.getFullYear()}${String(d.getMonth()+1).padStart(2,'0')}${String(n).padStart(3,'0')}`;
}

function addJELine(accountId='', debit='', credit='') {
  const idx = jeLineCount++;
  const opts = DB.accounts.sort((a,b)=>a.code.localeCompare(b.code))
    .map(a=>`<option value="${a.id}" ${a.id===accountId?'selected':''}>${a.code} ${a.nameKr}</option>`).join('');
  const div = document.createElement('div');
  div.className = 'je-line';
  div.id = `je-line-${idx}`;
  div.innerHTML = `
    <select class="input je-account" onchange="updateJETotals()">
      <option value="">-- 계정 선택 --</option>${opts}
    </select>
    <input type="number" class="input je-debit"  placeholder="0.00" step="0.01" min="0" value="${debit||''}"  oninput="onDRInput(this);updateJETotals()">
    <input type="number" class="input je-credit" placeholder="0.00" step="0.01" min="0" value="${credit||''}" oninput="onCRInput(this);updateJETotals()">
    <button class="je-line-remove" onclick="removeJELine('je-line-${idx}')">✕</button>`;
  document.getElementById('je-lines').appendChild(div);
}

function onDRInput(el) { if(Number(el.value)>0) { const cr=el.parentElement.querySelector('.je-credit'); cr.value=''; } }
function onCRInput(el) { if(Number(el.value)>0) { const dr=el.parentElement.querySelector('.je-debit');  dr.value=''; } }

function removeJELine(id) {
  const el = document.getElementById(id);
  if (el) { el.remove(); updateJETotals(); }
}

function updateJETotals() {
  const lines = getJELines();
  const dr = lines.reduce((s,l)=>s+Number(l.debit||0),0);
  const cr = lines.reduce((s,l)=>s+Number(l.credit||0),0);
  document.getElementById('je-total-dr').textContent = `DR: MYR ${fmtN(dr)}`;
  document.getElementById('je-total-cr').textContent = `CR: MYR ${fmtN(cr)}`;
  document.getElementById('je-total-dr').style.color = dr===cr&&dr>0 ? 'var(--accent)' : (dr>0?'#1e40af':'inherit');
  document.getElementById('je-total-cr').style.color = dr===cr&&cr>0 ? 'var(--accent)' : (cr>0?'#166534':'inherit');
  document.getElementById('je-balance-error').style.display = (dr>0||cr>0)&&Math.abs(dr-cr)>0.001 ? 'block' : 'none';
}

function getJELines() {
  return [...document.querySelectorAll('.je-line')].map(row=>({
    accountId: row.querySelector('.je-account').value,
    debit:     Number(row.querySelector('.je-debit').value||0),
    credit:    Number(row.querySelector('.je-credit').value||0),
  })).filter(l=>l.accountId);
}

function saveJournalEntry() {
  const date = document.getElementById('je-date').value;
  const ref  = document.getElementById('je-ref').value.trim();
  const desc = document.getElementById('je-desc').value.trim();
  const editId = document.getElementById('je-edit-id').value;
  if (!date) return alert('날짜를 선택하세요.');
  const lines = getJELines();
  if (lines.length < 2) return alert('최소 2개의 계정 항목이 필요합니다.');
  const dr = lines.reduce((s,l)=>s+Number(l.debit||0),0);
  const cr = lines.reduce((s,l)=>s+Number(l.credit||0),0);
  if (Math.abs(dr-cr)>0.001) return alert('차변과 대변 합계가 일치해야 합니다.');
  if (dr===0) return alert('금액을 입력하세요.');

  if (editId) {
    const e = DB.entries.find(x=>x.id===editId);
    Object.assign(e,{date,reference:ref,description:desc,lines});
  } else {
    DB.entries.push({id:uid(),date,reference:ref,description:desc,lines});
  }
  saveDB(); closeModal('modal-journal'); renderJournal();
}

function deleteEntry(id) {
  if (!confirm('이 전표를 삭제하시겠습니까?')) return;
  DB.entries = DB.entries.filter(e=>e.id!==id);
  saveDB(); renderJournal();
}

// ── Ledger ────────────────────────────────────────────
function renderLedger() {
  const accId  = document.getElementById('ledger-account').value;
  const from   = document.getElementById('ledger-from').value;
  const to     = document.getElementById('ledger-to').value;
  const content = document.getElementById('ledger-content');
  if (!accId) { content.innerHTML='<p class="empty-msg">계정을 선택하세요.</p>'; return; }

  const acc = getAccount(accId);
  let entries = DB.entries.filter(e=>e.lines.some(l=>l.accountId===accId));
  if (from) entries = entries.filter(e=>e.date>=from+'-01');
  if (to)   entries = entries.filter(e=>e.date<=to+'-31');
  entries.sort((a,b)=>a.date.localeCompare(b.date)||a.id.localeCompare(b.id));

  // Opening balance (before 'from')
  let openingBal = 0;
  if (from) {
    const fromDate = from+'-01';
    openingBal = accountBalance(accId, fromDate.slice(0,-3)+(String(Number(fromDate.slice(5,7))).padStart(2,'0')>='01' ? String(Number(fromDate.slice(8,10))-1).padStart(2,'0') : '01'));
    // Simpler: all entries before fromDate
    openingBal = 0;
    for (const e of DB.entries) {
      if (e.date < fromDate) {
        for (const l of e.lines) {
          if (l.accountId===accId) {
            const dr = Number(l.debit||0), cr = Number(l.credit||0);
            const isDebitNormal = ['asset','expense'].includes(acc.type) && !acc.contra;
            openingBal += isDebitNormal ? (dr-cr) : (cr-dr);
          }
        }
      }
    }
  }

  let runningBal = openingBal;
  const isDebitNormal = ['asset','expense'].includes(acc.type) && !acc.contra;

  const rows = entries.map(e=>{
    const line = e.lines.find(l=>l.accountId===accId);
    const dr = Number(line.debit||0), cr = Number(line.credit||0);
    runningBal += isDebitNormal ? (dr-cr) : (cr-dr);
    return `<tr>
      <td>${e.date}</td>
      <td>${e.reference||'—'}</td>
      <td>${e.description||'—'}</td>
      <td class="num dr">${dr>0?fmtN(dr):''}</td>
      <td class="num cr">${cr>0?fmtN(cr):''}</td>
      <td class="num" style="font-weight:600">${fmtN(runningBal)}</td>
    </tr>`;
  });

  content.innerHTML = `
    <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:1rem">
      <div>
        <strong style="font-size:1rem">${acc.code} ${acc.nameKr}</strong>
        <span class="tag tag-${acc.type}" style="margin-left:.5rem">${TYPE_LABELS[acc.type]}</span>
      </div>
      <div style="font-size:.82rem;color:var(--text-muted)">잔액: <strong>${fmt(runningBal)}</strong></div>
    </div>
    <table class="table">
      <thead><tr><th>날짜</th><th>참조번호</th><th>적요</th><th class="num">차변 DR</th><th class="num">대변 CR</th><th class="num">잔액</th></tr></thead>
      <tbody>
        ${from?`<tr style="background:#f8fafc;font-style:italic"><td colspan="5">전기 이월</td><td class="num">${fmtN(openingBal)}</td></tr>`:''}
        ${rows.join('')||'<tr><td colspan="6" class="empty-msg">거래 없음</td></tr>'}
      </tbody>
    </table>`;
}

function populateLedgerSelect() {
  const sel = document.getElementById('ledger-account');
  const cur = sel.value;
  sel.innerHTML = '<option value="">-- 계정 선택 --</option>' +
    TYPE_ORDER.flatMap(type=>{
      const accs = DB.accounts.filter(a=>a.type===type).sort((a,b)=>a.code.localeCompare(b.code));
      if (!accs.length) return [];
      return [`<optgroup label="${TYPE_LABELS[type]}">`,...accs.map(a=>`<option value="${a.id}" ${a.id===cur?'selected':''}>${a.code} ${a.nameKr}</option>`),'</optgroup>'];
    }).join('');
}

// ── Assets ────────────────────────────────────────────
function renderAssets() {
  const container = document.getElementById('assets-list');
  if (!DB.assets.length) { container.innerHTML='<p class="empty-msg">등록된 자산이 없습니다.</p>'; return; }

  container.innerHTML = DB.assets.map(asset=>{
    const monthlyDep = (asset.cost - asset.residual) / (asset.life * 12);
    const startDate  = new Date(asset.purchaseDate);
    const nowDate    = new Date();
    const months     = Math.max(0, (nowDate.getFullYear()-startDate.getFullYear())*12 + (nowDate.getMonth()-startDate.getMonth()));
    const maxMonths  = asset.life * 12;
    const accDep     = Math.min(months * monthlyDep, asset.cost - asset.residual);
    const bookValue  = asset.cost - accDep;
    const pct        = Math.round(accDep/(asset.cost-asset.residual||1)*100);

    return `<div class="asset-card">
      <div class="asset-card-header">
        <div>
          <h4>${asset.name}</h4>
          <div class="asset-meta">취득일: ${asset.purchaseDate} | 내용연수: ${asset.life}년 | ${asset.note||''}</div>
        </div>
        <div style="display:flex;gap:.4rem">
          <button class="btn btn-sm btn-outline" onclick="openAssetModal('${asset.id}')">수정</button>
          <button class="btn btn-sm btn-danger"  onclick="deleteAsset('${asset.id}')">삭제</button>
        </div>
      </div>
      <div class="asset-grid">
        <div class="asset-stat"><div class="label">취득원가</div><div class="value">MYR ${fmtN(asset.cost)}</div></div>
        <div class="asset-stat"><div class="label">연간 감가상각</div><div class="value">MYR ${fmtN(monthlyDep*12)}</div></div>
        <div class="asset-stat"><div class="label">누계 감가상각</div><div class="value" style="color:var(--warning)">MYR ${fmtN(accDep)}</div></div>
        <div class="asset-stat"><div class="label">장부가액</div><div class="value" style="color:var(--primary-lt)">MYR ${fmtN(bookValue)}</div></div>
      </div>
      <div class="dep-bar"><div class="dep-bar-fill" style="width:${pct}%"></div></div>
      <div style="font-size:.7rem;color:var(--text-muted);margin-top:.25rem">감가상각 ${pct}% 완료 (잔존가치: MYR ${fmtN(asset.residual)})</div>
    </div>`;
  }).join('');
}

function openAssetModal(id=null) {
  const a = id ? DB.assets.find(x=>x.id===id) : null;
  document.getElementById('asset-modal-title').textContent = a ? '자산 수정' : '자산 추가';
  document.getElementById('asset-name').value     = a ? a.name          : '';
  document.getElementById('asset-date').value     = a ? a.purchaseDate  : today();
  document.getElementById('asset-cost').value     = a ? a.cost          : '';
  document.getElementById('asset-residual').value = a ? a.residual      : '0';
  document.getElementById('asset-life').value     = a ? a.life          : '5';
  document.getElementById('asset-method').value   = a ? a.method        : 'straight-line';
  document.getElementById('asset-note').value     = a ? (a.note||'')    : '';
  document.getElementById('asset-edit-id').value  = a ? a.id            : '';
  document.getElementById('modal-asset').style.display='flex';
}

function saveAsset() {
  const name      = document.getElementById('asset-name').value.trim();
  const date      = document.getElementById('asset-date').value;
  const cost      = Number(document.getElementById('asset-cost').value);
  const residual  = Number(document.getElementById('asset-residual').value||0);
  const life      = Number(document.getElementById('asset-life').value);
  const method    = document.getElementById('asset-method').value;
  const note      = document.getElementById('asset-note').value.trim();
  const editId    = document.getElementById('asset-edit-id').value;
  if (!name||!date||!cost||!life) return alert('필수 항목을 입력하세요.');
  if (residual >= cost) return alert('잔존가치는 취득원가보다 작아야 합니다.');

  if (editId) {
    const a = DB.assets.find(x=>x.id===editId);
    Object.assign(a,{name,purchaseDate:date,cost,residual,life,method,note});
  } else {
    DB.assets.push({id:uid(),name,purchaseDate:date,cost,residual,life,method,note});
  }
  saveDB(); closeModal('modal-asset'); renderAssets();
}

function deleteAsset(id) {
  if (!confirm('이 자산을 삭제하시겠습니까?')) return;
  DB.assets = DB.assets.filter(a=>a.id!==id);
  saveDB(); renderAssets();
}

function postDepreciation() {
  const month = document.getElementById('dep-month').value;
  if (!month) return alert('감가상각 월을 선택하세요.');
  if (!DB.assets.length) return alert('등록된 자산이 없습니다.');

  // Find accounts
  const depExpAcc  = DB.accounts.find(a=>a.code==='5008');
  const accDepAcc  = DB.accounts.find(a=>a.code==='1501');
  if (!depExpAcc||!accDepAcc) return alert('감가상각비(5008) 및 감가상각누계액(1501) 계정이 필요합니다.');

  const [y,m] = month.split('-');
  const monthDate = `${y}-${m}-01`;
  const monthEnd  = `${y}-${m}-${String(new Date(Number(y),Number(m),0).getDate()).padStart(2,'0')}`;

  // Check if already posted
  const already = DB.entries.some(e=>e.date>=monthDate&&e.date<=monthEnd&&e.description&&e.description.includes('감가상각'));
  if (already && !confirm('해당 월에 이미 감가상각 분개가 있습니다. 계속 생성하시겠습니까?')) return;

  let totalDep = 0;
  const descParts = [];
  for (const asset of DB.assets) {
    const startDate = new Date(asset.purchaseDate);
    const entryDate = new Date(monthEnd);
    if (startDate > entryDate) continue;
    const monthly = (asset.cost - asset.residual) / (asset.life * 12);
    totalDep += monthly;
    descParts.push(`${asset.name}: MYR ${fmtN(monthly)}`);
  }

  if (totalDep<=0) return alert('계상할 감가상각액이 없습니다.');

  DB.entries.push({
    id:uid(),
    date: monthEnd,
    reference: `DEP-${y}${m}`,
    description: `${y}년 ${m}월 감가상각 (${descParts.join(', ')})`,
    lines:[
      {accountId: depExpAcc.id, debit: totalDep, credit: 0},
      {accountId: accDepAcc.id, debit: 0, credit: totalDep},
    ]
  });
  saveDB();
  alert(`감가상각 분개 생성 완료: MYR ${fmtN(totalDep)}`);
}

// ── P&L ───────────────────────────────────────────────
function renderPL() {
  const from = document.getElementById('pl-from').value;
  const to   = document.getElementById('pl-to').value;
  if (!from||!to) return;

  const revenue  = DB.accounts.filter(a=>a.type==='revenue').sort((a,b)=>a.code.localeCompare(b.code));
  const expenses = DB.accounts.filter(a=>a.type==='expense').sort((a,b)=>a.code.localeCompare(b.code));

  const revRows  = revenue.map(a=>{const {dr,cr}=accountBalanceRange(a.id,from,to);return{acc:a,val:cr-dr};});
  const expRows  = expenses.map(a=>{const {dr,cr}=accountBalanceRange(a.id,from,to);return{acc:a,val:dr-cr};});
  const totalRev = revRows.reduce((s,r)=>s+r.val,0);
  const totalExp = expRows.reduce((s,r)=>s+r.val,0);
  const netIncome= totalRev - totalExp;

  document.getElementById('pl-report').innerHTML = `
    <div class="report-title">
      <h2>JEY &amp; Company SB</h2>
      <p>손익계산서 (Profit & Loss Statement)</p>
      <p>${from} ~ ${to}</p>
    </div>
    <div class="report-section">
      <div class="report-section-title">수익 (Revenue)</div>
      ${revRows.map(r=>`<div class="report-row indent"><span>${r.acc.code} ${r.acc.nameKr}</span><span class="report-amt">${fmtN(r.val)}</span></div>`).join('')}
      <div class="report-row subtotal"><span>총 수익</span><span class="report-amt">${fmtN(totalRev)}</span></div>
    </div>
    <div class="report-section">
      <div class="report-section-title">비용 (Expenses)</div>
      ${expRows.map(r=>`<div class="report-row indent"><span>${r.acc.code} ${r.acc.nameKr}</span><span class="report-amt">${fmtN(r.val)}</span></div>`).join('')}
      <div class="report-row subtotal"><span>총 비용</span><span class="report-amt">${fmtN(totalExp)}</span></div>
    </div>
    <div class="report-row total ${netIncome>=0?'net-income':'net-loss'}">
      <span>${netIncome>=0?'당기순이익 (Net Income)':'당기순손실 (Net Loss)'}</span>
      <span class="report-amt">MYR ${fmtN(Math.abs(netIncome))}</span>
    </div>`;
}

// ── Balance Sheet ─────────────────────────────────────
function renderBS() {
  const date = document.getElementById('bs-date').value;
  if (!date) return;

  // P&L from start of year to date
  const yearStart = date.slice(0,4)+'-01-01';
  const revAccs = DB.accounts.filter(a=>a.type==='revenue');
  const expAccs = DB.accounts.filter(a=>a.type==='expense');
  const ytdRev = revAccs.reduce((s,a)=>{const {dr,cr}=accountBalanceRange(a.id,yearStart,date);return s+cr-dr;},0);
  const ytdExp = expAccs.reduce((s,a)=>{const {dr,cr}=accountBalanceRange(a.id,yearStart,date);return s+dr-cr;},0);
  const ytdNet = ytdRev - ytdExp;

  const assets    = DB.accounts.filter(a=>a.type==='asset'&&!a.contra).sort((a,b)=>a.code.localeCompare(b.code));
  const contra    = DB.accounts.filter(a=>a.type==='asset'&&a.contra);
  const liab      = DB.accounts.filter(a=>a.type==='liability').sort((a,b)=>a.code.localeCompare(b.code));
  const equity    = DB.accounts.filter(a=>a.type==='equity').sort((a,b)=>a.code.localeCompare(b.code));

  const assetBals  = assets.map(a=>({acc:a,val:accountBalance(a.id,date)}));
  const contraBals = contra.reduce((s,a)=>s+accountBalance(a.id,date),0);
  const liabBals   = liab.map(a=>({acc:a,val:accountBalance(a.id,date)}));
  const equBals    = equity.map(a=>({acc:a,val:accountBalance(a.id,date)}));

  const totalAsset = assetBals.reduce((s,r)=>s+r.val,0) - contraBals;
  const totalLiab  = liabBals.reduce((s,r)=>s+r.val,0);
  const totalEqu   = equBals.reduce((s,r)=>s+r.val,0) + ytdNet;
  const totalLE    = totalLiab + totalEqu;
  const balanced   = Math.abs(totalAsset-totalLE) < 0.01;

  document.getElementById('bs-report').innerHTML = `
    <div class="report-title">
      <h2>JEY &amp; Company SB</h2>
      <p>대차대조표 (Balance Sheet)</p>
      <p>${date} 현재</p>
    </div>
    <div style="display:grid;grid-template-columns:1fr 1fr;gap:2rem">
      <div>
        <div class="report-section-title">자산 (Assets)</div>
        ${assetBals.map(r=>`<div class="report-row indent"><span>${r.acc.code} ${r.acc.nameKr}</span><span class="report-amt">${fmtN(r.val)}</span></div>`).join('')}
        ${contraBals!==0?`<div class="report-row indent" style="color:var(--danger)"><span>감가상각누계액</span><span class="report-amt">(${fmtN(contraBals)})</span></div>`:''}
        <div class="report-row total"><span>총 자산</span><span class="report-amt">MYR ${fmtN(totalAsset)}</span></div>
      </div>
      <div>
        <div class="report-section-title">부채 (Liabilities)</div>
        ${liabBals.map(r=>`<div class="report-row indent"><span>${r.acc.code} ${r.acc.nameKr}</span><span class="report-amt">${fmtN(r.val)}</span></div>`).join('')}
        <div class="report-row subtotal"><span>총 부채</span><span class="report-amt">${fmtN(totalLiab)}</span></div>
        <div class="report-section-title" style="margin-top:1rem">자본 (Equity)</div>
        ${equBals.map(r=>`<div class="report-row indent"><span>${r.acc.code} ${r.acc.nameKr}</span><span class="report-amt">${fmtN(r.val)}</span></div>`).join('')}
        <div class="report-row indent ${ytdNet>=0?'':'net-loss'}"><span>당기순${ytdNet>=0?'이익':'손실'}</span><span class="report-amt">${fmtN(ytdNet)}</span></div>
        <div class="report-row subtotal"><span>총 자본</span><span class="report-amt">${fmtN(totalEqu)}</span></div>
        <div class="report-row total"><span>부채 + 자본 합계</span><span class="report-amt">MYR ${fmtN(totalLE)}</span></div>
      </div>
    </div>
    <div class="report-balance-check ${balanced?'report-balance-ok':'report-balance-fail'}">
      ${balanced ? '✅ 대차 일치 (Assets = Liabilities + Equity)' : '⚠️ 대차 불일치 — 전표를 확인하세요.'}
    </div>`;
}

// ── Trial Balance ─────────────────────────────────────
function renderTrial() {
  const date = document.getElementById('trial-date').value;
  if (!date) return;

  const rows = DB.accounts.sort((a,b)=>a.code.localeCompare(b.code)).map(acc=>{
    let dr=0, cr=0;
    for (const e of DB.entries) {
      if (e.date>date) continue;
      for (const l of e.lines) {
        if (l.accountId===acc.id) { dr+=Number(l.debit||0); cr+=Number(l.credit||0); }
      }
    }
    return {acc, dr, cr};
  }).filter(r=>r.dr>0||r.cr>0);

  const totDR = rows.reduce((s,r)=>s+r.dr,0);
  const totCR = rows.reduce((s,r)=>s+r.cr,0);

  document.getElementById('trial-report').innerHTML = `
    <div class="report-title">
      <h2>JEY &amp; Company SB</h2>
      <p>시산표 (Trial Balance)</p>
      <p>${date} 현재</p>
    </div>
    <table class="table">
      <thead>
        <tr><th>코드</th><th>계정과목</th><th>구분</th><th class="num">차변 (DR)</th><th class="num">대변 (CR)</th></tr>
      </thead>
      <tbody>
        ${rows.map(r=>`<tr>
          <td>${r.acc.code}</td>
          <td>${r.acc.nameKr}</td>
          <td><span class="tag tag-${r.acc.type}">${TYPE_LABELS[r.acc.type]}</span></td>
          <td class="num dr">${r.dr>0?fmtN(r.dr):''}</td>
          <td class="num cr">${r.cr>0?fmtN(r.cr):''}</td>
        </tr>`).join('')}
        <tr style="font-weight:700;border-top:2px solid var(--text)">
          <td colspan="3">합계</td>
          <td class="num dr">${fmtN(totDR)}</td>
          <td class="num cr">${fmtN(totCR)}</td>
        </tr>
      </tbody>
    </table>
    <div class="report-balance-check ${Math.abs(totDR-totCR)<0.01?'report-balance-ok':'report-balance-fail'}">
      ${Math.abs(totDR-totCR)<0.01 ? '✅ 차변 = 대변 (균형)' : '⚠️ 차변 ≠ 대변 — 전표를 확인하세요.'}
    </div>`;
}

// ── Export / Import ───────────────────────────────────
function exportData() {
  const blob = new Blob([JSON.stringify(DB,null,2)], {type:'application/json'});
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `jey_accounting_${today()}.json`;
  a.click();
  setLastExportDate();
  renderBackupPanel();
}

function importData(event) {
  const file = event.target.files[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = e => {
    try {
      const data = JSON.parse(e.target.result);
      if (!data.accounts||!data.entries) throw new Error('Invalid format');
      if (!confirm('This will overwrite current data. Continue? / 현재 데이터를 덮어씁니다. 계속하시겠습니까?')) return;
      DB = data;
      // Apply migration to imported data
      if (!DB.customers) DB.customers = [];
      if (!DB.suppliers) DB.suppliers = [];
      if (!DB.invoices)  DB.invoices  = [];
      if (!DB.bills)     DB.bills     = [];
      if (!DB.receipts)  DB.receipts  = [];
      if (!DB.payments)  DB.payments  = [];
      if (!DB.settings)  DB.settings  = {...DEFAULT_SETTINGS};
      saveDB();
      location.reload();
    } catch (err) {
      console.error(err);
      alert('Invalid file format. / 올바른 형식의 파일이 아닙니다.');
    }
  };
  reader.readAsText(file);
  event.target.value='';
}
// HTML calls importJsonBackup
const importJsonBackup = importData;

// Populate dropdowns referencing accounts (used by AR/AP modals)
function populateAccountDropdowns() {
  // Bank accounts (asset, code starts with 100x or contains 'bank/cash')
  const bankAccs = DB.accounts.filter(a=>a.type==='asset' && !a.contra && (
    a.code.startsWith('100') || /bank|cash|maybank|cimb|rhb|hong leong|public/i.test(a.nameEn||'') || /은행|현금/.test(a.nameKr||'')
  )).sort((a,b)=>a.code.localeCompare(b.code));
  const bankOpts = '<option value="">-- Select Account --</option>' +
    bankAccs.map(a=>`<option value="${a.id}">${a.code} ${a.nameEn||a.nameKr}</option>`).join('');
  ['rcpt-bank','pay-bank'].forEach(id=>{
    const el = document.getElementById(id);
    if (el) { const cur = el.value; el.innerHTML = bankOpts; el.value = cur || (bankAccs[0]?.id||''); }
  });
  // Customer/Supplier dropdowns
  const custOpts = '<option value="">-- Select Customer --</option>' +
    DB.customers.sort((a,b)=>(a.code||'').localeCompare(b.code||'')).map(c=>`<option value="${c.id}">${c.code} ${c.name}</option>`).join('');
  ['inv-customer','rcpt-customer'].forEach(id=>{
    const el = document.getElementById(id);
    if (el) { const cur=el.value; el.innerHTML=custOpts; el.value=cur; }
  });
  ['inv-filter-customer','rcpt-filter-customer'].forEach(id=>{
    const el = document.getElementById(id);
    if (el) { const cur=el.value; el.innerHTML='<option value="">All Customers</option>'+DB.customers.map(c=>`<option value="${c.id}">${c.code} ${c.name}</option>`).join(''); el.value=cur; }
  });
  const supOpts = '<option value="">-- Select Supplier --</option>' +
    DB.suppliers.sort((a,b)=>(a.code||'').localeCompare(b.code||'')).map(s=>`<option value="${s.id}">${s.code} ${s.name}</option>`).join('');
  ['bill-supplier','pay-supplier'].forEach(id=>{
    const el = document.getElementById(id);
    if (el) { const cur=el.value; el.innerHTML=supOpts; el.value=cur; }
  });
  ['bill-filter-supplier','pay-filter-supplier'].forEach(id=>{
    const el = document.getElementById(id);
    if (el) { const cur=el.value; el.innerHTML='<option value="">All Suppliers</option>'+DB.suppliers.map(s=>`<option value="${s.id}">${s.code} ${s.name}</option>`).join(''); el.value=cur; }
  });
}

// ── Modal Helpers ─────────────────────────────────────
function closeModal(id) {
  document.getElementById(id).style.display='none';
}

// Close on overlay click
document.querySelectorAll('.modal-overlay').forEach(overlay=>{
  overlay.addEventListener('click', e=>{ if(e.target===overlay) overlay.style.display='none'; });
});

// ── Print ─────────────────────────────────────────────
function printSection(id) {
  const el = document.getElementById(id);
  const win = window.open('','_blank');
  win.document.write(`<!DOCTYPE html><html><head><meta charset="UTF-8">
    <style>
      body{font-family:'Segoe UI',sans-serif;font-size:13px;color:#1e293b;padding:2rem}
      .report-title{text-align:center;margin-bottom:1.5rem}
      .report-row{display:flex;justify-content:space-between;padding:.3rem 0;font-size:13px}
      .report-row.indent{padding-left:1.5rem}
      .report-row.subtotal{border-top:1px solid #ccc;font-weight:600;padding-top:.4rem}
      .report-row.total{border-top:2px solid #000;border-bottom:2px solid #000;font-weight:700;padding:.5rem 0}
      .report-row.net-income{font-weight:700;color:#0ea572}
      .report-row.net-loss{font-weight:700;color:#dc2626}
      .report-section-title{font-weight:700;text-transform:uppercase;font-size:.75rem;border-bottom:1px solid #ccc;padding-bottom:.3rem;margin:1rem 0 .5rem}
      table{width:100%;border-collapse:collapse;font-size:12px}
      th,td{padding:.4rem .6rem;border-bottom:1px solid #eee;text-align:left}
      th{background:#f8fafc;font-weight:600}
      .num{text-align:right}
      .report-balance-check{text-align:center;margin-top:1rem;font-weight:700}
      .report-balance-ok{color:#0ea572}.report-balance-fail{color:#dc2626}
      @media print{body{padding:0}}
    </style></head><body>${el.innerHTML}</body></html>`);
  win.document.close();
  win.onload=()=>{ win.print(); };
}

// ── Load accounts from Supabase (after auth confirmed) ──
async function loadAccountsFromDB() {
  if (typeof loadAccountsFromSupabase === 'function') {
    try {
      const accounts = await loadAccountsFromSupabase();
      if (accounts && accounts.length > 0) {
        DB.accounts = accounts;
        return;
      }
    } catch (e) {
      console.warn('Could not load accounts from Supabase:', e);
    }
  }
  // Fallback: use local accounts (will be populated by loadDB)
}

// ── Init ──────────────────────────────────────────────
function init() {
  loadDB();

  // Nav click
  document.querySelectorAll('.nav-link').forEach(link=>{
    link.addEventListener('click', e=>{
      e.preventDefault();
      showSection(link.dataset.section);
    });
  });

  // Default filter month
  document.getElementById('journal-filter-month').value = nowMonth();
  const [y,m] = nowMonth().split('-');
  document.getElementById('ledger-from').value = `${y}-01`;
  document.getElementById('ledger-to').value   = nowMonth();
  document.getElementById('dep-month').value   = nowMonth();

  populateLedgerSelect();
  populateAccountDropdowns();

  // Default aging/SST dates
  if (document.getElementById('ar-aging-date')) document.getElementById('ar-aging-date').value = today();
  if (document.getElementById('ap-aging-date')) document.getElementById('ap-aging-date').value = today();
  if (document.getElementById('sst-from')) document.getElementById('sst-from').value = nowMonth();
  if (document.getElementById('sst-to'))   document.getElementById('sst-to').value   = nowMonth();

  showSection('dashboard');
}

// Stub for import section (filled in by import.js)
function renderImportSection() { /* import.js may extend */ }
// Stub for renderSST (filled by sst.js)
function renderSST() { if (typeof renderSSTReport === 'function') renderSSTReport(); }

document.addEventListener('DOMContentLoaded', init);
