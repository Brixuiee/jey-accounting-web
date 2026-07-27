'use strict';
// ══════════════════════════════════════════════════════
//  Tax Module — 말레이시아 세무
//  ----------------------------------------------------
//  1) CP58 — 수수료/인센티브 지급 신고
//     Section 83A Income Tax Act 1967: agent/dealer/distributor에게
//     연간 MYR 5,000 초과 지급 시 매년 3/31까지 LHDN 제출 의무
//  2) Income Tax Provision — 법인세 충당금 계산 + 분개
//     SME 법인세율: 첫 MYR 600,000은 17%, 초과분 24%
//  3) Tax Calendar — 모든 세무 신고 기한
// ══════════════════════════════════════════════════════

// ── Malaysian SME Tax Rates 2024-2025 ────────────────
const TAX_RATES_SME = {
  threshold: 600000,    // MYR — first 600k taxed at lower rate
  lowerRate: 0.17,      // 17% first 600k
  upperRate: 0.24,      // 24% balance
};
const TAX_RATES_NON_SME = { rate: 0.24 };

const CP58_THRESHOLD = 5000;  // MYR — annual payment threshold for CP58 reporting

// Migration helper — ensure required tax accounts and recipients store exist
function ensureTaxAccounts() {
  const needs = [
    {code:'2005', nameKr:'법인세 미지급금', nameEn:'Income Tax Payable', type:'liability'},
    {code:'5012', nameKr:'법인세비용', nameEn:'Income Tax Expense', type:'expense'},
  ];
  let added = false;
  for (const n of needs) {
    if (!DB.accounts.find(a=>a.code===n.code)) {
      DB.accounts.push({id: 'a'+n.code, ...n});
      added = true;
    }
  }
  if (!DB.taxComputations) { DB.taxComputations = []; added = true; }
  if (!DB.taxRecipients)   { DB.taxRecipients = []; added = true; }
  if (added) saveDB();
}

// ══════════════════════════════════════════════════════
//  1) CP58 — Commission Payment Tracking
// ══════════════════════════════════════════════════════

// Aggregate supplier payments by supplier for a given year
// Commission payments are identified by:
//   - Supplier marked as "commission agent" (supplier.isCommissionAgent = true), OR
//   - Bill account is 5xxx commission-type, OR
//   - Manual tag (payment.cp58Reportable = true)
function aggregateCP58(year) {
  const yearStart = `${year}-01-01`;
  const yearEnd = `${year}-12-31`;
  const summary = new Map();

  // From Supplier Payments
  for (const pay of DB.payments) {
    if (pay.date < yearStart || pay.date > yearEnd) continue;
    const sup = getSupplier(pay.supplierId);
    if (!sup) continue;
    // STRICT rule: only include if supplier is explicitly flagged as Commission Agent
    //   OR payment itself is tagged cp58Reportable.
    // Keyword scanning of descriptions is too error-prone (e.g. "not commission" matches "commission").
    // Users must check the "Commission Agent" box on supplier record.
    const isCommissionPay = !!(sup.isCommissionAgent || pay.cp58Reportable);
    if (!isCommissionPay) continue;

    const key = sup.id;
    if (!summary.has(key)) {
      summary.set(key, {supplier: sup, totalMonetary: 0, totalNonMonetary: 0, transactions: []});
    }
    const e = summary.get(key);
    e.totalMonetary += Number(pay.totalAmount||0);
    e.transactions.push({date: pay.date, number: pay.number, amount: pay.totalAmount, note: pay.notes});
  }

  return [...summary.values()].sort((a,b)=>(b.totalMonetary+b.totalNonMonetary)-(a.totalMonetary+a.totalNonMonetary));
}

