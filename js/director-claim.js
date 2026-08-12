'use strict';
// ══════════════════════════════════════════════════════
//  이사 비용정산 (Director Expense Claim)
//  ----------------------------------------------------
//  이사가 한 달 동안 쓴 여러 성격의 비용(주유·접대·숙박·다과…)을
//  회사가 한 번에 몰아서 지급하는 케이스를 처리한다.
//
//  감사법인 원장과 같은 흐름으로 2건의 분개를 만든다:
//    ① 지급   DR 1001 현금(정산계정)      / CR 은행
//    ② 정산   DR 각 세부 비용계정 …       / CR 1001 현금(정산계정)
//  정산계정은 두 분개로 상계되어 잔액이 0이 되므로, 감사법인의
//  11200 Petty Cash 계정 움직임과 1:1로 대응된다.
// ══════════════════════════════════════════════════════

const DC_CLEARING_CODE = '1001';   // 현금 ↔ 감사법인 11200 Petty Cash

function _dcClearingAccount() {
  return DB.accounts.find(a => a.code === DC_CLEARING_CODE);
}

// 지급 재원으로 쓸 수 있는 계정(은행·현금). 정산계정 자신은 제외.
function _dcFundingAccounts() {
  return DB.accounts.filter(a =>
    a.type === 'asset' && !a.contra && a.code !== DC_CLEARING_CODE &&
    (/^100[27]$/.test(a.code) || /bank|cash/i.test(a.nameEn || '') || /은행|현금/.test(a.nameKr || ''))
  );
}

let _dcSeq = 0;

function renderDirectorClaim() {
  const wrap = document.getElementById('dc-form');
  if (!wrap) return;

  const expOptions = DB.accounts
    .filter(a => a.type === 'expense')
    .sort((a, b) => a.code.localeCompare(b.code))
    .map(a => `<option value="${a.id}">${a.code} ${a.nameKr}${a.auditCode ? ` (감사 ${a.auditCode})` : ''}</option>`)
    .join('');

  const fundOptions = _dcFundingAccounts()
    .map(a => `<option value="${a.id}">${a.code} ${a.nameEn || a.nameKr}</option>`).join('');

  const clearing = _dcClearingAccount();

  wrap.innerHTML = `
    <div class="card">
      <div style="display:grid;grid-template-columns:repeat(3,1fr);gap:1rem">
        <div class="form-group">
          <label>정산 일자 *</label>
          <input type="date" id="dc-date" class="input" value="${today()}">
        </div>
        <div class="form-group">
          <label>지급 재원 (어디서 나갔나) *</label>
          <select id="dc-funding" class="input">${fundOptions}</select>
        </div>
        <div class="form-group">
          <label>실제 지급총액 (MYR) *</label>
          <input type="number" id="dc-total" class="input" step="0.01" placeholder="예: 11604.88"
                 oninput="updateDCTotals()" style="text-align:right;font-weight:600">
        </div>
      </div>
      <div class="form-group">
        <label>적요 (Description)</label>
        <input type="text" id="dc-memo" class="input" placeholder="예: Director's expenses — 2026년 6월분">
      </div>

      <h4 style="margin:1rem 0 .5rem">세부 내역 — 무슨 비용이었는지 나눠 적기</h4>
      <div style="overflow-x:auto">
        <table class="table" style="font-size:.82rem">
          <thead><tr>
            <th style="width:44%">비용 계정</th>
            <th style="width:32%">내용</th>
            <th class="num" style="width:18%">금액 MYR</th>
            <th style="width:6%"></th>
          </tr></thead>
          <tbody id="dc-lines"></tbody>
        </table>
      </div>
      <button class="btn btn-outline btn-sm" onclick="addDCLine()" style="margin-top:.5rem">+ 항목 추가</button>

      <div id="dc-summary" style="margin-top:1rem;padding:.75rem;border-radius:6px;background:#f8fafc"></div>

      <div style="margin-top:1rem;display:flex;gap:.5rem;justify-content:flex-end">
        <button class="btn btn-outline" onclick="renderDirectorClaim()">초기화</button>
        <button class="btn btn-primary" onclick="saveDirectorClaim()">✓ 정산 등록</button>
      </div>
      <p style="font-size:.72rem;color:var(--text-muted);margin-top:.6rem">
        등록하면 분개 2건이 생성됩니다 —
        ① <strong>DR ${clearing ? clearing.code + ' ' + clearing.nameKr : '정산계정'} / CR 지급재원</strong> (지급),
        ② <strong>DR 각 세부 비용 / CR ${clearing ? clearing.code + ' ' + clearing.nameKr : '정산계정'}</strong> (정산).
        감사법인 원장의 Petty Cash 처리와 동일한 형태입니다.
      </p>
    </div>`;

  _dcSeq = 0;
  window._dcExpOptions = expOptions;
  addDCLine();
  addDCLine();
  updateDCTotals();
  renderDCHistory();
}

