'use strict';
// ══════════════════════════════════════════════════════
//  Bank Statement Import — 은행 명세서 입력 / 대조
//  ----------------------------------------------------
//  은행 CSV 명세서를 한꺼번에 업로드하면 시스템이:
//   1) 각 라인을 자동 분류 (Receipt / Payment / Expense / Income / Transfer)
//   2) 거래처·송장 자동 매칭 (knock-off)
//   3) 이미 입력된 거래는 매칭 표시 (중복 방지)
//   4) Statement Balance vs Book Balance 자동 대조
//   5) 검토 후 일괄 등록
// ══════════════════════════════════════════════════════

let _bsParsed = null;     // parsed statement lines
let _bsBankAccId = null;  // selected bank account

// ── Bank CSV format detection (Malaysian banks) ──────
function parseBankStatementCSV(text) {
  const rows = parseCSV(text);
  if (rows.length < 2) throw new Error('CSV 파일이 비어있습니다');
  // Find the header row (some banks have title/account-info rows above)
  let headerIdx = 0;
  for (let i = 0; i < Math.min(rows.length, 10); i++) {
    const cells = rows[i].map(c => String(c||'').toLowerCase());
    if (cells.some(c => /date|tarikh/.test(c)) &&
        cells.some(c => /description|particular|narration|desc/.test(c))) {
      headerIdx = i; break;
    }
  }
  const headers = rows[headerIdx];
  const dataRows = rows.slice(headerIdx + 1).filter(r => r.some(c => c && c.trim()));

  const colMap = {
    date:       findCol(headers, ['date','tarikh','trx date','transaction date','value date']),
    desc:       findCol(headers, ['description','transaction description','particulars','narration','remarks','details']),
    withdrawal: findCol(headers, ['withdrawal','debit','debit amount','dr','out','outflow','withdraw']),
    deposit:    findCol(headers, ['deposit','credit','credit amount','cr','in','inflow']),
    amount:     findCol(headers, ['amount','transaction amount']),  // some banks combine W/D in 1 column with sign
    balance:    findCol(headers, ['balance','baki','running balance','closing balance']),
    refNo:      findCol(headers, ['ref no','reference','cheque no','reference no','txn ref']),
  };
  if (colMap.date < 0) throw new Error('Date 컬럼을 찾을 수 없습니다. CSV 헤더를 확인하세요.');
  if (colMap.desc < 0) throw new Error('Description 컬럼을 찾을 수 없습니다.');
  if (colMap.withdrawal < 0 && colMap.deposit < 0 && colMap.amount < 0)
    throw new Error('금액 컬럼(Withdrawal/Deposit/Amount)을 찾을 수 없습니다.');

  return dataRows.map((row, i) => {
    const date = parseImportDate(row[colMap.date]);
    let withdrawal = colMap.withdrawal >= 0 ? parseAmount(row[colMap.withdrawal]) : 0;
    let deposit = colMap.deposit >= 0 ? parseAmount(row[colMap.deposit]) : 0;
    // Single-column "Amount" with signed numbers: negative = withdrawal
    if (colMap.amount >= 0 && withdrawal === 0 && deposit === 0) {
      const amt = parseAmount(row[colMap.amount]);
      const raw = String(row[colMap.amount] || '');
      if (amt > 0 && (raw.startsWith('-') || /\(.+\)/.test(raw))) withdrawal = Math.abs(amt);
      else if (amt > 0) deposit = amt;
    }
    return {
      idx: i, lineNo: i + 1,
      date,
      desc: String(row[colMap.desc] || '').trim(),
      withdrawal, deposit,
      balance: colMap.balance >= 0 ? parseAmount(row[colMap.balance]) : null,
      refNo: colMap.refNo >= 0 ? String(row[colMap.refNo] || '').trim() : '',
    };
  }).filter(r => r.date && (r.withdrawal > 0 || r.deposit > 0));
}

// ── PDF import ────────────────────────────────────────
// Tailored to Malaysian bank BizChannel-style PDF statements (tested against
// CIMB), where each transaction lands on one visual row:
//   <acct#> <seq> MM/DD/YYYY <code> <description...> <branch|"No Record Found"> <docRef> <amount> D|C <balance> C <recType>
// Text is pulled from the PDF's text layer (no OCR), grouped into rows by
// y-position, then columns joined left-to-right by x-position — this mirrors
// the table's visual layout closely enough for a fixed-shape regex to match.
// Branch/doc-ref column: usually "<4-digit branch> <docRef>", but rows with
// no originating branch collapse to a bare "No Record Found" (no doc ref at all).
const BS_PDF_ROW_RX = /^\d{4,}\s+\d+\s+(\d{2})\/(\d{2})\/(\d{4})\s+\d{3,4}\s+(.+?)\s+(?:\d{3,4}\s+\S+|No\s+Record\s+Found)\s+([\d,]+\.\d{2})\s+([DC])\s+([\d,]+\.\d{2})\s+[DC]\s+\d+\s*$/;

