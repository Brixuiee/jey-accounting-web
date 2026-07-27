'use strict';
// ══════════════════════════════════════════════════════
//  Fixed Assets Module v2 — Categories, Disposal,
//  Multiple Depreciation Methods, Malaysian Capital Allowance,
//  Asset Register Report, CSV Import
// ══════════════════════════════════════════════════════

// ── Asset Categories (Malaysian standard useful life & Capital Allowance rates) ──
const ASSET_CATEGORIES = [
  {code:'COMP',  nameKr:'컴퓨터 / IT 장비',     nameEn:'Computer & IT Equipment',     life:5,  taxIA:20, taxAA:20},
  {code:'FURN',  nameKr:'사무용 가구',           nameEn:'Office Furniture',            life:10, taxIA:20, taxAA:10},
  {code:'EQUIP', nameKr:'사무용 기기',           nameEn:'Office Equipment',            life:5,  taxIA:20, taxAA:14},
  {code:'VEHIC', nameKr:'차량운반구',             nameEn:'Motor Vehicle',               life:5,  taxIA:20, taxAA:20},
  {code:'PLANT', nameKr:'기계장치',               nameEn:'Plant & Machinery',           life:10, taxIA:20, taxAA:14},
  {code:'RENOV', nameKr:'시설장치 / 임차개량',   nameEn:'Renovation / Leasehold Imp.', life:10, taxIA:0,  taxAA:0},
  {code:'BUILD', nameKr:'건물',                   nameEn:'Building',                    life:50, taxIA:10, taxAA:3},
  {code:'OTHER', nameKr:'기타',                   nameEn:'Other',                       life:5,  taxIA:0,  taxAA:0},
];

const SMALL_VALUE_THRESHOLD = 2000;  // MYR — Malaysian Capital Allowance: full claim in year if <2k

const DEPRECIATION_METHODS = {
  'straight-line':     {label:'정액법 (Straight-Line)'},
  'declining-balance': {label:'정률법 (Declining Balance)'},
};

const ASSET_STATUS = {
  active:        {label:'사용중', color:'#0ea572'},
  disposed:      {label:'매각', color:'#d97706'},
  'written-off': {label:'폐기', color:'#dc2626'},
};

// ── Helpers ──────────────────────────────────────────
function getCategory(code) {
  return ASSET_CATEGORIES.find(c=>c.code===code) || ASSET_CATEGORIES.find(c=>c.code==='OTHER');
}

function nextAssetCode(category='OTHER') {
  const prefix = `FA-${category}-`;
  const n = DB.assets.filter(a=>(a.code||'').startsWith(prefix)).length + 1;
  return `${prefix}${String(n).padStart(3,'0')}`;
}

// Compute accounting depreciation up to a given date
function computeAssetDep(asset, asOfDate=null) {
  if (!asset) return null;
  asOfDate = asOfDate || today();
  const start = new Date(asset.purchaseDate);
  const end = new Date(asOfDate);
  const monthsElapsed = Math.max(0, (end.getFullYear()-start.getFullYear())*12 + (end.getMonth()-start.getMonth()));
  const totalMonths = asset.life * 12;
  const depreciableBase = Math.max(0, Number(asset.cost||0) - Number(asset.residual||0));
  let monthlyDep = 0, accDep = 0;

  if (asset.method === 'declining-balance') {
    const rate = (asset.decliningRate || (2/asset.life)) / 12;  // monthly rate
    let bv = Number(asset.cost||0);
    for (let m=0; m<Math.min(monthsElapsed, totalMonths); m++) {
      const d = Math.min(bv * rate, bv - Number(asset.residual||0));
      if (d <= 0) break;
      accDep += d;
      bv -= d;
      if (m === monthsElapsed-1) monthlyDep = d;
    }
  } else {
    // Straight-line
    monthlyDep = totalMonths > 0 ? depreciableBase / totalMonths : 0;
    accDep = Math.min(monthsElapsed * monthlyDep, depreciableBase);
  }

  // If disposed, freeze at disposal
  if (asset.status === 'disposed' && asset.disposalDate && asset.disposalDate < asOfDate) {
    const disposalElapsed = Math.max(0, (new Date(asset.disposalDate).getFullYear()-start.getFullYear())*12 + (new Date(asset.disposalDate).getMonth()-start.getMonth()));
    if (asset.method === 'declining-balance') {
      let bv = Number(asset.cost||0); accDep = 0;
      const rate = (asset.decliningRate || (2/asset.life)) / 12;
      for (let m=0; m<Math.min(disposalElapsed, totalMonths); m++) {
        const d = Math.min(bv * rate, bv - Number(asset.residual||0));
        if (d <= 0) break;
        accDep += d;
        bv -= d;
      }
    } else {
      accDep = Math.min(disposalElapsed * monthlyDep, depreciableBase);
    }
  }

  const bookValue = Number(asset.cost||0) - accDep;
  const pct = depreciableBase > 0 ? Math.round((accDep / depreciableBase) * 100) : 0;
  return {monthlyDep, accDep, bookValue, pct, depreciableBase};
}

