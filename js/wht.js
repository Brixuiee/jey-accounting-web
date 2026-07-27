'use strict';
// ══════════════════════════════════════════════════════
//  Withholding Tax (WHT) — 원천징수세 모듈
//  ----------------------------------------------------
//  말레이시아 WHT (비거주자 지급 시):
//   • Royalty (사용료):     10% (조세조약 우선)
//   • Special class (기술 서비스): 10%
//   • Interest (이자):       15%
//   • Contract payment (도급): 10% + 3% = 13%
//   • Rental of movable property: 10%
//   • Other (Section 4(f)): 10%
//
//  납부: 지급일로부터 30일 이내 CP37 양식으로 LHDN 납부
//  미납부 시: 미지급 비용 손금불산입 + 가산세 10%
// ══════════════════════════════════════════════════════

const WHT_TYPES = [
  {code:'ROY',  label:'Royalty (사용료)',                rate:10, accountCode:'2015', section:'109'},
  {code:'SVC',  label:'Special Class / Technical Service (기술서비스)', rate:10, accountCode:'2015', section:'109B'},
  {code:'INT',  label:'Interest (이자)',                  rate:15, accountCode:'2015', section:'109'},
  {code:'CTR',  label:'Contract Payment 13% (도급, 10%+3%)', rate:13, accountCode:'2015', section:'107A'},
  {code:'RENT', label:'Rental of Movable Property (동산임대)', rate:10, accountCode:'2015', section:'109(1)(g)'},
  {code:'OTHR', label:'Other Section 4(f) (기타)',         rate:10, accountCode:'2015', section:'109F'},
  {code:'NONE', label:'WHT 적용 안 함 (Domestic / Treaty 면제)', rate:0, accountCode:null, section:''},
];

function ensureWHTAccounts() {
  if (!DB.accounts.find(a=>a.code==='2015')) {
    DB.accounts.push({id:'a2015', code:'2015', nameKr:'원천징수세 미지급금', nameEn:'Withholding Tax Payable', type:'liability'});
    saveDB();
  }
}

function getWHTType(code) {
  return WHT_TYPES.find(t=>t.code===code) || WHT_TYPES.find(t=>t.code==='NONE');
}

// Compute WHT on a gross payment
function computeWHT(grossAmount, whtCode) {
  const type = getWHTType(whtCode);
  const whtAmount = Math.round(grossAmount * type.rate) / 100;
  return {
    type, grossAmount,
    whtAmount: grossAmount * type.rate / 100,
    netAmount: grossAmount - (grossAmount * type.rate / 100),
    rate: type.rate,
  };
}

