'use strict';
// ======================================================
//  AR Module — Customers, Sales Invoices, Receipts, Aging
// ======================================================

// ── Customers ─────────────────────────────────────────
function renderCustomers() {
  const search = (document.getElementById('customer-search')?.value||'').toLowerCase();
  let list = [...DB.customers].sort((a,b)=>(a.code||'').localeCompare(b.code||''));
  if (search) list = list.filter(c =>
    (c.name||'').toLowerCase().includes(search) ||
    (c.code||'').toLowerCase().includes(search)
  );
  const tbody = document.querySelector('#customers-table tbody');
  if (!tbody) return;
  tbody.innerHTML = list.length ? list.map(c=>{
    const bal = customerOutstanding(c.id);
    return `<tr>
      <td><strong>${c.code||'—'}</strong></td>
      <td>${c.name||''}<div style="font-size:.7rem;color:var(--text-muted)">${c.regNo||''}</div></td>
      <td>${c.contact||'—'}<div style="font-size:.7rem;color:var(--text-muted)">${c.phone||''} ${c.email?'· '+c.email:''}</div></td>
      <td class="num">${fmtN(c.creditLimit||0)}</td>
      <td class="num"><strong style="color:${bal>0?'#dc2626':'inherit'}">${fmtN(bal)}</strong></td>
      <td>
        <button class="btn btn-sm btn-outline" onclick="openCustomerModal('${c.id}')">Edit</button>
        <button class="btn btn-sm btn-danger" onclick="deleteCustomer('${c.id}')" style="margin-left:.25rem">Del</button>
      </td>
    </tr>`;
  }).join('') : '<tr><td colspan="6" class="empty-msg">No customers. Click "+ Add Customer" or import from Mr. Accounting.</td></tr>';
}

function openCustomerModal(id=null) {
  const c = id ? getCustomer(id) : null;
  document.getElementById('customer-modal-title').textContent = c ? 'Edit Customer / 고객 수정' : 'Add Customer / 고객 추가';
  const set = (k,v)=>{ const el=document.getElementById(k); if (el) el.value=v||''; };
  set('cust-code',     c?c.code:'');
  set('cust-name',     c?c.name:'');
  set('cust-reg',      c?c.regNo:'');
  set('cust-contact',  c?c.contact:'');
  set('cust-phone',    c?c.phone:'');
  set('cust-email',    c?c.email:'');
  set('cust-credit',   c?c.creditLimit:'');
  set('cust-terms',    c?String(c.terms||30):'30');
  set('cust-address',  c?c.address:'');
  set('cust-edit-id',  c?c.id:'');
  document.getElementById('modal-customer').style.display='flex';
}

function saveCustomer() {
  const code = document.getElementById('cust-code').value.trim();
  const name = document.getElementById('cust-name').value.trim();
  const editId = document.getElementById('cust-edit-id').value;
  if (!code||!name) return alert('Customer code and name are required.');
  if (!editId && DB.customers.find(c=>c.code===code)) return alert('Customer code already exists.');
  const data = {
    code, name,
    regNo:    document.getElementById('cust-reg').value.trim(),
    contact:  document.getElementById('cust-contact').value.trim(),
    phone:    document.getElementById('cust-phone').value.trim(),
    email:    document.getElementById('cust-email').value.trim(),
    creditLimit: Number(document.getElementById('cust-credit').value||0),
    terms:    Number(document.getElementById('cust-terms').value||30),
    address:  document.getElementById('cust-address').value.trim(),
  };
  if (editId) Object.assign(getCustomer(editId), data);
  else DB.customers.push({id:uid(), ...data});
  saveDB(); closeModal('modal-customer'); renderCustomers(); populateAccountDropdowns();
}

function deleteCustomer(id) {
  if (DB.invoices.some(i=>i.customerId===id) || DB.receipts.some(r=>r.customerId===id))
    return alert('This customer has invoices or receipts. Delete those first.');
  if (!confirm('Delete this customer?')) return;
  DB.customers = DB.customers.filter(c=>c.id!==id);
  saveDB(); renderCustomers(); populateAccountDropdowns();
}