// Compute Malaysian Capital Allowance (tax depreciation)
// IA: Initial Allowance — only in year of acquisition
// AA: Annual Allowance — every year on cost (not on reducing balance, except for plant which uses cost basis)
function computeCapitalAllowance(asset, asOfDate=null) {
  if (!asset) return null;
  asOfDate = asOfDate || today();
  const cost = Number(asset.cost||0);

  // Small Value Asset — full 100% in year of acquisition
  if (cost < SMALL_VALUE_THRESHOLD && asset.smallValueClaim !== false) {
    return {ia: cost, aaPerYear: 0, totalToDate: cost, qe: 0, smallValue: true};
  }

  const cat = getCategory(asset.category);
  const iaRate = (asset.taxIA != null ? asset.taxIA : cat.taxIA) / 100;
  const aaRate = (asset.taxAA != null ? asset.taxAA : cat.taxAA) / 100;
  const ia = cost * iaRate;
  const aaPerYear = cost * aaRate;

  const purchaseYear = new Date(asset.purchaseDate).getFullYear();
  const asOfYear = new Date(asOfDate).getFullYear();
  const yearsElapsed = Math.max(0, asOfYear - purchaseYear);
  // Year 0 = IA + AA. Year 1+ = AA only. Stop when total reaches cost.
  const maxAllowance = cost;  // can't claim more than cost
  let total = ia + aaPerYear;  // year of acquisition
  for (let y=1; y<=yearsElapsed; y++) total += aaPerYear;
  total = Math.min(total, maxAllowance);
  const qe = Math.max(0, maxAllowance - total);  // Qualifying Expenditure remaining
  return {ia, aaPerYear, totalToDate: total, qe, smallValue:false, iaRate:iaRate*100, aaRate:aaRate*100};
}

