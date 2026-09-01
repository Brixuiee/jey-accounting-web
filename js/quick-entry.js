'use strict';
// ======================================================
//  Quick Entry Module — Raw text → auto-classify → preview → commit
//  ----------------------------------------------------
//  사용자는 한 곳에 자유롭게 거래를 적기만 하면 시스템이:
//   1) 거래 유형 자동 감지 (Sales / Receipt / Purchase / Payment / Expense / Journal)
//   2) 일자, 금액, 거래처, 계정과목 자동 추출
//   3) 품번(Document Number) 자동 부여
//   4) Preview 화면에서 관리자가 수정 가능
//   5) Confirm → 일괄 정식 등록 (이후 일반 화면에서도 편집 가능)
// ======================================================

// ── Keyword dictionaries (한·영 혼용) ────────────────
const QE_TYPE_KEYWORDS = {
  sales: [
    /수수료\s*(청구|발행|발생|invoice)?/i, /commission/i, /매출(?!채권)/, /판매(?!비)/,
    /\bsales\s*invoice/i, /\binvoice(?!\s*받음|\s*수취)/i, /billed/i, /청구\s*함/,
    /외상\s*수수료/, /credit\s*sales/i,
  ],
  receipt: [
    /입금/, /수령/, /수금/, /회수/, /돈\s*받/, /송금\s*받/,
    /\breceipt(?!\s*for)/i, /received\s*from/i, /collected/i, /\bdeposit(?!\s*to)/i,
    /은행에?\s*들어옴/, /계좌에?\s*들어옴/,
    /세금\s*환급/, /tax\s*refund/i, /환급금/,
  ],
  purchase: [
    /매입(?!채무)/, /청구서\s*받|청구서\s*수취|청구서(?!\s*없)/, /비용\s*청구/, /\bbill(?:ed)?\s*from|received/i,
    /\bpurchase\s*invoice/i, /supplier\s*invoice/i, /외상\s*매입/, /외상\s*비용/,
  ],
  payment: [
    /지급/, /송금(?!\s*받)/, /결제(?!\s*조건)/, /\bpay(?:ment|ing|aid)?\s+to/i, /\bpaid\b/i,
    /송금했|이체했|결제했/, /\bremit/i, /\btransfer(?:red)?\b(?!\s*fee)/i,
  ],
  expense: [
    /통신비/, /임차료/, /공과금/, /운반비/, /택배/, /은행\s*수수료/, /수도세/, /전기세/,
    /\butilities\b/i, /\brent\b/i, /bank\s*charge/i, /\bcourier\b/i, /transport(?:ation)?/i,
    /\bepf\b/i, /bank\s*(?:transfer\s*)?fee/i, /bank.*\bsst\b|\bsst\b.*bank/i, /계좌이체\s*수수료/,
  ],
};

// account code mapping — ordered ARRAY (not object) so priority is preserved.
// Object literals with numeric keys are auto-sorted ascending in JS — we must
// use an array to ensure expense/revenue accounts are checked before cash/bank.
const QE_ACCOUNT_KEYWORDS = [
  // Expenses (checked first)
  ['5051', [/은행\s*sst/i, /bank\s*sst/i, /service\s*tax/i]],
  ['5052', [/이체\s*수수료/, /transfer\s*fee/i, /telex/i, /handling\s*fee/i]],
  ['5009', [/은행\s*수수료/, /bank\s*(?:charge|fee)/i, /service\s*charge/i, /월\s*수수료/]],
  ['5050', [/epf.*(?:late|연체)/i, /(?:late|연체).*epf/i]],
  ['5049', [/epf.*(?:combined|통합)/i, /(?:combined|통합).*epf/i]],
  ['5048', [/epf.*(?:employee|직원)/i, /(?:employee|직원).*epf/i]],
  ['5013', [/epf.*(?:employer|회사)/i, /(?:employer|회사).*epf/i]],
  ['5003', [/임차료/, /임대료/, /\brent\b/i, /lease/i, /\boffice\s*rent\b/i]],
  ['5006', [/통신비/, /\bphone\b/i, /\binternet\b/i, /\bcelcom\b/i, /\bdigi\b/i, /\bmaxis\b/i, /\bunifi\b/i, /\btm\b/i, /telco/i]],
  ['5004', [/공과금/, /\butilit/i, /\btnb\b/i, /전기(?!세)|전기세/, /electric/i, /수도(?:세)?/, /\bwater\b/i, /sewerage/i, /indah\s*water/i]],
  ['5005', [/운반비/, /운송/, /택배(?:비)?/, /\bcourier\b/i, /transport/i, /shipping/i, /\bdelivery\b/i, /pos\s*laju/i, /\bdhl\b/i, /fedex/i]],
  ['5002', [/급여/, /월급/, /\bsalar/i, /\bwage/i, /payroll/i, /직원\s*급여/]],
  ['5007', [/전문가\s*수수료/, /accountant/i, /\blawyer\b/i, /audit(?:or)?(?!\s*ing)/i, /professional/i, /consultant/i, /자문료/, /법무사/]],
  ['5008', [/감가상각/, /depreciat/i]],
  ['5001', [/매출원가/, /\bcogs\b/i, /cost\s*of\s*good/i, /구매원가/]],
  ['5010', [/기타\s*비용/, /miscellaneous/i, /\bmisc\b/i, /other\s*expense/i, /광고(?!료)|광고료/, /marketing/i, /\bad\b/i]],
  // Revenue
  ['4002', [/수수료\s*수익/, /수수료\s*매출/, /commission(?!\s*paid)/i, /broker/i, /수수료(?!\s*지급)/]],
  ['4001', [/매출(?!채권)(?!원가)(?!세)/, /\bsales\b/i, /제품판매/]],
  ['4003', [/기타\s*수익/, /이자\s*수익/, /interest\s*income/i, /\bother\s*income\b/i, /환차익/, /forex\s*gain/i]],
  ['4007', [/세금\s*환급/, /tax\s*refund/i, /lhdn.*refund/i, /환급금/]],
  // Liabilities (checked before generic cash/bank so "미지급" wins)
  ['2005', [/미지급\s*급여/, /급여\s*미지급/, /salary\s*payable/i, /unpaid\s*salary/i, /accrued\s*salary/i]],
  ['2003', [/미지급\s*비용/, /accrued\s*expense/i]],
  ['2001', [/매입\s*채무/, /accounts\s*payable/i]],
  // Cash / Bank (checked LAST so expense keywords win)
  ['1001', [/현금(?!\s*\d)/, /\bcash\b/i, /petty\s*cash/i]],
  ['1002', [/(?:은행)(?!\s*수수료)/, /maybank/i, /cimb/i, /\brhb\b/i, /public\s*bank/i, /hong\s*leong/i, /계좌/]],
];

// Cash/Bank detection — distinguish cash from bank
const QE_BANK_KEYWORDS = [/은행/, /계좌/, /\bbank\b/i, /maybank/i, /cimb/i, /\brhb\b/i, /public\s*bank/i, /hong\s*leong/i, /송금/, /이체/, /transfer/i];
const QE_CASH_KEYWORDS = [/현금/, /\bcash\b/i, /petty/i];

