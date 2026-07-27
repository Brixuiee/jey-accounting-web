'use strict';
// ══════════════════════════════════════════════════════
//  Multi-Currency Module — 다중 통화 / Forex
//  ----------------------------------------------------
//  • 통화 마스터 (USD, SGD, CNY 등 + MYR base)
//  • 환율 입력 / 추적
//  • 외화 송장 등록 (Invoice/Bill에 foreign currency + rate)
//  • 환차손익 자동 계산 (수령/지급 시 rate 차이)
//  • 자산 계정 통화 설정 (USD 통장 등)
// ══════════════════════════════════════════════════════

const DEFAULT_CURRENCIES = [
  {code:'MYR', name:'Malaysian Ringgit', symbol:'RM', base: true},
  {code:'USD', name:'US Dollar', symbol:'$'},
  {code:'SGD', name:'Singapore Dollar', symbol:'S$'},
  {code:'EUR', name:'Euro', symbol:'€'},
  {code:'CNY', name:'Chinese Yuan', symbol:'¥'},
  {code:'KRW', name:'Korean Won', symbol:'₩'},
  {code:'JPY', name:'Japanese Yen', symbol:'¥'},
  {code:'GBP', name:'British Pound', symbol:'£'},
  {code:'IDR', name:'Indonesian Rupiah', symbol:'Rp'},
  {code:'THB', name:'Thai Baht', symbol:'฿'},
];

function ensureForexAccounts() {
  const needs = [
    {code:'4005', nameKr:'외환차익',    nameEn:'Forex Gain (Realized)',   type:'revenue'},
    {code:'5016', nameKr:'외환차손',    nameEn:'Forex Loss (Realized)',   type:'expense'},
    {code:'4006', nameKr:'외환환산이익', nameEn:'Forex Gain (Unrealized)', type:'revenue'},
    {code:'5017', nameKr:'외환환산손실', nameEn:'Forex Loss (Unrealized)', type:'expense'},
  ];
  let added = false;
  for (const n of needs) {
    if (!DB.accounts.find(a=>a.code===n.code)) {
      DB.accounts.push({id:'a'+n.code, ...n}); added = true;
    }
  }
  if (!DB.currencies) {
    DB.currencies = [...DEFAULT_CURRENCIES.map(c=>({...c}))];
    added = true;
  } else {
    // Ensure MYR exists
    if (!DB.currencies.find(c=>c.code==='MYR')) {
      DB.currencies.unshift({code:'MYR', name:'Malaysian Ringgit', symbol:'RM', base:true});
      added = true;
    }
  }
  if (!DB.exchangeRates) { DB.exchangeRates = []; added = true; }
  if (added) saveDB();
}

// Get exchange rate to MYR for a given currency on a date (closest prior rate)
function getExchangeRate(currency, date) {
  if (currency === 'MYR') return 1;
  const rates = DB.exchangeRates
    .filter(r=>r.currency===currency && r.date<=date)
    .sort((a,b)=>b.date.localeCompare(a.date));
  return rates[0]?.rate || null;
}

function setExchangeRate(currency, date, rate, note='') {
  ensureForexAccounts();
  if (!DB.exchangeRates) DB.exchangeRates = [];
  // Replace if same date+currency exists
  const existing = DB.exchangeRates.findIndex(r=>r.currency===currency && r.date===date);
  if (existing >= 0) DB.exchangeRates[existing] = {currency, date, rate, note};
  else DB.exchangeRates.push({currency, date, rate, note});
  saveDB();
}

// ── Currency Master + Exchange Rate Manager ──────────
function renderForexSettings() {
  ensureForexAccounts();
  const rates = [...DB.exchangeRates].sort((a,b)=>b.date.localeCompare(a.date) || a.currency.localeCompare(b.currency));
  const recentRates = {};
  for (const r of rates) {
    if (!recentRates[r.currency]) recentRates[r.currency] = r;
  }

  document.getElementById('forex-output').innerHTML = `
    <div class="card">
      <h3 style="margin-bottom:.75rem">💱 현재 환율 (최신, MYR 기준)</h3>
      <div class="cards-grid" style="grid-template-columns:repeat(5,1fr);gap:.5rem">
        ${DB.currencies.filter(c=>!c.base).map(c=>{
          const r = recentRates[c.code];
          return `<div class="stat-card" style="cursor:pointer" onclick="openRateModal('${c.code}')">
            <div class="label">${c.symbol} ${c.code}</div>
            <div class="value" style="font-size:1.1rem">${r?fmtN(r.rate):'<span style="color:#dc2626">미입력</span>'}</div>
            <div style="font-size:.65rem;color:var(--text-muted)">${r?r.date:'클릭하여 입력'}</div>
          </div>`;
        }).join('')}
      </div>
      <div style="margin-top:.75rem;text-align:right">
        <button class="btn btn-primary" onclick="openRateModal()">+ 환율 입력</button>
      </div>
    </div>

    <div class="card" style="margin-top:1rem">
      <h3 style="margin-bottom:.75rem">📅 환율 이력</h3>
      <table class="table" style="font-size:.82rem">
        <thead><tr><th>날짜</th><th>통화</th><th class="num">환율 (vs MYR)</th><th>메모</th><th></th></tr></thead>
        <tbody>
          ${rates.slice(0,30).map((r,i)=>`<tr>
            <td>${r.date}</td>
            <td><strong>${r.currency}</strong> ${DB.currencies.find(c=>c.code===r.currency)?.symbol||''}</td>
            <td class="num"><strong>${fmtN(r.rate)}</strong></td>
            <td style="font-size:.75rem;color:var(--text-muted)">${r.note||'—'}</td>
            <td><button class="btn btn-sm btn-danger" onclick="deleteRate('${r.currency}','${r.date}')">✕</button></td>
          </tr>`).join('') || '<tr><td colspan="5" class="empty-msg">환율 이력 없음</td></tr>'}
          ${rates.length > 30 ? `<tr><td colspan="5" style="text-align:center;font-size:.78rem;color:var(--text-muted)">... +${rates.length-30}건 더</td></tr>` : ''}
        </tbody>
      </table>
    </div>

    <div class="card" style="margin-top:1rem">
      <h3 style="margin-bottom:.75rem">💼 외화 거래 사용 방법</h3>
      <ol style="font-size:.82rem;color:var(--text-muted);line-height:1.7;padding-left:1.25rem">
        <li><strong>환율 입력:</strong> 거래일자별 환율을 먼저 등록 (e.g. 2025-07-15 USD = 4.5)</li>
        <li><strong>외화 송장 발행:</strong> Sales Invoice → 통화 선택 (예: USD) → 금액 입력
          <br>시스템이 자동으로 MYR 환산액 저장</li>
        <li><strong>외화 수령:</strong> Customer Receipt → 외화로 수령
          <br>수령일 환율과 송장 환율 차이 = 외환차익/손
          <br>분개: DR 은행 (수령일 MYR) / CR AR (송장 MYR) / CR 4005 (차익) 또는 DR 5016 (차손)</li>
        <li><strong>외화 계좌:</strong> 1002 외에 1007 (USD 계좌) 등 별도 계정 추가 권장
          <br>각 계정에 currency 필드 설정</li>
      </ol>
    </div>
  `;
}