// ── Sales Invoices ────────────────────────────────────
function renderInvoices() {
  const fc = document.getElementById('inv-filter-customer')?.value;
  const fs = document.getElementById('inv-filter-status')?.value;
  const fm = document.getElementById('inv-filter-month')?.value;
  let list = [...DB.invoices].sort((a,b)=>b.date.localeCompare(a.date));
  if (fc) list = list.filter(i=>i.customerId===fc);
  if (fm) list = list.filter(i=>i.date.startsWith(fm));
  if (fs) list = list.filter(i=>invoiceStatus(i)===fs);

  const tbody = document.querySelector('#invoices-table tbody');
  if (!tbody) return;
  tbody.innerHTML = list.length ? list.map(i=>{
    const cust = getCustomer(i.customerId);
    const status = invoiceStatus(i);
    const balance = Number(i.total||0) - Number(i.paid||0);
    const statusLabel = {paid:'Paid', partial:'Partial', overdue:'Overdue', outstanding:'Outstanding'}[status];
    const statusColor = {paid:'#0ea572', partial:'#d97706', overdue:'#dc2626', outstanding:'#475569'}[status];
    return `<tr>
      <td><strong>${i.number}</strong></td>
      <td>${i.date}</td>
      <td>${i.dueDate||'—'}</td>
      <td>${cust?cust.name:'—'}</td>
      <td class="num">${fmtN(i.total)}</td>
      <td class="num">${fmtN(i.paid||0)}</td>
      <td class="num"><strong>${fmtN(balance)}</strong></td>
      <td><span style="color:${statusColor};font-weight:600;font-size:.78rem">${statusLabel}</span></td>
      <td>
        <button class="btn btn-sm btn-outline" onclick="openInvoiceModal('${i.id}')">Edit</button>
        <button class="btn btn-sm btn-danger" onclick="deleteInvoice('${i.id}')" style="margin-left:.25rem">Del</button>
      </td>
    </tr>`;
  }).join('') : '<tr><td colspan="9" class="empty-msg">No invoices.</td></tr>';
}

let invLineCount = 0;
function openInvoiceModal(id=null) {
  const inv = id ? getInvoice(id) : null;
  document.getElementById('invoice-modal-title').textContent = inv ? 'Edit Sales Invoice' : 'New Sales Invoice';
  document.getElementById('inv-number').value   = inv ? inv.number : nextNumber('INV', DB.invoices, today());
  document.getElementById('inv-date').value     = inv ? inv.date : today();
  document.getElementById('inv-due').value      = inv ? (inv.dueDate||'') : '';
  document.getElementById('inv-customer').value = inv ? inv.customerId : '';
  document.getElementById('inv-ref').value      = inv ? (inv.ref||'') : '';
  document.getElementById('inv-notes').value    = inv ? (inv.notes||'') : '';
  document.getElementById('inv-edit-id').value  = inv ? inv.id : '';
  document.getElementById('inv-lines').innerHTML = '';
  invLineCount = 0;
  if (inv) inv.lines.forEach(l=>addInvLine(l));
  else addInvLine();
  if (!inv) calcInvDue();
  recalcInvTotals();
  document.getElementById('modal-invoice').style.display='flex';
}