async function parseBankStatementPDF(arrayBuffer) {
  if (typeof pdfjsLib === 'undefined') throw new Error('PDF 파서(PDF.js)가 로드되지 않았습니다.');
  const pdf = await pdfjsLib.getDocument({data: arrayBuffer}).promise;
  const textRows = [];
  for (let p = 1; p <= pdf.numPages; p++) {
    const page = await pdf.getPage(p);
    const content = await page.getTextContent();
    const items = content.items
      .map(it => ({str: it.str, x: it.transform[4], y: Math.round(it.transform[5])}))
      .filter(it => it.str.trim());
    // Cluster into rows by y (±2pt tolerance), then sort each row left-to-right
    const rows = [];
    items.forEach(it => {
      // Tolerance wide enough to reabsorb a wrapped description's extra
      // line(s) — e.g. "BIZCHANNEL MTHLY OCT" / "2025 FEE (INCL 8% GST)"
      // straddle ~5-6pt above/below the row's numeric baseline — while still
      // staying well short of the ~30pt+ gap between distinct transactions.
      let row = rows.find(r => Math.abs(r.y - it.y) <= 7);
      if (!row) { row = {y: it.y, items: []}; rows.push(row); }
      row.items.push(it);
    });
    rows.sort((a, b) => b.y - a.y);  // PDF y grows upward — top of page first
    rows.forEach(r => {
      r.items.sort((a, b) => a.x - b.x);
      textRows.push(r.items.map(i => i.str).join(' ').replace(/\s+/g, ' ').trim());
    });
  }

  const out = [];
  for (const raw of textRows) {
    const m = raw.match(BS_PDF_ROW_RX);
    if (!m) continue;
    const [, mm, dd, yyyy, desc, amtStr, drcr, balStr] = m;
    const amount = Number(amtStr.replace(/,/g, ''));
    if (!amount) continue;
    out.push({
      date: `${yyyy}-${mm}-${dd}`,
      desc: desc.trim(),
      withdrawal: drcr === 'D' ? amount : 0,
      deposit: drcr === 'C' ? amount : 0,
      balance: Number(balStr.replace(/,/g, '')),
      refNo: '',
    });
  }
  if (!out.length) {
    throw new Error('PDF에서 거래 내역을 인식하지 못했습니다. 이 은행/양식은 아직 지원하지 않을 수 있습니다 — CSV로 시도해보세요.');
  }
  // Statement PDFs commonly list most-recent-first; re-sort chronologically
  out.sort((a, b) => a.date.localeCompare(b.date));
  return out;
}