// ── Date Extraction ──────────────────────────────────
function qeExtractDate(line) {
  // YYYY-MM-DD
  let m = line.match(/(\d{4})-(\d{1,2})-(\d{1,2})/);
  if (m) return `${m[1]}-${m[2].padStart(2,'0')}-${m[3].padStart(2,'0')}`;
  // YYYY/MM/DD or YYYY.MM.DD
  m = line.match(/(\d{4})[\/\.](\d{1,2})[\/\.](\d{1,2})/);
  if (m) return `${m[1]}-${m[2].padStart(2,'0')}-${m[3].padStart(2,'0')}`;
  // DD/MM/YYYY or DD-MM-YYYY (Malaysian format)
  m = line.match(/(\d{1,2})[\/\-\.](\d{1,2})[\/\-\.](\d{4})/);
  if (m) return `${m[3]}-${m[2].padStart(2,'0')}-${m[1].padStart(2,'0')}`;
  // Korean "X월 Y일" — use current year
  m = line.match(/(\d{1,2})월\s*(\d{1,2})일/);
  if (m) {
    const y = new Date().getFullYear();
    return `${y}-${m[1].padStart(2,'0')}-${m[2].padStart(2,'0')}`;
  }
  // Default: today
  return today();
}

// ── Amount Extraction ────────────────────────────────
function qeExtractAmount(line) {
  // First strip out date strings, Korean date forms, and reference numbers
  // so they don't bleed into amount detection
  let cleaned = line
    .replace(/\d{4}[-\/.]\d{1,2}[-\/.]\d{1,2}/g, ' ')   // YYYY-MM-DD
    .replace(/\d{1,2}[-\/.]\d{1,2}[-\/.]\d{4}/g, ' ')   // DD/MM/YYYY
    .replace(/\d{1,2}\s*월\s*\d{1,2}\s*일/g, ' ')        // 7월 31일
    .replace(/\b[A-Z]{1,5}\d{4,}\b/gi, ' ');            // INV202507001, PV20250715, OR..., PY..., JE...

  const matches = [...cleaned.matchAll(/(?:MYR|RM|\$)?\s*(\d{1,3}(?:,\d{3})+(?:\.\d{1,2})?|\d+(?:\.\d{1,2})?)\b/gi)];
  const amounts = matches
    .map(m => Number(m[1].replace(/,/g, '')))
    .filter(n => !isNaN(n) && n >= 1 && n < 100000000);
  if (!amounts.length) return 0;
  // Prefer the largest number on the line (likely the transaction amount)
  return Math.max(...amounts);
}

// ── Type Detection ───────────────────────────────────
function qeDetectType(line) {
  // Explicit prefix
  const prefix = line.match(/^\s*\[(SALES|RECEIPT|PURCHASE|PAYMENT|EXPENSE|JE|JOURNAL|매출|수령|매입|지급|경비|분개)\]/i);
  if (prefix) {
    const p = prefix[1].toUpperCase();
    if (p==='SALES'||p==='매출') return {type:'sales', confidence:1.0, explicit:true};
    if (p==='RECEIPT'||p==='수령') return {type:'receipt', confidence:1.0, explicit:true};
    if (p==='PURCHASE'||p==='매입') return {type:'purchase', confidence:1.0, explicit:true};
    if (p==='PAYMENT'||p==='지급') return {type:'payment', confidence:1.0, explicit:true};
    if (p==='EXPENSE'||p==='경비') return {type:'expense', confidence:1.0, explicit:true};
    if (p==='JE'||p==='JOURNAL'||p==='분개') return {type:'journal', confidence:1.0, explicit:true};
  }
  // ── Disambiguate "수수료" (commission/fee) — context-sensitive ──
  if (/수수료/.test(line)) {
    // Bank charge specifically? (highest priority) — "은행 수수료" or "monthly fee" (NOT "7월 수수료" which is a month name)
    if (/은행\s*수수료|bank\s*(?:charge|fee)|monthly\s*(?:charge|fee)/i.test(line)) {
      return {type:'expense', confidence:0.9};
    }
    // "월 수수료" only if NOT preceded by a digit (e.g. "7월 수수료" = July commission, not monthly fee)
    if (/(?:^|[^0-9])월\s*수수료/.test(line) && /(?:maybank|cimb|rhb|public\s*bank|hong\s*leong|ambank|bank|은행)/i.test(line)) {
      return {type:'expense', confidence:0.9};
    }
    // Bank name + 수수료 (without months/dates between) → bank charge
    if (/(?:maybank|cimb|rhb|public\s*bank|hong\s*leong|ambank|bank\s*islam)\s+(?:월\s*)?수수료/i.test(line) ||
        /(?:^|\s)(?:maybank|cimb|rhb)\b[^가-힣\d]{0,15}수수료/i.test(line)) {
      return {type:'expense', confidence:0.9};
    }
    // Receipt? (입금/수령/received before 수수료)
    if (/입금|수령|받음|received|receipt|deposit/i.test(line)) return {type:'receipt', confidence:0.85};
    // Payment?
    if (/지급|송금했|paid|payment/i.test(line)) return {type:'payment', confidence:0.85};
    // Purchase? (received a commission/fee invoice from someone)
    if (/청구서\s*받|청구서\s*수취|매입/i.test(line)) return {type:'purchase', confidence:0.85};
    // Otherwise commission billing → sales
    return {type:'sales', confidence:0.8};
  }

  // Score each type by keyword matches
  let best = {type:'unknown', confidence:0.3, hits:0};
  for (const [type, patterns] of Object.entries(QE_TYPE_KEYWORDS)) {
    let hits = 0;
    for (const p of patterns) if (p.test(line)) hits++;
    if (hits > best.hits) best = {type, confidence: Math.min(0.5 + hits*0.2, 0.95), hits};
  }
  // ── Upgrade expense → purchase if "청구서" (received bill) is present ──
  // Cash/bank expense rarely uses the word "청구서" (bill).
  if (best.type === 'expense' && /청구서/.test(line) && !/지급|송금|결제|paid|payment/i.test(line)) {
    best = {type:'purchase', confidence:0.85, hits:best.hits+1};
  }
  return best;
}

// ── Account Detection ────────────────────────────────
function qeDetectAccount(line, type) {
  // Receipt/Payment: account = the BANK/CASH account where money moves
  if (type === 'receipt' || type === 'payment') {
    if (/현금|\bcash\b/i.test(line)) return _accByCode(null, '1001');
    return _accByCode(DB.settings.defaultBankAccount, '1002');
  }

  // Restrict candidate accounts by transaction type
  // - sales:    only revenue accounts (4xxx)
  // - purchase: only expense accounts (5xxx)
  // - expense:  expense accounts (5xxx), then cash/bank if pure account word
  // - journal:  any
  let candidateCodePrefix = null;
  if (type === 'sales')    candidateCodePrefix = ['4'];
  else if (type === 'purchase' || type === 'expense') candidateCodePrefix = ['5'];

  for (const [code, patterns] of QE_ACCOUNT_KEYWORDS) {
    if (candidateCodePrefix && !candidateCodePrefix.includes(code[0])) continue;
    for (const p of patterns) {
      if (p.test(line)) {
        const acc = DB.accounts.find(a => a.code === code);
        if (acc) return {code, id: acc.id, name: acc.nameEn||acc.nameKr};
      }
    }
  }
  // Defaults by type
  if (type === 'sales')    return _accByCode(DB.settings.defaultSalesAccount, '4002');
  if (type === 'purchase') return _accByCode(null, '5010');
  if (type === 'expense')  return _accByCode(null, '5010');
  return null;
}
function _accByCode(prefId, fallbackCode) {
  let acc = prefId ? DB.accounts.find(a=>a.id===prefId) : null;
  if (!acc) acc = DB.accounts.find(a=>a.code===fallbackCode);
  return acc ? {code: acc.code, id: acc.id, name: acc.nameEn||acc.nameKr} : null;
}