function addInvLine(data={}) {
  const idx = invLineCount++;
  const div = document.createElement('div');
  div.className = 'inv-line';
  div.id = `inv-line-${idx}`;
  div.innerHTML = `
    <input type="text"   class="input inv-desc"  placeholder="Description" style="flex:3" value="${data.desc||''}">
    <input type="number" class="input inv-qty"   placeholder="1" step="0.01" min="0" style="flex:.8;text-align:right" value="${data.qty??1}" oninput="recalcInvLine('inv-line-${idx}')">
    <input type="number" class="input inv-price" placeholder="0.00" step="0.01" min="0" style="flex:1;text-align:right" value="${data.unitPrice??''}" oninput="recalcInvLine('inv-line-${idx}')">
    <input type="number" class="input inv-sst"   placeholder="0" step="0.01" min="0" max="20" style="flex:.8;text-align:right" value="${data.sstPct??(DB.settings.sstRegistered?DB.settings.sstRate:0)}" oninput="recalcInvLine('inv-line-${idx}')">
    <input type="text"   class="input inv-amt"   readonly style="flex:1;text-align:right;background:#f1f5f9" value="${fmtN(data.amount||0)}">
    <input type="text"   class="input inv-sstamt" readonly style="flex:.8;text-align:right;background:#f1f5f9" value="${fmtN(data.sstAmt||0)}">
    <button class="je-line-remove" onclick="removeInvLine('inv-line-${idx}')">✕</button>`;
  document.getElementById('inv-lines').appendChild(div);
  recalcInvLine(`inv-line-${idx}`);
}

function recalcInvLine(rowId) {
  const row = document.getElementById(rowId);
  if (!row) return;
  const qty = Number(row.querySelector('.inv-qty').value||0);
  const price = Number(row.querySelector('.inv-price').value||0);
  const sstPct = Number(row.querySelector('.inv-sst').value||0);
  const amount = qty * price;
  const sstAmt = amount * sstPct / 100;
  row.querySelector('.inv-amt').value = fmtN(amount);
  row.querySelector('.inv-sstamt').value = fmtN(sstAmt);
  recalcInvTotals();
}

function removeInvLine(id) { const el=document.getElementById(id); if (el) el.remove(); recalcInvTotals(); }

function recalcInvTotals() {
  let sub = 0, sst = 0;
  document.querySelectorAll('#inv-lines .inv-line').forEach(row=>{
    const qty = Number(row.querySelector('.inv-qty').value||0);
    const price = Number(row.querySelector('.inv-price').value||0);
    const sstPct = Number(row.querySelector('.inv-sst').value||0);
    const amt = qty * price;
    sub += amt;
    sst += amt * sstPct / 100;
  });
  document.getElementById('inv-subtotal').textContent = `MYR ${fmtN(sub)}`;
  document.getElementById('inv-sst-total').textContent = `MYR ${fmtN(sst)}`;
  document.getElementById('inv-grand-total').textContent = `MYR ${fmtN(sub+sst)}`;
}

function calcInvDue() {
  const date = document.getElementById('inv-date').value;
  const custId = document.getElementById('inv-customer').value;
  const cust = getCustomer(custId);
  if (!date || !cust) return;
  const days = Number(cust.terms||30);
  const due = new Date(date); due.setDate(due.getDate() + days);
  document.getElementById('inv-due').value = due.toISOString().slice(0,10);
}

function getInvLines() {
  return [...document.querySelectorAll('#inv-lines .inv-line')].map(row=>{
    const qty = Number(row.querySelector('.inv-qty').value||0);
    const price = Number(row.querySelector('.inv-price').value||0);
    const sstPct = Number(row.querySelector('.inv-sst').value||0);
    const desc = row.querySelector('.inv-desc').value.trim();
    const amount = qty * price;
    const sstAmt = amount * sstPct / 100;
    return {desc, qty, unitPrice: price, sstPct, amount, sstAmt};
  }).filter(l=>l.desc||l.amount>0);
}