// ── Auto-categorize a single bank line ───────────────
function categorizeBankLine(line, bankAccId) {
  const desc = (line.desc || '').toLowerCase();
  // 1. Already in books? (date ± 2 days, exact amount, same bank account)
  if (line.deposit > 0) {
    const existing = DB.receipts.find(r =>
      r.bankAccountId === bankAccId &&
      Math.abs(new Date(r.date) - new Date(line.date)) <= 2 * 86400000 &&
      Math.abs(r.totalAmount - line.deposit) < 0.01
    );
    if (existing) {
      const cust = getCustomer(existing.customerId);
      return {action: 'matched', recordType: 'receipt', recordId: existing.id, label: `✓ 매칭됨: ${existing.number} (${cust?.name||''})`};
    }
  }
  if (line.withdrawal > 0) {
    const existing = DB.payments.find(p =>
      p.bankAccountId === bankAccId &&
      Math.abs(new Date(p.date) - new Date(line.date)) <= 2 * 86400000 &&
      Math.abs(p.totalAmount - line.withdrawal) < 0.01
    );
    if (existing) {
      const sup = getSupplier(existing.supplierId);
      return {action: 'matched', recordType: 'payment', recordId: existing.id, label: `✓ 매칭됨: ${existing.number} (${sup?.name||''})`};
    }
    // Also check non-AP journal entries (e.g. depreciation, bank charge journals) for same date+amount
    const existingJE = DB.entries.find(e =>
      e.source !== 'invoice' && e.source !== 'receipt' && e.source !== 'bill' && e.source !== 'payment' &&
      Math.abs(new Date(e.date) - new Date(line.date)) <= 2 * 86400000 &&
      e.lines.some(l => l.accountId === bankAccId && (Math.abs(l.credit - line.withdrawal) < 0.01 || Math.abs(l.debit - line.deposit) < 0.01))
    );
    if (existingJE) return {action: 'matched', recordType: 'journal', recordId: existingJE.id, label: `✓ 매칭됨: ${existingJE.reference} (Journal)`};
  }

  // 2. New entry — auto-categorize
  // (A) Deposit
  if (line.deposit > 0) {
    // Match customer by name fragment in description
    for (const c of DB.customers) {
      if (!c.name || c.name.length < 3) continue;
      if (desc.includes(c.name.toLowerCase()) ||
          (c.code && desc.includes(c.code.toLowerCase()))) {
        // Outstanding invoice with matching amount?
        const inv = DB.invoices.find(i =>
          i.customerId === c.id &&
          Math.abs(Number(i.total||0) - Number(i.paid||0) - line.deposit) < 0.01
        );
        return {
          action: 'create_receipt',
          customerId: c.id, customerName: c.name,
          invoiceId: inv?.id, invoiceNumber: inv?.number || '',
          amount: line.deposit,
          confidence: inv ? 0.95 : 0.75,
        };
      }
    }
    // Interest income?
    if (/interest|이자|dividend|배당/i.test(line.desc)) {
      return {action: 'create_income', accountCode: '4003', amount: line.deposit, description: line.desc, confidence: 0.9};
    }
    // Tax refund (LHDN income tax / SST refund)?
    if (/tax\s*refund|refund.*(?:lhdn|tax)|세금\s*환급|환급금/i.test(line.desc)) {
      return {action: 'create_income', accountCode: '4007', amount: line.deposit, description: line.desc, confidence: 0.9};
    }
    // Capital injection?
    if (/capital|investor|자본금|투자/i.test(line.desc)) {
      return {action: 'create_income', accountCode: '3001', amount: line.deposit, description: line.desc, confidence: 0.7, note: '자본금 입금 추정'};
    }
    // Unknown deposit — generic "Other Income" or new customer receipt
    return {action: 'create_unknown_deposit', amount: line.deposit, description: line.desc, confidence: 0.4};
  }

  // (B) Withdrawal
  if (line.withdrawal > 0) {
    // Bank SST tax (Malaysia 8% service tax charged on bank fees)?
    if (/service\s*tax|bank.*\bsst\b|\bsst\b.*bank/i.test(line.desc)) {
      return {action: 'create_expense', accountCode: '5051', amount: line.withdrawal, description: line.desc, confidence: 0.95, label: '은행 SST'};
    }
    // Bank transfer fee?
    if (/transfer\s*fee|ibg\s*fee|\btelex\b|handling\s*fee|remittance\s*fee|이체\s*수수료/i.test(line.desc)) {
      return {action: 'create_expense', accountCode: '5052', amount: line.withdrawal, description: line.desc, confidence: 0.9, label: '계좌이체 수수료'};
    }
    // Bank charge (general)?
    if (/service\s*charge|month?ly\s*fee|mthly\s*fee|bank\s*charge|maintenance|biz.*banking|bizchannel|half\s*yearly\s*charge|충전\s*수수료|월\s*수수료/i.test(line.desc)) {
      return {action: 'create_expense', accountCode: '5009', amount: line.withdrawal, description: line.desc, confidence: 0.95, label: '은행 수수료'};
    }
    // Direct debit utilities
    if (/celcom|digi|maxis|unifi|telekom|tm\b/i.test(line.desc)) {
      return {action: 'create_expense', accountCode: '5006', amount: line.withdrawal, description: line.desc, confidence: 0.9, label: '통신비'};
    }
    if (/tnb|tenaga|electricity|water|indah\s*water|sewerage/i.test(line.desc)) {
      return {action: 'create_expense', accountCode: '5004', amount: line.withdrawal, description: line.desc, confidence: 0.9, label: '공과금'};
    }
    if (/payroll|salary|wage|급여|월급/i.test(line.desc)) {
      return {action: 'create_expense', accountCode: '5002', amount: line.withdrawal, description: line.desc, confidence: 0.85, label: '급여'};
    }
    if (/rent|rental|임차료|임대/i.test(line.desc)) {
      return {action: 'create_expense', accountCode: '5003', amount: line.withdrawal, description: line.desc, confidence: 0.85, label: '임차료'};
    }
    // Match supplier by name in description
    for (const s of DB.suppliers) {
      if (!s.name || s.name.length < 3) continue;
      if (desc.includes(s.name.toLowerCase()) ||
          (s.code && desc.includes(s.code.toLowerCase()))) {
        const bill = DB.bills.find(b =>
          b.supplierId === s.id &&
          Math.abs(Number(b.total||0) - Number(b.paid||0) - line.withdrawal) < 0.01
        );
        return {
          action: 'create_payment',
          supplierId: s.id, supplierName: s.name,
          billId: bill?.id, billNumber: bill?.number || '',
          amount: line.withdrawal,
          confidence: bill ? 0.95 : 0.75,
        };
      }
    }
    // Inter-account transfer?
    if (/transfer|fund\s*transfer|이체/i.test(line.desc)) {
      return {action: 'create_transfer', amount: line.withdrawal, description: line.desc, confidence: 0.7};
    }
    // Generic expense
    return {action: 'create_expense', accountCode: '5010', amount: line.withdrawal, description: line.desc, confidence: 0.4, label: '기타비용'};
  }

  return {action: 'skip', confidence: 0};
}

// ── Main UI ──────────────────────────────────────────
function renderBankStatement() {
  // Populate bank account dropdown
  const sel = document.getElementById('bs-bank-account');
  if (sel) {
    const banks = DB.accounts.filter(a =>
      a.type === 'asset' && !a.contra && (
        a.code === '1001' || a.code === '1002' ||
        /bank|cash|maybank|cimb|rhb|public|hong\s*leong/i.test(a.nameEn || '') ||
        /은행|현금/.test(a.nameKr || '')
      )
    );
    sel.innerHTML = '<option value="">-- 은행 계정 선택 --</option>' +
      banks.map(a => `<option value="${a.id}">${a.code} ${a.nameEn || a.nameKr}</option>`).join('');
    if (banks.length && !sel.value) sel.value = banks.find(a => a.code === '1002')?.id || banks[0].id;
  }
  _bsBankAccId = sel?.value || null;
}

function onBSFileChange(event) {
  const file = event.target.files[0];
  if (!file) return;
  if (!_bsBankAccId) { alert('먼저 은행 계정을 선택하세요.'); event.target.value = ''; return; }
  const isPDF = /\.pdf$/i.test(file.name) || file.type === 'application/pdf';
  const reader = new FileReader();
  reader.onload = async e => {
    try {
      const lines = isPDF ? await parseBankStatementPDF(e.target.result) : parseBankStatementCSV(e.target.result);
      processBankLines(lines, file.name);
    } catch (err) {
      console.error(err);
      alert((isPDF ? 'PDF' : 'CSV') + ' 파싱 실패: ' + err.message);
    }
  };
  if (isPDF) reader.readAsArrayBuffer(file);
  else reader.readAsText(file, 'UTF-8');
  event.target.value = '';
}