// ── Render Assets List (overrides app.js renderAssets) ──
const _origRenderAssets = typeof renderAssets === 'function' ? renderAssets : null;
function renderAssetsV2() {
  const container = document.getElementById('assets-list');
  if (!container) return;

  // Filter and sort
  const filter = document.getElementById('asset-filter-status')?.value || '';
  const catFilter = document.getElementById('asset-filter-cat')?.value || '';
  let list = [...DB.assets];
  if (filter) list = list.filter(a=>(a.status||'active')===filter);
  if (catFilter) list = list.filter(a=>a.category===catFilter);
  list.sort((a,b)=>(a.code||'').localeCompare(b.code||''));

  if (!list.length) {
    container.innerHTML = '<p class="empty-msg">등록된 자산이 없습니다. [+ Add Asset] 또는 [📥 CSV 가져오기]를 이용하세요.</p>';
    renderAssetSummary();
    return;
  }

  container.innerHTML = list.map(asset => {
    const cat = getCategory(asset.category);
    const status = asset.status || 'active';
    const stCfg = ASSET_STATUS[status];
    const dep = computeAssetDep(asset);
    const ca = computeCapitalAllowance(asset);
    const isDisposed = status !== 'active';

    return `<div class="asset-card" style="${isDisposed?'opacity:.65;':''}border-left:4px solid ${stCfg.color}">
      <div class="asset-card-header">
        <div style="flex:1">
          <div style="display:flex;align-items:center;gap:.5rem;flex-wrap:wrap">
            <h4 style="margin:0">${asset.name}</h4>
            <span style="font-size:.7rem;background:#f1f5f9;padding:.15rem .4rem;border-radius:3px;color:#475569;font-family:monospace">${asset.code||'—'}</span>
            <span style="font-size:.7rem;background:#dbeafe;padding:.15rem .4rem;border-radius:3px;color:#1e40af">${cat.nameKr}</span>
            <span style="font-size:.7rem;background:${stCfg.color}22;padding:.15rem .4rem;border-radius:3px;color:${stCfg.color};font-weight:600">${stCfg.label}</span>
          </div>
          <div class="asset-meta" style="margin-top:.2rem">
            취득일: ${asset.purchaseDate} · 내용연수: ${asset.life}년 · ${DEPRECIATION_METHODS[asset.method||'straight-line'].label}
            ${asset.serialNo?` · S/N: ${asset.serialNo}`:''}${asset.location?` · 위치: ${asset.location}`:''}
          </div>
        </div>
        <div style="display:flex;gap:.4rem;flex-shrink:0">
          ${status==='active' ? `<button class="btn btn-sm btn-outline" onclick="openDisposeModal('${asset.id}')" title="처분/매각">📤 처분</button>` : ''}
          <button class="btn btn-sm btn-outline" onclick="openAssetModal('${asset.id}')">수정</button>
          <button class="btn btn-sm btn-danger" onclick="deleteAsset('${asset.id}')">삭제</button>
        </div>
      </div>
      <div class="asset-grid">
        <div class="asset-stat"><div class="label">취득원가</div><div class="value">MYR ${fmtN(asset.cost)}</div></div>
        <div class="asset-stat"><div class="label">연간 감가상각</div><div class="value">MYR ${fmtN(dep.monthlyDep*12)}</div></div>
        <div class="asset-stat"><div class="label">누계 감가상각</div><div class="value" style="color:var(--warning)">MYR ${fmtN(dep.accDep)}</div></div>
        <div class="asset-stat"><div class="label">장부가액</div><div class="value" style="color:var(--primary-lt)">MYR ${fmtN(dep.bookValue)}</div></div>
      </div>
      <div class="dep-bar"><div class="dep-bar-fill" style="width:${dep.pct}%"></div></div>
      <div style="font-size:.7rem;color:var(--text-muted);margin-top:.25rem;display:flex;justify-content:space-between">
        <span>감가상각 ${dep.pct}% 완료 (잔존: MYR ${fmtN(asset.residual)})</span>
        ${ca?.smallValue ? '<span style="color:#0ea572;font-weight:600">⚡ Small Value Asset — 100% 즉시공제</span>' :
          `<span>세무: IA ${ca.iaRate}% + AA ${ca.aaRate}% (누적 공제 MYR ${fmtN(ca.totalToDate)}, QE ${fmtN(ca.qe)})</span>`}
      </div>
      ${asset.status==='disposed' ? `<div style="margin-top:.5rem;padding:.5rem;background:#fef3c7;border-radius:4px;font-size:.78rem">
        📤 ${asset.disposalDate} 매각 — 매각대금 MYR ${fmtN(asset.disposalProceeds||0)} → ${asset.disposalGainLoss>=0?'처분이익':'처분손실'} <strong>MYR ${fmtN(Math.abs(asset.disposalGainLoss||0))}</strong>
      </div>` : ''}
      ${asset.status==='written-off' ? `<div style="margin-top:.5rem;padding:.5rem;background:#fee2e2;border-radius:4px;font-size:.78rem">
        🗑 ${asset.disposalDate||''} 폐기 — 폐기손실 MYR ${fmtN(Math.abs(asset.disposalGainLoss||0))}
      </div>` : ''}
      ${asset.note ? `<div style="font-size:.72rem;color:var(--text-muted);margin-top:.4rem;font-style:italic">${asset.note}</div>` : ''}
    </div>`;
  }).join('');

  renderAssetSummary();
}