function renderCP58() {
  ensureTaxAccounts();
  const yearEl = document.getElementById('cp58-year');
  if (yearEl && !yearEl.value) yearEl.value = new Date().getFullYear() - 1;  // default to previous year
  const year = Number(yearEl?.value || new Date().getFullYear()-1);
  const summary = aggregateCP58(year);

  const reportable = summary.filter(s => (s.totalMonetary + s.totalNonMonetary) > CP58_THRESHOLD);
  const total = summary.reduce((s,x)=>s+x.totalMonetary+x.totalNonMonetary, 0);
  const reportableTotal = reportable.reduce((s,x)=>s+x.totalMonetary+x.totalNonMonetary, 0);

  document.getElementById('cp58-report').innerHTML = `
    <div class="report-title">
      <h2>${DB.settings.companyName}</h2>
      <p>CP58 — Statement of Monetary &amp; Non-Monetary Incentive Payment</p>
      <p>수수료/인센티브 지급 신고서 — Year of Assessment ${year}</p>
      <p style="font-size:.75rem;color:var(--text-muted)">Section 83A, Income Tax Act 1967 · LHDN 제출일: ${year+1}년 3월 31일</p>
    </div>
    <div class="cards-grid" style="grid-template-columns:repeat(4,1fr);gap:.5rem;margin:1rem 0">
      <div class="stat-card"><div class="label">총 지급 대상자</div><div class="value">${summary.length}명</div></div>
      <div class="stat-card"><div class="label">총 지급액 (MYR)</div><div class="value">${fmtN(total)}</div></div>
      <div class="stat-card"><div class="label">신고 대상자 (>MYR ${fmtN(CP58_THRESHOLD)})</div><div class="value" style="color:#dc2626">${reportable.length}명</div></div>
      <div class="stat-card"><div class="label">신고 대상 총액</div><div class="value" style="color:#dc2626">${fmtN(reportableTotal)}</div></div>
    </div>
    <div style="background:#fef3c7;padding:.75rem;border-radius:6px;font-size:.82rem;margin-bottom:1rem;line-height:1.6">
      ⚠️ <strong>제출 의무:</strong> 연간 지급액이 <strong>MYR ${fmtN(CP58_THRESHOLD)}</strong>을 초과하는 모든 agent/dealer/distributor는 CP58 양식으로 신고해야 합니다.
      미신고 시 RM 200~RM 20,000 벌금 또는 6개월 이하 징역 (Section 120 ITA).
    </div>
    <table class="table" style="font-size:.78rem">
      <thead style="background:#f1f5f9">
        <tr>
          <th>#</th><th>Code</th><th>Recipient Name</th><th>IC / Passport / Reg. No</th><th>Address</th>
          <th class="num">현금 지급 (MYR)</th><th class="num">현물 지급 (MYR)</th><th class="num">합계 (MYR)</th><th>CP58 대상</th><th></th>
        </tr>
      </thead>
      <tbody>
        ${summary.map((s,i)=>{
          const sup = s.supplier;
          const t = s.totalMonetary + s.totalNonMonetary;
          const reportable = t > CP58_THRESHOLD;
          return `<tr style="${reportable?'background:#fef2f2':''}">
            <td>${i+1}</td>
            <td style="font-family:monospace">${sup.code||'—'}</td>
            <td><strong>${sup.name}</strong></td>
            <td style="font-family:monospace;font-size:.72rem">${sup.regNo||'<span style="color:#dc2626">⚠ 누락</span>'}</td>
            <td style="font-size:.7rem;max-width:200px">${sup.address||'<span style="color:var(--text-muted)">—</span>'}</td>
            <td class="num">${fmtN(s.totalMonetary)}</td>
            <td class="num">${fmtN(s.totalNonMonetary)}</td>
            <td class="num"><strong>${fmtN(t)}</strong></td>
            <td>${reportable?'<span style="color:#dc2626;font-weight:700">✓ 대상</span>':'<span style="color:var(--text-muted);font-size:.72rem">미만</span>'}</td>
            <td>
              <button class="btn btn-sm btn-outline" onclick="openCP58Detail('${sup.id}',${year})">상세</button>
            </td>
          </tr>`;
        }).join('') || '<tr><td colspan="10" class="empty-msg">해당 연도 수수료 지급 내역 없음. <br>공급업체 등록 시 "Commission Agent" 체크 또는 비용 명세에 "commission"/"수수료" 포함 필요.</td></tr>'}
      </tbody>
    </table>
    <h3 style="margin-top:1.5rem;font-size:1rem">📋 LHDN 제출 양식 데이터 (CP58)</h3>
    ${reportable.length ? `
      <p style="font-size:.78rem;color:var(--text-muted);margin-bottom:.5rem">아래 표를 복사해 LHDN MyTax 포털 또는 인쇄 양식에 입력하세요:</p>
      <pre style="background:#1e293b;color:#e2e8f0;padding:1rem;border-radius:6px;font-size:.72rem;overflow-x:auto;line-height:1.5">${
        reportable.map((s,i)=>{
          return [
            `${i+1}. ${s.supplier.name}`,
            `   IC/Reg: ${s.supplier.regNo||'(MISSING - 수정 필요)'}`,
            `   Address: ${s.supplier.address||'(MISSING)'}`,
            `   Monetary: MYR ${fmtN(s.totalMonetary)}`,
            `   Non-Monetary: MYR ${fmtN(s.totalNonMonetary)}`,
            `   Total: MYR ${fmtN(s.totalMonetary+s.totalNonMonetary)}`,
          ].join('\n');
        }).join('\n\n')
      }</pre>
      <button class="btn btn-outline" style="margin-top:.5rem" onclick="exportCP58CSV(${year})">↓ CP58 CSV Export</button>
    ` : '<p style="font-size:.82rem;color:var(--text-muted);padding:1rem;text-align:center">신고 대상자 없음. (MYR 5,000 초과 지급자 없음)</p>'}
  `;
}