// ── Journal (수동 분개): detect a DEBIT + CREDIT account pair from one line ──
// Scans every keyword pattern (no type restriction) and picks the two accounts
// most likely intended, using natural debit/credit side by account type
// (asset/expense increase on debit, liability/equity/revenue increase on credit).
function qeDetectJournalAccounts(line) {
  const found = [];
  for (const [code, patterns] of QE_ACCOUNT_KEYWORDS) {
    for (const p of patterns) {
      const m = line.match(p);
      if (m) {
        const acc = DB.accounts.find(a => a.code === code);
        if (acc) found.push({code, id: acc.id, name: acc.nameEn||acc.nameKr, type: acc.type, pos: m.index});
        break;  // one hit per code is enough
      }
    }
  }
  found.sort((a,b)=>a.pos-b.pos);

  const side = t => (t==='asset'||t==='expense') ? 'debit' : (t==='liability'||t==='equity'||t==='revenue') ? 'credit' : null;

  if (found.length >= 2) {
    const debitCand = found.find(m => side(m.type)==='debit');
    const creditCand = found.find(m => side(m.type)==='credit' && m.code !== debitCand?.code);
    if (debitCand && creditCand) return {debit: debitCand, credit: creditCand};
    // Both landed on the same natural side — fall back to left-to-right order in the text
    return {debit: found[0], credit: found[1]};
  }
  if (found.length === 1) return {debit: found[0], credit: null};
  return {debit: null, credit: null};
}

// ── Party Detection (Customer/Supplier name) ─────────
function qeDetectParty(line, type) {
  // Strip known noise: date strings, amounts, type prefix, journal-related words
  let cleaned = line
    .replace(/^\s*\[[^\]]+\]\s*/, ' ')                            // [TYPE] prefix
    .replace(/\d{4}[-\/.]\d{1,2}[-\/.]\d{1,2}/g, ' ')             // YYYY-MM-DD
    .replace(/\d{1,2}[-\/.]\d{1,2}[-\/.]\d{4}/g, ' ')             // DD/MM/YYYY
    .replace(/\d{1,2}\s*월\s*\d{1,2}\s*일/g, ' ')                  // 7월 31일
    .replace(/\b[A-Z]{1,5}\d{4,}\b/gi, ' ')                       // INV202507001, PV..., etc.
    .replace(/(?:MYR|RM|\$)?\s*\d{1,3}(?:,\d{3})+(?:\.\d{1,2})?\b/g, ' ')  // 8,000 / 5,500.00
    .replace(/(?:MYR|RM|\$)?\s*\d+(?:\.\d{1,2})?\b/g, ' ')        // 8000 / 25.50
    .replace(/외상|현금|은행|계좌|cash|bank|credit|즉시|즉결|자동\s*이체/gi, ' ')
    .replace(/수수료|매출|매입|입금|수령|지급|송금|청구서|청구\s*함|청구|결제|받음|이전\s*송장|invoice|receipt|bill|payment|commission|sales|paid|deposit/gi, ' ')
    .replace(/임차료|통신비|공과금|운반비|택배비|택배|은행\s*수수료|월\s*수수료|월\s*관리/gi, ' ')
    .replace(/\d+\s*월|\d+\s*일/g, ' ')                            // Korean month/day suffixes
    .replace(/[\(\)\[\]【】「」\.]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  const list = type==='purchase'||type==='payment' ? DB.suppliers : DB.customers;

  // Try exact code match first (e.g. "C0001")
  const codeMatch = line.match(/\b([CSV]\d{3,5})\b/);
  if (codeMatch) {
    const p = list.find(x => x.code === codeMatch[1]);
    if (p) return {id: p.id, name: p.name, code: p.code, autoCreated: false};
  }
  // Fuzzy match on name (longest match wins)
  cleaned = cleaned.trim();
  let best = null;
  for (const p of list) {
    if (!p.name) continue;
    const nameLow = p.name.toLowerCase();
    const lineLow = line.toLowerCase();
    // Substring or first-word match
    if (lineLow.includes(nameLow)) {
      if (!best || p.name.length > best.name.length) best = {id: p.id, name: p.name, code: p.code, autoCreated: false};
    } else {
      // Check first word of name
      const firstWord = p.name.split(/\s+/)[0].toLowerCase();
      if (firstWord.length >= 3 && lineLow.includes(firstWord)) {
        if (!best) best = {id: p.id, name: p.name, code: p.code, autoCreated: false, weak: true};
      }
    }
  }
  if (best) return best;

  // Couldn't match — extract a guess from cleaned text
  cleaned = cleaned.replace(/[^\w가-힣\s\-&]/g, ' ').replace(/\s+/g,' ').trim();
  // Filter out remaining noise words (single Korean particles, English short words)
  const noise = /^(외|을|를|에|의|로|이|가|는|은|과|와|및|및|so|did|to|in|on|at|by|of|for|the|a|an|and|or|sb|sdn|bhd|pte|ltd|co|corp)$/i;
  const words = cleaned.split(/\s+/).filter(w => w.length >= 2 && !noise.test(w));
  if (!words.length) return null;
  // Take first 1-3 plausible words as the guessed name
  const guess = words.slice(0, 3).join(' ').trim();
  if (guess && (type==='sales'||type==='receipt'||type==='purchase'||type==='payment')) {
    return {id: null, name: guess, code: '', autoCreated: true};
  }
  return null;
}

// ── Cash vs Bank for expense ─────────────────────────
function qeDetectCashOrBank(line) {
  for (const p of QE_CASH_KEYWORDS) if (p.test(line)) return 'cash';
  for (const p of QE_BANK_KEYWORDS) if (p.test(line)) return 'bank';
  return 'bank';  // default to bank
}

// ── Description Extraction ───────────────────────────
function qeExtractDescription(line) {
  return line.replace(/^\s*\[[^\]]+\]\s*/, '').trim();
}

// ── Knockoff reference detection ─────────────────────
function qeExtractKnockoff(line) {
  // Match INV / OR / PV / PY style references
  const m = line.match(/\b(INV|OR|PV|PY)\d{4,}\b/i);
  return m ? m[0] : '';
}

