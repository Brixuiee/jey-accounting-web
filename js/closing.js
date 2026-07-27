'use strict';
// ══════════════════════════════════════════════════════
//  Year-End Closing — 연말 결산 자동화
//  ----------------------------------------------------
//  1) 마감 전 점검 체크리스트
//  2) 마감 전 시산표 / P&L 표시
//  3) 마감 분개 자동 생성 (Revenue/Expense → Retained Earnings)
//  4) 마감 후 검증 (모든 P/L 계정 잔액 = 0)
// ══════════════════════════════════════════════════════

function renderYearEndClosing() {
  // Default to FY end if not set
  const fyEndEl = document.getElementById('ye-fy-end');
  if (fyEndEl && !fyEndEl.value) {
    const y = new Date().getFullYear();
    fyEndEl.value = `${y}-06-30`;
  }
  const fyEnd = fyEndEl?.value || today();
  const yearStart = fyEnd.slice(0,4) === today().slice(0,4)
    ? `${Number(fyEnd.slice(0,4))-1}-07-01`
    : `${fyEnd.slice(0,4)}-07-01`;
  // Actually use fiscal year start = 7/1 of previous year if FY end is 6/30
  let fyStart;
  if (fyEnd.endsWith('-06-30')) {
    fyStart = `${Number(fyEnd.slice(0,4))-1}-07-01`;
  } else if (fyEnd.endsWith('-12-31')) {
    fyStart = `${fyEnd.slice(0,4)}-01-01`;
  } else {
    fyStart = `${Number(fyEnd.slice(0,4))-1}-07-01`;
  }

  // Pre-closing checklist
  const cklist = computeClosingChecklist(fyStart, fyEnd);

  // Compute net income for the year
  const ni = computeNetIncome(fyStart, fyEnd);

  // Render
  document.getElementById('closing-output').innerHTML = `
    <div class="report-title">
      <h2>${DB.settings.companyName}</h2>
      <p>Year-End Closing / 연말결산</p>
      <p>Fiscal Year: ${fyStart} ~ ${fyEnd}</p>
    </div>

    <h3 style="margin-top:1.5rem;margin-bottom:.75rem">📋 마감 전 점검 체크리스트</h3>
    <div class="card">
      ${cklist.map(c=>`
        <div style="display:flex;align-items:center;gap:.75rem;padding:.5rem 0;border-bottom:1px solid var(--border)">
          <span style="font-size:1.2rem">${c.status==='ok'?'✅':c.status==='warn'?'⚠️':'❌'}</span>
          <div style="flex:1">
            <strong>${c.title}</strong>
            <div style="font-size:.78rem;color:var(--text-muted)">${c.message}</div>
          </div>
        </div>
      `).join('')}
    </div>

    <h3 style="margin-top:1.5rem;margin-bottom:.75rem">📊 마감 전 손익</h3>
    <div class="cards-grid" style="grid-template-columns:repeat(3,1fr);gap:.5rem;margin-bottom:1rem">
      <div class="stat-card"><div class="label">총 수익 (Revenue)</div><div class="value positive">MYR ${fmtN(ni.revenue)}</div></div>
      <div class="stat-card"><div class="label">총 비용 (Expenses)</div><div class="value negative">MYR ${fmtN(ni.expenses)}</div></div>
      <div class="stat-card"><div class="label">${ni.netIncome>=0?'당기순이익':'당기순손실'} (Net ${ni.netIncome>=0?'Income':'Loss'})</div><div class="value ${ni.netIncome>=0?'positive':'negative'}">MYR ${fmtN(Math.abs(ni.netIncome))}</div></div>
    </div>

    <h3 style="margin-top:1.5rem;margin-bottom:.75rem">📝 자동 생성될 마감 분개</h3>
    <div class="card">
      <table class="table" style="font-size:.82rem">
        <thead><tr><th>분개</th><th>설명</th><th>계정</th><th class="num">차변 (DR)</th><th class="num">대변 (CR)</th></tr></thead>
        <tbody>
          ${ni.revenueAccounts.map((a,i)=>`<tr>
            <td>${i===0?'<strong>① 수익 마감</strong>':''}</td>
            <td>${a.code} ${a.name}</td>
            <td></td>
            <td class="num">${fmtN(a.balance)}</td>
            <td class="num"></td>
          </tr>`).join('')}
          <tr style="background:#f1f5f9"><td></td><td colspan="2"><em>→ 이익잉여금으로 대체</em></td>
            <td class="num"></td><td class="num">${fmtN(ni.revenue)}</td></tr>

          ${ni.expenseAccounts.map((a,i)=>`<tr>
            <td>${i===0?'<strong>② 비용 마감</strong>':''}</td>
            <td>${a.code} ${a.name}</td>
            <td></td>
            <td class="num"></td>
            <td class="num">${fmtN(a.balance)}</td>
          </tr>`).join('')}
          <tr style="background:#f1f5f9"><td></td><td colspan="2"><em>← 이익잉여금에서 차감</em></td>
            <td class="num">${fmtN(ni.expenses)}</td><td class="num"></td></tr>
        </tbody>
      </table>
      <div style="margin-top:.75rem;padding:.5rem;background:#fef3c7;border-radius:4px;font-size:.82rem">
        💡 <strong>결과:</strong> 3002 이익잉여금 (Retained Earnings) ${ni.netIncome>=0?'<span style="color:#0ea572;font-weight:700">+'+fmtN(ni.netIncome)+'</span>':'<span style="color:#dc2626;font-weight:700">'+fmtN(ni.netIncome)+'</span>'} 변동
        <br>모든 수익(4xxx)/비용(5xxx) 계정 잔액은 마감 후 <strong>0</strong>이 됩니다.
      </div>
    </div>

    <div style="margin:1.5rem 0;text-align:center;display:flex;gap:.75rem;justify-content:center">
      <button class="btn btn-outline" onclick="if(confirm('마감 분개를 미리보기만 합니다 (실제 저장 안 됨).')){alert('Preview shown above.');}">미리보기 (위 표 참조)</button>
      <button class="btn btn-danger" onclick="executeYearEndClose('${fyStart}','${fyEnd}')">⚠ 마감 실행 (Execute Close)</button>
    </div>
    <p style="font-size:.75rem;color:var(--text-muted);text-align:center;line-height:1.6">
      <strong>주의:</strong> 마감 실행 후에는 해당 회계연도의 P&L 계정 잔액이 모두 0이 됩니다.<br>
      Audit 조정사항이 있을 수 있으니, audit 완료 후 또는 결산 직전에만 실행하세요. 백업 권장.
    </p>
  `;
}

