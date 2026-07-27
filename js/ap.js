'use strict';
// ======================================================
//  AP Module — Suppliers, Purchase Bills, Payments, Aging
// ======================================================

// ── Suppliers ─────────────────────────────────────────
function renderSuppliers() {
  const search = (document.getElementById('supplier-search')?.value||'').toLowerCase();
  let list = [...DB.suppliers].sort((a,b)=>(a.code||'').localeCompare(b.code||''));
  if (search) list = list.filter(s =>
    (s.name||'').toLowerCase().includes(search) ||
    (s.code||'').toLowerCase().includes(search)
  );
  const tbody = document.querySelector('#suppliers-table tbody');
  if (!tbody) return;
  tbody.innerHTML = list.length ? list.map(s=>{
    const bal = supplierOutstanding(s.id);
    return `<tr>
      <td><strong>${s.code||'—'}</strong></td>
      <td>${s.name||''}<div style="font-size:.7rem;color:var(--text-muted)">${s.regNo||''}</div></td>
      <td>${s.contact||'—'}<div style="font-size:.7rem;color:var(--text-muted)">${s.phone||''} ${s.email?'· '+s.email:''}</div></td>
      <td>${s.terms||0} days</td>
      <td class="num"><strong style="color:${bal>0?'#dc2626':'inherit'}">${fmtN(bal)}</strong></td>
      <td>
        <button class="btn btn-sm btn-outline" onclick="openSupplierModal('${s.id}')">Edit</button>
        <button class="btn btn-sm btn-danger" onclick="deleteSupplier('${s.id}')" style="margin-left:.25rem">Del</button>
      </td>
    </tr>`;
  }).join('') : '<tr><td colspan="6" class="empty-msg">No suppliers. Click "+ Add Supplier" or import from Mr. Accounting.</td></tr>';
}

function openSupplierModal(id=null) {
  const s = id ? getSupplier(id) : null;
  document.getElementById('supplier-modal-title').textContent = s ? 'Edit Supplier / 공급업체 수정' : 'Add Supplier / 공급업체 추가';
  const set = (k,v)=>{ const el=document.getElementById(k); if (el) el.value=v||''; };
  set('sup-code',     s?s.code:'');
  set('sup-name',     s?s.name:'');
  set('sup-reg',      s?s.regNo:'');
  set('sup-contact',  s?s.contact:'');
  set('sup-phone',    s?s.phone:'');
  set('sup-email',    s?s.email:'');
  set('sup-terms',    s?String(s.terms||30):'30');
  set('sup-address',  s?s.address:'');
  set('sup-edit-id',  s?s.id:'');
  const ca = document.getElementById('sup-commission-agent');
  if (ca) ca.checked = !!(s && s.isCommissionAgent);
  document.getElementById('modal-supplier').style.display='flex';
}

function saveSupplier() {
  const code = document.getElementById('sup-code').value.trim();
  const name = document.getElementById('sup-name').value.trim();
  const editId = document.getElementById('sup-edit-id').value;
  if (!code||!name) return alert('Supplier code and name are required.');
  if (!editId && DB.suppliers.find(s=>s.code===code)) return alert('Supplier code already exists.');
  const data = {
    code, name,
    regNo:   document.getElementById('sup-reg').value.trim(),
    contact: document.getElementById('sup-contact').value.trim(),
    phone:   document.getElementById('sup-phone').value.trim(),
    email:   document.getElementById('sup-email').value.trim(),
    terms:   Number(document.getElementById('sup-terms').value||30),
    address: document.getElementById('sup-address').value.trim(),
    isCommissionAgent: document.getElementById('sup-commission-agent')?.checked || false,
  };
  if (editId) Object.assign(getSupplier(editId), data);
  else DB.suppliers.push({id:uid(), ...data});
  saveDB(); closeModal('modal-supplier'); renderSuppliers(); populateAccountDropdowns();
}

function deleteSupplier(id) {
  if (DB.bills.some(b=>b.supplierId===id) || DB.payments.some(p=>p.supplierId===id))
    return alert('This supplier has bills or payments. Delete those first.');
  if (!confirm('Delete this supplier?')) return;
  DB.suppliers = DB.suppliers.filter(s=>s.id!==id);
  saveDB(); renderSuppliers(); populateAccountDropdowns();
}