function exportCP58CSV(year) {
  const summary = aggregateCP58(year).filter(s => (s.totalMonetary+s.totalNonMonetary) > CP58_THRESHOLD);
  const csv = ['No,Recipient Name,IC/Passport/Reg No,Address,Monetary Payment (MYR),Non-Monetary Payment (MYR),Total (MYR)'];
  summary.forEach((s,i)=>{
    csv.push([
      i+1,
      `"${(s.supplier.name||'').replace(/"/g,'""')}"`,
      `"${(s.supplier.regNo||'').replace(/"/g,'""')}"`,
      `"${(s.supplier.address||'').replace(/"/g,'""').replace(/\n/g,' ')}"`,
      s.totalMonetary.toFixed(2),
      s.totalNonMonetary.toFixed(2),
      (s.totalMonetary+s.totalNonMonetary).toFixed(2),
    ].join(','));
  });
  const blob = new Blob(['﻿'+csv.join('\n')], {type:'text/csv;charset=utf-8'});
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `CP58_${year}.csv`;
  a.click();
}

function openCP58Detail(supplierId, year) {
  const sup = getSupplier(supplierId);
  const yearStart = `${year}-01-01`, yearEnd = `${year}-12-31`;
  const payments = DB.payments.filter(p =>
    p.supplierId === supplierId && p.date >= yearStart && p.date <= yearEnd
  ).sort((a,b)=>a.date.localeCompare(b.date));
  const total = payments.reduce((s,p)=>s+Number(p.totalAmount||0), 0);

  const html = `
    <div style="background:#f1f5f9;padding:.75rem;border-radius:6px;margin-bottom:1rem">
      <h3 style="margin-bottom:.4rem">${sup.code} ${sup.name}</h3>
      <div style="font-size:.78rem;color:var(--text-muted)">
        Reg No: ${sup.regNo||'<span style="color:#dc2626">⚠ 누락 — 공급업체 정보에서 수정 필요</span>'}<br>
        Address: ${sup.address||'<span style="color:#dc2626">⚠ 누락</span>'}
      </div>
    </div>
    <h4 style="margin-bottom:.5rem">${year}년 지급 내역 (${payments.length}건, 총 MYR ${fmtN(total)})</h4>
    <table class="table">
      <thead><tr><th>Date</th><th>Payment No</th><th>Note</th><th class="num">Amount (MYR)</th></tr></thead>
      <tbody>
        ${payments.map(p=>`<tr><td>${p.date}</td><td><strong>${p.number}</strong></td><td>${p.notes||'—'}</td><td class="num">${fmtN(p.totalAmount)}</td></tr>`).join('')}
        <tr style="font-weight:700;border-top:2px solid var(--text)"><td colspan="3">합계</td><td class="num">${fmtN(total)}</td></tr>
      </tbody>
    </table>
    <div style="margin-top:1rem;padding:.5rem;background:#fff3c7;border-radius:4px;font-size:.78rem">
      💡 이 공급업체를 CP58 대상에서 제외하려면, 공급업체 정보 → "Commission Agent" 체크 해제 또는 비용 설명에서 "commission"/"수수료" 단어 제거.
    </div>
  `;
  // Show in a simple modal/overlay
  const existing = document.getElementById('cp58-detail-overlay');
  if (existing) existing.remove();
  const overlay = document.createElement('div');
  overlay.id = 'cp58-detail-overlay';
  overlay.className = 'modal-overlay';
  overlay.style.display = 'flex';
  overlay.innerHTML = `
    <div class="modal modal-lg">
      <div class="modal-header"><h2>CP58 상세 — ${sup.name}</h2>
        <button class="modal-close" onclick="document.getElementById('cp58-detail-overlay').remove()">✕</button></div>
      <div class="modal-body">${html}</div>
      <div class="modal-footer">
        <button class="btn btn-outline" onclick="document.getElementById('cp58-detail-overlay').remove()">닫기</button>
      </div>
    </div>`;
  document.body.appendChild(overlay);
  overlay.addEventListener('click', e=>{ if (e.target===overlay) overlay.remove(); });
}