function computeClosingChecklist(fyStart, fyEnd) {
  const checks = [];

  // 1. Trial balance check
  let totalDr = 0, totalCr = 0;
  for (const e of DB.entries) {
    if (e.date > fyEnd) continue;
    for (const l of e.lines) { totalDr += Number(l.debit||0); totalCr += Number(l.credit||0); }
  }
  checks.push({
    title: 'Trial Balance 균형 (시산표 차변 = 대변)',
    status: Math.abs(totalDr-totalCr) < 0.01 ? 'ok' : 'error',
    message: `DR ${fmtN(totalDr)} vs CR ${fmtN(totalCr)} (차이: ${fmtN(Math.abs(totalDr-totalCr))})`,
  });

  // 2. Depreciation entries for each month of FY
  const fyYears = (new Date(fyEnd) - new Date(fyStart)) / 86400000 / 30; // approx months
  const depEntries = DB.entries.filter(e => e.date >= fyStart && e.date <= fyEnd && (e.description||'').includes('감가상각'));
  checks.push({
    title: '감가상각 분개 누락 점검 (월별)',
    status: DB.assets.length === 0 ? 'ok' : (depEntries.length >= Math.floor(fyYears) ? 'ok' : 'warn'),
    message: DB.assets.length === 0 ? '등록 자산 없음' : `${depEntries.length}건 / 예상 12건 — Fixed Assets → Post Depreciation 메뉴에서 누락 월 처리`,
  });

  // 3. AR Aging — overdue
  const overdueAr = DB.invoices.filter(i => {
    const bal = Number(i.total||0) - Number(i.paid||0);
    return bal > 0 && i.dueDate && i.dueDate < fyEnd;
  });
  checks.push({
    title: 'AR Aging — 만기 초과 미수금',
    status: overdueAr.length === 0 ? 'ok' : 'warn',
    message: `만기 초과 ${overdueAr.length}건 — AR Aging 메뉴 확인, 대손충당금 검토`,
  });

  // 4. AP Aging
  const overdueAp = DB.bills.filter(b => {
    const bal = Number(b.total||0) - Number(b.paid||0);
    return bal > 0 && b.dueDate && b.dueDate < fyEnd;
  });
  checks.push({
    title: 'AP Aging — 만기 초과 미지급금',
    status: overdueAp.length === 0 ? 'ok' : 'warn',
    message: `만기 초과 ${overdueAp.length}건 — AP Aging 메뉴 확인`,
  });

  // 5. Tax provision
  const taxProvAcc = DB.accounts.find(a=>a.code==='5012');
  const taxAccrued = taxProvAcc ? accountBalanceRange(taxProvAcc.id, fyStart, fyEnd).dr : 0;
  checks.push({
    title: '법인세 충당금 계상',
    status: taxAccrued > 0 ? 'ok' : 'warn',
    message: taxAccrued > 0 ? `법인세비용 MYR ${fmtN(taxAccrued)} 계상됨` : 'Tax → Income Tax 메뉴에서 산출 + 충당금 분개 권장',
  });

  // 6. Bank reconciliation
  checks.push({
    title: '은행 잔액 대조',
    status: 'warn',
    message: '은행 명세서 import 후 Balance Sheet 잔액과 일치 확인 권장',
  });

  return checks;
}