function saveInvoice() {
  const editId = document.getElementById('inv-edit-id').value;
  const number = document.getElementById('inv-number').value.trim();
  const date = document.getElementById('inv-date').value;
  const dueDate = document.getElementById('inv-due').value;
  const customerId = document.getElementById('inv-customer').value;
  const ref = document.getElementById('inv-ref').value.trim();
  const notes = document.getElementById('inv-notes').value.trim();
  if (!number||!date||!customerId) return alert('Invoice number, date and customer are required.');
  const lines = getInvLines();
  if (!lines.length) return alert('Add at least one line item.');
  const subtotal = lines.reduce((s,l)=>s+l.amount,0);
  const sstTotal = lines.reduce((s,l)=>s+l.sstAmt,0);
  const total = subtotal + sstTotal;

  let invoice;
  if (editId) {
    invoice = getInvoice(editId);
    Object.assign(invoice, {number,date,dueDate,customerId,ref,notes,lines,subtotal,sstTotal,total});
  } else {
    invoice = {id:uid(),number,date,dueDate,customerId,ref,notes,lines,subtotal,sstTotal,total,paid:0};
    DB.invoices.push(invoice);
  }
  // Generate / update journal entry
  postInvoiceJournal(invoice);
  saveDB(); closeModal('modal-invoice'); renderInvoices();
}

function postInvoiceJournal(inv) {
  const arAcc = DB.accounts.find(a=>a.id===DB.settings.defaultArAccount) || DB.accounts.find(a=>a.code==='1003');
  // Revenue account priority: inv.revenueAccountId > first line accountId > settings default > 4001
  let salesAcc = null;
  if (inv.revenueAccountId)  salesAcc = DB.accounts.find(a=>a.id===inv.revenueAccountId);
  if (!salesAcc && inv.lines?.[0]?.accountId) salesAcc = DB.accounts.find(a=>a.id===inv.lines[0].accountId);
  if (!salesAcc) salesAcc = DB.accounts.find(a=>a.id===DB.settings.defaultSalesAccount);
  if (!salesAcc) salesAcc = DB.accounts.find(a=>a.code==='4001');
  const sstAcc = DB.accounts.find(a=>a.id===DB.settings.defaultSstOutput) || DB.accounts.find(a=>a.code==='2002');
  if (!arAcc||!salesAcc) return;

  // Remove old auto-entry if exists
  if (inv.journalEntryId) DB.entries = DB.entries.filter(e=>e.id!==inv.journalEntryId);

  const cust = getCustomer(inv.customerId);
  const lines = [
    {accountId: arAcc.id, debit: inv.total, credit: 0},
    {accountId: salesAcc.id, debit: 0, credit: inv.subtotal},
  ];
  if (inv.sstTotal > 0 && sstAcc) lines.push({accountId: sstAcc.id, debit: 0, credit: inv.sstTotal});

  const entry = {
    id: uid(), date: inv.date,
    reference: inv.number,
    description: `Sales Invoice — ${cust?cust.name:''}`,
    lines, source: 'invoice', sourceId: inv.id,
  };
  DB.entries.push(entry);
  inv.journalEntryId = entry.id;
}

function deleteInvoice(id) {
  const inv = getInvoice(id);
  if (!inv) return;
  if ((inv.paid||0) > 0) return alert('Cannot delete invoice with receipts. Delete receipts first.');
  if (!confirm(`Delete invoice ${inv.number}?`)) return;
  if (inv.journalEntryId) DB.entries = DB.entries.filter(e=>e.id!==inv.journalEntryId);
  DB.invoices = DB.invoices.filter(x=>x.id!==id);
  saveDB(); renderInvoices();
}

// ── Customer Receipts ─────────────────────────────────
function renderReceipts() {
  const fc = document.getElementById('rcpt-filter-customer')?.value;
  const fm = document.getElementById('rcpt-filter-month')?.value;
  let list = [...DB.receipts].sort((a,b)=>b.date.localeCompare(a.date));
  if (fc) list = list.filter(r=>r.customerId===fc);
  if (fm) list = list.filter(r=>r.date.startsWith(fm));
  const tbody = document.querySelector('#receipts-table tbody');
  if (!tbody) return;
  tbody.innerHTML = list.length ? list.map(r=>{
    const cust = getCustomer(r.customerId);
    const bank = getAccount(r.bankAccountId);
    return `<tr>
      <td><strong>${r.number}</strong></td>
      <td>${r.date}</td>
      <td>${cust?cust.name:'—'}</td>
      <td>${bank?bank.code+' '+(bank.nameEn||bank.nameKr):'—'}</td>
      <td class="num"><strong>${fmtN(r.totalAmount)}</strong></td>
      <td>
        <button class="btn btn-sm btn-outline" onclick="openReceiptModal('${r.id}')">Edit</button>
        <button class="btn btn-sm btn-danger" onclick="deleteReceipt('${r.id}')" style="margin-left:.25rem">Del</button>
      </td>
    </tr>`;
  }).join('') : '<tr><td colspan="6" class="empty-msg">No receipts.</td></tr>';
}