// ── Purchase Bills ────────────────────────────────────
function renderBills() {
  const fs = document.getElementById('bill-filter-supplier')?.value;
  const fst = document.getElementById('bill-filter-status')?.value;
  const fm = document.getElementById('bill-filter-month')?.value;
  let list = [...DB.bills].sort((a,b)=>b.date.localeCompare(a.date));
  if (fs) list = list.filter(b=>b.supplierId===fs);
  if (fm) list = list.filter(b=>b.date.startsWith(fm));
  if (fst) list = list.filter(b=>billStatus(b)===fst);

  const tbody = document.querySelector('#bills-table tbody');
  if (!tbody) return;
  tbody.innerHTML = list.length ? list.map(b=>{
    const sup = getSupplier(b.supplierId);
    const status = billStatus(b);
    const balance = Number(b.total||0) - Number(b.paid||0);
    const statusLabel = {paid:'Paid', partial:'Partial', overdue:'Overdue', outstanding:'Outstanding'}[status];
    const statusColor = {paid:'#0ea572', partial:'#d97706', overdue:'#dc2626', outstanding:'#475569'}[status];
    return `<tr>
      <td><strong>${b.number}</strong></td>
      <td>${b.supInv||'—'}</td>
      <td>${b.date}</td>
      <td>${b.dueDate||'—'}</td>
      <td>${sup?sup.name:'—'}</td>
      <td class="num">${fmtN(b.total)}</td>
      <td class="num">${fmtN(b.paid||0)}</td>
      <td class="num"><strong>${fmtN(balance)}</strong></td>
      <td><span style="color:${statusColor};font-weight:600;font-size:.78rem">${statusLabel}</span></td>
      <td>
        <button class="btn btn-sm btn-outline" onclick="openBillModal('${b.id}')">Edit</button>
        <button class="btn btn-sm btn-danger" onclick="deleteBill('${b.id}')" style="margin-left:.25rem">Del</button>
      </td>
    </tr>`;
  }).join('') : '<tr><td colspan="10" class="empty-msg">No purchase invoices.</td></tr>';
}

let billLineCount = 0;
function openBillModal(id=null) {
  const b = id ? getBill(id) : null;
  document.getElementById('bill-modal-title').textContent = b ? 'Edit Purchase Invoice' : 'New Purchase Invoice';
  document.getElementById('bill-number').value   = b ? b.number : nextNumber('PV', DB.bills, today());
  document.getElementById('bill-sup-inv').value  = b ? (b.supInv||'') : '';
  document.getElementById('bill-date').value     = b ? b.date : today();
  document.getElementById('bill-due').value      = b ? (b.dueDate||'') : '';
  document.getElementById('bill-supplier').value = b ? b.supplierId : '';
  document.getElementById('bill-notes').value    = b ? (b.notes||'') : '';
  document.getElementById('bill-edit-id').value  = b ? b.id : '';
  document.getElementById('bill-lines').innerHTML = '';
  billLineCount = 0;
  if (b) b.lines.forEach(l=>addBillLine(l));
  else addBillLine();
  if (!b) calcBillDue();
  recalcBillTotals();
  document.getElementById('modal-bill').style.display='flex';
}

function addBillLine(data={}) {
  const idx = billLineCount++;
  const expenseAccs = DB.accounts.filter(a=>a.type==='expense'||a.type==='asset').sort((a,b)=>a.code.localeCompare(b.code));
  const opts = expenseAccs.map(a=>`<option value="${a.id}" ${a.id===data.accountId?'selected':''}>${a.code} ${a.nameEn||a.nameKr}</option>`).join('');
  const div = document.createElement('div');
  div.className = 'bill-line';
  div.id = `bill-line-${idx}`;
  div.innerHTML = `
    <input type="text"   class="input bill-desc"  placeholder="Description" style="flex:2" value="${data.desc||''}">
    <select class="input bill-account" style="flex:1.5"><option value="">-- Account --</option>${opts}</select>
    <input type="number" class="input bill-qty"   placeholder="1" step="0.01" min="0" style="flex:.8;text-align:right" value="${data.qty??1}" oninput="recalcBillLine('bill-line-${idx}')">
    <input type="number" class="input bill-price" placeholder="0.00" step="0.01" min="0" style="flex:1;text-align:right" value="${data.unitPrice??''}" oninput="recalcBillLine('bill-line-${idx}')">
    <input type="number" class="input bill-sst"   placeholder="0" step="0.01" min="0" max="20" style="flex:.8;text-align:right" value="${data.sstPct??(DB.settings.sstRegistered?DB.settings.sstRate:0)}" oninput="recalcBillLine('bill-line-${idx}')">
    <input type="text"   class="input bill-amt"   readonly style="flex:1;text-align:right;background:#f1f5f9" value="${fmtN(data.amount||0)}">
    <input type="text"   class="input bill-sstamt" readonly style="flex:.8;text-align:right;background:#f1f5f9" value="${fmtN(data.sstAmt||0)}">
    <button class="je-line-remove" onclick="removeBillLine('bill-line-${idx}')">✕</button>`;
  document.getElementById('bill-lines').appendChild(div);
  recalcBillLine(`bill-line-${idx}`);
}