// ── Main parse for a single line ─────────────────────
function qeParseLine(line, idx) {
  const date = qeExtractDate(line);
  const amount = qeExtractAmount(line);
  const typeInfo = qeDetectType(line);
  let account = qeDetectAccount(line, typeInfo.type);
  let creditAccount = null;
  if (typeInfo.type === 'journal') {
    const ja = qeDetectJournalAccounts(line);
    account = ja.debit;
    creditAccount = ja.credit;
  }
  const party = qeDetectParty(line, typeInfo.type);
  const cashOrBank = qeDetectCashOrBank(line);
  const knockoff = qeExtractKnockoff(line);
  const description = qeExtractDescription(line);

  // Auto number — use batch counter if provided to avoid collisions within one parse session
  const batch = qeParseLine._batch || (qeParseLine._batch = {});
  let number = '';
  if (typeInfo.type==='sales')         number = nextNumberBatch('INV', DB.invoices, date, batch);
  else if (typeInfo.type==='receipt')  number = nextNumberBatch('OR',  DB.receipts, date, batch);
  else if (typeInfo.type==='purchase') number = nextNumberBatch('PV',  DB.bills,    date, batch);
  else if (typeInfo.type==='payment')  number = nextNumberBatch('PY',  DB.payments, date, batch);
  else if (typeInfo.type==='expense'||typeInfo.type==='journal') number = `JE${date.slice(0,7).replace('-','')}${String(idx+1).padStart(3,'0')}`;
  else number = `QE${date.slice(0,7).replace('-','')}${String(idx+1).padStart(3,'0')}`;

  // Warning flags
  const warnings = [];
  if (!amount) warnings.push('금액을 찾지 못했습니다');
  if (!date) warnings.push('일자를 찾지 못했습니다');
  if (typeInfo.type==='unknown') warnings.push('거래 유형 자동 분류 실패 — 직접 선택하세요');
  if ((typeInfo.type==='sales'||typeInfo.type==='receipt'||typeInfo.type==='purchase'||typeInfo.type==='payment') && (!party || party.autoCreated))
    warnings.push('거래처 자동 생성 예정 — 확인 필요');
  if (typeInfo.type==='journal' && (!account || !creditAccount))
    warnings.push('차변/대변 계정을 자동으로 다 찾지 못했습니다 — 직접 선택하세요');
  if (typeInfo.confidence < 0.6) warnings.push('자동 분류 신뢰도 낮음');

  return {
    idx, raw: line, number,
    type: typeInfo.type, confidence: typeInfo.confidence, explicit: !!typeInfo.explicit,
    date, amount, account, creditAccount, party, cashOrBank, knockoff, description,
    warnings,
  };
}

// ── Render Quick Entry section ───────────────────────
let _qeParsed = null;

function renderQuickEntry() {
  // Section is rendered statically in HTML; just clear preview area
  const preview = document.getElementById('qe-preview');
  if (preview && !_qeParsed) preview.innerHTML = '';
}

function parseQuickEntries() {
  const txt = document.getElementById('qe-input').value;
  if (!txt.trim()) { alert('거래 내용을 입력하세요.'); return; }
  const lines = txt.split(/\r?\n/).map(s=>s.trim()).filter(Boolean);
  // Skip lines starting with # (comments)
  const dataLines = lines.filter(l => !l.startsWith('#'));
  if (!dataLines.length) { alert('유효한 거래 라인이 없습니다.'); return; }
  qeParseLine._batch = {};  // reset batch counters for fresh parse
  _qeParsed = dataLines.map((l,i)=>qeParseLine(l, i));
  renderQEPreview();
}

const QE_TYPE_LABELS = {
  sales: '판매송장 (Sales Invoice)',
  receipt: '고객 수령 (Receipt)',
  purchase: '매입송장 (Purchase Invoice)',
  payment: '공급업체 지급 (Payment)',
  expense: '직접경비 (Cash/Bank Expense)',
  journal: '수동 분개 (Journal)',
  unknown: '⚠ 미분류 — 선택 필요',
};

function renderQEPreview() {
  const wrap = document.getElementById('qe-preview');
  if (!_qeParsed || !_qeParsed.length) { wrap.innerHTML=''; return; }

  const accountOptions = (filterType=null) => {
    const accs = DB.accounts.filter(a=>!filterType||a.type===filterType).sort((a,b)=>a.code.localeCompare(b.code));
    return accs.map(a=>`<option value="${a.id}">${a.code} ${a.nameEn||a.nameKr}</option>`).join('');
  };
  const allAccountOptions = accountOptions();
  const customerOptions = '<option value="__new__">+ 신규 생성</option>' + DB.customers.map(c=>`<option value="${c.id}">${c.code} ${c.name}</option>`).join('');
  const supplierOptions = '<option value="__new__">+ 신규 생성</option>' + DB.suppliers.map(s=>`<option value="${s.id}">${s.code} ${s.name}</option>`).join('');

  const rows = _qeParsed.map((r,i)=>{
    const confidenceColor = r.confidence>=0.8 ? '#0ea572' : r.confidence>=0.6 ? '#d97706' : '#dc2626';
    const isCust = r.type==='sales'||r.type==='receipt';
    const isSupp = r.type==='purchase'||r.type==='payment';
    const partyHTML = (isCust||isSupp) ? `
      <div style="display:flex;gap:.3rem;align-items:center">
        <select class="input qe-party" data-idx="${i}" style="flex:1;font-size:.78rem;padding:.25rem">
          ${isCust ? customerOptions : supplierOptions}
        </select>
        ${r.party?.autoCreated ? `<input type="text" class="input qe-party-new" data-idx="${i}" value="${r.party.name}" placeholder="신규 거래처명" style="flex:1;font-size:.78rem;padding:.25rem">` : ''}
      </div>` : '<span style="color:var(--text-muted);font-size:.78rem">—</span>';

    return `<tr data-idx="${i}" style="vertical-align:top">
      <td style="font-size:.7rem;color:var(--text-muted);padding:.4rem">${i+1}</td>
      <td style="padding:.4rem">
        <div style="font-size:.78rem;color:var(--text-muted);font-family:monospace;margin-bottom:.2rem">${escapeHtml(r.raw)}</div>
        ${r.warnings.length ? `<div style="font-size:.7rem;color:#dc2626">⚠ ${r.warnings.join(' · ')}</div>` : ''}
      </td>
      <td style="padding:.4rem">
        <select class="input qe-type" data-idx="${i}" onchange="onQETypeChange(${i})" style="font-size:.78rem;padding:.25rem;width:100%">
          <option value="sales"    ${r.type==='sales'?'selected':''}>판매송장</option>
          <option value="receipt"  ${r.type==='receipt'?'selected':''}>고객 수령</option>
          <option value="purchase" ${r.type==='purchase'?'selected':''}>매입송장</option>
          <option value="payment"  ${r.type==='payment'?'selected':''}>공급업체 지급</option>
          <option value="expense"  ${r.type==='expense'?'selected':''}>직접경비</option>
          <option value="journal"  ${r.type==='journal'?'selected':''}>수동 분개</option>
          <option value="unknown"  ${r.type==='unknown'?'selected':''} disabled>미분류</option>
        </select>
        <div style="font-size:.65rem;color:${confidenceColor};margin-top:.2rem">신뢰도: ${Math.round(r.confidence*100)}%</div>
      </td>
      <td style="padding:.4rem"><input type="text" class="input qe-number" data-idx="${i}" value="${r.number}" style="font-size:.78rem;padding:.25rem;width:110px;font-family:monospace"></td>
      <td style="padding:.4rem"><input type="date" class="input qe-date" data-idx="${i}" value="${r.date}" style="font-size:.78rem;padding:.25rem;width:130px"></td>
      <td style="padding:.4rem"><input type="number" class="input qe-amount" data-idx="${i}" value="${r.amount}" step="0.01" style="font-size:.78rem;padding:.25rem;width:100px;text-align:right"></td>
      <td style="padding:.4rem">${partyHTML}</td>
      <td style="padding:.4rem">
        ${r.type==='journal' ? `
        <div style="display:flex;flex-direction:column;gap:.25rem">
          <select class="input qe-account" data-idx="${i}" style="font-size:.72rem;padding:.2rem;width:190px">
            <option value="">DR 차변 계정</option>${allAccountOptions}
          </select>
          <select class="input qe-credit-account" data-idx="${i}" style="font-size:.72rem;padding:.2rem;width:190px">
            <option value="">CR 대변 계정</option>${allAccountOptions}
          </select>
        </div>` : `
        <select class="input qe-account" data-idx="${i}" style="font-size:.78rem;padding:.25rem;width:200px">
          ${allAccountOptions}
        </select>`}
      </td>
      <td style="padding:.4rem"><input type="text" class="input qe-knockoff" data-idx="${i}" value="${r.knockoff||''}" placeholder="INV번호" style="font-size:.78rem;padding:.25rem;width:110px;font-family:monospace"></td>
      <td style="padding:.4rem"><button class="btn btn-sm btn-danger" onclick="removeQERow(${i})">✕</button></td>
    </tr>`;
  }).join('');

  wrap.innerHTML = `
    <div class="card" style="margin-top:1rem;background:#f8fafc">
      <h4 style="margin-bottom:.5rem">검토 / 수정 (${_qeParsed.length}건)</h4>
      <p style="font-size:.78rem;color:var(--text-muted);margin-bottom:.75rem">
        각 행의 유형·거래처·계정을 확인하세요. 자동 부여된 품번도 직접 수정 가능합니다. 확인 후 [Confirm All]을 눌러야 실제로 등록됩니다.
      </p>
      <div style="overflow-x:auto">
        <table class="table" style="font-size:.78rem;min-width:1200px">
          <thead><tr>
            <th>#</th><th>원문</th><th>유형</th><th>품번</th><th>일자</th><th class="num">금액 MYR</th><th>거래처</th><th>계정과목 / 결제수단</th><th>Knock-off</th><th></th>
          </tr></thead>
          <tbody>${rows}</tbody>
        </table>
      </div>
      <div style="margin-top:.75rem;display:flex;gap:.5rem;justify-content:flex-end">
        <button class="btn btn-outline" onclick="cancelQuickEntry()">취소</button>
        <button class="btn btn-primary" onclick="commitQuickEntries()">✓ 전체 등록 (Confirm All)</button>
      </div>
    </div>`;

  // Set initial select values
  _qeParsed.forEach((r,i)=>{
    if (r.party && r.party.id) {
      const sel = document.querySelector(`select.qe-party[data-idx="${i}"]`);
      if (sel) sel.value = r.party.id;
    } else if (r.party && r.party.autoCreated) {
      const sel = document.querySelector(`select.qe-party[data-idx="${i}"]`);
      if (sel) sel.value = '__new__';
    }
    if (r.account && r.account.id) {
      const sel = document.querySelector(`select.qe-account[data-idx="${i}"]`);
      if (sel) sel.value = r.account.id;
    }
    if (r.creditAccount && r.creditAccount.id) {
      const csel = document.querySelector(`select.qe-credit-account[data-idx="${i}"]`);
      if (csel) csel.value = r.creditAccount.id;
    }
  });
}