// ══════════════════════════════════════════════════════
//  2) Income Tax Provision — 법인세 충당금 계산
// ══════════════════════════════════════════════════════

function calculateTaxProvision(fromDate, toDate, isSME=true) {
  // 1. Profit Before Tax = Revenue - Expenses
  const revAccs = DB.accounts.filter(a=>a.type==='revenue');
  const expAccs = DB.accounts.filter(a=>a.type==='expense');
  const totalRev = revAccs.reduce((s,a)=>{
    const {dr,cr} = accountBalanceRange(a.id, fromDate, toDate);
    return s + cr - dr;
  }, 0);
  const totalExp = expAccs.reduce((s,a)=>{
    const {dr,cr} = accountBalanceRange(a.id, fromDate, toDate);
    return s + dr - cr;
  }, 0);
  const profitBeforeTax = totalRev - totalExp;

  // 2. Adjustments (manual)
  const ui = document.getElementById('tax-comp-form');
  const getAdj = (id) => Number(document.getElementById(id)?.value || 0);
  const entertainmentTotal = getAdj('tax-adj-entertainment');
  const nonDeductible = getAdj('tax-adj-nondeductible');
  const otherAddback = getAdj('tax-adj-otheradd');
  const sec33Deduction = getAdj('tax-adj-sec33');
  const otherDeduction = getAdj('tax-adj-otherdeduct');

  // 3. Capital Allowance (replace book depreciation)
  // Book depreciation already in P&L. Add back, deduct CA instead.
  const depAcc = DB.accounts.find(a=>a.code==='5008');
  const bookDep = depAcc ? accountBalanceRange(depAcc.id, fromDate, toDate).dr - accountBalanceRange(depAcc.id, fromDate, toDate).cr : 0;
  const yearEnd = toDate;
  let capitalAllowance = 0;
  for (const asset of DB.assets) {
    if (asset.status === 'written-off' || asset.status === 'disposed') continue;
    if (typeof computeCapitalAllowance === 'function') {
      const ca = computeCapitalAllowance(asset, yearEnd);
      const prevCa = computeCapitalAllowance(asset, fromDate);
      capitalAllowance += (ca.totalToDate - prevCa.totalToDate);
    }
  }

  // 4. Chargeable Income
  const addBacks = bookDep + entertainmentTotal * 0.5 + nonDeductible + otherAddback;
  const deductions = capitalAllowance + sec33Deduction + otherDeduction;
  const chargeableIncome = profitBeforeTax + addBacks - deductions;

  // 5. Apply tax rates
  let taxLiability = 0;
  let rateBreakdown = '';
  if (chargeableIncome <= 0) {
    taxLiability = 0;
    rateBreakdown = 'No tax (loss or zero CI)';
  } else if (isSME) {
    if (chargeableIncome <= TAX_RATES_SME.threshold) {
      taxLiability = chargeableIncome * TAX_RATES_SME.lowerRate;
      rateBreakdown = `${fmtN(chargeableIncome)} × 17% (SME first MYR 600k)`;
    } else {
      const t1 = TAX_RATES_SME.threshold * TAX_RATES_SME.lowerRate;
      const t2 = (chargeableIncome - TAX_RATES_SME.threshold) * TAX_RATES_SME.upperRate;
      taxLiability = t1 + t2;
      rateBreakdown = `${fmtN(TAX_RATES_SME.threshold)} × 17% + ${fmtN(chargeableIncome-TAX_RATES_SME.threshold)} × 24%`;
    }
  } else {
    taxLiability = chargeableIncome * TAX_RATES_NON_SME.rate;
    rateBreakdown = `${fmtN(chargeableIncome)} × 24%`;
  }

  return {
    profitBeforeTax, totalRev, totalExp,
    bookDep, capitalAllowance,
    entertainmentTotal, entertainmentAddBack: entertainmentTotal*0.5,
    nonDeductible, otherAddback,
    sec33Deduction, otherDeduction,
    addBacks, deductions,
    chargeableIncome, taxLiability, rateBreakdown,
    effectiveRate: profitBeforeTax > 0 ? (taxLiability/profitBeforeTax*100) : 0,
  };
}