function renderAssetSummary() {
  const el = document.getElementById('asset-summary');
  if (!el) return;
  const active = DB.assets.filter(a=>(a.status||'active')==='active');
  const totalCost = active.reduce((s,a)=>s+Number(a.cost||0),0);
  const totalDep = active.reduce((s,a)=>s+computeAssetDep(a).accDep,0);
  const totalBV = totalCost - totalDep;
  const monthlyDep = active.reduce((s,a)=>s+computeAssetDep(a).monthlyDep,0);
  el.innerHTML = `
    <div class="stat-card"><div class="label">활성 자산 수</div><div class="value">${active.length}개</div></div>
    <div class="stat-card"><div class="label">총 취득원가</div><div class="value">MYR ${fmtN(totalCost)}</div></div>
    <div class="stat-card"><div class="label">누계 감가상각</div><div class="value" style="color:var(--warning)">MYR ${fmtN(totalDep)}</div></div>
    <div class="stat-card"><div class="label">순 장부가액</div><div class="value" style="color:var(--primary-lt)">MYR ${fmtN(totalBV)}</div></div>
    <div class="stat-card"><div class="label">월 감가상각액</div><div class="value">MYR ${fmtN(monthlyDep)}</div></div>
  `;
}

// ── Asset Modal v2 (with category, methods, tax fields) ──
function openAssetModalV2(id=null) {
  const a = id ? DB.assets.find(x=>x.id===id) : null;
  const cat = a ? getCategory(a.category) : ASSET_CATEGORIES[0];
  document.getElementById('asset-modal-title').textContent = a ? '자산 수정' : '자산 추가';
  document.getElementById('asset-name').value     = a ? a.name : '';
  document.getElementById('asset-date').value     = a ? a.purchaseDate : today();
  document.getElementById('asset-cost').value     = a ? a.cost : '';
  document.getElementById('asset-residual').value = a ? a.residual : '0';
  document.getElementById('asset-life').value     = a ? a.life : cat.life;
  document.getElementById('asset-method').value   = a ? (a.method||'straight-line') : 'straight-line';
  document.getElementById('asset-note').value     = a ? (a.note||'') : '';
  document.getElementById('asset-edit-id').value  = a ? a.id : '';
  // New fields
  const setIf = (id, val) => { const el = document.getElementById(id); if (el) el.value = val; };
  setIf('asset-code',     a ? (a.code||nextAssetCode(a.category||'OTHER')) : nextAssetCode('OTHER'));
  setIf('asset-category', a ? (a.category||'OTHER') : 'OTHER');
  setIf('asset-serial',   a ? (a.serialNo||'') : '');
  setIf('asset-location', a ? (a.location||'') : '');
  setIf('asset-tax-ia',   a && a.taxIA != null ? a.taxIA : cat.taxIA);
  setIf('asset-tax-aa',   a && a.taxAA != null ? a.taxAA : cat.taxAA);
  document.getElementById('modal-asset').style.display='flex';
}

function onAssetCategoryChange() {
  const code = document.getElementById('asset-category').value;
  const cat = getCategory(code);
  const lifeEl = document.getElementById('asset-life');
  const iaEl = document.getElementById('asset-tax-ia');
  const aaEl = document.getElementById('asset-tax-aa');
  const codeEl = document.getElementById('asset-code');
  if (lifeEl && !document.getElementById('asset-edit-id').value) lifeEl.value = cat.life;
  if (iaEl) iaEl.value = cat.taxIA;
  if (aaEl) aaEl.value = cat.taxAA;
  if (codeEl && !document.getElementById('asset-edit-id').value) codeEl.value = nextAssetCode(code);
}