function onQETypeChange(idx) {
  const sel = document.querySelector(`select.qe-type[data-idx="${idx}"]`);
  const type = sel.value;
  _qeParsed[idx].type = type;
  // Re-suggest defaults (account, party list)
  if (type === 'journal') {
    const ja = qeDetectJournalAccounts(_qeParsed[idx].raw);
    _qeParsed[idx].account = ja.debit;
    _qeParsed[idx].creditAccount = ja.credit;
  } else {
    const newAcc = qeDetectAccount(_qeParsed[idx].raw, type);
    if (newAcc) _qeParsed[idx].account = newAcc;
    _qeParsed[idx].creditAccount = null;
  }
  // Re-render (also switches party cell between customer/supplier list, and
  // account cell between single/DR+CR layout)
  renderQEPreview();
}

function removeQERow(idx) {
  _qeParsed.splice(idx, 1);
  _qeParsed.forEach((r,i)=>r.idx=i);
  renderQEPreview();
}

function cancelQuickEntry() {
  _qeParsed = null;
  document.getElementById('qe-preview').innerHTML = '';
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
}

// ── Commit all entries ───────────────────────────────
function commitQuickEntries() {
  if (!_qeParsed || !_qeParsed.length) return;

  // Read latest values from UI
  const rows = _qeParsed.map((r,i)=>{
    const type = document.querySelector(`.qe-type[data-idx="${i}"]`).value;
    const number = document.querySelector(`.qe-number[data-idx="${i}"]`).value.trim();
    const date = document.querySelector(`.qe-date[data-idx="${i}"]`).value;
    const amount = Number(document.querySelector(`.qe-amount[data-idx="${i}"]`).value||0);
    const accountId = document.querySelector(`.qe-account[data-idx="${i}"]`)?.value || '';
    const creditAccountId = document.querySelector(`.qe-credit-account[data-idx="${i}"]`)?.value || '';
    const partySel = document.querySelector(`.qe-party[data-idx="${i}"]`);
    const partyNewInput = document.querySelector(`.qe-party-new[data-idx="${i}"]`);
    let partyId = partySel?.value || '';
    let partyNewName = partyNewInput?.value?.trim() || r.party?.name || '';
    const knockoff = document.querySelector(`.qe-knockoff[data-idx="${i}"]`)?.value?.trim() || '';
    return {...r, type, number, date, amount, accountId, creditAccountId, partyId, partyNewName, knockoff};
  });

  // Validate
  const errors = [];
  rows.forEach((r,i)=>{
    if (!r.date) errors.push(`#${i+1}: 일자 누락`);
    if (!r.amount) errors.push(`#${i+1}: 금액이 0`);
    if (r.type==='unknown') errors.push(`#${i+1}: 거래 유형 미선택`);
    if (r.type==='journal' && (!r.accountId || !r.creditAccountId)) errors.push(`#${i+1}: 분개는 차변/대변 계정이 모두 필요합니다`);
    if (r.type==='journal' && r.accountId && r.accountId===r.creditAccountId) errors.push(`#${i+1}: 차변과 대변 계정이 같습니다`);
  });
  if (errors.length) {
    alert('등록 불가:\n' + errors.join('\n'));
    return;
  }

  let stats = {sales:0, receipt:0, purchase:0, payment:0, expense:0, journal:0, custCreated:0, suppCreated:0, errors:[]};

  for (const r of rows) {
    try {
      if (r.type==='sales') {
        const custId = ensurePartyExists(r.partyId, r.partyNewName, 'customer', stats);
        if (!custId) { stats.errors.push(`#${r.idx+1}: 고객 누락`); continue; }
        // Revenue account override (4002 Commission vs default 4001 Sales)
        const revenueAccId = r.accountId || null;
        const inv = {
          id: uid(), number: r.number, date: r.date, dueDate: '',
          customerId: custId,
          ref: '', notes: r.description,
          lines: [{desc: r.description, qty:1, unitPrice: r.amount, sstPct:0, amount: r.amount, sstAmt:0, accountId: revenueAccId}],
          revenueAccountId: revenueAccId,
          subtotal: r.amount, sstTotal: 0, total: r.amount, paid: 0,
        };
        // Apply customer terms if any
        const c = getCustomer(custId);
        if (c?.terms) {
          const d = new Date(r.date); d.setDate(d.getDate()+Number(c.terms));
          inv.dueDate = d.toISOString().slice(0,10);
        }
        DB.invoices.push(inv);
        postInvoiceJournal(inv);
        stats.sales++;
      }
      else if (r.type==='receipt') {
        const custId = ensurePartyExists(r.partyId, r.partyNewName, 'customer', stats);
        if (!custId) { stats.errors.push(`#${r.idx+1}: 고객 누락`); continue; }
        const bankAcc = DB.accounts.find(a=>a.id===r.accountId && a.type==='asset') || DB.accounts.find(a=>a.code==='1002');
        const allocs = [];
        if (r.knockoff) {
          const target = DB.invoices.find(x=>x.number===r.knockoff && x.customerId===custId);
          if (target) {
            const bal = Number(target.total||0)-Number(target.paid||0);
            const alloc = Math.min(r.amount, bal);
            allocs.push({invoiceId: target.id, amount: alloc});
            target.paid = Number(target.paid||0) + alloc;
          }
        }
        const onAcct = r.amount - allocs.reduce((s,a)=>s+a.amount,0);
        const rcpt = {
          id: uid(), number: r.number, date: r.date,
          customerId: custId, bankAccountId: bankAcc?.id,
          method: 'Bank Transfer', chequeNo: '',
          notes: r.description, allocations: allocs,
          onAccount: Math.max(0,onAcct), totalAmount: r.amount,
        };
        DB.receipts.push(rcpt);
        postReceiptJournal(rcpt);
        stats.receipt++;
      }
      else if (r.type==='purchase') {
        const supId = ensurePartyExists(r.partyId, r.partyNewName, 'supplier', stats);
        if (!supId) { stats.errors.push(`#${r.idx+1}: 공급업체 누락`); continue; }
        const expAcc = DB.accounts.find(a=>a.id===r.accountId) || DB.accounts.find(a=>a.code==='5010');
        const bill = {
          id: uid(), number: r.number,
          supInv: r.knockoff || '',
          date: r.date, dueDate: '', supplierId: supId, notes: r.description,
          lines: [{desc:r.description, accountId: expAcc?.id, qty:1, unitPrice:r.amount, sstPct:0, amount:r.amount, sstAmt:0}],
          subtotal: r.amount, sstTotal:0, total:r.amount, paid:0,
        };
        const s = getSupplier(supId);
        if (s?.terms) {
          const d = new Date(r.date); d.setDate(d.getDate()+Number(s.terms));
          bill.dueDate = d.toISOString().slice(0,10);
        }
        DB.bills.push(bill);
        postBillJournal(bill);
        stats.purchase++;
      }
      else if (r.type==='payment') {
        const supId = ensurePartyExists(r.partyId, r.partyNewName, 'supplier', stats);
        if (!supId) { stats.errors.push(`#${r.idx+1}: 공급업체 누락`); continue; }
        const bankAcc = DB.accounts.find(a=>a.id===r.accountId && a.type==='asset') || DB.accounts.find(a=>a.code==='1002');
        const allocs = [];
        if (r.knockoff) {
          const target = DB.bills.find(x=>x.number===r.knockoff && x.supplierId===supId);
          if (target) {
            const bal = Number(target.total||0)-Number(target.paid||0);
            const alloc = Math.min(r.amount, bal);
            allocs.push({billId: target.id, amount: alloc});
            target.paid = Number(target.paid||0) + alloc;
          }
        }
        const onAcct = r.amount - allocs.reduce((s,a)=>s+a.amount,0);
        const pay = {
          id: uid(), number: r.number, date: r.date,
          supplierId: supId, bankAccountId: bankAcc?.id,
          method: 'Bank Transfer', chequeNo: '',
          notes: r.description, allocations: allocs,
          onAccount: Math.max(0,onAcct), totalAmount: r.amount,
        };
        DB.payments.push(pay);
        postPaymentJournal(pay);
        stats.payment++;
      }
      else if (r.type==='expense') {
        // Direct journal: DR expense / CR cash or bank
        const expAcc = DB.accounts.find(a=>a.id===r.accountId) || DB.accounts.find(a=>a.code==='5010');
        const cashOrBank = r.cashOrBank || 'bank';
        const payAcc = DB.accounts.find(a=>a.code === (cashOrBank==='cash'?'1001':'1002'));
        if (!expAcc || !payAcc) { stats.errors.push(`#${r.idx+1}: 계정과목 누락`); continue; }
        DB.entries.push({
          id: uid(), date: r.date,
          reference: r.number,
          description: r.description,
          lines: [
            {accountId: expAcc.id, debit: r.amount, credit: 0},
            {accountId: payAcc.id, debit: 0, credit: r.amount},
          ],
          source: 'manual',
        });
        stats.expense++;
      }
      else if (r.type==='journal') {
        // Manual journal: DR account (r.accountId) / CR account (r.creditAccountId),
        // both auto-detected from keywords (e.g. "급여" + "미지급급여") or picked in the preview.
        const drAcc = DB.accounts.find(a=>a.id===r.accountId);
        const crAcc = DB.accounts.find(a=>a.id===r.creditAccountId);
        if (!drAcc || !crAcc) { stats.errors.push(`#${r.idx+1}: 차변/대변 계정 누락`); continue; }
        DB.entries.push({
          id: uid(), date: r.date,
          reference: r.number,
          description: r.description,
          lines: [
            {accountId: drAcc.id, debit: r.amount, credit: 0},
            {accountId: crAcc.id, debit: 0, credit: r.amount},
          ],
          source: 'manual',
        });
        stats.journal++;
      }
    } catch (err) {
      console.error(err);
      stats.errors.push(`#${r.idx+1}: ${err.message}`);
    }
  }

  saveDB();
  populateAccountDropdowns();
  populateLedgerSelect();

  const msg = [
    `✓ 등록 완료`,
    `판매송장: ${stats.sales}건`,
    `고객 수령: ${stats.receipt}건`,
    `매입송장: ${stats.purchase}건`,
    `공급업체 지급: ${stats.payment}건`,
    `직접경비: ${stats.expense}건`,
    `수동 분개: ${stats.journal}건`,
    stats.custCreated ? `신규 고객 생성: ${stats.custCreated}` : '',
    stats.suppCreated ? `신규 공급업체 생성: ${stats.suppCreated}` : '',
    stats.errors.length ? `\n⚠ 오류 ${stats.errors.length}건:\n${stats.errors.join('\n')}` : '',
  ].filter(Boolean).join('\n');
  alert(msg);
  document.getElementById('qe-input').value = '';
  document.getElementById('qe-preview').innerHTML = `<div class="alert alert-success" style="margin-top:1rem">${msg.replace(/\n/g,'<br>')}</div>`;
  _qeParsed = null;
}

