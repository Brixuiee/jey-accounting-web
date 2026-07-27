'use strict';
// ══════════════════════════════════════════════════════
//  Payroll Module — 직원 급여
//  ----------------------------------------------------
//  Malaysia 2024-2025 Statutory:
//   • EPF (KWSP): 직원 11% / 회사 13%(<5k) or 12%(≥5k)
//     - 60세 이상: 직원 5.5% / 회사 4%(≤60k) or 0%(>60k)
//   • SOCSO (PERKESO):
//     - Cat 1 (Employment + Invalidity, 60세 미만): 직원 0.5% / 회사 1.75%
//     - Cat 2 (Employment only, 60세 이상): 회사 1.25%
//   • EIS: 직원 0.2% / 회사 0.2% (60세 미만)
//   • PCB: LHDN 표 기반 — 사용자 입력 또는 간이 계산
// ══════════════════════════════════════════════════════

function ensurePayrollAccounts() {
  const needs = [
    {code:'2010', nameKr:'미지급 급여',          nameEn:'Salaries Payable',        type:'liability'},
    {code:'2011', nameKr:'EPF 미지급금',         nameEn:'EPF Payable',             type:'liability'},
    {code:'2012', nameKr:'SOCSO 미지급금',       nameEn:'SOCSO Payable',           type:'liability'},
    {code:'2013', nameKr:'EIS 미지급금',         nameEn:'EIS Payable',             type:'liability'},
    {code:'2014', nameKr:'PCB 미지급금',         nameEn:'PCB Payable',             type:'liability'},
    {code:'5013', nameKr:'EPF 회사부담분',       nameEn:'EPF Employer Contribution', type:'expense'},
    {code:'5014', nameKr:'SOCSO 회사부담분',     nameEn:'SOCSO Employer Contribution', type:'expense'},
    {code:'5015', nameKr:'EIS 회사부담분',       nameEn:'EIS Employer Contribution', type:'expense'},
  ];
  let added = false;
  for (const n of needs) {
    if (!DB.accounts.find(a=>a.code===n.code)) {
      DB.accounts.push({id:'a'+n.code, ...n}); added = true;
    }
  }
  if (!DB.employees) { DB.employees = []; added = true; }
  if (!DB.payrollRuns) { DB.payrollRuns = []; added = true; }
  if (added) saveDB();
}

// ── EPF / SOCSO / EIS Calculations ───────────────────
function calcEPF(grossSalary, age, citizenship='Malaysian') {
  // Note: full LHDN table is complex; this is simplified standard
  if (grossSalary <= 0) return {empE:0, empR:0};
  let empRate, erRate;
  if (age >= 60 && citizenship === 'Malaysian') {
    empRate = 0.055;
    erRate = grossSalary <= 60000/12 ? 0.04 : 0;
  } else if (age >= 60) {
    empRate = 0;
    erRate = 0.04;
  } else {
    empRate = 0.11;
    erRate = grossSalary <= 5000 ? 0.13 : 0.12;
  }
  return {
    empE: Math.ceil(grossSalary * empRate),  // EPF is rounded up to ringgit
    empR: Math.ceil(grossSalary * erRate),
    empRate: empRate*100, erRate: erRate*100,
  };
}

function calcSOCSO(grossSalary, age) {
  if (grossSalary <= 0 || grossSalary > 5000) {
    // SOCSO capped at MYR 5,000 base in old scheme; new scheme caps at MYR 6,000+
    // Use MYR 5,000 for simplicity
    grossSalary = Math.min(grossSalary, 6000);
  }
  if (grossSalary <= 30) return {empE:0, empR:0};
  // Simplified: Category 1 (under 60): 0.5% emp + 1.75% employer
  //              Category 2 (60+):       0% emp + 1.25% employer
  if (age >= 60) {
    return {empE:0, empR: Math.round(grossSalary * 0.0125 * 100) / 100, cat:2};
  }
  return {
    empE: Math.round(grossSalary * 0.005 * 100) / 100,
    empR: Math.round(grossSalary * 0.0175 * 100) / 100,
    cat: 1,
  };
}

function calcEIS(grossSalary, age) {
  if (grossSalary <= 0 || age >= 60) return {empE:0, empR:0};
  const cap = Math.min(grossSalary, 6000);
  return {
    empE: Math.round(cap * 0.002 * 100) / 100,
    empR: Math.round(cap * 0.002 * 100) / 100,
  };
}