function onBSPaste() {
  const text = document.getElementById('bs-paste-area').value.trim();
  if (!text) { alert('붙여넣은 내용이 없습니다.'); return; }
  if (!_bsBankAccId) { alert('먼저 은행 계정을 선택하세요.'); return; }
  try {
    const lines = parseBankStatementCSV(text);
    processBankLines(lines, 'pasted-input');
  } catch (err) {
    alert('파싱 실패: ' + err.message);
  }
}

function processBankLines(lines, source) {
  if (!lines.length) { alert('인식된 거래 라인이 없습니다.'); return; }
  _bsParsed = lines.map(line => ({...line, suggestion: categorizeBankLine(line, _bsBankAccId)}));
  renderBSPreview(source);
}

function renderBSPreview(source) {
  if (!_bsParsed) return;
  const bankAcc = DB.accounts.find(a => a.id === _bsBankAccId);
  const stats = {matched: 0, create_receipt: 0, create_payment: 0, create_expense: 0, create_income: 0, create_transfer: 0, create_unknown_deposit: 0, skip: 0};
  _bsParsed.forEach(p => { stats[p.suggestion.action] = (stats[p.suggestion.action] || 0) + 1; });

  const totalDeposit = _bsParsed.reduce((s, l) => s + (l.deposit || 0), 0);
  const totalWithdrawal = _bsParsed.reduce((s, l) => s + (l.withdrawal || 0), 0);
  // Book balance for this account up to the latest statement date
  const lastDate = _bsParsed[_bsParsed.length - 1]?.date;
  const firstDate = _bsParsed[0]?.date;
  const bookBalAfter = bankAcc ? accountBalance(bankAcc.id, lastDate) : 0;
  const stmtBalEnd = _bsParsed[_bsParsed.length - 1]?.balance;

  const allAccountOptions = DB.accounts.sort((a, b) => a.code.localeCompare(b.code))
    .map(a => `<option value="${a.id}">${a.code} ${a.nameEn || a.nameKr}</option>`).join('');
  const custOptions = DB.customers.map(c => `<option value="${c.id}">${c.code} ${c.name}</option>`).join('');
  const supOptions = DB.suppliers.map(s => `<option value="${s.id}">${s.code} ${s.name}</option>`).join('');

  const rowsHtml = _bsParsed.map((line, i) => {
    const s = line.suggestion;
    const isMatched = s.action === 'matched';
    const rowBg = isMatched ? '#dcfce7' : (s.confidence < 0.6 ? '#fef3c7' : 'white');
    const confColor = s.confidence >= 0.85 ? '#0ea572' : s.confidence >= 0.6 ? '#d97706' : '#dc2626';

    let actionCell = '';
    if (isMatched) {
      actionCell = `<span style="color:#166534;font-size:.78rem;font-weight:600">${s.label}</span>
        <input type="hidden" class="bs-action" data-idx="${i}" value="skip">`;
    } else {
      const partyOptions = (s.action === 'create_receipt' || s.action === 'create_unknown_deposit') ? custOptions :
                          (s.action === 'create_payment') ? supOptions : '';
      const partyCell = s.action === 'create_receipt' || s.action === 'create_unknown_deposit' ? `
        <select class="input bs-party" data-idx="${i}" style="font-size:.75rem;padding:.2rem;width:100%">
          <option value="">-- 고객 --</option>${custOptions}
        </select>` :
        s.action === 'create_payment' ? `
        <select class="input bs-party" data-idx="${i}" style="font-size:.75rem;padding:.2rem;width:100%">
          <option value="">-- 공급업체 --</option>${supOptions}
        </select>` : '<span style="font-size:.7rem;color:var(--text-muted)">—</span>';
      const accountValue = s.accountCode ? DB.accounts.find(a => a.code === s.accountCode)?.id || '' : '';

      actionCell = `
        <select class="input bs-action" data-idx="${i}" onchange="onBSActionChange(${i})" style="font-size:.75rem;padding:.2rem;width:100%">
          <option value="create_receipt"  ${s.action === 'create_receipt' ? 'selected' : ''} ${line.deposit <= 0 ? 'disabled' : ''}>고객 수령 (Receipt)</option>
          <option value="create_payment"  ${s.action === 'create_payment' ? 'selected' : ''} ${line.withdrawal <= 0 ? 'disabled' : ''}>공급업체 지급 (Payment)</option>
          <option value="create_expense"  ${s.action === 'create_expense' ? 'selected' : ''} ${line.withdrawal <= 0 ? 'disabled' : ''}>비용 분개 (Expense)</option>
          <option value="create_income"   ${s.action === 'create_income' ? 'selected' : ''} ${line.deposit <= 0 ? 'disabled' : ''}>수익 분개 (Income)</option>
          <option value="create_transfer" ${s.action === 'create_transfer' ? 'selected' : ''}>계좌이체 (Transfer)</option>
          <option value="create_unknown_deposit" ${s.action === 'create_unknown_deposit' ? 'selected' : ''} ${line.deposit <= 0 ? 'disabled' : ''}>미분류 입금</option>
          <option value="skip"            ${s.action === 'skip' ? 'selected' : ''}>건너뛰기 (Skip)</option>
        </select>
        <div style="margin-top:.2rem">${partyCell}</div>`;
    }
    const acctSel = !isMatched && (s.action === 'create_expense' || s.action === 'create_income' || s.action === 'create_transfer') ? `
      <select class="input bs-account" data-idx="${i}" style="font-size:.75rem;padding:.2rem;width:100%">
        <option value="">-- 계정 --</option>${allAccountOptions}
      </select>` : '<span style="font-size:.7rem;color:var(--text-muted)">자동</span>';

    const ko = (s.action === 'create_receipt' && s.invoiceNumber) ? s.invoiceNumber :
               (s.action === 'create_payment' && s.billNumber) ? s.billNumber : '';

    return `<tr data-idx="${i}" style="vertical-align:top;background:${rowBg}">
      <td style="font-size:.7rem;color:var(--text-muted);padding:.3rem">${i + 1}</td>
      <td style="font-size:.78rem;padding:.3rem">${line.date}</td>
      <td style="font-size:.78rem;padding:.3rem">${escapeHtml(line.desc)}${line.refNo ? `<div style="font-size:.65rem;color:var(--text-muted)">ref: ${escapeHtml(line.refNo)}</div>` : ''}</td>
      <td style="font-size:.78rem;padding:.3rem;text-align:right;color:#dc2626">${line.withdrawal > 0 ? fmtN(line.withdrawal) : ''}</td>
      <td style="font-size:.78rem;padding:.3rem;text-align:right;color:#166534">${line.deposit > 0 ? fmtN(line.deposit) : ''}</td>
      <td style="font-size:.78rem;padding:.3rem;text-align:right;color:var(--text-muted)">${line.balance != null ? fmtN(line.balance) : ''}</td>
      <td style="padding:.3rem">${actionCell}</td>
      <td style="padding:.3rem">${acctSel}</td>
      <td style="padding:.3rem"><input type="text" class="input bs-knockoff" data-idx="${i}" value="${ko}" placeholder="INV/PV번호" style="font-size:.75rem;padding:.2rem;width:100%;font-family:monospace"></td>
      <td style="padding:.3rem;text-align:center;font-size:.7rem"><span style="color:${confColor};font-weight:600">${Math.round(s.confidence * 100)}%</span></td>
    </tr>`;
  }).join('');

  // Set initial customer/supplier dropdowns to suggested party
  setTimeout(() => {
    _bsParsed.forEach((line, i) => {
      const s = line.suggestion;
      const partySel = document.querySelector(`.bs-party[data-idx="${i}"]`);
      const accSel = document.querySelector(`.bs-account[data-idx="${i}"]`);
      if (partySel) {
        if (s.customerId) partySel.value = s.customerId;
        else if (s.supplierId) partySel.value = s.supplierId;
      }
      if (accSel && s.accountCode) {
        const acc = DB.accounts.find(a => a.code === s.accountCode);
        if (acc) accSel.value = acc.id;
      }
    });
  }, 50);

  const balanceDiff = stmtBalEnd != null ? bookBalAfter - stmtBalEnd : null;

  document.getElementById('bs-preview').innerHTML = `
    <div class="card" style="margin-top:1rem">
      <h3 style="margin-bottom:.5rem">검토 — ${escapeHtml(source)} (${_bsParsed.length}건)</h3>
      <div class="cards-grid" style="grid-template-columns:repeat(4,1fr);gap:.5rem;margin-bottom:1rem">
        <div class="stat-card"><div class="label">기간</div><div class="value" style="font-size:.85rem">${firstDate} ~ ${lastDate}</div></div>
        <div class="stat-card"><div class="label">총 입금</div><div class="value positive" style="font-size:1rem">${fmtN(totalDeposit)}</div></div>
        <div class="stat-card"><div class="label">총 출금</div><div class="value negative" style="font-size:1rem">${fmtN(totalWithdrawal)}</div></div>
        <div class="stat-card"><div class="label">계정: ${bankAcc?.code} ${bankAcc?.nameEn || bankAcc?.nameKr}</div>
          ${stmtBalEnd != null ? `
            <div style="font-size:.75rem;color:var(--text-muted)">명세서 잔액: <strong>${fmtN(stmtBalEnd)}</strong></div>
            <div style="font-size:.75rem;color:var(--text-muted)">장부 잔액: <strong>${fmtN(bookBalAfter)}</strong></div>
            <div style="font-size:.78rem;font-weight:700;color:${Math.abs(balanceDiff) < 0.01 ? '#166534' : '#dc2626'}">${Math.abs(balanceDiff) < 0.01 ? '✓ 일치' : `차이: ${fmtN(balanceDiff)}`}</div>
          ` : '<div style="font-size:.7rem;color:var(--text-muted)">잔액 컬럼 없음</div>'}</div>
      </div>
      <div style="font-size:.78rem;color:var(--text-muted);margin-bottom:.5rem">
        <span style="background:#dcfce7;padding:.15rem .4rem;border-radius:3px;margin-right:.4rem">✓ 매칭됨 (이미 입력): ${stats.matched || 0}</span>
        <span style="background:#cffafe;padding:.15rem .4rem;border-radius:3px;margin-right:.4rem">고객 수령: ${stats.create_receipt || 0}</span>
        <span style="background:#fef3c7;padding:.15rem .4rem;border-radius:3px;margin-right:.4rem">공급업체 지급: ${stats.create_payment || 0}</span>
        <span style="background:#fee2e2;padding:.15rem .4rem;border-radius:3px;margin-right:.4rem">비용: ${stats.create_expense || 0}</span>
        <span style="background:#ede9fe;padding:.15rem .4rem;border-radius:3px;margin-right:.4rem">수익: ${stats.create_income || 0}</span>
        ${stats.create_unknown_deposit ? `<span style="background:#fecaca;padding:.15rem .4rem;border-radius:3px;margin-right:.4rem">미분류 입금: ${stats.create_unknown_deposit}</span>` : ''}
      </div>
      <div style="overflow-x:auto;max-height:600px;overflow-y:auto">
        <table class="table" style="font-size:.78rem;min-width:1400px">
          <thead style="position:sticky;top:0;background:#f1f5f9;z-index:1">
            <tr>
              <th style="width:30px">#</th><th style="width:90px">날짜</th><th>설명</th>
              <th class="num" style="width:90px;color:#dc2626">출금</th>
              <th class="num" style="width:90px;color:#166534">입금</th>
              <th class="num" style="width:90px;color:var(--text-muted)">잔액</th>
              <th style="width:200px">처리</th>
              <th style="width:180px">계정과목</th>
              <th style="width:120px">Knock-off</th>
              <th style="width:60px">신뢰도</th>
            </tr>
          </thead>
          <tbody>${rowsHtml}</tbody>
        </table>
      </div>
      <div style="margin-top:.75rem;display:flex;gap:.5rem;justify-content:flex-end;align-items:center">
        <span style="font-size:.75rem;color:var(--text-muted)">매칭(녹색)은 자동으로 건너뜁니다. 미분류(노랑)는 직접 확인 후 등록하세요.</span>
        <button class="btn btn-outline" onclick="cancelBankStatement()">취소</button>
        <button class="btn btn-outline" style="border-color:#d97706;color:#d97706" onclick="commitBankStatementAsSuspense()" title="세부 계정을 지금 정하지 않고, 은행 잔액만 먼저 맞춰둔 뒤 나중에 하나씩 정리합니다">⚡ 전부 미분류로 즉시 기표</button>
        <button class="btn btn-primary" onclick="commitBankStatement()">✓ 전체 등록</button>
      </div>
    </div>`;
  setTimeout(() => document.getElementById('bs-preview')?.scrollIntoView({behavior:'smooth', block:'start'}), 100);
}