function ensurePartyExists(partyId, newName, kind, stats) {
  const list = kind==='customer' ? DB.customers : DB.suppliers;
  if (partyId && partyId !== '__new__') {
    const p = list.find(x=>x.id===partyId);
    if (p) return p.id;
  }
  if (!newName || !newName.trim()) return null;
  const trimmed = newName.trim();
  // Match against existing party by name (case-insensitive, including
  // already-created-in-this-batch ones, so subsequent rows reuse the same record)
  const existing = list.find(p => (p.name||'').toLowerCase() === trimmed.toLowerCase());
  if (existing) return existing.id;
  // Try fuzzy: substring match (e.g. "ABC" matches "ABC Sdn Bhd")
  const fuzzy = list.find(p => {
    const n = (p.name||'').toLowerCase();
    const t = trimmed.toLowerCase();
    return n.includes(t) || t.includes(n);
  });
  if (fuzzy) return fuzzy.id;
  // Create new
  const codePrefix = kind==='customer' ? 'C' : 'S';
  const nextCode = `${codePrefix}${String(list.length+1).padStart(4,'0')}`;
  const newParty = {id: uid(), code: nextCode, name: trimmed, terms: 30};
  list.push(newParty);
  if (kind==='customer') stats.custCreated++;
  else stats.suppCreated++;
  return newParty.id;
}