function addDCLine() {
  const tbody = document.getElementById('dc-lines');
  if (!tbody) return;
  const i = _dcSeq++;
  const tr = document.createElement('tr');
  tr.id = `dc-line-${i}`;
  tr.innerHTML = `
    <td><select class="input dc-acc" style="font-size:.8rem;padding:.25rem;width:100%">
      <option value="">-- 비용 계정 선택 --</option>${window._dcExpOptions || ''}
    </select></td>
    <td><input type="text" class="input dc-desc" placeholder="예: 6월 주유비" style="font-size:.8rem;padding:.25rem;width:100%"></td>
    <td><input type="number" class="input dc-amt" step="0.01" oninput="updateDCTotals()"
               style="font-size:.8rem;padding:.25rem;width:100%;text-align:right"></td>
    <td><button class="btn btn-sm btn-danger" onclick="removeDCLine('dc-line-${i}')">✕</button></td>`;
  tbody.appendChild(tr);
}

function removeDCLine(rowId) {
  document.getElementById(rowId)?.remove();
  updateDCTotals();
}

function updateDCTotals() {
  const el = document.getElementById('dc-summary');
  if (!el) return;
  const paid = Number(document.getElementById('dc-total')?.value || 0);
  const lines = [...document.querySelectorAll('#dc-lines tr')].map(tr =>
    Number(tr.querySelector('.dc-amt')?.value || 0));
  const sum = lines.reduce((s, n) => s + n, 0);
  const diff = +(paid - sum).toFixed(2);
  const ok = Math.abs(diff) < 0.005 && paid > 0;

  el.innerHTML = `
    <div style="display:flex;gap:2rem;flex-wrap:wrap;align-items:center">
      <div>실제 지급총액 <strong style="font-size:1.05rem">${fmtN(paid)}</strong></div>
      <div>세부 합계 <strong style="font-size:1.05rem">${fmtN(sum)}</strong></div>
      <div style="font-weight:700;color:${ok ? '#166534' : '#dc2626'}">
        ${ok ? '✓ 일치' : `차이 ${fmtN(diff)} — 세부 내역을 ${diff > 0 ? '더 채워주세요' : '줄여주세요'}`}
      </div>
    </div>`;
}