// Simple PCB estimate (NOT exact LHDN — for budgeting only)
// User should override with actual LHDN calculator result
function estimatePCB(monthlyGross, age) {
  // Annual estimate
  const annual = monthlyGross * 12;
  const personalRelief = 9000;  // Basic personal relief
  const epfRelief = Math.min(annual * 0.11, 4000);  // EPF up to 4000
  const taxable = Math.max(0, annual - personalRelief - epfRelief);
  // Simplified tax bands (resident individual 2024)
  let tax = 0;
  if (taxable <= 5000) tax = 0;
  else if (taxable <= 20000) tax = (taxable - 5000) * 0.01;
  else if (taxable <= 35000) tax = 150 + (taxable - 20000) * 0.03;
  else if (taxable <= 50000) tax = 600 + (taxable - 35000) * 0.06;
  else if (taxable <= 70000) tax = 1500 + (taxable - 50000) * 0.11;
  else if (taxable <= 100000) tax = 3700 + (taxable - 70000) * 0.19;
  else if (taxable <= 400000) tax = 9400 + (taxable - 100000) * 0.25;
  else tax = 84400 + (taxable - 400000) * 0.26;
  return Math.round(tax / 12 * 100) / 100;
}

// ── Employees Management ─────────────────────────────
function renderEmployees() {
  ensurePayrollAccounts();
  const list = [...DB.employees].sort((a,b)=>(a.code||'').localeCompare(b.code||''));
  const tbody = document.querySelector('#employees-table tbody');
  if (!tbody) return;
  tbody.innerHTML = list.length ? list.map(e=>{
    const age = e.dob ? Math.floor((new Date() - new Date(e.dob)) / (365.25*86400000)) : 30;
    return `<tr>
      <td><strong>${e.code||'—'}</strong></td>
      <td>${e.name}<div style="font-size:.7rem;color:var(--text-muted)">${e.ic||''} · ${e.position||''}</div></td>
      <td style="font-size:.78rem">EPF: ${e.epfNo||'—'}<br>SOCSO: ${e.socsoNo||'—'}</td>
      <td class="num">${fmtN(e.basicSalary||0)}</td>
      <td>${age}세 ${e.status==='active'?'<span style="color:#0ea572;font-size:.7rem">●사용중</span>':'<span style="color:var(--text-muted);font-size:.7rem">●퇴직</span>'}</td>
      <td>
        <button class="btn btn-sm btn-outline" onclick="openEmployeeModal('${e.id}')">수정</button>
        <button class="btn btn-sm btn-danger" onclick="deleteEmployee('${e.id}')" style="margin-left:.25rem">삭제</button>
      </td>
    </tr>`;
  }).join('') : '<tr><td colspan="6" class="empty-msg">등록된 직원이 없습니다.</td></tr>';
}

function openEmployeeModal(id=null) {
  const e = id ? DB.employees.find(x=>x.id===id) : null;
  document.getElementById('emp-modal-title').textContent = e?'직원 수정':'직원 추가';
  const set = (k,v)=>{ const el=document.getElementById(k); if (el) el.value = v||''; };
  set('emp-code',     e?e.code: `EMP${String(DB.employees.length+1).padStart(3,'0')}`);
  set('emp-name',     e?e.name:'');
  set('emp-ic',       e?e.ic:'');
  set('emp-dob',      e?e.dob:'');
  set('emp-position', e?e.position:'');
  set('emp-join',     e?e.joinDate:today());
  set('emp-basic',    e?e.basicSalary:'0');
  set('emp-allowance', e?e.fixedAllowance:'0');
  set('emp-epf-no',   e?e.epfNo:'');
  set('emp-socso-no', e?e.socsoNo:'');
  set('emp-tax-no',   e?e.taxNo:'');
  set('emp-bank',     e?e.bankAccount:'');
  set('emp-status',   e?(e.status||'active'):'active');
  set('emp-edit-id',  e?e.id:'');
  document.getElementById('modal-employee').style.display='flex';
}