function openReceiptModal(id=null) {
  const r = id ? DB.receipts.find(x=>x.id===id) : null;
  document.getElementById('receipt-modal-title').textContent = r ? 'Edit Receipt' : 'New Customer Receipt';
  document.getElementById('rcpt-number').value   = r ? r.number : nextNumber('OR', DB.receipts, today());
  document.getElementById('rcpt-date').value     = r ? r.date : today();
  document.getElementById('rcpt-customer').value = r ? r.customerId : '';
  document.getElementById('rcpt-bank').value     = r ? r.bankAccountId : (DB.settings.defaultBankAccount||'');
  document.getElementById('rcpt-method').value   = r ? (r.method||'Bank Transfer') : 'Bank Transfer';
  document.getElementById('rcpt-cheque').value   = r ? (r.chequeNo||'') : '';
  document.getElementById('rcpt-notes').value    = r ? (r.notes||'') : '';
  document.getElementById('rcpt-edit-id').value  = r ? r.id : '';
  if (r) loadReceiptInvoices(r.allocations);
  else loadReceiptInvoices();
  document.getElementById('modal-receipt').style.display='flex';
}

function loadReceiptInvoices(existingAllocs=null) {
  const custId = document.getElementById('rcpt-customer').value;
  const editId = document.getElementById('rcpt-edit-id').value;
  const section = document.getElementById('rcpt-allocations-section');
  const wrap = document.getElementById('rcpt-allocations');
  if (!custId) { section.style.display='none'; return; }
  // Outstanding invoices for this customer (or include any invoices already allocated by this receipt)
  const editingReceipt = editId ? DB.receipts.find(r=>r.id===editId) : null;
  const allocByInv = {};
  (existingAllocs||editingReceipt?.allocations||[]).forEach(a=>{ allocByInv[a.invoiceId]=a.amount; });

  const invs = DB.invoices.filter(inv=>{
    if (inv.customerId !== custId) return false;
    const bal = Number(inv.total||0) - Number(inv.paid||0) + (allocByInv[inv.id]||0);
    return bal > 0.001 || allocByInv[inv.id];
  }).sort((a,b)=>a.date.localeCompare(b.date));

  if (!invs.length) { wrap.innerHTML = '<p style="font-size:.82rem;color:var(--text-muted);padding:.5rem 0">No outstanding invoices for this customer. You can still record an on-account receipt below.</p><div class="form-group"><label>On-account amount (MYR)</label><input type="number" class="input" id="rcpt-onaccount" step="0.01" min="0" value="0" oninput="updateReceiptTotal()"></div>'; section.style.display='block'; updateReceiptTotal(); return; }

  wrap.innerHTML = `
    <div style="display:grid;grid-template-columns:1.2fr .8fr .8fr 1fr 1fr;gap:.5rem;font-size:.75rem;font-weight:600;color:var(--text-muted);padding:.4rem 0;border-bottom:1px solid var(--border)">
      <span>Invoice No.</span><span>Date</span><span class="num">Total</span><span class="num">Outstanding</span><span class="num">Allocate</span>
    </div>
    ${invs.map(inv=>{
      const bal = Number(inv.total||0) - Number(inv.paid||0) + (allocByInv[inv.id]||0);
      return `<div class="rcpt-alloc-row" data-inv="${inv.id}" style="display:grid;grid-template-columns:1.2fr .8fr .8fr 1fr 1fr;gap:.5rem;align-items:center;padding:.4rem 0;font-size:.85rem">
        <span><strong>${inv.number}</strong></span>
        <span>${inv.date}</span>
        <span class="num">${fmtN(inv.total)}</span>
        <span class="num">${fmtN(bal)}</span>
        <input type="number" class="input rcpt-alloc-amt" step="0.01" min="0" max="${bal}" value="${allocByInv[inv.id]||0}" oninput="updateReceiptTotal()" style="text-align:right">
      </div>`;
    }).join('')}
    <div class="form-group" style="margin-top:.75rem"><label style="font-size:.78rem">On-account / Excess (MYR)</label><input type="number" class="input" id="rcpt-onaccount" step="0.01" min="0" value="0" oninput="updateReceiptTotal()"></div>`;
  section.style.display='block';
  updateReceiptTotal();
}