function onBSActionChange(idx) {
  // Re-render row based on new action
  const sel = document.querySelector(`.bs-action[data-idx="${idx}"]`);
  if (!sel || !_bsParsed[idx]) return;
  const newAction = sel.value;
  _bsParsed[idx].suggestion.action = newAction;
  // Re-render entire preview to update party/account columns
  renderBSPreview('updated');
}

function cancelBankStatement() {
  _bsParsed = null;
  document.getElementById('bs-preview').innerHTML = '';
}

// ── Commit ──────────────────────────────────────────
function commitBankStatement() {
  if (!_bsParsed || !_bsBankAccId) return;
  const bankAcc = DB.accounts.find(a => a.id === _bsBankAccId);
  if (!bankAcc) return alert('은행 계정을 찾을 수 없습니다.');
  const apAcc = DB.accounts.find(a => a.id === DB.settings.defaultApAccount) || DB.accounts.find(a => a.code === '2001');
  const arAcc = DB.accounts.find(a => a.id === DB.settings.defaultArAccount) || DB.accounts.find(a => a.code === '1003');

  let stats = {matched: 0, receipts: 0, payments: 0, expenses: 0, incomes: 0, transfers: 0, skipped: 0, errors: []};
  const batch = {};

  _bsParsed.forEach((line, i) => {
    try {
      // Read latest values from DOM
      const action = document.querySelector(`.bs-action[data-idx="${i}"]`)?.value || line.suggestion.action;
      const partyId = document.querySelector(`.bs-party[data-idx="${i}"]`)?.value || '';
      const accountId = document.querySelector(`.bs-account[data-idx="${i}"]`)?.value || '';
      const knockoff = document.querySelector(`.bs-knockoff[data-idx="${i}"]`)?.value?.trim() || '';

      if (action === 'matched' || action === 'skip') { stats.skipped++; return; }

      if (action === 'create_receipt' || action === 'create_unknown_deposit') {
        if (!partyId) { stats.errors.push(`#${i+1}: 고객을 선택하세요`); return; }
        const allocs = [];
        if (knockoff) {
          const inv = DB.invoices.find(x => x.number === knockoff && x.customerId === partyId);
          if (inv) {
            const bal = Number(inv.total||0) - Number(inv.paid||0);
            const alloc = Math.min(line.deposit, bal);
            allocs.push({invoiceId: inv.id, amount: alloc});
            inv.paid = Number(inv.paid||0) + alloc;
          }
        }
        const onAccount = line.deposit - allocs.reduce((s,a)=>s+a.amount,0);
        const rcpt = {
          id: uid(),
          number: nextNumberBatch('OR', DB.receipts, line.date, batch),
          date: line.date,
          customerId: partyId,
          bankAccountId: _bsBankAccId,
          method: 'Bank Transfer', chequeNo: line.refNo || '',
          notes: line.desc, allocations: allocs,
          onAccount: Math.max(0, onAccount),
          totalAmount: line.deposit,
        };
        DB.receipts.push(rcpt);
        postReceiptJournal(rcpt);
        stats.receipts++;
      }
      else if (action === 'create_payment') {
        if (!partyId) { stats.errors.push(`#${i+1}: 공급업체를 선택하세요`); return; }
        const allocs = [];
        if (knockoff) {
          const bill = DB.bills.find(x => x.number === knockoff && x.supplierId === partyId);
          if (bill) {
            const bal = Number(bill.total||0) - Number(bill.paid||0);
            const alloc = Math.min(line.withdrawal, bal);
            allocs.push({billId: bill.id, amount: alloc});
            bill.paid = Number(bill.paid||0) + alloc;
          }
        }
        const onAccount = line.withdrawal - allocs.reduce((s,a)=>s+a.amount,0);
        const pay = {
          id: uid(),
          number: nextNumberBatch('PY', DB.payments, line.date, batch),
          date: line.date,
          supplierId: partyId,
          bankAccountId: _bsBankAccId,
          method: 'Bank Transfer', chequeNo: line.refNo || '',
          notes: line.desc, allocations: allocs,
          onAccount: Math.max(0, onAccount),
          totalAmount: line.withdrawal,
        };
        DB.payments.push(pay);
        postPaymentJournal(pay);
        stats.payments++;
      }
      else if (action === 'create_expense') {
        if (!accountId) { stats.errors.push(`#${i+1}: 비용 계정을 선택하세요`); return; }
        DB.entries.push({
          id: uid(), date: line.date,
          reference: `BS${line.date.slice(0,7).replace('-','')}${String(i+1).padStart(3,'0')}`,
          description: line.desc,
          lines: [
            {accountId: accountId, debit: line.withdrawal, credit: 0},
            {accountId: _bsBankAccId, debit: 0, credit: line.withdrawal},
          ],
          source: 'manual',
        });
        stats.expenses++;
      }
      else if (action === 'create_income') {
        if (!accountId) { stats.errors.push(`#${i+1}: 수익 계정을 선택하세요`); return; }
        DB.entries.push({
          id: uid(), date: line.date,
          reference: `BS${line.date.slice(0,7).replace('-','')}${String(i+1).padStart(3,'0')}`,
          description: line.desc,
          lines: [
            {accountId: _bsBankAccId, debit: line.deposit, credit: 0},
            {accountId: accountId, debit: 0, credit: line.deposit},
          ],
          source: 'manual',
        });
        stats.incomes++;
      }
      else if (action === 'create_transfer') {
        if (!accountId) { stats.errors.push(`#${i+1}: 상대 계정을 선택하세요`); return; }
        const isOut = line.withdrawal > 0;
        DB.entries.push({
          id: uid(), date: line.date,
          reference: `TRF${line.date.slice(0,7).replace('-','')}${String(i+1).padStart(3,'0')}`,
          description: `이체 — ${line.desc}`,
          lines: isOut ? [
            {accountId: accountId, debit: line.withdrawal, credit: 0},
            {accountId: _bsBankAccId, debit: 0, credit: line.withdrawal},
          ] : [
            {accountId: _bsBankAccId, debit: line.deposit, credit: 0},
            {accountId: accountId, debit: 0, credit: line.deposit},
          ],
          source: 'manual',
        });
        stats.transfers++;
      }
    } catch (err) {
      console.error(err);
      stats.errors.push(`#${i+1}: ${err.message}`);
    }
  });

  saveDB();
  populateAccountDropdowns();
  populateLedgerSelect();

  const msg = [
    '✓ 등록 완료',
    `매칭(이미 입력됨): ${stats.matched + stats.skipped}건`,
    `고객 수령: ${stats.receipts}건`,
    `공급업체 지급: ${stats.payments}건`,
    `비용 분개: ${stats.expenses}건`,
    `수익 분개: ${stats.incomes}건`,
    stats.transfers ? `계좌이체: ${stats.transfers}건` : '',
    stats.errors.length ? `\n⚠ 오류 ${stats.errors.length}건:\n${stats.errors.join('\n')}` : '',
  ].filter(Boolean).join('\n');
  alert(msg);
  document.getElementById('bs-preview').innerHTML = `<div class="alert alert-success" style="margin-top:1rem">${msg.replace(/\n/g,'<br>')}</div>`;
  _bsParsed = null;
}