// ══════════════════════════════════════════════════════
//  GRID FORM MODE — 양식 입력
// ══════════════════════════════════════════════════════
let _qeGridIdx = 0;

function switchQEMode(mode) {
  const grid = document.getElementById('qe-mode-grid');
  const text = document.getElementById('qe-mode-text');
  const tabG = document.getElementById('qe-tab-grid');
  const tabT = document.getElementById('qe-tab-text');
  if (mode === 'grid') {
    grid.style.display = ''; text.style.display = 'none';
    tabG.classList.add('qe-tab-active'); tabT.classList.remove('qe-tab-active');
    tabG.style.color = 'var(--primary)'; tabG.style.borderBottom = '3px solid var(--primary)';
    tabT.style.color = 'var(--text-muted)'; tabT.style.borderBottom = '3px solid transparent';
    // Add initial rows if empty
    if (!document.querySelectorAll('#qe-grid-body .qe-grid-row').length) {
      for (let i=0;i<3;i++) addQEGridRow();
    }
  } else {
    grid.style.display = 'none'; text.style.display = '';
    tabT.classList.add('qe-tab-active'); tabG.classList.remove('qe-tab-active');
    tabT.style.color = 'var(--primary)'; tabT.style.borderBottom = '3px solid var(--primary)';
    tabG.style.color = 'var(--text-muted)'; tabG.style.borderBottom = '3px solid transparent';
  }
}

function addQEGridRow(data={}) {
  const idx = _qeGridIdx++;
  const tbody = document.getElementById('qe-grid-body');
  const tr = document.createElement('tr');
  tr.className = 'qe-grid-row';
  tr.dataset.idx = idx;
  const dateValue = data.date || today();
  tr.innerHTML = `
    <td style="font-size:.7rem;color:var(--text-muted);text-align:center;padding:.3rem">${tbody.children.length + 1}</td>
    <td style="padding:.3rem"><input type="date" class="input qe-g-date" value="${dateValue}" style="font-size:.78rem;padding:.25rem;width:100%"></td>
    <td style="padding:.3rem">
      <select class="input qe-g-type" style="font-size:.78rem;padding:.25rem;width:100%" onchange="onQEGridTypeChange(this)">
        <option value="">(자동)</option>
        <option value="sales">판매송장 (매출)</option>
        <option value="receipt">고객 수령</option>
        <option value="purchase">매입송장 (매입)</option>
        <option value="payment">공급업체 지급</option>
        <option value="expense">직접경비</option>
      </select>
    </td>
    <td style="padding:.3rem"><input type="text" class="input qe-g-memo" value="${escapeHtml(data.memo||'')}" placeholder="예: ABC Sdn Bhd 수수료 청구" style="font-size:.78rem;padding:.25rem;width:100%" oninput="onQEGridMemoInput(this)" list="qe-party-suggestions"></td>
    <td style="padding:.3rem"><input type="number" class="input qe-g-amount" value="${data.amount||''}" step="0.01" min="0" placeholder="0.00" style="font-size:.78rem;padding:.25rem;width:100%;text-align:right"></td>
    <td style="padding:.3rem">
      <select class="input qe-g-account" style="font-size:.78rem;padding:.25rem;width:100%">
        <option value="">(자동 추정)</option>
        ${qeAccountOptionsHTML()}
      </select>
    </td>
    <td style="padding:.3rem"><input type="text" class="input qe-g-knockoff" value="${escapeHtml(data.knockoff||'')}" placeholder="INV번호" style="font-size:.78rem;padding:.25rem;width:100%;font-family:monospace"></td>
    <td style="padding:.3rem;text-align:center"><button class="btn btn-sm btn-danger" onclick="removeQEGridRow(this)">✕</button></td>
  `;
  tbody.appendChild(tr);
  // Pre-set values if provided
  if (data.type) tr.querySelector('.qe-g-type').value = data.type;
  if (data.accountId) tr.querySelector('.qe-g-account').value = data.accountId;
  ensurePartyDatalist();
  updateQEGridCount();
  return tr;
}

function removeQEGridRow(btn) {
  btn.closest('tr').remove();
  // Renumber
  document.querySelectorAll('#qe-grid-body .qe-grid-row').forEach((r,i)=>{
    r.children[0].textContent = i+1;
  });
  updateQEGridCount();
}

function clearQEGrid() {
  if (!confirm('모든 행을 지우시겠습니까?')) return;
  document.getElementById('qe-grid-body').innerHTML = '';
  for (let i=0;i<3;i++) addQEGridRow();
}

function updateQEGridCount() {
  const n = document.querySelectorAll('#qe-grid-body .qe-grid-row').length;
  const el = document.getElementById('qe-grid-count');
  if (el) el.textContent = `${n}행`;
}

function qeAccountOptionsHTML() {
  const groups = {revenue:'수익', expense:'비용', asset:'자산', liability:'부채', equity:'자본'};
  return Object.entries(groups).map(([t,label])=>{
    const accs = DB.accounts.filter(a=>a.type===t).sort((a,b)=>a.code.localeCompare(b.code));
    if (!accs.length) return '';
    return `<optgroup label="${label}">${accs.map(a=>`<option value="${a.id}">${a.code} ${a.nameEn||a.nameKr}</option>`).join('')}</optgroup>`;
  }).join('');
}

function ensurePartyDatalist() {
  let dl = document.getElementById('qe-party-suggestions');
  if (!dl) {
    dl = document.createElement('datalist');
    dl.id = 'qe-party-suggestions';
    document.body.appendChild(dl);
  }
  const items = [
    ...DB.customers.map(c=>`<option value="${c.name}">${c.code} (고객)</option>`),
    ...DB.suppliers.map(s=>`<option value="${s.name}">${s.code} (공급업체)</option>`),
  ];
  dl.innerHTML = items.join('');
}

// When user types in memo cell — auto-suggest 구분 and 계정
function onQEGridMemoInput(input) {
  const row = input.closest('tr');
  const memo = input.value.trim();
  if (!memo) return;
  const typeSel = row.querySelector('.qe-g-type');
  const accSel = row.querySelector('.qe-g-account');
  // Only auto-set if user hasn't manually chosen yet (i.e. value is empty/(자동))
  if (!typeSel.value) {
    const typeInfo = qeDetectType(memo);
    if (typeInfo.type && typeInfo.type !== 'unknown' && typeInfo.confidence >= 0.7) {
      typeSel.value = typeInfo.type;
      // Visual hint that it was auto-set
      typeSel.style.background = '#fef3c7';
      setTimeout(()=>{ typeSel.style.background = ''; }, 1500);
    }
  }
  // Suggest account
  if (!accSel.value && typeSel.value) {
    const accInfo = qeDetectAccount(memo, typeSel.value);
    if (accInfo && accInfo.id) {
      accSel.value = accInfo.id;
      accSel.style.background = '#fef3c7';
      setTimeout(()=>{ accSel.style.background = ''; }, 1500);
    }
  }
}

