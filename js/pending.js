'use strict';
// ======================================================
//  미결거래 (Pending Transactions) Module
//  장부 반영 여부 미결정 거래를 임시 보관.
//  재무제표에 반영 안 됨. 승인 시 실제 거래로 등록.
// ======================================================

const PENDING_TYPE_LABELS = {
  sales:   '판매송장 (수수료 청구)',
  expense: '직접경비',
  purchase:'매입송장',
  receipt: '고객 수령',
  payment: '공급업체 지급',
  journal: '수동 분개',
};

const PENDING_TYPE_COLORS = {
  sales:   '#0ea572',
  expense: '#d97706',
  purchase:'#7c3aed',
  receipt: '#2563eb',
  payment: '#dc2626',
  journal: '#64748b',
};

// ── Render list ───────────────────────────────────────
function renderPendingEntries() {
  const el = document.getElementById('pending-list');
  if (!el) return;

  const list = (DB.pendingEntries || []).slice().sort((a, b) => (b.createdAt || '').localeCompare(a.createdAt || ''));

  if (!list.length) {
    el.innerHTML = `<div class="card" style="text-align:center;color:var(--text-muted);padding:2rem">
      미결거래가 없습니다. [+ 미결 추가] 버튼으로 추가하세요.
    </div>`;
    return;
  }

  el.innerHTML = `
    <table class="table">
      <thead><tr>
        <th>등록일</th><th>거래일</th><th>유형</th><th>거래처</th>
        <th>내용</th><th class="num">금액 (MYR)</th><th>보류 사유</th><th></th>
      </tr></thead>
      <tbody>
        ${list.map(p => {
          const customer = p.customerId ? DB.customers.find(c => c.id === p.customerId) : null;
          const supplier = p.supplierId ? DB.suppliers.find(s => s.id === p.supplierId) : null;
          const party = customer ? customer.name : supplier ? supplier.name : '—';
          const color = PENDING_TYPE_COLORS[p.type] || '#64748b';
          return `<tr>
            <td style="font-size:.75rem;color:var(--text-muted)">${p.createdAt || '—'}</td>
            <td><strong>${p.date || '—'}</strong></td>
            <td><span style="background:${color}20;color:${color};padding:.15rem .5rem;border-radius:4px;font-size:.75rem;white-space:nowrap">
              ${PENDING_TYPE_LABELS[p.type] || p.type}
            </span></td>
            <td style="font-size:.82rem">${party}</td>
            <td style="font-size:.82rem">${escapeHtml ? escapeHtml(p.description || '') : (p.description || '')}</td>
            <td class="num"><strong>${fmtN(p.amount || 0)}</strong></td>
            <td style="font-size:.75rem;color:var(--text-muted);max-width:160px">${p.reason || '—'}</td>
            <td style="white-space:nowrap">
              <button class="btn btn-sm btn-outline" onclick="approvePendingEntry('${p.id}')" title="장부에 반영">✓ 승인</button>
              <button class="btn btn-sm btn-outline" onclick="openPendingModal('${p.id}')" style="margin-left:.25rem">✎</button>
              <button class="btn btn-sm btn-danger" onclick="deletePendingEntry('${p.id}')" style="margin-left:.25rem">✕</button>
            </td>
          </tr>`;
        }).join('')}
      </tbody>
    </table>
    <div style="margin-top:.5rem;font-size:.78rem;color:var(--text-muted)">
      총 ${list.length}건 | 합계 MYR ${fmtN(list.reduce((s, p) => s + (p.amount || 0), 0))}
    </div>`;
}

// ── Open modal ────────────────────────────────────────
function openPendingModal(id = null) {
  const p = id ? (DB.pendingEntries || []).find(x => x.id === id) : null;

  document.getElementById('pending-modal-title').textContent = p ? '미결거래 수정' : '미결거래 추가';
  document.getElementById('pending-edit-id').value  = p ? p.id : '';
  document.getElementById('pending-date').value     = p ? (p.date || today()) : today();
  document.getElementById('pending-type').value     = p ? (p.type || 'sales') : 'sales';
  document.getElementById('pending-description').value = p ? (p.description || '') : '';
  document.getElementById('pending-amount').value   = p ? (p.amount || '') : '';
  document.getElementById('pending-reason').value   = p ? (p.reason || '') : '';

  _populatePendingDropdowns();
  onPendingTypeChange();

  if (p) {
    if (p.customerId) document.getElementById('pending-customer').value = p.customerId;
    if (p.supplierId) document.getElementById('pending-supplier').value = p.supplierId;
    if (p.accountId)  document.getElementById('pending-account').value  = p.accountId;
  }

  document.getElementById('modal-pending').style.display = 'flex';
}

function _populatePendingDropdowns() {
  // Customers
  const custSel = document.getElementById('pending-customer');
  custSel.innerHTML = '<option value="">(미정)</option>' +
    DB.customers.map(c => `<option value="${c.id}">${c.code} ${c.name}</option>`).join('');

  // Suppliers
  const suppSel = document.getElementById('pending-supplier');
  suppSel.innerHTML = '<option value="">(미정)</option>' +
    DB.suppliers.map(s => `<option value="${s.id}">${s.code} ${s.name}</option>`).join('');

  // Accounts (grouped)
  const accSel = document.getElementById('pending-account');
  const groups = {revenue:'수익', expense:'비용', asset:'자산', liability:'부채', equity:'자본'};
  accSel.innerHTML = '<option value="">(자동)</option>' +
    Object.entries(groups).map(([t, label]) => {
      const accs = DB.accounts.filter(a => a.type === t).sort((a, b) => a.code.localeCompare(b.code));
      if (!accs.length) return '';
      return `<optgroup label="${label}">${accs.map(a =>
        `<option value="${a.id}">${a.code} ${a.nameEn || a.nameKr}</option>`
      ).join('')}</optgroup>`;
    }).join('');
}