function recalcBillLine(rowId) {
  const row = document.getElementById(rowId);
  if (!row) return;
  const qty = Number(row.querySelector('.bill-qty').value||0);
  const price = Number(row.querySelector('.bill-price').value||0);
  const sstPct = Number(row.querySelector('.bill-sst').value||0);
  const amt = qty * price;
  row.querySelector('.bill-amt').value = fmtN(amt);
  row.querySelector('.bill-sstamt').value = fmtN(amt * sstPct/100);
  recalcBillTotals();
}

function removeBillLine(id) { const el=document.getElementById(id); if (el) el.remove(); recalcBillTotals(); }

function recalcBillTotals() {
  let sub = 0, sst = 0;
  document.querySelectorAll('#bill-lines .bill-line').forEach(row=>{
    const qty = Number(row.querySelector('.bill-qty').value||0);
    const price = Number(row.querySelector('.bill-price').value||0);
    const sstPct = Number(row.querySelector('.bill-sst').value||0);
    const amt = qty * price;
    sub += amt;
    sst += amt * sstPct / 100;
  });
  document.getElementById('bill-subtotal').textContent = `MYR ${fmtN(sub)}`;
  document.getElementById('bill-sst-total').textContent = `MYR ${fmtN(sst)}`;
  document.getElementById('bill-grand-total').textContent = `MYR ${fmtN(sub+sst)}`;
}

function calcBillDue() {
  const date = document.getElementById('bill-date').value;
  const supId = document.getElementById('bill-supplier').value;
  const sup = getSupplier(supId);
  if (!date||!sup) return;
  const days = Number(sup.terms||30);
  const due = new Date(date); due.setDate(due.getDate()+days);
  document.getElementById('bill-due').value = due.toISOString().slice(0,10);
}

function getBillLines() {
  return [...document.querySelectorAll('#bill-lines .bill-line')].map(row=>{
    const desc = row.querySelector('.bill-desc').value.trim();
    const accountId = row.querySelector('.bill-account').value;
    const qty = Number(row.querySelector('.bill-qty').value||0);
    const unitPrice = Number(row.querySelector('.bill-price').value||0);
    const sstPct = Number(row.querySelector('.bill-sst').value||0);
    const amount = qty * unitPrice;
    const sstAmt = amount * sstPct/100;
    return {desc, accountId, qty, unitPrice, sstPct, amount, sstAmt};
  }).filter(l=>l.accountId && l.amount>0);
}

function saveBill() {
  const editId = document.getElementById('bill-edit-id').value;
  const number = document.getElementById('bill-number').value.trim();
  const supInv = document.getElementById('bill-sup-inv').value.trim();
  const date = document.getElementById('bill-date').value;
  const dueDate = document.getElementById('bill-due').value;
  const supplierId = document.getElementById('bill-supplier').value;
  const notes = document.getElementById('bill-notes').value.trim();
  if (!number||!date||!supplierId||!supInv) return alert('Number, date, supplier and supplier invoice no. are required.');
  const lines = getBillLines();
  if (!lines.length) return alert('Add at least one line item with an expense account.');
  const subtotal = lines.reduce((s,l)=>s+l.amount,0);
  const sstTotal = lines.reduce((s,l)=>s+l.sstAmt,0);
  const total = subtotal + sstTotal;

  let bill;
  if (editId) {
    bill = getBill(editId);
    Object.assign(bill, {number,supInv,date,dueDate,supplierId,notes,lines,subtotal,sstTotal,total});
  } else {
    bill = {id:uid(),number,supInv,date,dueDate,supplierId,notes,lines,subtotal,sstTotal,total,paid:0};
    DB.bills.push(bill);
  }
  postBillJournal(bill);
  saveDB(); closeModal('modal-bill'); renderBills();
}