function saveEmployee() {
  const code = document.getElementById('emp-code').value.trim();
  const name = document.getElementById('emp-name').value.trim();
  if (!code||!name) return alert('직원 코드와 이름은 필수입니다.');
  const editId = document.getElementById('emp-edit-id').value;
  if (!editId && DB.employees.find(e=>e.code===code)) return alert('이미 존재하는 직원 코드');
  const data = {
    code, name,
    ic: document.getElementById('emp-ic').value.trim(),
    dob: document.getElementById('emp-dob').value,
    position: document.getElementById('emp-position').value.trim(),
    joinDate: document.getElementById('emp-join').value,
    basicSalary: Number(document.getElementById('emp-basic').value||0),
    fixedAllowance: Number(document.getElementById('emp-allowance').value||0),
    epfNo: document.getElementById('emp-epf-no').value.trim(),
    socsoNo: document.getElementById('emp-socso-no').value.trim(),
    taxNo: document.getElementById('emp-tax-no').value.trim(),
    bankAccount: document.getElementById('emp-bank').value.trim(),
    status: document.getElementById('emp-status').value,
  };
  if (editId) Object.assign(DB.employees.find(e=>e.id===editId), data);
  else DB.employees.push({id:uid(), ...data});
  saveDB();
  closeModal('modal-employee');
  renderEmployees();
}

function deleteEmployee(id) {
  if (DB.payrollRuns?.some(r=>r.lines?.some(l=>l.employeeId===id)))
    return alert('이 직원의 급여 처리 이력이 있어 삭제할 수 없습니다. 상태를 "퇴직"으로 변경하세요.');
  if (!confirm('삭제하시겠습니까?')) return;
  DB.employees = DB.employees.filter(e=>e.id!==id);
  saveDB();
  renderEmployees();
}