function onPendingTypeChange() {
  const type = document.getElementById('pending-type').value;
  const isCust = type === 'sales' || type === 'receipt';
  const isSupp = type === 'purchase' || type === 'payment';
  document.getElementById('pending-customer-row').style.display = (isCust || (!isCust && !isSupp)) ? '' : 'none';
  document.getElementById('pending-supplier-row').style.display = isSupp ? '' : 'none';
}

// ── Save ──────────────────────────────────────────────
function savePendingEntry() {
  const desc = document.getElementById('pending-description').value.trim();
  const amount = Number(document.getElementById('pending-amount').value || 0);
  if (!desc)   return alert('내용을 입력하세요.');
  if (!amount) return alert('금액을 입력하세요.');

  if (!DB.pendingEntries) DB.pendingEntries = [];

  const editId = document.getElementById('pending-edit-id').value;
  const type = document.getElementById('pending-type').value;
  const isCust = type === 'sales' || type === 'receipt';
  const isSupp = type === 'purchase' || type === 'payment';

  const data = {
    date:        document.getElementById('pending-date').value,
    type,
    customerId:  isCust ? (document.getElementById('pending-customer').value || null) : null,
    supplierId:  isSupp ? (document.getElementById('pending-supplier').value || null) : null,
    accountId:   document.getElementById('pending-account').value || null,
    description: desc,
    amount,
    reason:      document.getElementById('pending-reason').value.trim(),
  };

  if (editId) {
    const existing = DB.pendingEntries.find(x => x.id === editId);
    if (existing) Object.assign(existing, data);
  } else {
    DB.pendingEntries.push({ id: uid(), createdAt: today(), ...data });
  }

  saveDB();
  closeModal('modal-pending');
  renderPendingEntries();
}

// ── Approve → post to books ───────────────────────────
function approvePendingEntry(id) {
  const p = (DB.pendingEntries || []).find(x => x.id === id);
  if (!p) return;

  const label = PENDING_TYPE_LABELS[p.type] || p.type;
  if (!confirm(`"${p.description}" (${label}, MYR ${fmtN(p.amount)})\n\n장부에 반영하시겠습니까?`)) return;

  try {
    if (p.type === 'expense') {
      const expAcc = (p.accountId ? DB.accounts.find(a => a.id === p.accountId) : null)
                     || DB.accounts.find(a => a.code === '5010');
      const bankAcc = DB.accounts.find(a => a.code === '1002');
      if (!expAcc || !bankAcc) throw new Error('계정과목 설정 필요');
      DB.entries.push({
        id: uid(), date: p.date,
        reference: `PE${p.id.slice(0, 6).toUpperCase()}`,
        description: p.description,
        lines: [
          { accountId: expAcc.id, debit: p.amount, credit: 0 },
          { accountId: bankAcc.id, debit: 0, credit: p.amount },
        ],
        source: 'pending-approved',
      });

    } else if (p.type === 'sales') {
      const revAccId = p.accountId || DB.settings.defaultSalesAccount;
      const inv = {
        id: uid(),
        number: nextNumber('INV', DB.invoices, p.date),
        date: p.date, dueDate: '',
        customerId: p.customerId,
        ref: '', notes: p.description,
        lines: [{ desc: p.description, qty: 1, unitPrice: p.amount, sstPct: 0, amount: p.amount, sstAmt: 0, accountId: revAccId }],
        subtotal: p.amount, sstTotal: 0, total: p.amount, paid: 0,
      };
      if (p.customerId) {
        const c = DB.customers.find(x => x.id === p.customerId);
        if (c?.terms) {
          const d = new Date(p.date); d.setDate(d.getDate() + Number(c.terms));
          inv.dueDate = d.toISOString().slice(0, 10);
        }
      }
      DB.invoices.push(inv);
      if (typeof postInvoiceJournal === 'function') postInvoiceJournal(inv);

    } else if (p.type === 'purchase') {
      const bill = {
        id: uid(),
        number: nextNumber('PV', DB.bills, p.date),
        supInv: '', date: p.date, dueDate: '',
        supplierId: p.supplierId,
        notes: p.description,
        lines: [{ desc: p.description, accountId: p.accountId, qty: 1, unitPrice: p.amount, sstPct: 0, amount: p.amount, sstAmt: 0 }],
        subtotal: p.amount, sstTotal: 0, total: p.amount, paid: 0,
      };
      if (p.supplierId) {
        const s = DB.suppliers.find(x => x.id === p.supplierId);
        if (s?.terms) {
          const d = new Date(p.date); d.setDate(d.getDate() + Number(s.terms));
          bill.dueDate = d.toISOString().slice(0, 10);
        }
      }
      DB.bills.push(bill);
      if (typeof postBillJournal === 'function') postBillJournal(bill);

    } else {
      alert(`'${label}' 유형은 빠른입력(⚡) 메뉴에서 직접 처리해주세요.`);
      return;
    }

    DB.pendingEntries = DB.pendingEntries.filter(x => x.id !== id);
    saveDB();
    renderPendingEntries();
    alert('✅ 장부에 반영됐습니다.');

  } catch (err) {
    console.error('approvePendingEntry:', err);
    alert('오류: ' + err.message);
  }
}

// ── Delete ────────────────────────────────────────────
function deletePendingEntry(id) {
  if (!confirm('이 미결거래를 삭제하시겠습니까?')) return;
  DB.pendingEntries = (DB.pendingEntries || []).filter(x => x.id !== id);
  saveDB();
  renderPendingEntries();
}