// ── WHT Report (CP37) ────────────────────────────────
function renderWHTReport() {
  ensureWHTAccounts();
  const fromEl = document.getElementById('wht-from');
  const toEl = document.getElementById('wht-to');
  if (fromEl && !fromEl.value) {
    fromEl.value = nowMonth() + '-01';
    toEl.value = today();
  }
  const fromDate = fromEl.value;
  const toDate = toEl.value;
  if (!fromDate || !toDate) return;

  // Find all payments in period that have WHT applied
  // Look in DB.payments for payments tagged with whtCode
  const whtPayments = DB.payments.filter(p =>
    p.date >= fromDate && p.date <= toDate && p.whtCode && p.whtCode !== 'NONE' && p.whtAmount > 0
  );

  // Group by WHT type
  const byType = {};
  whtPayments.forEach(p => {
    const t = p.whtCode;
    if (!byType[t]) byType[t] = {type: getWHTType(t), payments: [], total: 0};
    byType[t].payments.push(p);
    byType[t].total += Number(p.whtAmount||0);
  });

  const totalWHT = whtPayments.reduce((s,p)=>s+Number(p.whtAmount||0), 0);
  const totalGross = whtPayments.reduce((s,p)=>s+Number(p.whtGross||p.totalAmount||0), 0);

  // Outstanding WHT (in 2015 account) — what's still owed to LHDN
  const whtAcc = DB.accounts.find(a=>a.code==='2015');
  const whtPayable = whtAcc ? accountBalance(whtAcc.id, toDate) : 0;

  document.getElementById('wht-output').innerHTML = `
    <div class="report-title">
      <h2>${DB.settings.companyName}</h2>
      <p>Withholding Tax Report — CP37 / 원천징수세 신고</p>
      <p>${fromDate} ~ ${toDate}</p>
      <p style="font-size:.75rem;color:var(--text-muted)">납부 기한: 지급일로부터 <strong>30일 이내</strong> LHDN ByrHasil 또는 e-CP37</p>
    </div>

    <div class="cards-grid" style="grid-template-columns:repeat(4,1fr);gap:.5rem;margin:1rem 0">
      <div class="stat-card"><div class="label">WHT 적용 지급 건수</div><div class="value">${whtPayments.length}건</div></div>
      <div class="stat-card"><div class="label">총 지급액 (Gross)</div><div class="value">MYR ${fmtN(totalGross)}</div></div>
      <div class="stat-card"><div class="label">원천징수세 합계</div><div class="value" style="color:#dc2626">MYR ${fmtN(totalWHT)}</div></div>
      <div class="stat-card"><div class="label">2015 WHT 미지급 잔액</div><div class="value" style="color:#dc2626">MYR ${fmtN(whtPayable)}</div></div>
    </div>

    ${Object.values(byType).map(g => `
      <h3 style="margin-top:1rem;font-size:.95rem">${g.type.label} <span style="color:var(--text-muted);font-size:.78rem">— Section ${g.type.section}, Rate ${g.type.rate}%</span></h3>
      <table class="table" style="font-size:.78rem">
        <thead style="background:#f1f5f9"><tr>
          <th>지급일</th><th>참조 No</th><th>공급업체</th><th>IC/Reg No</th><th>국가</th>
          <th class="num">Gross (MYR)</th><th class="num">WHT ${g.type.rate}% (MYR)</th><th class="num">Net (MYR)</th>
        </tr></thead>
        <tbody>
          ${g.payments.map(p => {
            const sup = getSupplier(p.supplierId);
            return `<tr>
              <td>${p.date}</td>
              <td><strong>${p.number}</strong></td>
              <td>${sup?.name||'—'}</td>
              <td style="font-size:.72rem;font-family:monospace">${sup?.regNo||'<span style="color:#dc2626">⚠</span>'}</td>
              <td>${sup?.country||'—'}</td>
              <td class="num">${fmtN(p.whtGross||p.totalAmount)}</td>
              <td class="num" style="color:#dc2626"><strong>${fmtN(p.whtAmount)}</strong></td>
              <td class="num">${fmtN(p.totalAmount)}</td>
            </tr>`;
          }).join('')}
          <tr style="background:#f8fafc;font-weight:700;border-top:2px solid var(--text)">
            <td colspan="5">${g.type.label} 소계</td>
            <td class="num">${fmtN(g.payments.reduce((s,p)=>s+Number(p.whtGross||p.totalAmount||0),0))}</td>
            <td class="num" style="color:#dc2626">${fmtN(g.total)}</td>
            <td class="num"></td>
          </tr>
        </tbody>
      </table>
    `).join('') || '<p class="empty-msg">해당 기간 WHT 적용 지급 내역 없음.</p>'}

    ${whtPayable > 0 ? `
      <div style="margin-top:1.5rem;padding:1rem;background:#fef2f2;border:1px solid #fecaca;border-radius:6px">
        <h3 style="color:#dc2626;font-size:.95rem;margin-bottom:.5rem">⚠️ 미납부 WHT: MYR ${fmtN(whtPayable)}</h3>
        <p style="font-size:.82rem;line-height:1.6">
          이 금액은 아직 LHDN에 납부되지 않았습니다. 각 지급일로부터 30일 이내 납부 필수.
          납부 시 다음 분개를 생성하세요:
        </p>
        <pre style="background:#1e293b;color:#e2e8f0;padding:.75rem;border-radius:4px;font-size:.78rem;margin-top:.5rem">
DR  2015 Withholding Tax Payable    XXX
CR  1002 Bank - Maybank                    XXX</pre>
        <button class="btn btn-primary" onclick="postWHTPaymentJournal('${toDate}',${whtPayable})" style="margin-top:.5rem">💼 WHT 납부 분개 생성 (전액)</button>
      </div>
    ` : ''}

    <div class="card" style="margin-top:1rem;background:#f0fdf4">
      <h3 style="font-size:.95rem;margin-bottom:.5rem">📋 WHT 적용 가이드 (말레이시아)</h3>
      <table class="table" style="font-size:.78rem">
        <thead><tr><th>유형</th><th>세율</th><th>Section</th><th>대상</th></tr></thead>
        <tbody>
          ${WHT_TYPES.filter(t=>t.code!=='NONE').map(t=>`<tr>
            <td>${t.label}</td>
            <td class="num"><strong>${t.rate}%</strong></td>
            <td style="font-family:monospace">${t.section}</td>
            <td style="font-size:.72rem;color:var(--text-muted)">${
              t.code==='ROY' ? '저작권/상표권/특허/노하우 사용료' :
              t.code==='SVC' ? '경영/기술/관리 서비스 (말레이시아 외 수행)' :
              t.code==='INT' ? '비거주자에게 지급하는 이자' :
              t.code==='CTR' ? '비거주 도급업자 (도급액 기준)' :
              t.code==='RENT' ? '비거주자에게 지급하는 동산 임차료' :
              '기타 비거주자 수입 (Section 4(f))'
            }</td>
          </tr>`).join('')}
        </tbody>
      </table>
      <p style="font-size:.78rem;color:var(--text-muted);margin-top:.5rem;line-height:1.6">
        💡 <strong>조세조약 (DTA) 우선 적용:</strong> 한국·싱가포르 등 협정국가는 더 낮은 세율 적용 가능.
        예: 한국과의 DTA에서 Royalty 10%, Interest 10% 등. 적용 시 supplier 정보에 "Treaty Country" 표시 권장.
      </p>
    </div>
  `;
}