// ── Monthly Payroll Run ──────────────────────────────
function renderPayrollRun() {
  ensurePayrollAccounts();
  const monthEl = document.getElementById('payroll-month');
  if (monthEl && !monthEl.value) monthEl.value = nowMonth();
  const month = monthEl?.value || nowMonth();

  const activeEmps = DB.employees.filter(e=>(e.status||'active')==='active');
  if (!activeEmps.length) {
    document.getElementById('payroll-output').innerHTML = '<p class="empty-msg">활성 직원이 없습니다. Employee 메뉴에서 추가하세요.</p>';
    return;
  }

  // Check if already processed
  const existing = DB.payrollRuns?.find(r=>r.month===month);

  // Compute payroll for each employee
  const lines = activeEmps.map(e=>{
    const age = e.dob ? Math.floor((new Date() - new Date(e.dob)) / (365.25*86400000)) : 30;
    const basic = Number(e.basicSalary||0);
    const allowance = Number(e.fixedAllowance||0);
    const gross = basic + allowance;
    const epf = calcEPF(gross, age);
    const socso = calcSOCSO(gross, age);
    const eis = calcEIS(gross, age);
    const pcb = (existing?.lines?.find(l=>l.employeeId===e.id)?.pcb) ?? estimatePCB(gross, age);
    const totalDeduction = epf.empE + socso.empE + eis.empE + pcb;
    const netPay = gross - totalDeduction;
    return {
      employeeId: e.id, code: e.code, name: e.name, age,
      basic, allowance, gross,
      epfE: epf.empE, epfR: epf.empR,
      socsoE: socso.empE, socsoR: socso.empR,
      eisE: eis.empE, eisR: eis.empR,
      pcb,
      netPay,
      employerCost: gross + epf.empR + socso.empR + eis.empR,
    };
  });

  const tot = lines.reduce((t,l)=>{
    t.gross += l.gross; t.epfE += l.epfE; t.epfR += l.epfR;
    t.socsoE += l.socsoE; t.socsoR += l.socsoR;
    t.eisE += l.eisE; t.eisR += l.eisR;
    t.pcb += l.pcb; t.net += l.netPay; t.employerCost += l.employerCost;
    return t;
  }, {gross:0,epfE:0,epfR:0,socsoE:0,socsoR:0,eisE:0,eisR:0,pcb:0,net:0,employerCost:0});

  document.getElementById('payroll-output').innerHTML = `
    <div class="report-title">
      <h2>${DB.settings.companyName}</h2>
      <p>Monthly Payroll Run / 월 급여 정산</p>
      <p>${month} · 활성 직원 ${lines.length}명${existing?' · <span style="color:#0ea572">이미 처리됨</span>':''}</p>
    </div>
    <div style="overflow-x:auto">
      <table class="table" style="font-size:.75rem;min-width:1300px">
        <thead style="background:#f1f5f9">
          <tr>
            <th>코드</th><th>직원명</th><th class="num">기본급</th><th class="num">수당</th><th class="num">총급여</th>
            <th class="num" style="color:#dc2626">EPF (직원)</th>
            <th class="num" style="color:#dc2626">SOCSO (직원)</th>
            <th class="num" style="color:#dc2626">EIS (직원)</th>
            <th class="num" style="color:#dc2626">PCB</th>
            <th class="num"><strong>실수령액</strong></th>
            <th class="num" style="color:#0ea572">EPF (회사)</th>
            <th class="num" style="color:#0ea572">SOCSO (회사)</th>
            <th class="num" style="color:#0ea572">EIS (회사)</th>
            <th class="num"><strong>총 인건비</strong></th>
          </tr>
        </thead>
        <tbody>
          ${lines.map((l,i)=>`<tr>
            <td><strong>${l.code}</strong></td>
            <td>${l.name}<div style="font-size:.65rem;color:var(--text-muted)">${l.age}세</div></td>
            <td class="num">${fmtN(l.basic)}</td>
            <td class="num">${fmtN(l.allowance)}</td>
            <td class="num"><strong>${fmtN(l.gross)}</strong></td>
            <td class="num">${fmtN(l.epfE)}</td>
            <td class="num">${fmtN(l.socsoE)}</td>
            <td class="num">${fmtN(l.eisE)}</td>
            <td class="num"><input type="number" class="input payroll-pcb" data-emp="${l.employeeId}" value="${l.pcb}" step="0.01" min="0" style="width:80px;font-size:.72rem;padding:.15rem .3rem" onchange="updatePayrollLine(${i})"></td>
            <td class="num"><strong style="color:#1e40af" id="net-${i}">${fmtN(l.netPay)}</strong></td>
            <td class="num">${fmtN(l.epfR)}</td>
            <td class="num">${fmtN(l.socsoR)}</td>
            <td class="num">${fmtN(l.eisR)}</td>
            <td class="num"><strong>${fmtN(l.employerCost)}</strong></td>
          </tr>`).join('')}
          <tr style="font-weight:700;background:#f8fafc;border-top:2px solid var(--text)">
            <td colspan="4">합계</td>
            <td class="num">${fmtN(tot.gross)}</td>
            <td class="num">${fmtN(tot.epfE)}</td>
            <td class="num">${fmtN(tot.socsoE)}</td>
            <td class="num">${fmtN(tot.eisE)}</td>
            <td class="num">${fmtN(tot.pcb)}</td>
            <td class="num"><strong>${fmtN(tot.net)}</strong></td>
            <td class="num">${fmtN(tot.epfR)}</td>
            <td class="num">${fmtN(tot.socsoR)}</td>
            <td class="num">${fmtN(tot.eisR)}</td>
            <td class="num"><strong>${fmtN(tot.employerCost)}</strong></td>
          </tr>
        </tbody>
      </table>
    </div>

    <div class="cards-grid" style="grid-template-columns:repeat(4,1fr);gap:.5rem;margin:1rem 0">
      <div class="stat-card"><div class="label">총 급여 (Gross)</div><div class="value">MYR ${fmtN(tot.gross)}</div></div>
      <div class="stat-card"><div class="label">실수령액 합계</div><div class="value positive">MYR ${fmtN(tot.net)}</div></div>
      <div class="stat-card"><div class="label">회사 부담분 합계</div><div class="value negative">MYR ${fmtN(tot.epfR+tot.socsoR+tot.eisR)}</div></div>
      <div class="stat-card"><div class="label">총 인건비</div><div class="value">MYR ${fmtN(tot.employerCost)}</div></div>
    </div>

    <p style="font-size:.78rem;color:var(--text-muted);background:#fef3c7;padding:.5rem;border-radius:4px;line-height:1.6">
      💡 <strong>PCB(원천징수세) 주의:</strong> 위 PCB 값은 간이 추정치입니다.
      정확한 PCB는 <a href="https://calcpcb.hasil.gov.my/" target="_blank" style="color:#1e40af">LHDN e-PCB 계산기</a>로 확인 후 위 칸에 직접 입력하세요.
    </p>

    <div style="margin:1rem 0;text-align:center">
      <button class="btn btn-primary" onclick="commitPayrollRun('${month}')">💾 급여 분개 생성 (Commit)</button>
      ${existing?`<button class="btn btn-outline" onclick="alert('이미 처리된 월입니다. Journal Entry 메뉴에서 PR-${month.replace('-','')} 분개를 확인하세요.')" style="margin-left:.5rem">처리됨 (재실행 시 추가됨)</button>`:''}
    </div>
  `;
}

function updatePayrollLine(i) {
  // Called when PCB is manually changed — re-render to update net pay
  renderPayrollRun();
}