// ── "Post first, classify later" — bulk-post everything unmatched to a
//    suspense/clearing account so the bank balance is right immediately,
//    then reclassify each one individually later (see renderUnclassifiedBank). ──
// 2020, not 2010: payroll.js reserves 2010-2015 for its own auto-created
// accounts (미지급 급여 / EPF / SOCSO / EIS / PCB) and would otherwise post
// salaries payable into this suspense account. The name fallback also catches
// the account created before the code was moved.
function _getSuspenseAccount() {
  return DB.accounts.find(a => a.code === '2020') || DB.accounts.find(a => /은행거래\s*미정리/.test(a.nameKr || ''));
}

function commitBankStatementAsSuspense() {
  if (!_bsParsed || !_bsBankAccId) return;
  const susp = _getSuspenseAccount();
  if (!susp) return alert('미분류 임시 계정(2010 은행거래 미정리)을 찾을 수 없습니다.');
  const toPost = _bsParsed.filter(l => l.suggestion.action !== 'matched' && (l.withdrawal || l.deposit));
  if (!toPost.length) return alert('기표할 미매칭 거래가 없습니다.');
  if (!confirm(`매칭 안 된 ${toPost.length}건을 전부 "${susp.code} ${susp.nameKr}" 계정으로 임시 기표합니다.\n나중에 "미분류 은행거래" 메뉴에서 하나씩 실제 계정으로 정리해주세요.\n계속할까요?`)) return;

  let count = 0;
  _bsParsed.forEach((line, i) => {
    if (line.suggestion.action === 'matched') return;
    const amt = line.withdrawal || line.deposit;
    if (!amt) return;
    const isWithdrawal = line.withdrawal > 0;
    DB.entries.push({
      id: uid(), date: line.date,
      reference: `BS${line.date.slice(0,7).replace('-','')}${String(i+1).padStart(3,'0')}`,
      description: line.desc,
      lines: isWithdrawal ? [
        {accountId: susp.id, debit: amt, credit: 0},
        {accountId: _bsBankAccId, debit: 0, credit: amt},
      ] : [
        {accountId: _bsBankAccId, debit: amt, credit: 0},
        {accountId: susp.id, debit: 0, credit: amt},
      ],
      source: 'bank-suspense',
    });
    count++;
  });

  saveDB();
  populateAccountDropdowns();
  populateLedgerSelect();
  const msg = `✓ ${count}건 임시 기표 완료.\n왼쪽 메뉴 "미분류 은행거래"에서 세부 계정을 하나씩 정리해주세요.`;
  alert(msg);
  document.getElementById('bs-preview').innerHTML = `<div class="alert alert-success" style="margin-top:1rem">${msg.replace(/\n/g,'<br>')}</div>`;
  _bsParsed = null;
  if (typeof renderUnclassifiedBank === 'function') renderUnclassifiedBank();
}