function renderTaxComputation() {
  ensureTaxAccounts();
  const fromEl = document.getElementById('tax-comp-from');
  const toEl = document.getElementById('tax-comp-to');
  if (fromEl && !fromEl.value) {
    const fy = DB.settings.fiscalYearStart || '07-01';
    const y = new Date().getFullYear() - 1;
    fromEl.value = `${y}-${fy}`;
    toEl.value = `${y+1}-${fy.slice(0,2)}-${new Date(y+1, Number(fy.slice(0,2)),0).getDate()}`;
    // Simpler: assume FY July to June
    fromEl.value = `${y}-07-01`;
    toEl.value = `${y+1}-06-30`;
  }
  const fromDate = fromEl.value;
  const toDate = toEl.value;
  if (!fromDate || !toDate) return;
  const isSME = document.getElementById('tax-comp-sme')?.checked !== false;

  const calc = calculateTaxProvision(fromDate, toDate, isSME);

  const row = (label, value, indent=false, bold=false, negative=false, color='') => `
    <tr style="${bold?'font-weight:700;border-top:1px solid #cbd5e1':''}">
      <td style="${indent?'padding-left:1.5rem':''}">${label}</td>
      <td class="num" style="color:${color||(negative?'#dc2626':'inherit')}">${value<0?'(':''}${fmtN(Math.abs(value))}${value<0?')':''}</td>
    </tr>`;

  document.getElementById('tax-comp-output').innerHTML = `
    <div class="report-title">
      <h2>${DB.settings.companyName}</h2>
      <p>Income Tax Computation / 법인세 산출</p>
      <p>Year of Assessment: ${fromDate} ~ ${toDate}</p>
      <p style="font-size:.75rem;color:var(--text-muted)">${isSME?'SME (Small &amp; Medium Enterprise) Rate':'Non-SME Rate (24%)'}</p>
    </div>
    <table class="table" style="font-size:.85rem;max-width:700px;margin:1rem auto">
      <tbody>
        ${row('💰 Revenue (총수익)', calc.totalRev)}
        ${row('− Expenses (총비용)', -calc.totalExp)}
        ${row('= Profit Before Tax (PBT) / 세전이익', calc.profitBeforeTax, false, true, calc.profitBeforeTax<0, calc.profitBeforeTax>=0?'#0ea572':'#dc2626')}
        <tr><td colspan="2" style="background:#fef3c7;padding:.5rem;font-weight:600;font-size:.85rem">▼ Add Backs (가산 항목)</td></tr>
        ${row('Depreciation (회계 감가상각)', calc.bookDep, true)}
        ${row('Entertainment 50% (접대비 50% 가산)', calc.entertainmentAddBack, true)}
        ${row('Non-deductible Expenses (기타 손금불산입)', calc.nonDeductible, true)}
        ${row('Other Add-backs', calc.otherAddback, true)}
        ${row('Total Add Backs', calc.addBacks, false, true)}
        <tr><td colspan="2" style="background:#f0fdf4;padding:.5rem;font-weight:600;font-size:.85rem">▼ Deductions (공제 항목)</td></tr>
        ${row('Capital Allowance (세무 감가상각)', calc.capitalAllowance, true)}
        ${row('Sec 33 Deductions', calc.sec33Deduction, true)}
        ${row('Other Deductions', calc.otherDeduction, true)}
        ${row('Total Deductions', calc.deductions, false, true)}
        ${row('🎯 Chargeable Income (CI) / 과세소득', calc.chargeableIncome, false, true, calc.chargeableIncome<0, '#1e40af')}
        <tr><td colspan="2" style="background:#fef2f2;padding:.5rem;font-weight:600;font-size:.85rem">▼ Tax Computation</td></tr>
        <tr><td style="padding-left:1.5rem;font-size:.78rem;color:var(--text-muted)">${calc.rateBreakdown}</td><td></td></tr>
        ${row('🔴 Income Tax Liability / 법인세', calc.taxLiability, false, true, false, '#dc2626')}
        <tr><td>Effective Tax Rate</td><td class="num">${calc.effectiveRate.toFixed(2)}%</td></tr>
      </tbody>
    </table>
    <div style="margin:1rem 0;text-align:center">
      <button class="btn btn-primary" onclick="postTaxProvisionJournal('${fromDate}','${toDate}',${calc.taxLiability})" ${calc.taxLiability<=0?'disabled':''}>
        💼 법인세 충당금 분개 생성 (${fmt(calc.taxLiability)})
      </button>
    </div>
    <p style="font-size:.78rem;color:var(--text-muted);text-align:center;line-height:1.6">
      분개: DR 5012 Income Tax Expense / CR 2005 Income Tax Payable
    </p>
  `;
}