function onQEGridTypeChange(select) {
  const row = select.closest('tr');
  const memo = row.querySelector('.qe-g-memo').value.trim();
  const accSel = row.querySelector('.qe-g-account');
  // Re-suggest account based on new type
  if (memo) {
    const accInfo = qeDetectAccount(memo, select.value);
    if (accInfo && accInfo.id) {
      accSel.value = accInfo.id;
      accSel.style.background = '#fef3c7';
      setTimeout(()=>{ accSel.style.background = ''; }, 1500);
    }
  }
}

// Generate sequence number with batch offset (so multiple rows in the same parse
// don't collide on the same number).
function nextNumberBatch(prefix, dbList, date, batchCounter) {
  const ym = (date||today()).slice(0,7).replace('-','');
  const existing = dbList.filter(x=>(x.number||'').startsWith(prefix+ym)).length;
  const k = `${prefix}${ym}`;
  batchCounter[k] = (batchCounter[k]||0) + 1;
  const n = existing + batchCounter[k];
  return `${prefix}${ym}${String(n).padStart(3,'0')}`;
}

// Parse grid rows into _qeParsed entries (same shape as text-mode parser)
function parseQEGrid() {
  const rows = [...document.querySelectorAll('#qe-grid-body .qe-grid-row')];
  if (!rows.length) { alert('행이 없습니다. [+ 행 추가] 를 눌러주세요.'); return; }
  const parsed = [];
  const errors = [];
  const batchCounter = {};  // tracks per-prefix-month seq within this parse
  rows.forEach((tr, i) => {
    const date = tr.querySelector('.qe-g-date').value;
    let type = tr.querySelector('.qe-g-type').value;
    const memo = tr.querySelector('.qe-g-memo').value.trim();
    const amount = Number(tr.querySelector('.qe-g-amount').value || 0);
    const accountIdManual = tr.querySelector('.qe-g-account').value;
    const knockoff = tr.querySelector('.qe-g-knockoff').value.trim();

    // Skip completely empty rows
    if (!memo && !amount && !type) return;
    if (!memo || !amount) { errors.push(`#${i+1}: 거래처/메모와 금액은 필수입니다`); return; }
    if (!date) { errors.push(`#${i+1}: 날짜 누락`); return; }

    // Auto-detect type if blank
    if (!type) {
      const ti = qeDetectType(memo);
      type = ti.type;
      if (type === 'unknown') { errors.push(`#${i+1}: 구분을 선택하세요 (메모: "${memo}")`); return; }
    }

    // Account: use manual if set, otherwise detect from memo
    let account = null;
    if (accountIdManual) {
      const a = DB.accounts.find(x=>x.id===accountIdManual);
      if (a) account = {id: a.id, code: a.code, name: a.nameEn||a.nameKr};
    }
    if (!account) account = qeDetectAccount(memo, type);

    // Party: detect from memo
    const party = qeDetectParty(memo, type);

    // Auto-number (with batch counter to avoid collision)
    let number = '';
    if (type==='sales')         number = nextNumberBatch('INV', DB.invoices, date, batchCounter);
    else if (type==='receipt')  number = nextNumberBatch('OR',  DB.receipts, date, batchCounter);
    else if (type==='purchase') number = nextNumberBatch('PV',  DB.bills, date, batchCounter);
    else if (type==='payment')  number = nextNumberBatch('PY',  DB.payments, date, batchCounter);
    else number = `JE${date.slice(0,7).replace('-','')}${String(i+1).padStart(3,'0')}`;

    const warnings = [];
    if ((type==='sales'||type==='receipt'||type==='purchase'||type==='payment') && (!party || party.autoCreated))
      warnings.push('거래처 자동 생성 예정');

    parsed.push({
      idx: parsed.length, raw: `[${type}] ${date} ${memo} ${amount}${knockoff?' '+knockoff:''}`,
      number, type, confidence: type ? 1.0 : 0.5, explicit: true,
      date, amount, account, party, cashOrBank: null, knockoff,
      description: memo, warnings,
    });
  });
  if (errors.length) {
    alert('입력 오류:\n' + errors.join('\n'));
    return;
  }
  if (!parsed.length) { alert('등록할 행이 없습니다.'); return; }
  _qeParsed = parsed;
  renderQEPreview();
  // Scroll to preview
  setTimeout(()=>{
    document.getElementById('qe-preview')?.scrollIntoView({behavior:'smooth', block:'start'});
  }, 100);
}

// Override renderQuickEntry to initialize grid mode by default
const _origRenderQuickEntry = renderQuickEntry;
renderQuickEntry = function() {
  _origRenderQuickEntry();
  ensurePartyDatalist();
  // Initialize 3 empty grid rows on first visit
  if (!document.querySelectorAll('#qe-grid-body .qe-grid-row').length) {
    for (let i=0;i<3;i++) addQEGridRow();
  }
  updateQEGridCount();
};

// ── Examples loader ──────────────────────────────────
function loadQuickEntryExample() {
  const td = new Date().toISOString().slice(0,10);
  // Text-mode sample
  const sample = `# 한 줄에 한 거래씩 자유롭게 적으세요. (# 으로 시작하는 줄은 주석)
# 시스템이 자동으로: 일자·유형·금액·거래처·계정을 추출하고 품번을 부여합니다.

${td} ABC Sdn Bhd 7월 수수료 청구 MYR 8,000 외상
${td} XYZ Corporation 수수료 청구 5,500
${td} ABC 입금 받음 8000 INV${new Date().getFullYear()}${String(new Date().getMonth()+1).padStart(2,'0')}001
${td} Landlord Co 임차료 청구서 1,500 외상
${td} 임차료 지급 1500 Landlord
${td} Celcom 통신비 자동이체 150 은행
${td} Maybank 월 수수료 25
${td} 택배비 현금 35`;
  const ta = document.getElementById('qe-input');
  if (ta) ta.value = sample;

  // Grid-mode sample
  const gridBody = document.getElementById('qe-grid-body');
  if (gridBody) {
    gridBody.innerHTML = '';
    _qeGridIdx = 0;
    const examples = [
      {date: td, type:'sales',    memo:'ABC Sdn Bhd 7월 수수료 청구', amount: 8000, knockoff:''},
      {date: td, type:'sales',    memo:'XYZ Corporation 수수료 청구', amount: 5500, knockoff:''},
      {date: td, type:'receipt',  memo:'ABC 입금 받음', amount: 8000, knockoff:`INV${new Date().getFullYear()}${String(new Date().getMonth()+1).padStart(2,'0')}001`},
      {date: td, type:'purchase', memo:'Landlord Co 임차료 청구서', amount: 1500, knockoff:''},
      {date: td, type:'payment',  memo:'Landlord 임차료 지급', amount: 1500, knockoff:''},
      {date: td, type:'expense',  memo:'Celcom 통신비 자동이체', amount: 150, knockoff:''},
      {date: td, type:'expense',  memo:'Maybank 월 수수료', amount: 25, knockoff:''},
      {date: td, type:'expense',  memo:'택배비 현금', amount: 35, knockoff:''},
    ];
    examples.forEach(e => {
      const tr = addQEGridRow({date: e.date, memo: e.memo, amount: e.amount, knockoff: e.knockoff});
      tr.querySelector('.qe-g-type').value = e.type;
      // Trigger auto-account suggestion
      const accInfo = qeDetectAccount(e.memo, e.type);
      if (accInfo?.id) tr.querySelector('.qe-g-account').value = accInfo.id;
    });
  }
}