// ── Unclassified bank transactions — review & reclassify one by one ──
function renderUnclassifiedBank() {
  const el = document.getElementById('bs-unclassified-list');
  if (!el) return;
  const susp = _getSuspenseAccount();
  // Identified purely by data shape (a line still pointing at the suspense
  // account) rather than a separate flag — flags on the entry object don't
  // survive the Supabase round-trip (only `lines` is synced), but this does.
  const list = susp
    ? DB.entries.filter(e => e.lines.some(l => l.accountId === susp.id))
        .slice().sort((a, b) => b.date.localeCompare(a.date))
    : [];

  if (!list.length) {
    el.innerHTML = `<div class="card" style="text-align:center;color:var(--text-muted);padding:2rem">정리할 미분류 은행거래가 없습니다.</div>`;
    return;
  }

  const allAccountOptions = (excludeIds) => DB.accounts
    .filter(a => !excludeIds.includes(a.id))
    .sort((a, b) => a.code.localeCompare(b.code))
    .map(a => `<option value="${a.id}">${a.code} ${a.nameEn || a.nameKr}</option>`).join('');

  el.innerHTML = `
    <table class="table">
      <thead><tr>
        <th>날짜</th><th>내용 (은행 명세서 원문)</th><th class="num">금액 (MYR)</th>
        <th style="width:260px">실제 계정으로 정리</th><th></th>
      </tr></thead>
      <tbody>
        ${list.map(e => {
          const suspLine = e.lines.find(l => l.accountId === susp.id);
          const bankLine = e.lines.find(l => l.accountId !== susp.id);
          const amt = (suspLine.debit || suspLine.credit || 0);
          return `<tr data-entry-id="${e.id}">
            <td style="font-size:.82rem">${e.date}</td>
            <td style="font-size:.82rem">${escapeHtml(e.description || '')}</td>
            <td class="num"><strong>${fmtN(amt)}</strong></td>
            <td>
              <select class="input bs-reclass-account" data-entry-id="${e.id}" style="font-size:.78rem;padding:.25rem;width:100%">
                <option value="">-- 실제 계정 선택 --</option>
                ${allAccountOptions([susp.id, bankLine?.accountId])}
              </select>
            </td>
            <td><button class="btn btn-sm btn-primary" onclick="reclassifyBankEntry('${e.id}')">✓ 정리</button></td>
          </tr>`;
        }).join('')}
      </tbody>
    </table>
    <div style="margin-top:.5rem;font-size:.78rem;color:var(--text-muted)">
      총 ${list.length}건 | 합계 MYR ${fmtN(list.reduce((s, e) => {
        const l = e.lines.find(x => x.accountId === susp.id);
        return s + (l.debit || l.credit || 0);
      }, 0))}
    </div>`;
}