function saveAssetV2() {
  const name      = document.getElementById('asset-name').value.trim();
  const code      = document.getElementById('asset-code').value.trim();
  const category  = document.getElementById('asset-category').value;
  const date      = document.getElementById('asset-date').value;
  const cost      = Number(document.getElementById('asset-cost').value);
  const residual  = Number(document.getElementById('asset-residual').value||0);
  const life      = Number(document.getElementById('asset-life').value);
  const method    = document.getElementById('asset-method').value;
  const note      = document.getElementById('asset-note').value.trim();
  const serialNo  = document.getElementById('asset-serial')?.value?.trim()||'';
  const location  = document.getElementById('asset-location')?.value?.trim()||'';
  const taxIA     = Number(document.getElementById('asset-tax-ia')?.value||0);
  const taxAA     = Number(document.getElementById('asset-tax-aa')?.value||0);
  const editId    = document.getElementById('asset-edit-id').value;
  if (!name||!date||!cost||!life) return alert('필수 항목을 입력하세요.');
  if (residual >= cost) return alert('잔존가치는 취득원가보다 작아야 합니다.');

  const data = {
    name, code, category, purchaseDate: date,
    cost, residual, life, method, note,
    serialNo, location, taxIA, taxAA,
    status: editId ? (DB.assets.find(x=>x.id===editId).status||'active') : 'active',
  };
  if (editId) {
    Object.assign(DB.assets.find(x=>x.id===editId), data);
  } else {
    DB.assets.push({id:uid(), ...data});
  }
  saveDB();
  closeModal('modal-asset');
  renderAssetsV2();
}

// ── Asset Disposal ──────────────────────────────────
function openDisposeModal(id) {
  const a = DB.assets.find(x=>x.id===id);
  if (!a) return;
  const dep = computeAssetDep(a);
  document.getElementById('dispose-asset-id').value = a.id;
  document.getElementById('dispose-asset-name').textContent = `${a.code||''} ${a.name}`;
  document.getElementById('dispose-bv').textContent = fmtN(dep.bookValue);
  document.getElementById('dispose-date').value = today();
  document.getElementById('dispose-proceeds').value = '';
  document.getElementById('dispose-method-sold').checked = true;
  document.getElementById('dispose-bank-account').innerHTML = '<option value="">-- 계정 --</option>' +
    DB.accounts.filter(a=>a.type==='asset'&&!a.contra).sort((a,b)=>a.code.localeCompare(b.code))
      .map(a=>`<option value="${a.id}">${a.code} ${a.nameEn||a.nameKr}</option>`).join('');
  document.getElementById('dispose-bank-account').value = DB.settings.defaultBankAccount || '';
  updateDisposeGainLoss();
  document.getElementById('modal-dispose').style.display='flex';
}

function updateDisposeGainLoss() {
  const proceeds = Number(document.getElementById('dispose-proceeds').value||0);
  const bv = Number(document.getElementById('dispose-bv').textContent.replace(/,/g,'')||0);
  const gl = proceeds - bv;
  const el = document.getElementById('dispose-gl');
  el.textContent = `${gl>=0?'처분이익':'처분손실'} MYR ${fmtN(Math.abs(gl))}`;
  el.style.color = gl>=0 ? '#0ea572' : '#dc2626';
}

