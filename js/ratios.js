'use strict';
// ══════════════════════════════════════════════════════
//  Financial Ratios — 재무비율 분석
//  ----------------------------------------------------
//  4 카테고리:
//   • Profitability (수익성): Gross Margin, Net Margin, ROE, ROA
//   • Liquidity (유동성): Current Ratio, Quick Ratio
//   • Leverage (안정성): Debt-to-Equity, Equity Ratio
//   • Activity (활동성): AR Days, AP Days, Asset Turnover
// ══════════════════════════════════════════════════════

function computeRatios(asOfDate, fromDate) {
  fromDate = fromDate || `${Number(asOfDate.slice(0,4))-1}-${asOfDate.slice(5)}`;

  // Balance Sheet items (as of date)
  const totalAssets = DB.accounts.filter(a=>a.type==='asset' && !a.contra).reduce((s,a)=>s+accountBalance(a.id, asOfDate),0)
                    - DB.accounts.filter(a=>a.type==='asset' && a.contra).reduce((s,a)=>s+accountBalance(a.id, asOfDate),0);
  const totalLiab = DB.accounts.filter(a=>a.type==='liability').reduce((s,a)=>s+accountBalance(a.id, asOfDate),0);
  const totalEquity = DB.accounts.filter(a=>a.type==='equity').reduce((s,a)=>s+accountBalance(a.id, asOfDate),0);

  // Current Assets (1xxx, excluding 1500+ Fixed Assets)
  const currentAssets = DB.accounts.filter(a=>a.type==='asset' && !a.contra && Number(a.code) < 1500)
                          .reduce((s,a)=>s+accountBalance(a.id, asOfDate),0);
  // Current Liabilities (2xxx, all are typically current)
  const currentLiab = DB.accounts.filter(a=>a.type==='liability').reduce((s,a)=>s+accountBalance(a.id, asOfDate),0);
  // Inventory (1004)
  const inventoryAcc = DB.accounts.find(a=>a.code==='1004');
  const inventory = inventoryAcc ? accountBalance(inventoryAcc.id, asOfDate) : 0;
  // Cash + Bank
  const cashBank = DB.accounts.filter(a=>['1001','1002'].includes(a.code)).reduce((s,a)=>s+accountBalance(a.id, asOfDate),0);
  // AR
  const arAcc = DB.accounts.find(a=>a.code==='1003');
  const ar = arAcc ? accountBalance(arAcc.id, asOfDate) : 0;
  // AP
  const apAcc = DB.accounts.find(a=>a.code==='2001');
  const ap = apAcc ? accountBalance(apAcc.id, asOfDate) : 0;

  // P&L items (period)
  const revAccs = DB.accounts.filter(a=>a.type==='revenue');
  const expAccs = DB.accounts.filter(a=>a.type==='expense');
  const revenue = revAccs.reduce((s,a)=>{const r=accountBalanceRange(a.id,fromDate,asOfDate); return s+r.cr-r.dr;},0);
  const expenses = expAccs.reduce((s,a)=>{const r=accountBalanceRange(a.id,fromDate,asOfDate); return s+r.dr-r.cr;},0);
  // COGS (5001)
  const cogsAcc = DB.accounts.find(a=>a.code==='5001');
  const cogs = cogsAcc ? (accountBalanceRange(cogsAcc.id, fromDate, asOfDate).dr - accountBalanceRange(cogsAcc.id, fromDate, asOfDate).cr) : 0;
  const grossProfit = revenue - cogs;
  const netIncome = revenue - expenses;

  // Ratios
  const safe = (n,d) => d===0 ? null : n/d;
  const pct = (x) => x===null ? '—' : (x*100).toFixed(2) + '%';
  const days = (x) => x===null ? '—' : Math.round(x) + '일';
  const num = (x) => x===null ? '—' : x.toFixed(2);

  const ratios = {
    profitability: [
      {name:'Gross Margin (매출총이익률)', value: pct(safe(grossProfit, revenue)),
        benchmark: '커미션 사업: 보통 70~90%', formula:'(매출 − 매출원가) ÷ 매출'},
      {name:'Net Margin (순이익률)', value: pct(safe(netIncome, revenue)),
        benchmark: '5%~15% 평균', formula:'순이익 ÷ 매출'},
      {name:'ROA (총자산이익률)', value: pct(safe(netIncome, totalAssets)),
        benchmark: '5%+ 양호', formula:'순이익 ÷ 총자산'},
      {name:'ROE (자기자본이익률)', value: pct(safe(netIncome, totalEquity)),
        benchmark: '15%+ 양호', formula:'순이익 ÷ 자기자본'},
    ],
    liquidity: [
      {name:'Current Ratio (유동비율)', value: num(safe(currentAssets, currentLiab)),
        benchmark: '1.5~2.0 권장', formula:'유동자산 ÷ 유동부채'},
      {name:'Quick Ratio (당좌비율)', value: num(safe(currentAssets - inventory, currentLiab)),
        benchmark: '1.0+ 권장', formula:'(유동자산 − 재고) ÷ 유동부채'},
      {name:'Cash Ratio (현금비율)', value: num(safe(cashBank, currentLiab)),
        benchmark: '0.2+ 권장', formula:'(현금 + 은행) ÷ 유동부채'},
    ],
    leverage: [
      {name:'Debt-to-Equity (부채비율)', value: num(safe(totalLiab, totalEquity)),
        benchmark: '< 1.0 안정적', formula:'총부채 ÷ 자기자본'},
      {name:'Equity Ratio (자기자본비율)', value: pct(safe(totalEquity, totalAssets)),
        benchmark: '50%+ 양호', formula:'자기자본 ÷ 총자산'},
      {name:'Debt Ratio (부채비율 자산 대비)', value: pct(safe(totalLiab, totalAssets)),
        benchmark: '< 50% 양호', formula:'총부채 ÷ 총자산'},
    ],
    activity: [
      {name:'AR Days (매출채권 회수기간)', value: days(safe(ar * 365, revenue)),
        benchmark: '30~60일 권장', formula:'매출채권 ÷ (매출 ÷ 365)'},
      {name:'AP Days (매입채무 결제기간)', value: days(safe(ap * 365, expenses)),
        benchmark: '30~45일', formula:'매입채무 ÷ (비용 ÷ 365)'},
      {name:'Asset Turnover (총자산회전율)', value: num(safe(revenue, totalAssets)),
        benchmark: '> 0.5 활용도 양호', formula:'매출 ÷ 총자산'},
    ],
    raw: {revenue, cogs, grossProfit, expenses, netIncome,
          totalAssets, totalLiab, totalEquity,
          currentAssets, currentLiab, cashBank, ar, ap, inventory},
  };
  return ratios;
}