function openRateModal(currency='') {
  document.getElementById('rate-currency').value = currency;
  document.getElementById('rate-date').value = today();
  document.getElementById('rate-value').value = '';
  document.getElementById('rate-note').value = '';
  // Populate currency dropdown
  const sel = document.getElementById('rate-currency');
  sel.innerHTML = DB.currencies.filter(c=>!c.base).map(c=>`<option value="${c.code}">${c.symbol} ${c.code} - ${c.name}</option>`).join('');
  if (currency) sel.value = currency;
  document.getElementById('modal-rate').style.display='flex';
}

function saveRate() {
  const currency = document.getElementById('rate-currency').value;
  const date = document.getElementById('rate-date').value;
  const rate = Number(document.getElementById('rate-value').value);
  const note = document.getElementById('rate-note').value.trim();
  if (!currency||!date||!rate) return alert('통화, 날짜, 환율 필수');
  if (rate <= 0) return alert('환율은 양수');
  setExchangeRate(currency, date, rate, note);
  closeModal('modal-rate');
  renderForexSettings();
}

function deleteRate(currency, date) {
  if (!confirm('이 환율을 삭제하시겠습니까?')) return;
  DB.exchangeRates = DB.exchangeRates.filter(r => !(r.currency===currency && r.date===date));
  saveDB();
  renderForexSettings();
}

// ── Foreign Currency Conversion Helper ───────────────
// Convert foreign amount to MYR using rate on date
function convertToMYR(amount, currency, date) {
  if (currency === 'MYR' || !currency) return amount;
  const rate = getExchangeRate(currency, date);
  if (!rate) return null;
  return amount * rate;
}

// Compute realized forex gain/loss when receipting in foreign currency
// invoice was issued at rateA (MYR/foreign), receipt comes in at rateB
// gain = foreignAmount × (rateB - rateA)  if from customer's perspective (rateB > rateA = gain for us)
// For customer receipt: we receive foreign currency, exchange at receipt rate to MYR
function calcForexGainLoss(foreignAmount, invoiceRate, receiptRate) {
  const expectedMYR = foreignAmount * invoiceRate;
  const actualMYR = foreignAmount * receiptRate;
  return actualMYR - expectedMYR;  // positive = gain
}

// ── Quick Forex Calculator UI ────────────────────────
function renderForexCalculator() {
  const sel = document.getElementById('fc-currency');
  if (sel) {
    sel.innerHTML = DB.currencies.filter(c=>!c.base).map(c=>`<option value="${c.code}">${c.symbol} ${c.code}</option>`).join('');
  }
  const dateEl = document.getElementById('fc-date');
  if (dateEl && !dateEl.value) dateEl.value = today();
  updateForexCalc();
}

function updateForexCalc() {
  const currency = document.getElementById('fc-currency')?.value;
  const date = document.getElementById('fc-date')?.value;
  const amount = Number(document.getElementById('fc-amount')?.value||0);
  if (!currency||!date) return;
  const rate = getExchangeRate(currency, date);
  const myr = rate ? amount * rate : null;
  const resultEl = document.getElementById('fc-result');
  if (resultEl) {
    resultEl.innerHTML = rate ? `
      <div style="font-size:.85rem;margin-bottom:.3rem">환율: <strong>1 ${currency} = ${fmtN(rate)} MYR</strong></div>
      <div style="font-size:1.4rem;font-weight:700;color:#0ea572">≈ MYR ${fmtN(myr)}</div>
    ` : `<div style="color:#dc2626;font-size:.85rem">⚠️ ${date} 기준 ${currency} 환율이 입력되지 않았습니다. <button class="btn btn-sm btn-outline" onclick="openRateModal('${currency}')">+ 환율 입력</button></div>`;
  }
}