function postWHTPaymentJournal(date, amount) {
  if (!confirm(`WHT 납부 분개를 생성합니다.\n금액: MYR ${fmtN(amount)}\n날짜: ${date}\n계속?`)) return;
  ensureWHTAccounts();
  const whtAcc = DB.accounts.find(a=>a.code==='2015');
  const bankAcc = DB.accounts.find(a=>a.id===DB.settings.defaultBankAccount) || DB.accounts.find(a=>a.code==='1002');
  DB.entries.push({
    id: uid(), date,
    reference: `WHT-PAY-${date.slice(0,7).replace('-','')}`,
    description: `WHT 납부 (LHDN CP37)`,
    lines: [
      {accountId: whtAcc.id, debit: amount, credit: 0},
      {accountId: bankAcc.id, debit: 0, credit: amount},
    ],
    source: 'manual',
  });
  saveDB();
  alert(`✓ WHT 납부 분개 생성됨\nMYR ${fmtN(amount)}`);
  renderWHTReport();
}

// ── Hook into Supplier Payment UI ───────────────────
// Add WHT selector to payment modal (called from app.js openPaymentModal hook)
function injectWHTSelectorIntoPaymentModal() {
  const modalBody = document.querySelector('#modal-payment .modal-body');
  if (!modalBody || document.getElementById('pay-wht-code')) return;

  // Find the notes form-group and insert WHT section before it
  const notesGroup = modalBody.querySelector('.form-group:last-child');
  const whtDiv = document.createElement('div');
  whtDiv.style.cssText = 'background:#fef3c7;padding:.6rem;border-radius:4px;margin-top:.5rem';
  whtDiv.innerHTML = `
    <div style="display:flex;align-items:center;gap:.5rem;margin-bottom:.4rem">
      <strong style="font-size:.85rem">🏛️ Withholding Tax (WHT) — 비거주자 지급 시</strong>
    </div>
    <div class="form-row">
      <div class="form-group">
        <label style="font-size:.78rem">WHT 유형</label>
        <select id="pay-wht-code" class="input" style="font-size:.78rem" onchange="updateWHTOnPayment()">
          ${WHT_TYPES.map(t=>`<option value="${t.code}">${t.label}${t.rate>0?' ('+t.rate+'%)':''}</option>`).join('')}
        </select>
      </div>
      <div class="form-group">
        <label style="font-size:.78rem">총 지급액 Gross (MYR)</label>
        <input type="number" id="pay-wht-gross" class="input" step="0.01" min="0" style="font-size:.78rem" oninput="updateWHTOnPayment()">
      </div>
    </div>
    <div id="pay-wht-display" style="font-size:.78rem;color:#92400e;line-height:1.5"></div>
  `;
  notesGroup.parentNode.insertBefore(whtDiv, notesGroup);
}