function postTaxProvisionJournal(fromDate, toDate, taxLiability) {
  if (!taxLiability || taxLiability <= 0) return alert('세액이 0 이하입니다.');
  ensureTaxAccounts();
  const expAcc = DB.accounts.find(a=>a.code==='5012');
  const payAcc = DB.accounts.find(a=>a.code==='2005');
  if (!expAcc || !payAcc) return alert('계정 누락 — 5012/2005 확인');

  // Check duplicate
  const existing = DB.entries.find(e =>
    e.date === toDate && e.reference?.startsWith('TAX-') &&
    e.lines.some(l => l.accountId === expAcc.id)
  );
  if (existing && !confirm('해당 기간에 이미 법인세 충당금 분개가 있습니다. 추가로 생성하시겠습니까?')) return;

  const entry = {
    id: uid(), date: toDate,
    reference: `TAX-${toDate.slice(0,4)}`,
    description: `법인세 충당금 (${fromDate} ~ ${toDate})`,
    lines: [
      {accountId: expAcc.id, debit: taxLiability, credit: 0},
      {accountId: payAcc.id, debit: 0, credit: taxLiability},
    ],
    source: 'manual',
  };
  DB.entries.push(entry);
  // Save computation history
  if (!DB.taxComputations) DB.taxComputations = [];
  DB.taxComputations.push({
    id: uid(), fromDate, toDate, taxLiability,
    createdAt: today(), entryId: entry.id,
  });
  saveDB();
  alert(`✓ 법인세 충당금 분개 생성\nMYR ${fmtN(taxLiability)}`);
}

// ══════════════════════════════════════════════════════
//  3) Tax Calendar — 세무 일정
// ══════════════════════════════════════════════════════