function renderRatios() {
  const dateEl = document.getElementById('ratio-date');
  const fromEl = document.getElementById('ratio-from');
  if (dateEl && !dateEl.value) dateEl.value = today();
  if (fromEl && !fromEl.value) fromEl.value = `${Number(today().slice(0,4))-1}-${today().slice(5)}`;
  const asOfDate = dateEl.value;
  const fromDate = fromEl.value;

  const r = computeRatios(asOfDate, fromDate);

  const rowBg = (val, good, ok, bad) => {
    if (val === '—') return '';
    const num = parseFloat(val);
    if (isNaN(num)) return '';
    return '';  // Could add color coding here based on benchmark
  };

  const categoryHtml = (title, color, ratios) => `
    <div class="card" style="border-top:4px solid ${color}">
      <h3 style="font-size:1rem;color:${color};margin-bottom:.75rem">${title}</h3>
      <table class="table" style="font-size:.85rem">
        <thead><tr><th>지표</th><th class="num">값</th><th>벤치마크</th><th>공식</th></tr></thead>
        <tbody>
          ${ratios.map(x=>`<tr>
            <td><strong>${x.name}</strong></td>
            <td class="num"><strong style="font-size:1rem;color:${color}">${x.value}</strong></td>
            <td style="font-size:.78rem;color:var(--text-muted)">${x.benchmark}</td>
            <td style="font-size:.72rem;color:var(--text-muted);font-family:monospace">${x.formula}</td>
          </tr>`).join('')}
        </tbody>
      </table>
    </div>
  `;

  document.getElementById('ratios-output').innerHTML = `
    <div class="report-title">
      <h2>${DB.settings.companyName}</h2>
      <p>Financial Ratio Analysis / 재무비율 분석</p>
      <p>P&L 기간: ${fromDate} ~ ${asOfDate} · B/S 기준일: ${asOfDate}</p>
    </div>

    <div class="cards-grid" style="grid-template-columns:repeat(4,1fr);gap:.5rem;margin:1rem 0">
      <div class="stat-card"><div class="label">매출</div><div class="value">MYR ${fmtN(r.raw.revenue)}</div></div>
      <div class="stat-card"><div class="label">순이익</div><div class="value ${r.raw.netIncome>=0?'positive':'negative'}">MYR ${fmtN(r.raw.netIncome)}</div></div>
      <div class="stat-card"><div class="label">총자산</div><div class="value">MYR ${fmtN(r.raw.totalAssets)}</div></div>
      <div class="stat-card"><div class="label">자기자본</div><div class="value">MYR ${fmtN(r.raw.totalEquity)}</div></div>
    </div>

    ${categoryHtml('💰 Profitability — 수익성', '#0ea572', r.profitability)}
    ${categoryHtml('💧 Liquidity — 유동성 (단기 지급능력)', '#2563a8', r.liquidity)}
    ${categoryHtml('⚖️ Leverage — 안정성 (재무구조)', '#d97706', r.leverage)}
    ${categoryHtml('🔄 Activity — 활동성 (자산 효율)', '#dc2626', r.activity)}

    <div class="card" style="margin-top:1rem;background:#f0fdf4">
      <h3 style="font-size:.95rem;margin-bottom:.5rem">💡 해석 가이드</h3>
      <ul style="font-size:.78rem;color:var(--text)#475569;line-height:1.7;padding-left:1.2rem">
        <li><strong>수익성:</strong> Net Margin이 5% 미만이면 비용 구조 점검. 커미션 사업은 보통 Gross Margin 70%+</li>
        <li><strong>유동성:</strong> Current Ratio 1.5+ 안정. 1.0 미만이면 단기 자금 위험</li>
        <li><strong>안정성:</strong> Debt-to-Equity 1.0 초과 시 부채 의존도 높음 — 추가 차입 신중</li>
        <li><strong>활동성:</strong> AR Days 60일 초과 시 회수 강화 필요. AP Days는 자금 활용 측면에서 30~45일이 이상적</li>
      </ul>
    </div>
  `;
}