function computeNetIncome(fyStart, fyEnd) {
  const revAccs = DB.accounts.filter(a=>a.type==='revenue');
  const expAccs = DB.accounts.filter(a=>a.type==='expense');

  const revenueAccounts = revAccs.map(a=>{
    const {dr,cr} = accountBalanceRange(a.id, fyStart, fyEnd);
    return {id:a.id, code:a.code, name:a.nameEn||a.nameKr, balance: cr-dr};
  }).filter(a=>Math.abs(a.balance) > 0.001);

  const expenseAccounts = expAccs.map(a=>{
    const {dr,cr} = accountBalanceRange(a.id, fyStart, fyEnd);
    return {id:a.id, code:a.code, name:a.nameEn||a.nameKr, balance: dr-cr};
  }).filter(a=>Math.abs(a.balance) > 0.001);

  const revenue = revenueAccounts.reduce((s,a)=>s+a.balance, 0);
  const expenses = expenseAccounts.reduce((s,a)=>s+a.balance, 0);
  const netIncome = revenue - expenses;

  return {revenue, expenses, netIncome, revenueAccounts, expenseAccounts};
}

function executeYearEndClose(fyStart, fyEnd) {
  const ni = computeNetIncome(fyStart, fyEnd);
  if (ni.revenueAccounts.length === 0 && ni.expenseAccounts.length === 0) {
    return alert('마감할 수익/비용 잔액이 없습니다.');
  }

  // Check duplicate
  const existing = DB.entries.find(e => e.date === fyEnd && e.reference?.startsWith('CLOSE-'));
  if (existing && !confirm('이미 마감 분개가 있습니다. 추가로 생성하시겠습니까?')) return;

  if (!confirm(`마감을 실행하시겠습니까?\n\n수익: MYR ${fmtN(ni.revenue)}\n비용: MYR ${fmtN(ni.expenses)}\n순${ni.netIncome>=0?'이익':'손실'}: MYR ${fmtN(Math.abs(ni.netIncome))}\n\n→ 3002 Retained Earnings ${ni.netIncome>=0?'증가':'감소'}\n\n실행 후 모든 4xxx/5xxx 잔액 = 0`)) return;

  // Find or create 3002 Retained Earnings
  let re = DB.accounts.find(a=>a.code==='3002');
  if (!re) {
    re = {id:'a3002', code:'3002', nameKr:'이익잉여금', nameEn:'Retained Earnings', type:'equity'};
    DB.accounts.push(re);
  }

  // Entry 1: Close revenue accounts to RE
  if (ni.revenueAccounts.length) {
    DB.entries.push({
      id: uid(), date: fyEnd,
      reference: `CLOSE-REV-${fyEnd.slice(0,4)}`,
      description: `Closing Entry — Close revenue accounts (FY ${fyStart}~${fyEnd})`,
      lines: [
        ...ni.revenueAccounts.map(a => ({accountId: a.id, debit: a.balance, credit: 0})),
        {accountId: re.id, debit: 0, credit: ni.revenue},
      ],
      source: 'manual',
    });
  }

  // Entry 2: Close expense accounts (from RE)
  if (ni.expenseAccounts.length) {
    DB.entries.push({
      id: uid(), date: fyEnd,
      reference: `CLOSE-EXP-${fyEnd.slice(0,4)}`,
      description: `Closing Entry — Close expense accounts (FY ${fyStart}~${fyEnd})`,
      lines: [
        {accountId: re.id, debit: ni.expenses, credit: 0},
        ...ni.expenseAccounts.map(a => ({accountId: a.id, debit: 0, credit: a.balance})),
      ],
      source: 'manual',
    });
  }

  saveDB();
  alert(`✓ 마감 완료\n\n순${ni.netIncome>=0?'이익':'손실'} MYR ${fmtN(Math.abs(ni.netIncome))}이 3002 Retained Earnings에 반영되었습니다.\n\n다음:\n1. Trial Balance 확인 (모든 4xxx/5xxx = 0)\n2. JSON 백업\n3. 새 회계연도 거래 입력 시작`);
  renderYearEndClosing();
}