function postBillJournal(bill) {
  const apAcc = DB.accounts.find(a=>a.id===DB.settings.defaultApAccount) || DB.accounts.find(a=>a.code==='2001');
  const sstInputAcc = DB.accounts.find(a=>a.id===DB.settings.defaultSstInput) || DB.accounts.find(a=>a.code==='1006');
  if (!apAcc) return;
  if (bill.journalEntryId) DB.entries = DB.entries.filter(e=>e.id!==bill.journalEntryId);

  const sup = getSupplier(bill.supplierId);
  const lines = [];
  bill.lines.forEach(l=>{ lines.push({accountId: l.accountId, debit: l.amount, credit: 0}); });
  if (bill.sstTotal > 0 && sstInputAcc) lines.push({accountId: sstInputAcc.id, debit: bill.sstTotal, credit: 0});
  lines.push({accountId: apAcc.id, debit: 0, credit: bill.total});

  const entry = {
    id: uid(), date: bill.date,
    reference: bill.number,
    description: `Purchase Invoice — ${sup?sup.name:''} (${bill.supInv})`,
    lines, source: 'bill', sourceId: bill.id,
  };
  DB.entries.push(entry);
  bill.journalEntryId = entry.id;
}

function deleteBill(id) {
  const b = getBill(id);
  if (!b) return;
  if ((b.paid||0)>0) return alert('Cannot delete bill with payments. Delete payments first.');
  if (!confirm(`Delete bill ${b.number}?`)) return;
  if (b.journalEntryId) DB.entries = DB.entries.filter(e=>e.id!==b.journalEntryId);
  DB.bills = DB.bills.filter(x=>x.id!==id);
  saveDB(); renderBills();
}

// ── Supplier Payments ─────────────────────────────────
function renderPayments() {
  const fs = document.getElementById('pay-filter-supplier')?.value;
  const fm = document.getElementById('pay-filter-month')?.value;
  let list = [...DB.payments].sort((a,b)=>b.date.localeCompare(a.date));
  if (fs) list = list.filter(p=>p.supplierId===fs);
  if (fm) list = list.filter(p=>p.date.startsWith(fm));
  const tbody = document.querySelector('#payments-table tbody');
  if (!tbody) return;
  tbody.innerHTML = list.length ? list.map(p=>{
    const sup = getSupplier(p.supplierId);
    const bank = getAccount(p.bankAccountId);
    return `<tr>
      <td><strong>${p.number}</strong></td>
      <td>${p.date}</td>
      <td>${sup?sup.name:'—'}</td>
      <td>${bank?bank.code+' '+(bank.nameEn||bank.nameKr):'—'}</td>
      <td class="num"><strong>${fmtN(p.totalAmount)}</strong></td>
      <td>
        <button class="btn btn-sm btn-outline" onclick="openPaymentModal('${p.id}')">Edit</button>
        <button class="btn btn-sm btn-danger" onclick="deletePayment('${p.id}')" style="margin-left:.25rem">Del</button>
      </td>
    </tr>`;
  }).join('') : '<tr><td colspan="6" class="empty-msg">No payments.</td></tr>';
}

function openPaymentModal(id=null) {
  // Inject WHT selector if module is loaded
  if (typeof injectWHTSelectorIntoPaymentModal === 'function') injectWHTSelectorIntoPaymentModal();
  const p = id ? DB.payments.find(x=>x.id===id) : null;
  document.getElementById('payment-modal-title').textContent = p ? 'Edit Payment' : 'New Supplier Payment';
  document.getElementById('pay-number').value   = p ? p.number : nextNumber('PY', DB.payments, today());
  document.getElementById('pay-date').value     = p ? p.date : today();
  document.getElementById('pay-supplier').value = p ? p.supplierId : '';
  document.getElementById('pay-bank').value     = p ? p.bankAccountId : (DB.settings.defaultBankAccount||'');
  document.getElementById('pay-method').value   = p ? (p.method||'Bank Transfer') : 'Bank Transfer';
  document.getElementById('pay-cheque').value   = p ? (p.chequeNo||'') : '';
  document.getElementById('pay-notes').value    = p ? (p.notes||'') : '';
  document.getElementById('pay-edit-id').value  = p ? p.id : '';
  if (p) loadPaymentBills(p.allocations);
  else loadPaymentBills();
  document.getElementById('modal-payment').style.display='flex';
}