function updateReceiptTotal() {
  let total = 0;
  document.querySelectorAll('.rcpt-alloc-amt').forEach(i=>total += Number(i.value||0));
  total += Number(document.getElementById('rcpt-onaccount')?.value||0);
  document.getElementById('rcpt-total-display').textContent = `MYR ${fmtN(total)}`;
}

function getReceiptAllocations() {
  const allocs = [];
  document.querySelectorAll('.rcpt-alloc-row').forEach(row=>{
    const amt = Number(row.querySelector('.rcpt-alloc-amt').value||0);
    if (amt > 0) allocs.push({invoiceId: row.dataset.inv, amount: amt});
  });
  return allocs;
}

function saveReceipt() {
  const editId = document.getElementById('rcpt-edit-id').value;
  const number = document.getElementById('rcpt-number').value.trim();
  const date = document.getElementById('rcpt-date').value;
  const customerId = document.getElementById('rcpt-customer').value;
  const bankAccountId = document.getElementById('rcpt-bank').value;
  if (!number||!date||!customerId||!bankAccountId) return alert('Number, date, customer and bank account are required.');
  const allocations = getReceiptAllocations();
  const onAccount = Number(document.getElementById('rcpt-onaccount')?.value||0);
  const totalAmount = allocations.reduce((s,a)=>s+a.amount,0) + onAccount;
  if (totalAmount <= 0) return alert('Receipt amount must be greater than zero.');

  // If editing, reverse old paid amounts
  if (editId) {
    const old = DB.receipts.find(r=>r.id===editId);
    if (old) old.allocations.forEach(a=>{ const inv=getInvoice(a.invoiceId); if (inv) inv.paid = Math.max(0, Number(inv.paid||0) - a.amount); });
  }
  // Apply new
  allocations.forEach(a=>{ const inv=getInvoice(a.invoiceId); if (inv) inv.paid = Number(inv.paid||0) + a.amount; });

  const rcpt = {
    id: editId || uid(),
    number, date, customerId, bankAccountId,
    method: document.getElementById('rcpt-method').value,
    chequeNo: document.getElementById('rcpt-cheque').value.trim(),
    notes: document.getElementById('rcpt-notes').value.trim(),
    allocations, onAccount, totalAmount,
  };
  if (editId) Object.assign(DB.receipts.find(r=>r.id===editId), rcpt);
  else DB.receipts.push(rcpt);
  postReceiptJournal(rcpt);
  saveDB(); closeModal('modal-receipt'); renderReceipts(); renderInvoices();
}

function postReceiptJournal(rcpt) {
  const arAcc = DB.accounts.find(a=>a.id===DB.settings.defaultArAccount) || DB.accounts.find(a=>a.code==='1003');
  if (!arAcc) return;
  const old = DB.entries.find(e=>e.source==='receipt' && e.sourceId===rcpt.id);
  if (old) DB.entries = DB.entries.filter(e=>e.id!==old.id);

  const cust = getCustomer(rcpt.customerId);
  const lines = [
    {accountId: rcpt.bankAccountId, debit: rcpt.totalAmount, credit: 0},
    {accountId: arAcc.id, debit: 0, credit: rcpt.totalAmount},
  ];
  DB.entries.push({
    id: uid(), date: rcpt.date,
    reference: rcpt.number,
    description: `Receipt — ${cust?cust.name:''}${rcpt.chequeNo?' (Chq '+rcpt.chequeNo+')':''}`,
    lines, source: 'receipt', sourceId: rcpt.id,
  });
}