function confirmDispose() {
  const id = document.getElementById('dispose-asset-id').value;
  const a = DB.assets.find(x=>x.id===id);
  if (!a) return;
  const date = document.getElementById('dispose-date').value;
  const proceeds = Number(document.getElementById('dispose-proceeds').value||0);
  const isWriteOff = document.getElementById('dispose-method-writeoff').checked;
  const bankAccId = document.getElementById('dispose-bank-account').value;
  if (!date) return alert('처분일을 입력하세요.');
  if (!isWriteOff && !bankAccId) return alert('수령 계좌(은행 또는 매출채권)를 선택하세요.');

  // Compute depreciation up to disposal date
  const aCopy = {...a};
  aCopy.status = 'active';  // force compute up to disposal
  const dep = computeAssetDep(aCopy, date);
  const bookValue = dep.bookValue;
  const gainLoss = proceeds - bookValue;

  // Find accounts
  const faAcc = DB.accounts.find(x=>x.code==='1500');             // Fixed Assets
  const accDepAcc = DB.accounts.find(x=>x.code==='1501');         // Accumulated Depreciation
  let gainAcc = DB.accounts.find(x=>x.code==='4004');             // Gain on Disposal (create if missing)
  let lossAcc = DB.accounts.find(x=>x.code==='5011');             // Loss on Disposal
  if (!gainAcc) {
    gainAcc = {id:uid(), code:'4004', nameKr:'유형자산처분이익', nameEn:'Gain on Disposal of Assets', type:'revenue'};
    DB.accounts.push(gainAcc);
  }
  if (!lossAcc) {
    lossAcc = {id:uid(), code:'5011', nameKr:'유형자산처분손실', nameEn:'Loss on Disposal of Assets', type:'expense'};
    DB.accounts.push(lossAcc);
  }
  if (!faAcc||!accDepAcc) return alert('1500 Fixed Assets 또는 1501 Accumulated Depreciation 계정이 필요합니다.');

  // Build disposal journal entry
  // Always: CR Fixed Assets (cost), DR Accumulated Depreciation (acc dep)
  // If sold: DR Bank (proceeds)
  // Balance with Gain (CR) or Loss (DR)
  const lines = [
    {accountId: accDepAcc.id, debit: dep.accDep, credit: 0},  // remove acc dep
    {accountId: faAcc.id, debit: 0, credit: Number(a.cost||0)},  // remove cost
  ];
  if (!isWriteOff && proceeds > 0) {
    lines.push({accountId: bankAccId, debit: proceeds, credit: 0});
  }
  if (gainLoss > 0) {
    lines.push({accountId: gainAcc.id, debit: 0, credit: gainLoss});
  } else if (gainLoss < 0) {
    lines.push({accountId: lossAcc.id, debit: -gainLoss, credit: 0});
  }

  DB.entries.push({
    id: uid(), date,
    reference: `DISP-${(a.code||a.id).slice(0,12)}`,
    description: `${isWriteOff?'폐기':'매각'} — ${a.name}${proceeds>0?` (매각대금 ${fmtN(proceeds)})`:''}`,
    lines, source: 'depreciation', sourceId: a.id,
  });

  // Update asset status
  a.status = isWriteOff ? 'written-off' : 'disposed';
  a.disposalDate = date;
  a.disposalProceeds = proceeds;
  a.disposalGainLoss = gainLoss;

  saveDB();
  closeModal('modal-dispose');
  renderAssetsV2();
  alert(`✓ ${isWriteOff?'폐기':'매각'} 처리 완료\n장부가액: MYR ${fmtN(bookValue)}\n${gainLoss>=0?'처분이익':'처분손실'}: MYR ${fmtN(Math.abs(gainLoss))}`);
}

