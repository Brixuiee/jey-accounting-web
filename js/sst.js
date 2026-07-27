'use strict';
// ======================================================
//  SST Summary Report — Malaysian Sales & Service Tax
// ======================================================

function renderSSTReport() {
  const from = document.getElementById('sst-from').value;
  const to   = document.getElementById('sst-to').value;
  if (!from||!to) return;
  const fromDate = `${from}-01`;
  const [ty, tm] = to.split('-');
  const lastDay = new Date(Number(ty), Number(tm), 0).getDate();
  const toDate = `${to}-${String(lastDay).padStart(2,'0')}`;

  // Output SST: from sales invoices in period
  const invs = DB.invoices.filter(i=>i.date>=fromDate && i.date<=toDate);
  const outputDetail = invs.map(i=>{
    const cust = getCustomer(i.customerId);
    return {
      date: i.date,
      ref: i.number,
      party: cust?cust.name:'—',
      taxable: i.subtotal||0,
      sst: i.sstTotal||0,
    };
  });
  const outputTaxable = outputDetail.reduce((s,r)=>s+r.taxable,0);
  const outputSst     = outputDetail.reduce((s,r)=>s+r.sst,0);

  // Input SST: from purchase bills
  const bills = DB.bills.filter(b=>b.date>=fromDate && b.date<=toDate);
  const inputDetail = bills.map(b=>{
    const sup = getSupplier(b.supplierId);
    return {
      date: b.date,
      ref: b.number,
      party: sup?sup.name:'—',
      taxable: b.subtotal||0,
      sst: b.sstTotal||0,
    };
  });
  const inputTaxable = inputDetail.reduce((s,r)=>s+r.taxable,0);
  const inputSst     = inputDetail.reduce((s,r)=>s+r.sst,0);
  const netPayable   = outputSst - inputSst;

  document.getElementById('sst-report').innerHTML = `
    <div class="report-title">
      <h2>${DB.settings.companyName}</h2>
      <p>SST Summary / 부가세 요약</p>
      <p>${fromDate} ~ ${toDate}</p>
      ${DB.settings.sstNo?`<p style="font-size:.78rem;color:var(--text-muted)">SST Reg No: ${DB.settings.sstNo}</p>`:''}
    </div>

    <div class="cards-grid" style="margin:1rem 0">
      <div class="stat-card"><div class="label">Output SST (매출세액)</div><div class="value positive">MYR ${fmtN(outputSst)}</div><div style="font-size:.7rem;color:var(--text-muted);margin-top:.2rem">Taxable: ${fmtN(outputTaxable)}</div></div>
      <div class="stat-card"><div class="label">Input SST (매입세액)</div><div class="value negative">MYR ${fmtN(inputSst)}</div><div style="font-size:.7rem;color:var(--text-muted);margin-top:.2rem">Taxable: ${fmtN(inputTaxable)}</div></div>
      <div class="stat-card"><div class="label">Net SST ${netPayable>=0?'Payable':'Refund'}</div><div class="value ${netPayable>=0?'negative':'positive'}">MYR ${fmtN(Math.abs(netPayable))}</div></div>
    </div>

    <h3 style="margin-top:1.5rem;font-size:1rem">Output Tax (Sales)</h3>
    <table class="table">
      <thead><tr><th>Date</th><th>Invoice</th><th>Customer</th><th class="num">Taxable (MYR)</th><th class="num">SST (MYR)</th></tr></thead>
      <tbody>
        ${outputDetail.map(r=>`<tr><td>${r.date}</td><td>${r.ref}</td><td>${r.party}</td><td class="num">${fmtN(r.taxable)}</td><td class="num">${fmtN(r.sst)}</td></tr>`).join('') || '<tr><td colspan="5" class="empty-msg">No sales in period.</td></tr>'}
        <tr style="font-weight:700;border-top:2px solid var(--text)"><td colspan="3">Total Output</td><td class="num">${fmtN(outputTaxable)}</td><td class="num">${fmtN(outputSst)}</td></tr>
      </tbody>
    </table>

    <h3 style="margin-top:1.5rem;font-size:1rem">Input Tax (Purchases)</h3>
    <table class="table">
      <thead><tr><th>Date</th><th>Ref.</th><th>Supplier</th><th class="num">Taxable (MYR)</th><th class="num">SST (MYR)</th></tr></thead>
      <tbody>
        ${inputDetail.map(r=>`<tr><td>${r.date}</td><td>${r.ref}</td><td>${r.party}</td><td class="num">${fmtN(r.taxable)}</td><td class="num">${fmtN(r.sst)}</td></tr>`).join('') || '<tr><td colspan="5" class="empty-msg">No purchases in period.</td></tr>'}
        <tr style="font-weight:700;border-top:2px solid var(--text)"><td colspan="3">Total Input</td><td class="num">${fmtN(inputTaxable)}</td><td class="num">${fmtN(inputSst)}</td></tr>
      </tbody>
    </table>`;
}