function deleteReceipt(id) {
  const r = DB.receipts.find(x=>x.id===id);
  if (!r) return;
  if (!confirm(`Delete receipt ${r.number}?`)) return;
  // Reverse paid amounts on invoices
  r.allocations.forEach(a=>{ const inv=getInvoice(a.invoiceId); if (inv) inv.paid = Math.max(0, Number(inv.paid||0) - a.amount); });
  // Remove journal entry
  DB.entries = DB.entries.filter(e=>!(e.source==='receipt' && e.sourceId===id));
  DB.receipts = DB.receipts.filter(x=>x.id!==id);
  saveDB(); renderReceipts(); renderInvoices();
}

// ── AR Aging ──────────────────────────────────────────
function renderARaging() {
  const date = document.getElementById('ar-aging-date').value || today();
  const buckets = [0, 30, 60, 90]; // 0-30, 31-60, 61-90, 90+
  const rows = DB.customers.map(c=>{
    const invs = DB.invoices.filter(i=>i.customerId===c.id && i.date<=date);
    const cells = [0,0,0,0,0]; // current, 31-60, 61-90, 90+, total
    invs.forEach(inv=>{
      const bal = Number(inv.total||0) - Number(inv.paid||0);
      if (bal <= 0.001) return;
      const ageDays = Math.floor((new Date(date) - new Date(inv.dueDate||inv.date))/86400000);
      let bucket;
      if (ageDays <= 30) bucket = 0;
      else if (ageDays <= 60) bucket = 1;
      else if (ageDays <= 90) bucket = 2;
      else bucket = 3;
      cells[bucket] += bal;
      cells[4] += bal;
    });
    return {cust:c, cells};
  }).filter(r=>r.cells[4] > 0.001);

  const totals = [0,0,0,0,0];
  rows.forEach(r=>r.cells.forEach((v,i)=>totals[i]+=v));

  document.getElementById('ar-aging-report').innerHTML = `
    <div class="report-title">
      <h2>${DB.settings.companyName}</h2>
      <p>AR Aging Report / 매출채권 연령분석</p>
      <p>As of ${date}</p>
    </div>
    <table class="table">
      <thead><tr>
        <th>Customer</th>
        <th class="num">Current (0-30)</th>
        <th class="num">31-60 days</th>
        <th class="num">61-90 days</th>
        <th class="num">Over 90</th>
        <th class="num">Total Outstanding</th>
      </tr></thead>
      <tbody>
        ${rows.map(r=>`<tr>
          <td><strong>${r.cust.code}</strong> ${r.cust.name}</td>
          <td class="num">${r.cells[0]>0?fmtN(r.cells[0]):''}</td>
          <td class="num">${r.cells[1]>0?fmtN(r.cells[1]):''}</td>
          <td class="num">${r.cells[2]>0?fmtN(r.cells[2]):''}</td>
          <td class="num" style="color:#dc2626">${r.cells[3]>0?fmtN(r.cells[3]):''}</td>
          <td class="num"><strong>${fmtN(r.cells[4])}</strong></td>
        </tr>`).join('')||'<tr><td colspan="6" class="empty-msg">No outstanding receivables.</td></tr>'}
        <tr style="border-top:2px solid var(--text);font-weight:700;background:#f8fafc">
          <td>Total / 합계</td>
          ${totals.map((v,i)=>`<td class="num">${fmtN(v)}</td>`).join('')}
        </tr>
      </tbody>
    </table>`;
}