function loadPaymentBills(existingAllocs=null) {
  const supId = document.getElementById('pay-supplier').value;
  const editId = document.getElementById('pay-edit-id').value;
  const section = document.getElementById('pay-allocations-section');
  const wrap = document.getElementById('pay-allocations');
  if (!supId) { section.style.display='none'; return; }
  const editingPayment = editId ? DB.payments.find(p=>p.id===editId) : null;
  const allocByBill = {};
  (existingAllocs||editingPayment?.allocations||[]).forEach(a=>{ allocByBill[a.billId]=a.amount; });

  const bills = DB.bills.filter(b=>{
    if (b.supplierId !== supId) return false;
    const bal = Number(b.total||0) - Number(b.paid||0) + (allocByBill[b.id]||0);
    return bal > 0.001 || allocByBill[b.id];
  }).sort((a,b)=>a.date.localeCompare(b.date));

  if (!bills.length) { wrap.innerHTML = '<p style="font-size:.82rem;color:var(--text-muted);padding:.5rem 0">No outstanding bills for this supplier.</p><div class="form-group"><label>On-account amount (MYR)</label><input type="number" class="input" id="pay-onaccount" step="0.01" min="0" value="0" oninput="updatePaymentTotal()"></div>'; section.style.display='block'; updatePaymentTotal(); return; }

  wrap.innerHTML = `
    <div style="display:grid;grid-template-columns:1.2fr 1.2fr .8fr 1fr 1fr;gap:.5rem;font-size:.75rem;font-weight:600;color:var(--text-muted);padding:.4rem 0;border-bottom:1px solid var(--border)">
      <span>Our Ref.</span><span>Sup. Inv.</span><span>Date</span><span class="num">Outstanding</span><span class="num">Allocate</span>
    </div>
    ${bills.map(b=>{
      const bal = Number(b.total||0) - Number(b.paid||0) + (allocByBill[b.id]||0);
      return `<div class="pay-alloc-row" data-bill="${b.id}" style="display:grid;grid-template-columns:1.2fr 1.2fr .8fr 1fr 1fr;gap:.5rem;align-items:center;padding:.4rem 0;font-size:.85rem">
        <span><strong>${b.number}</strong></span>
        <span>${b.supInv||'—'}</span>
        <span>${b.date}</span>
        <span class="num">${fmtN(bal)}</span>
        <input type="number" class="input pay-alloc-amt" step="0.01" min="0" max="${bal}" value="${allocByBill[b.id]||0}" oninput="updatePaymentTotal()" style="text-align:right">
      </div>`;
    }).join('')}
    <div class="form-group" style="margin-top:.75rem"><label style="font-size:.78rem">On-account / Excess (MYR)</label><input type="number" class="input" id="pay-onaccount" step="0.01" min="0" value="0" oninput="updatePaymentTotal()"></div>`;
  section.style.display='block';
  updatePaymentTotal();
}

function updatePaymentTotal() {
  let total = 0;
  document.querySelectorAll('.pay-alloc-amt').forEach(i=>total += Number(i.value||0));
  total += Number(document.getElementById('pay-onaccount')?.value||0);
  document.getElementById('pay-total-display').textContent = `MYR ${fmtN(total)}`;
}

function getPaymentAllocations() {
  const allocs = [];
  document.querySelectorAll('.pay-alloc-row').forEach(row=>{
    const amt = Number(row.querySelector('.pay-alloc-amt').value||0);
    if (amt > 0) allocs.push({billId: row.dataset.bill, amount: amt});
  });
  return allocs;
}

function savePayment() {
  const editId = document.getElementById('pay-edit-id').value;
  const number = document.getElementById('pay-number').value.trim();
  const date = document.getElementById('pay-date').value;
  const supplierId = document.getElementById('pay-supplier').value;
  const bankAccountId = document.getElementById('pay-bank').value;
  if (!number||!date||!supplierId||!bankAccountId) return alert('Number, date, supplier and bank account are required.');
  const allocations = getPaymentAllocations();
  const onAccount = Number(document.getElementById('pay-onaccount')?.value||0);
  const totalAmount = allocations.reduce((s,a)=>s+a.amount,0) + onAccount;
  if (totalAmount<=0) return alert('Payment amount must be greater than zero.');

  if (editId) {
    const old = DB.payments.find(p=>p.id===editId);
    if (old) old.allocations.forEach(a=>{ const b=getBill(a.billId); if (b) b.paid = Math.max(0, Number(b.paid||0)-a.amount); });
  }
  allocations.forEach(a=>{ const b=getBill(a.billId); if (b) b.paid = Number(b.paid||0)+a.amount; });

  const pay = {
    id: editId || uid(),
    number, date, supplierId, bankAccountId,
    method: document.getElementById('pay-method').value,
    chequeNo: document.getElementById('pay-cheque').value.trim(),
    notes: document.getElementById('pay-notes').value.trim(),
    allocations, onAccount, totalAmount,
  };
  if (editId) Object.assign(DB.payments.find(p=>p.id===editId), pay);
  else DB.payments.push(pay);
  postPaymentJournal(pay);
  saveDB(); closeModal('modal-payment'); renderPayments(); renderBills();
}