function renderTaxCalendar() {
  ensureTaxAccounts();
  const today_ = new Date();
  const currentYear = today_.getFullYear();
  const fyStartMonth = Number((DB.settings.fiscalYearStart||'07-01').slice(0,2));
  // Compute basis period (e.g. 7/1/Y-1 ~ 6/30/Y)
  const fyEnd = new Date(currentYear, fyStartMonth-1, 0);
  const fyStart = new Date(currentYear-1, fyStartMonth-1, 1);
  const prevFyEnd = new Date(currentYear-1, fyStartMonth-1, 0);

  const events = [
    // SST (bimonthly)
    {date: `${currentYear}-03-31`, type:'SST', title:'SST Return — Jan/Feb taxable period', critical:true, agency:'Royal Malaysian Customs (RMCD)'},
    {date: `${currentYear}-05-31`, type:'SST', title:'SST Return — Mar/Apr taxable period', critical:true, agency:'RMCD'},
    {date: `${currentYear}-07-31`, type:'SST', title:'SST Return — May/Jun taxable period', critical:true, agency:'RMCD'},
    {date: `${currentYear}-09-30`, type:'SST', title:'SST Return — Jul/Aug taxable period', critical:true, agency:'RMCD'},
    {date: `${currentYear}-11-30`, type:'SST', title:'SST Return — Sep/Oct taxable period', critical:true, agency:'RMCD'},
    {date: `${currentYear+1}-01-31`, type:'SST', title:'SST Return — Nov/Dec taxable period', critical:true, agency:'RMCD'},
    // CP58
    {date: `${currentYear}-03-31`, type:'CP58', title:'CP58 — 수수료 지급 신고서 (전년도 지급분)', critical:true, agency:'LHDN'},
    // CP204 — 30 days before basis period
    {date: new Date(fyStart.getTime() - 30*86400000).toISOString().slice(0,10), type:'CP204', title:`CP204 — Estimated Tax Payable (YA${currentYear})`, critical:true, agency:'LHDN'},
    // CP204A — 6th month of basis period
    {date: new Date(fyStart.getFullYear(), fyStart.getMonth()+5, fyStart.getDate()).toISOString().slice(0,10), type:'CP204A', title:'CP204A — Revision of Estimated Tax', critical:false, agency:'LHDN'},
    // Form C — 7 months after FY end
    {date: new Date(prevFyEnd.getFullYear(), prevFyEnd.getMonth()+7, prevFyEnd.getDate()).toISOString().slice(0,10), type:'FORM_C', title:'Form C — Corporate Income Tax Return (YA' + prevFyEnd.getFullYear() + ')', critical:true, agency:'LHDN'},
    // Form E — Feb 28/29 (employer return)
    {date: `${currentYear}-02-28`, type:'FORM_E', title:'Form E — Employer Annual Return', critical:true, agency:'LHDN'},
    // Form EA — Feb 28 (employee statement)
    {date: `${currentYear}-02-28`, type:'FORM_EA', title:'Form EA — Employee Statement (직원에게 발급)', critical:true, agency:'LHDN'},
    // PCB — 15th of next month (if any employees)
    {date: today_.toISOString().slice(0,8) + '15', type:'PCB', title:'PCB Monthly — 직원 원천징수세 납부', critical:false, agency:'LHDN', recurring:true},
    // EPF / SOCSO / EIS — 15th
    {date: today_.toISOString().slice(0,8) + '15', type:'EPF', title:'EPF / SOCSO / EIS — 사회보장 납부', critical:false, agency:'KWSP/PERKESO', recurring:true},
  ];

  // Sort by date and compute days remaining
  const upcoming = events.map(e=>{
    const daysLeft = Math.ceil((new Date(e.date) - today_) / 86400000);
    return {...e, daysLeft};
  }).filter(e => e.daysLeft >= -7 && e.daysLeft <= 365)
    .sort((a,b)=>a.daysLeft - b.daysLeft);

  const urgent = upcoming.filter(e=>e.daysLeft >= 0 && e.daysLeft <= 30);
  const overdue = upcoming.filter(e=>e.daysLeft < 0);
  const later = upcoming.filter(e=>e.daysLeft > 30);

  const formatDays = (d) => d < 0 ? `${-d}일 지남` : d === 0 ? '오늘' : d === 1 ? '내일' : `${d}일 남음`;
  const colorFor = (d, critical) => {
    if (d < 0) return '#dc2626';
    if (d <= 7) return '#dc2626';
    if (d <= 30) return '#d97706';
    return critical ? '#1e40af' : '#475569';
  };
  const eventRow = (e) => `<tr style="border-left:4px solid ${colorFor(e.daysLeft, e.critical)}">
    <td style="padding:.5rem"><strong>${e.date}</strong></td>
    <td style="padding:.5rem;color:${colorFor(e.daysLeft, e.critical)};font-weight:600">${formatDays(e.daysLeft)}</td>
    <td style="padding:.5rem"><strong style="font-size:.8rem">${e.type}</strong></td>
    <td style="padding:.5rem;font-size:.85rem">${e.title}</td>
    <td style="padding:.5rem;font-size:.72rem;color:var(--text-muted)">${e.agency}</td>
  </tr>`;

  document.getElementById('tax-calendar-output').innerHTML = `
    <div class="report-title">
      <h2>${DB.settings.companyName}</h2>
      <p>📅 Tax Calendar / 세무 일정</p>
      <p style="font-size:.78rem;color:var(--text-muted)">기준일: ${today_.toISOString().slice(0,10)} · 회계연도: ${(fyStart.toISOString().slice(0,10))} ~ ${fyEnd.toISOString().slice(0,10)}</p>
    </div>
    <div class="cards-grid" style="grid-template-columns:repeat(3,1fr);gap:.5rem;margin:1rem 0">
      <div class="stat-card" style="border-left:4px solid #dc2626"><div class="label">🚨 기한 지남</div><div class="value" style="color:#dc2626">${overdue.length}건</div></div>
      <div class="stat-card" style="border-left:4px solid #d97706"><div class="label">⏰ 30일 이내</div><div class="value" style="color:#d97706">${urgent.length}건</div></div>
      <div class="stat-card" style="border-left:4px solid #475569"><div class="label">📅 향후</div><div class="value">${later.length}건</div></div>
    </div>
    ${overdue.length ? `
      <h3 style="margin:1rem 0 .5rem;color:#dc2626">🚨 기한 지남 — 즉시 조치 필요</h3>
      <table class="table">${overdue.map(eventRow).join('')}</table>
    ` : ''}
    ${urgent.length ? `
      <h3 style="margin:1rem 0 .5rem;color:#d97706">⏰ 30일 이내 마감</h3>
      <table class="table">${urgent.map(eventRow).join('')}</table>
    ` : ''}
    ${later.length ? `
      <h3 style="margin:1rem 0 .5rem;color:var(--text)">📅 향후 일정</h3>
      <table class="table">${later.map(eventRow).join('')}</table>
    ` : ''}
    <div style="margin-top:1rem;padding:.75rem;background:#f0fdf4;border-radius:6px;font-size:.78rem;line-height:1.7">
      <strong>📚 세무 양식 안내</strong>
      <ul style="margin-top:.4rem;padding-left:1.2rem">
        <li><strong>CP204</strong>: 사업연도 시작 30일 전 추정세 신고 (e-CP204 via MyTax)</li>
        <li><strong>CP204A</strong>: 사업연도 6번째 달 추정세 수정 (선택, 권장)</li>
        <li><strong>Form C</strong>: 회계연도 종료 7개월 이내 법인세 신고 (e-Filing)</li>
        <li><strong>Form E</strong>: 매년 2/28 직원 관련 연간 신고 (직원 있을 시)</li>
        <li><strong>Form EA</strong>: 매년 2/28까지 직원에게 발급</li>
        <li><strong>CP58</strong>: 매년 3/31까지 수수료 지급 신고 (전년도 분)</li>
        <li><strong>SST Return</strong>: 격월 (2-month taxable period 종료 후 1개월 이내)</li>
      </ul>
    </div>
  `;
}