function reclassifyBankEntry(entryId) {
  const susp = _getSuspenseAccount();
  const entry = DB.entries.find(e => e.id === entryId);
  if (!entry || !susp) return;
  const sel = document.querySelector(`.bs-reclass-account[data-entry-id="${entryId}"]`);
  const newAccId = sel ? sel.value : '';
  if (!newAccId) return alert('실제 계정을 선택하세요.');
  const line = entry.lines.find(l => l.accountId === susp.id);
  if (!line) return;
  line.accountId = newAccId;
  entry.source = 'bank-reclassified';
  saveDB();
  populateAccountDropdowns();
  populateLedgerSelect();
  renderUnclassifiedBank();
}

// ── Sample data loader ───────────────────────────────
function loadBSExample() {
  if (!_bsBankAccId) {
    const sel = document.getElementById('bs-bank-account');
    if (sel && sel.options.length > 1) { sel.value = sel.options[1].value; _bsBankAccId = sel.value; }
  }
  const sample = `Date,Description,Withdrawal,Deposit,Balance
2025-07-05,IBFT FROM ABC SDN BHD,0,5000.00,20000.00
2025-07-08,SERVICE CHARGE,5.00,0,19995.00
2025-07-10,IBFT TO LANDLORD CO,1500.00,0,18495.00
2025-07-15,CELCOM DIRECT DEBIT,150.00,0,18345.00
2025-07-18,IBFT FROM XYZ CORPORATION,0,5500.00,23845.00
2025-07-20,TNB BERHAD DIRECT DEBIT,180.00,0,23665.00
2025-07-25,INTEREST CREDITED,0,12.50,23677.50
2025-07-30,SALARY PAYROLL JUL,3500.00,0,20177.50
2025-07-31,MONTHLY MAINTENANCE FEE,25.00,0,20152.50`;
  document.getElementById('bs-paste-area').value = sample;
}