// ── Asset Register Report ──────────────────────────
function renderAssetRegister() {
  const asOfDate = document.getElementById('areg-date')?.value || today();
  const includeDisposed = document.getElementById('areg-include-disposed')?.checked || false;

  let list = [...DB.assets];
  if (!includeDisposed) list = list.filter(a=>(a.status||'active')==='active');
  list.sort((a,b)=>(a.code||'').localeCompare(b.code||''));

  const rows = list.map(a => {
    const cat = getCategory(a.category);
    const dep = computeAssetDep(a, asOfDate);
    const ca = computeCapitalAllowance(a, asOfDate);
    return {a, cat, dep, ca};
  });

  const totals = rows.reduce((t,r)=>{
    t.cost += Number(r.a.cost||0);
    t.acc += r.dep.accDep;
    t.bv += r.dep.bookValue;
    t.ca += r.ca?.totalToDate || 0;
    return t;
  }, {cost:0, acc:0, bv:0, ca:0});

  document.getElementById('asset-register-report').innerHTML = `
    <div class="report-title">
      <h2>${DB.settings.companyName}</h2>
      <p>Fixed Asset Register / 고정자산 대장</p>
      <p>As of ${asOfDate}</p>
    </div>
    <table class="table" style="font-size:.78rem">
      <thead>
        <tr style="background:#f1f5f9">
          <th>Code</th><th>Description / 자산명</th><th>Category</th><th>Purchase Date</th>
          <th class="num">Cost (MYR)</th>
          <th class="num">Acc. Dep. (MYR)</th>
          <th class="num">Book Value (MYR)</th>
          <th class="num">Capital Allow. (MYR)</th>
          <th>Status</th>
        </tr>
      </thead>
      <tbody>
        ${rows.map(r=>`<tr ${r.a.status!=='active'?'style="color:var(--text-muted);font-style:italic"':''}>
          <td style="font-family:monospace">${r.a.code||'—'}</td>
          <td>${r.a.name}${r.a.serialNo?`<div style="font-size:.65rem;color:var(--text-muted)">S/N: ${r.a.serialNo}</div>`:''}</td>
          <td>${r.cat.nameKr}</td>
          <td>${r.a.purchaseDate}</td>
          <td class="num">${fmtN(r.a.cost)}</td>
          <td class="num">${fmtN(r.dep.accDep)}</td>
          <td class="num"><strong>${fmtN(r.dep.bookValue)}</strong></td>
          <td class="num">${fmtN(r.ca.totalToDate)}${r.ca.smallValue?'<br><span style="font-size:.65rem;color:#0ea572">SVA 100%</span>':''}</td>
          <td>${ASSET_STATUS[r.a.status||'active'].label}</td>
        </tr>`).join('') || '<tr><td colspan="9" class="empty-msg">자산 없음</td></tr>'}
        <tr style="font-weight:700;border-top:2px solid var(--text);background:#f8fafc">
          <td colspan="4">Total / 합계</td>
          <td class="num">${fmtN(totals.cost)}</td>
          <td class="num">${fmtN(totals.acc)}</td>
          <td class="num">${fmtN(totals.bv)}</td>
          <td class="num">${fmtN(totals.ca)}</td>
          <td></td>
        </tr>
      </tbody>
    </table>
    <div style="margin-top:1rem;font-size:.78rem;color:var(--text-muted);line-height:1.6">
      <p><strong>약어 설명:</strong> Acc. Dep. = Accumulated Depreciation (누계 감가상각) · BV = Book Value (장부가액) · SVA = Small Value Asset (MYR 2,000 미만 즉시공제)</p>
      <p><strong>Capital Allowance</strong>는 말레이시아 세무용 (Section 19, Schedule 3 Income Tax Act 1967) — IA + AA 누적 공제액</p>
    </div>`;
}