function saveDirectorClaim() {
  const date = document.getElementById('dc-date').value;
  const fundingId = document.getElementById('dc-funding').value;
  const paid = Number(document.getElementById('dc-total').value || 0);
  const memo = document.getElementById('dc-memo').value.trim() || "Director's expenses";
  const clearing = _dcClearingAccount();

  if (!date) return alert('정산 일자를 입력하세요.');
  if (!fundingId) return alert('지급 재원 계정을 선택하세요.');
  if (!paid) return alert('실제 지급총액을 입력하세요.');
  if (!clearing) return alert(`정산계정(${DC_CLEARING_CODE})을 찾을 수 없습니다.`);

  const lines = [];
  for (const tr of document.querySelectorAll('#dc-lines tr')) {
    const accId = tr.querySelector('.dc-acc')?.value;
    const amt = Number(tr.querySelector('.dc-amt')?.value || 0);
    const desc = tr.querySelector('.dc-desc')?.value.trim() || '';
    if (!accId && !amt) continue;                       // 빈 줄은 건너뜀
    if (!accId) return alert('비용 계정을 선택하지 않은 줄이 있습니다.');
    if (!amt)   return alert('금액이 비어있는 줄이 있습니다.');
    lines.push({accountId: accId, amount: amt, desc});
  }
  if (!lines.length) return alert('세부 내역을 최소 한 줄 입력하세요.');

  const sum = lines.reduce((s, l) => s + l.amount, 0);
  if (Math.abs(sum - paid) >= 0.005) {
    return alert(`세부 합계(${fmtN(sum)})가 지급총액(${fmtN(paid)})과 맞지 않습니다.\n차이: ${fmtN(paid - sum)}`);
  }

  const ym = date.slice(0, 7).replace('-', '');
  const seq = String(DB.entries.filter(e => (e.reference || '').startsWith('DC' + ym)).length + 1).padStart(3, '0');
  const ref = `DC${ym}${seq}`;

  // ① 지급 — 재원에서 정산계정으로
  DB.entries.push({
    id: uid(), date, reference: ref,
    description: `${memo} (지급)`,
    lines: [
      {accountId: clearing.id, debit: paid, credit: 0},
      {accountId: fundingId,   debit: 0,    credit: paid},
    ],
    source: 'director-claim',
  });

  // ② 정산 — 정산계정을 세부 비용으로 분해
  DB.entries.push({
    id: uid(), date, reference: `${ref}-D`,
    description: `${memo} (세부정산)`,
    lines: [
      ...lines.map(l => ({accountId: l.accountId, debit: l.amount, credit: 0, memo: l.desc})),
      {accountId: clearing.id, debit: 0, credit: paid},
    ],
    source: 'director-claim',
  });

  saveDB();
  populateAccountDropdowns();
  populateLedgerSelect();
  alert(`✓ 정산 등록 완료 (${ref})\n지급 ${fmtN(paid)} → 세부 ${lines.length}건으로 분해되었습니다.`);
  renderDirectorClaim();
}

// ── 최근 정산 내역 ────────────────────────────────────
function renderDCHistory() {
  const el = document.getElementById('dc-history');
  if (!el) return;
  const clearing = _dcClearingAccount();
  const claims = DB.entries
    .filter(e => e.source === 'director-claim' && /-D$/.test(e.reference || ''))
    .sort((a, b) => b.date.localeCompare(a.date))
    .slice(0, 20);

  if (!claims.length) {
    el.innerHTML = `<div class="card" style="text-align:center;color:var(--text-muted);padding:1.5rem">
      아직 등록된 이사 정산 내역이 없습니다.</div>`;
    return;
  }

  el.innerHTML = `
    <table class="table" style="font-size:.82rem">
      <thead><tr><th>일자</th><th>전표번호</th><th>적요</th><th>세부 내역</th><th class="num">합계 MYR</th></tr></thead>
      <tbody>
        ${claims.map(e => {
          const detail = e.lines.filter(l => l.accountId !== clearing?.id);
          const total = detail.reduce((s, l) => s + Number(l.debit || 0), 0);
          return `<tr>
            <td>${e.date}</td>
            <td style="font-family:monospace;font-size:.75rem">${e.reference || ''}</td>
            <td>${escapeHtml(e.description || '')}</td>
            <td style="font-size:.75rem;line-height:1.6">
              ${detail.map(l => {
                const a = DB.accounts.find(x => x.id === l.accountId);
                return `<span style="display:inline-block;background:#eef2ff;color:#3730a3;border-radius:3px;padding:.05rem .35rem;margin:.1rem .2rem .1rem 0">
                  ${a ? a.nameKr : '?'} ${fmtN(l.debit)}</span>`;
              }).join('')}
            </td>
            <td class="num"><strong>${fmtN(total)}</strong></td>
          </tr>`;
        }).join('')}
      </tbody>
    </table>`;
}