function postPaymentJournal(pay) {
  const apAcc = DB.accounts.find(a=>a.id===DB.settings.defaultApAccount) || DB.accounts.find(a=>a.code==='2001');
  if (!apAcc) return;
  const old = DB.entries.find(e=>e.source==='payment' && e.sourceId===pay.id);
  if (old) DB.entries = DB.entries.filter(e=>e.id!==old.id);

  const sup = getSupplier(pay.supplierId);
  const lines = [
    {accountId: apAcc.id, debit: pay.totalAmount, credit: 0},
    {accountId: pay.bankAccountId, debit: 0, credit: pay.totalAmount},
  ];
  DB.entries.push({
    id: uid(), date: pay.date,
    reference: pay.number,
    description: `Payment — ${sup?sup.name:''}${pay.chequeNo?' (Chq '+pay.chequeNo+')':''}`,
    lines, source: 'payment', sourceId: pay.id,
  });
}

function deletePayment(id) {
  const p = DB.payments.find(x=>x.id===id);
  if (!p) return;
  if (!confirm(`Delete payment ${p.number}?`)) return;
  p.allocations.forEach(a=>{ const b=getBill(a.billId); if (b) b.paid = Math.max(0, Number(b.paid||0)-a.amount); });
  DB.entries = DB.entries.filter(e=>!(e.source==='payment' && e.sourceId===id));
  DB.payments = DB.payments.filter(x=>x.id!==id);
  saveDB(); renderPayments(); renderBills();
}

// ── AP Aging ──────────────────────────────────────────
function renderAPaging() {
  const date = document.getElementById('ap-aging-date').value || today();
  const rows = DB.suppliers.map(s=>{
    const bills = DB.bills.filter(b=>b.supplierId===s.id && b.date<=date);
    const cells = [0,0,0,0,0];
    bills.forEach(b=>{
      const bal = Number(b.total||0) - Number(b.paid||0);
      if (bal <= 0.001) return;
      const ageDays = Math.floor((new Date(date) - new Date(b.dueDate||b.date))/86400000);
      let bucket;
      if (ageDays <= 30) bucket = 0;
      else if (ageDays <= 60) bucket = 1;
      else if (ageDays <= 90) bucket = 2;
      else bucket = 3;
      cells[bucket] += bal;
      cells[4] += bal;
    });
    return {sup:s, cells};
  }).filter(r=>r.cells[4]>0.001);
  const totals = [0,0,0,0,0];
  rows.forEach(r=>r.cells.forEach((v,i)=>totals[i]+=v));

  document.getElementById('ap-aging-report').innerHTML = `
    <div class="report-title">
      <h2>${DB.settings.companyName}</h2>
      <p>AP Aging Report / 매입채무 연령분석</p>
      <p>As of ${date}</p>
    </div>
    <table class="table">
      <thead><tr>
        <th>Supplier</th>
        <th class="num">Current (0-30)</th>
        <th class="num">31-60 days</th>
        <th class="num">61-90 days</th>
        <th class="num">Over 90</th>
        <th class="num">Total Outstanding</th>
      </tr></thead>
      <tbody>
        ${rows.map(r=>`<tr>
          <td><strong>${r.sup.code}</strong> ${r.sup.name}</td>
          <td class="num">${r.cells[0]>0?fmtN(r.cells[0]):''}</td>
          <td class="num">${r.cells[1]>0?fmtN(r.cells[1]):''}</td>
          <td class="num">${r.cells[2]>0?fmtN(r.cells[2]):''}</td>
          <td class="num" style="color:#dc2626">${r.cells[3]>0?fmtN(r.cells[3]):''}</td>
          <td class="num"><strong>${fmtN(r.cells[4])}</strong></td>
        </tr>`).join('')||'<tr><td colspan="6" class="empty-msg">No outstanding payables.</td></tr>'}
        <tr style="border-top:2px solid var(--text);font-weight:700;background:#f8fafc">
          <td>Total / 합계</td>
          ${totals.map(v=>`<td class="num">${fmtN(v)}</td>`).join('')}
        </tr>
      </tbody>
    </table>`;
}