function updateWHTOnPayment() {
  const code = document.getElementById('pay-wht-code')?.value || 'NONE';
  const gross = Number(document.getElementById('pay-wht-gross')?.value || 0);
  const display = document.getElementById('pay-wht-display');
  if (!display) return;
  if (code === 'NONE' || gross <= 0) {
    display.innerHTML = '<em>WHT 없음 — 일반 지급으로 처리됩니다.</em>';
    return;
  }
  const w = computeWHT(gross, code);
  display.innerHTML = `
    원천징수 ${w.rate}% = <strong>MYR ${fmtN(w.whtAmount)}</strong> → 2015 WHT Payable<br>
    실제 송금액 (Net): <strong>MYR ${fmtN(w.netAmount)}</strong>
  `;
}

// Wrap savePayment to apply WHT
const _origSavePayment = typeof savePayment === 'function' ? savePayment : null;
window.savePayment = function() {
  // Get WHT info before normal save
  const whtCode = document.getElementById('pay-wht-code')?.value || 'NONE';
  const whtGross = Number(document.getElementById('pay-wht-gross')?.value || 0);
  if (whtCode !== 'NONE' && whtGross > 0) {
    // Override the on-account or total to reflect that this is the NET amount
    const w = computeWHT(whtGross, whtCode);
    // Save state on the payment after _origSavePayment runs
    window._pendingWHT = {whtCode, whtGross, whtAmount: w.whtAmount};
  }
  if (_origSavePayment) _origSavePayment();
};

// Hook into postPaymentJournal to add WHT line
const _origPostPaymentJournal = typeof postPaymentJournal === 'function' ? postPaymentJournal : null;
window.postPaymentJournal = function(pay) {
  if (window._pendingWHT && window._pendingWHT.whtAmount > 0) {
    ensureWHTAccounts();
    // Tag the payment
    pay.whtCode = window._pendingWHT.whtCode;
    pay.whtGross = window._pendingWHT.whtGross;
    pay.whtAmount = window._pendingWHT.whtAmount;
    window._pendingWHT = null;
  }
  // Call original
  if (_origPostPaymentJournal) _origPostPaymentJournal(pay);
  // If WHT applies, modify the just-posted journal entry to add WHT line
  if (pay.whtAmount > 0) {
    const whtAcc = DB.accounts.find(a=>a.code==='2015');
    const apAcc = DB.accounts.find(a=>a.id===DB.settings.defaultApAccount) || DB.accounts.find(a=>a.code==='2001');
    // Find the entry just posted
    const entry = DB.entries.find(e => e.source==='payment' && e.sourceId===pay.id);
    if (entry && whtAcc && apAcc) {
      // Original: DR AP / CR Bank (for net)
      // We need: DR AP (gross) / CR Bank (net) / CR WHT Payable (wht)
      // So increase AP debit to gross, and add WHT credit
      const apLine = entry.lines.find(l => l.accountId === apAcc.id);
      if (apLine && apLine.debit > 0) {
        apLine.debit = pay.whtGross;
        entry.lines.push({accountId: whtAcc.id, debit: 0, credit: pay.whtAmount});
        entry.description += ` (WHT ${pay.whtCode}: ${fmtN(pay.whtAmount)} withheld)`;
        saveDB();
      }
    }
  }
};