// ── CSV Bulk Import ──────────────────────────────────
function handleAssetCSVImport(event) {
  const file = event.target.files[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = e => {
    try {
      const rows = parseCSV(e.target.result);
      if (rows.length < 2) { alert('CSV 비어있음'); return; }
      const headers = rows[0];
      const map = {
        code:     findCol(headers, ['code','asset code','자산코드']),
        name:     findCol(headers, ['name','asset name','description','자산명']),
        category: findCol(headers, ['category','type','분류']),
        date:     findCol(headers, ['purchase date','date','acquisition date','취득일']),
        cost:     findCol(headers, ['cost','acquisition cost','original cost','취득원가']),
        residual: findCol(headers, ['residual','residual value','salvage value','잔존가치']),
        life:     findCol(headers, ['life','useful life','내용연수']),
        method:   findCol(headers, ['method','depreciation method']),
        serial:   findCol(headers, ['serial','serial no','s/n']),
        location: findCol(headers, ['location','site','위치']),
        note:     findCol(headers, ['note','remarks','notes']),
      };
      if (map.name < 0 || map.date < 0 || map.cost < 0)
        throw new Error('필수 컬럼 누락 (Asset Name, Purchase Date, Cost)');

      const importLog = [];
      const dataRows = rows.slice(1).filter(r=>r.some(c=>c&&c.trim()));
      for (const row of dataRows) {
        const name = String(row[map.name]||'').trim();
        if (!name) continue;
        const catStr = (map.category>=0 ? row[map.category] : '').toString().toLowerCase();
        let category = 'OTHER';
        for (const c of ASSET_CATEGORIES) {
          if (catStr.includes(c.code.toLowerCase()) ||
              catStr.includes(c.nameEn.toLowerCase().split(' ')[0]) ||
              catStr.includes(c.nameKr.slice(0,3))) { category = c.code; break; }
        }
        const cat = getCategory(category);
        const cost = parseAmount(row[map.cost]);
        const date = parseImportDate(row[map.date]) || today();
        // Skip duplicates by code
        const codeVal = map.code>=0 ? String(row[map.code]||'').trim() : '';
        if (codeVal && DB.assets.find(a=>a.code===codeVal)) {
          importLog.push(`SKIP ${codeVal}: 이미 존재`);
          continue;
        }
        const a = {
          id: uid(),
          code: codeVal || nextAssetCode(category),
          name,
          category,
          purchaseDate: date,
          cost,
          residual: map.residual>=0 ? parseAmount(row[map.residual]) : 0,
          life: map.life>=0 ? Number(parseAmount(row[map.life]))||cat.life : cat.life,
          method: (map.method>=0 ? String(row[map.method]||'').toLowerCase() : '').includes('declin') ? 'declining-balance' : 'straight-line',
          serialNo: map.serial>=0 ? String(row[map.serial]||'').trim() : '',
          location: map.location>=0 ? String(row[map.location]||'').trim() : '',
          note: map.note>=0 ? String(row[map.note]||'').trim() : '',
          taxIA: cat.taxIA, taxAA: cat.taxAA,
          status: 'active',
        };
        DB.assets.push(a);
        importLog.push(`OK ${a.code} ${a.name} (${a.category}) MYR ${fmtN(cost)}`);
      }
      saveDB();
      renderAssetsV2();
      alert(`✓ 자산 import 완료\n${importLog.length}건 처리\n\n${importLog.slice(0,15).join('\n')}${importLog.length>15?`\n...+${importLog.length-15}건 더`:''}`);
    } catch (err) {
      console.error(err);
      alert('CSV import 실패: '+err.message);
    }
  };
  reader.readAsText(file, 'UTF-8');
  event.target.value = '';
}

function downloadAssetTemplate() {
  const csv = 'Asset Code,Asset Name,Category,Purchase Date,Cost,Residual Value,Useful Life,Depreciation Method,Serial No,Location,Notes\n' +
    'FA-COMP-001,Dell Laptop i7,COMP,2024-03-15,5000.00,500.00,5,Straight-line,SN-LAP-001,Office 1F,Marketing dept\n' +
    'FA-FURN-001,Office Desk x4,FURN,2024-01-10,3200.00,0,10,Straight-line,,Office 1F,4 units\n' +
    'FA-VEHIC-001,Proton X70 2023,VEHIC,2023-06-20,150000.00,15000.00,5,Declining-balance,WTH1234,Company,Director use\n';
  const blob = new Blob(['﻿'+csv], {type:'text/csv;charset=utf-8'});
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = 'asset_register_template.csv';
  a.click();
}

// ── Override the global functions called by app.js ──
window.renderAssets = renderAssetsV2;
window.openAssetModal = openAssetModalV2;
window.saveAsset = saveAssetV2;

// Update showSection to wire register
if (typeof showSection === 'function') {
  const _origShow = showSection;
  window.showSection = function(name) {
    _origShow(name);
    if (name === 'asset-register') renderAssetRegister();
  };
}