function commitPayrollRun(month) {
  ensurePayrollAccounts();
  const activeEmps = DB.employees.filter(e=>(e.status||'active')==='active');
  if (!activeEmps.length) return alert('활성 직원이 없습니다.');

  // Re-compute with PCB overrides from DOM
  const pcbOverrides = {};
  document.querySelectorAll('.payroll-pcb').forEach(input => {
    pcbOverrides[input.dataset.emp] = Number(input.value||0);
  });

  const lines = activeEmps.map(e=>{
    const age = e.dob ? Math.floor((new Date() - new Date(e.dob)) / (365.25*86400000)) : 30;
    const basic = Number(e.basicSalary||0);
    const allowance = Number(e.fixedAllowance||0);
    const gross = basic + allowance;
    const epf = calcEPF(gross, age);
    const socso = calcSOCSO(gross, age);
    const eis = calcEIS(gross, age);
    const pcb = pcbOverrides[e.id] ?? estimatePCB(gross, age);
    const netPay = gross - epf.empE - socso.empE - eis.empE - pcb;
    return {employeeId:e.id, basic, allowance, gross, epfE:epf.empE, epfR:epf.empR, socsoE:socso.empE, socsoR:socso.empR, eisE:eis.empE, eisR:eis.empR, pcb, netPay};
  });

  const tot = lines.reduce((t,l)=>{
    t.gross += l.gross; t.epfE += l.epfE; t.epfR += l.epfR;
    t.socsoE += l.socsoE; t.socsoR += l.socsoR;
    t.eisE += l.eisE; t.eisR += l.eisR;
    t.pcb += l.pcb; t.net += l.netPay;
    return t;
  }, {gross:0,epfE:0,epfR:0,socsoE:0,socsoR:0,eisE:0,eisR:0,pcb:0,net:0});

  if (!confirm(`급여 분개를 생성합니다.\n총 급여: MYR ${fmtN(tot.gross)}\n실수령액: MYR ${fmtN(tot.net)}\n계속?`)) return;

  // Build journal:
  // DR Salary Expense (5002)         tot.gross
  // DR EPF Employer (5013)            tot.epfR
  // DR SOCSO Employer (5014)          tot.socsoR
  // DR EIS Employer (5015)            tot.eisR
  // CR Bank (1002)                          tot.net (가정: 즉시 이체)
  // CR EPF Payable (2011)                   tot.epfE + tot.epfR
  // CR SOCSO Payable (2012)                 tot.socsoE + tot.socsoR
  // CR EIS Payable (2013)                   tot.eisE + tot.eisR
  // CR PCB Payable (2014)                   tot.pcb

  const [y, m] = month.split('-');
  const monthEnd = `${y}-${m}-${String(new Date(Number(y),Number(m),0).getDate()).padStart(2,'0')}`;

  const acc = (code) => DB.accounts.find(a=>a.code===code)?.id;
  const drExp = [
    {accountId: acc('5002'), debit: tot.gross, credit: 0},   // Salary Expense
    {accountId: acc('5013'), debit: tot.epfR, credit: 0},    // EPF Employer
    {accountId: acc('5014'), debit: tot.socsoR, credit: 0},  // SOCSO Employer
    {accountId: acc('5015'), debit: tot.eisR, credit: 0},    // EIS Employer
  ].filter(l=>l.debit > 0);
  const crLines = [
    {accountId: acc('1002'), debit: 0, credit: tot.net},                       // Bank (net pay)
    {accountId: acc('2011'), debit: 0, credit: tot.epfE + tot.epfR},           // EPF Payable
    {accountId: acc('2012'), debit: 0, credit: tot.socsoE + tot.socsoR},       // SOCSO Payable
    {accountId: acc('2013'), debit: 0, credit: tot.eisE + tot.eisR},           // EIS Payable
    {accountId: acc('2014'), debit: 0, credit: tot.pcb},                       // PCB Payable
  ].filter(l=>l.credit > 0);

  const entry = {
    id: uid(), date: monthEnd,
    reference: `PR-${y}${m}`,
    description: `${y}년 ${m}월 급여 (${activeEmps.length}명, 총 MYR ${fmtN(tot.gross)})`,
    lines: [...drExp, ...crLines],
    source: 'manual',
  };
  DB.entries.push(entry);

  // Save run
  if (!DB.payrollRuns) DB.payrollRuns = [];
  DB.payrollRuns.push({
    id: uid(), month, date: monthEnd, lines, totals: tot, entryId: entry.id,
  });

  saveDB();
  alert(`✓ 급여 분개 생성 완료\n참조번호: PR-${y}${m}\n총 인건비: MYR ${fmtN(tot.gross + tot.epfR + tot.socsoR + tot.eisR)}`);
  renderPayrollRun();
}
