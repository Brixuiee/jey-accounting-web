'use strict';
// ======================================================
//  Mr. Accounting (MySoft) Import Module
//  ----------------------------------------------------
//  Mr. Accounting export formats supported:
//    Master Files:    Account chart, Customer, Supplier
//    Transaction:     Sales (Invoice), Cash sales, Customer receipt,
//                     Purchase, Supplier payment,
//                     Cashbook payment/receipt, Journal entry, GL
//  ----------------------------------------------------
//  Supported file types:
//    CSV  (.csv / .txt, UTF-8 with or without BOM, auto-detects ,/;/\t)
//    Excel(.xlsx / .xls / .xlsm — via SheetJS, first non-empty sheet)
//    PDF  (.pdf — via PDF.js text extraction; text-based PDFs only)
//    Word (.docx — via Mammoth; tables preferred, raw text fallback)
//    Legacy .doc binaries are NOT supported — re-save as .docx/.csv.
//  All parsers funnel into a uniform 2-D rows[] array consumed by
//  previewImport() → parseRowsByType() → commitImport().
// ======================================================

// ── CSV Parser (handles quoted fields, embedded commas/newlines) ─
function parseCSV(text) {
  // Strip BOM
  if (text.charCodeAt(0) === 0xFEFF) text = text.slice(1);
  // Auto-detect delimiter from first line
  const firstLine = text.split(/\r?\n/)[0] || '';
  const tabs = (firstLine.match(/\t/g)||[]).length;
  const commas = (firstLine.match(/,/g)||[]).length;
  const semis = (firstLine.match(/;/g)||[]).length;
  const delim = tabs > commas && tabs > semis ? '\t' :
                semis > commas ? ';' : ',';

  const rows = [];
  let row = [], field = '', inQuote = false;
  for (let i=0; i<text.length; i++) {
    const c = text[i];
    if (inQuote) {
      if (c === '"') {
        if (text[i+1] === '"') { field += '"'; i++; }
        else inQuote = false;
      } else field += c;
    } else {
      if (c === '"') inQuote = true;
      else if (c === delim) { row.push(field); field = ''; }
      else if (c === '\r') { /* skip */ }
      else if (c === '\n') { row.push(field); rows.push(row); row=[]; field=''; }
      else field += c;
    }
  }
  if (field || row.length) { row.push(field); rows.push(row); }
  // Trim trailing empty rows
  while (rows.length && rows[rows.length-1].every(c=>!c||!c.trim())) rows.pop();
  return rows;
}

// Parse various date formats commonly produced by Mr. Accounting / Excel
function parseImportDate(s) {
  if (!s) return '';
  s = String(s).trim();
  if (!s) return '';
  // Already ISO YYYY-MM-DD
  let m = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/);
  if (m) return `${m[1]}-${m[2].padStart(2,'0')}-${m[3].padStart(2,'0')}`;
  // DD/MM/YYYY or D/M/YY (Mr. Accounting Malaysia default)
  m = s.match(/^(\d{1,2})[\/\-\.](\d{1,2})[\/\-\.](\d{2,4})/);
  if (m) {
    let [_, d, mo, y] = m;
    if (y.length === 2) y = (Number(y) > 50 ? '19' : '20') + y;
    return `${y}-${mo.padStart(2,'0')}-${d.padStart(2,'0')}`;
  }
  // MM/DD/YYYY (US)
  // Excel serial date number
  if (/^\d+(\.\d+)?$/.test(s)) {
    const serial = Number(s);
    if (serial > 25569 && serial < 60000) {
      const date = new Date((serial - 25569) * 86400 * 1000);
      return date.toISOString().slice(0,10);
    }
  }
  // Try Date.parse fallback
  const d = new Date(s);
  if (!isNaN(d)) return d.toISOString().slice(0,10);
  return '';
}

function parseAmount(s) {
  if (s === null || s === undefined) return 0;
  s = String(s).trim();
  if (!s) return 0;
  // Remove currency symbols, MYR/RM prefix, commas, spaces
  s = s.replace(/MYR|RM|\$|,|\s/gi, '');
  // Parentheses = negative
  if (/^\(.+\)$/.test(s)) { s = '-' + s.slice(1,-1); }
  const n = Number(s);
  return isNaN(n) ? 0 : n;
}

// Find header column index by fuzzy match on multiple aliases
function findCol(headers, aliases) {
  const norm = h => String(h||'').toLowerCase().replace(/[\s_\-\.]/g,'');
  const normHeaders = headers.map(norm);
  for (const a of aliases) {
    const na = norm(a);
    const idx = normHeaders.findIndex(h => h===na || h.includes(na));
    if (idx >= 0) return idx;
  }
  return -1;
}

// Map Mr. Accounting account-type strings to JEY internal types
function mapAccountType(s) {
  if (!s) return 'asset';
  s = String(s).toLowerCase();
  if (/asset|aktiva|자산/.test(s)) return 'asset';
  if (/liab|liabilit|부채/.test(s)) return 'liability';
  if (/equity|capital|자본/.test(s)) return 'equity';
  if (/income|revenue|sales|수익|매출/.test(s)) return 'revenue';
  if (/cogs|cost\s*of/.test(s))  return 'expense';  // store with subType handling later if needed
  if (/expense|expenditure|비용/.test(s))  return 'expense';
  // Mr. Accounting "special types" sometimes use shorter codes
  if (/^a$/.test(s)) return 'asset';
  if (/^l$/.test(s)) return 'liability';
  if (/^c$/.test(s)) return 'equity';
  if (/^i$|^r$/.test(s)) return 'revenue';
  if (/^e$/.test(s)) return 'expense';
  // Default fallback by code range — will be overridden by code-based heuristic
  return 'asset';
}

// Heuristic by leading digit of account code
function inferTypeFromCode(code) {
  const c = String(code||'').trim();
  if (!c) return null;
  const first = c[0];
  if (first === '1') return 'asset';
  if (first === '2') return 'liability';
  if (first === '3') return 'equity';
  if (first === '4') return 'revenue';
  if (first === '5' || first === '6' || first === '7' || first === '8' || first === '9') return 'expense';
  return null;
}

// ── File-format dispatchers ────────────────────────────
// All format-specific parsers convert their input into a 2-D `rows` array
// (the same shape produced by parseCSV) so the rest of the pipeline is unchanged.

function _extOf(name) {
  const m = String(name||'').toLowerCase().match(/\.([a-z0-9]+)$/);
  return m ? m[1] : '';
}

// Read an .xlsx/.xls/.xlsm workbook via SheetJS and return rows from the first
// non-empty sheet. Headers are kept as-is (first row).
async function parseExcelFile(file) {
  if (typeof XLSX === 'undefined') throw new Error('Excel parser (SheetJS) not loaded.');
  const buf = await file.arrayBuffer();
  const wb = XLSX.read(buf, {type:'array', cellDates:false, cellNF:false});
  // Pick the first sheet that has any data
  let rows = [];
  for (const name of wb.SheetNames) {
    const sheet = wb.Sheets[name];
    const r = XLSX.utils.sheet_to_json(sheet, {header:1, raw:false, defval:''});
    // Drop trailing empty rows
    while (r.length && r[r.length-1].every(c => c==='' || c===null || c===undefined)) r.pop();
    if (r.length >= 2) { rows = r.map(row => row.map(c => c==null ? '' : String(c))); break; }
  }
  if (!rows.length) throw new Error('Excel file appears to be empty.');
  return rows;
}

// Extract text from a PDF page-by-page using PDF.js, then split into rows/cols
// using whitespace runs. Works best for table-like PDFs exported from accounting
// software; free-text PDFs will require manual cleanup.
async function parsePdfFile(file) {
  if (typeof pdfjsLib === 'undefined') throw new Error('PDF parser (PDF.js) not loaded.');
  const buf = await file.arrayBuffer();
  const pdf = await pdfjsLib.getDocument({data: buf}).promise;
  const allRows = [];
  for (let p = 1; p <= pdf.numPages; p++) {
    const page = await pdf.getPage(p);
    const content = await page.getTextContent();
    // Group text items by their Y coordinate (rounded) to recover rows
    const lines = {};
    for (const item of content.items) {
      const y = Math.round(item.transform[5]);
      const x = item.transform[4];
      if (!lines[y]) lines[y] = [];
      lines[y].push({x, text: item.str});
    }
    // Sort by Y descending (PDF origin is bottom-left), and within each line by X
    const ys = Object.keys(lines).map(Number).sort((a,b)=>b-a);
    for (const y of ys) {
      const items = lines[y].sort((a,b)=>a.x-b.x);
      // Split into columns by gaps > 8 units
      const cols = [];
      let cur = '';
      let lastX = null;
      for (const it of items) {
        if (lastX != null && it.x - lastX > 8) { cols.push(cur.trim()); cur = ''; }
        cur += (cur ? ' ' : '') + it.str;
        lastX = it.x + (it.width || 0);
      }
      if (cur) cols.push(cur.trim());
      if (cols.some(c => c)) allRows.push(cols);
    }
  }
  if (!allRows.length) throw new Error('No text extracted from PDF.');
  return allRows;
}

// Read .docx via Mammoth — extract any tables (preferred) or fall back to
// splitting raw text by lines and runs of 2+ spaces.
async function parseDocxFile(file) {
  if (typeof mammoth === 'undefined') throw new Error('Word parser (mammoth) not loaded.');
  const buf = await file.arrayBuffer();
  const html = (await mammoth.convertToHtml({arrayBuffer: buf})).value;
  // Try to extract <table> rows first
  const dom = new DOMParser().parseFromString(html, 'text/html');
  const tbl = dom.querySelector('table');
  if (tbl) {
    const rows = [];
    for (const tr of tbl.querySelectorAll('tr')) {
      const cells = [...tr.querySelectorAll('th,td')].map(td => td.textContent.trim());
      if (cells.some(c => c)) rows.push(cells);
    }
    if (rows.length >= 2) return rows;
  }
  // Fallback to raw text — split by lines, columns by 2+ spaces or tabs
  const txt = (await mammoth.extractRawText({arrayBuffer: buf})).value;
  const rows = txt.split(/\r?\n/)
    .map(line => line.split(/\t|\s{2,}/).map(c=>c.trim()))
    .filter(r => r.some(c => c));
  if (rows.length < 2) throw new Error('Could not extract a table from the Word document.');
  return rows;
}

// ── Main Import Handler ───────────────────────────────
function handleMrImport(event) {
  const file = event.target.files[0];
  if (!file) return;
  const type = document.getElementById('mr-import-type').value;
  const ext = _extOf(file.name);

  const onParsed = (rows) => {
    if (!rows || rows.length < 2) { alert('File appears to be empty or has no data rows.'); return; }
    previewImport(type, rows, file.name);
  };
  const onError = (label, err) => {
    console.error(err);
    alert(`Failed to parse ${label}: ${err.message || err}`);
  };

  if (ext === 'csv' || ext === 'txt' || ext === '') {
    const reader = new FileReader();
    reader.onload = e => {
      try { onParsed(parseCSV(e.target.result)); }
      catch (err) { onError('CSV', err); }
    };
    reader.readAsText(file, 'UTF-8');
  }
  else if (ext === 'xlsx' || ext === 'xls' || ext === 'xlsm') {
    parseExcelFile(file).then(onParsed).catch(err => onError('Excel', err));
  }
  else if (ext === 'pdf') {
    parsePdfFile(file).then(onParsed).catch(err => onError('PDF', err));
  }
  else if (ext === 'docx') {
    parseDocxFile(file).then(onParsed).catch(err => onError('Word', err));
  }
  else if (ext === 'doc') {
    alert('Legacy .doc (binary Word 97-2003) is not supported in-browser. Please save the file as .docx, .xlsx, or .csv and try again.');
  }
  else {
    alert('Unsupported file type: .' + ext + '\nSupported: CSV, XLSX, XLS, PDF, DOCX.');
  }
  event.target.value = '';
}

let _importPreview = null;  // staged data

function previewImport(type, rows, filename) {
  const headers = rows[0].map(h=>String(h||'').trim());
  const dataRows = rows.slice(1).filter(r=>r.some(c=>c&&c.trim()));

  let mapping, parsed, summary;
  try {
    ({mapping, parsed, summary} = parseRowsByType(type, headers, dataRows));
  } catch (err) {
    document.getElementById('import-preview').innerHTML = `<div class="alert alert-danger">${err.message}</div>`;
    return;
  }

  _importPreview = {type, parsed, filename};

  const previewHtml = `
    <div class="card" style="margin-top:1rem;background:#f8fafc">
      <h4>Preview — ${filename}</h4>
      <p style="font-size:.82rem;color:var(--text-muted)">
        Detected ${dataRows.length} rows. ${summary.valid} valid, ${summary.invalid} invalid/skipped.
      </p>
      <p style="font-size:.78rem;margin-top:.5rem"><strong>Column Mapping (auto-detected):</strong></p>
      <ul style="font-size:.75rem;color:var(--text-muted);padding-left:1.25rem">
        ${Object.entries(mapping).map(([k,v])=>`<li>${k} → ${v>=0?`Column ${v+1}: "${headers[v]}"`:'<span style="color:#dc2626">NOT FOUND</span>'}</li>`).join('')}
      </ul>
      ${summary.errors.length ? `
        <details style="margin-top:.5rem">
          <summary style="font-size:.78rem;color:#dc2626;cursor:pointer">⚠ ${summary.errors.length} row(s) had warnings — click to expand</summary>
          <ul style="font-size:.72rem;max-height:120px;overflow:auto;margin-top:.4rem;padding-left:1.25rem">
            ${summary.errors.slice(0,30).map(e=>`<li>Row ${e.row}: ${e.msg}</li>`).join('')}
            ${summary.errors.length>30?`<li>... +${summary.errors.length-30} more</li>`:''}
          </ul>
        </details>
      ` : ''}
      <p style="font-size:.78rem;margin-top:.75rem"><strong>Sample (first 5 rows):</strong></p>
      <div style="overflow-x:auto;max-height:200px">
        <table class="table" style="font-size:.75rem">
          <thead><tr>${Object.keys(parsed[0]||{}).map(k=>`<th>${k}</th>`).join('')}</tr></thead>
          <tbody>
            ${parsed.slice(0,5).map(r=>`<tr>${Object.values(r).map(v=>`<td>${v===null||v===undefined?'':typeof v==='object'?JSON.stringify(v):String(v)}</td>`).join('')}</tr>`).join('')}
          </tbody>
        </table>
      </div>
      <div style="margin-top:.75rem;display:flex;gap:.5rem">
        <button class="btn btn-primary" onclick="commitImport()">✓ Confirm Import (${summary.valid} rows)</button>
        <button class="btn btn-outline" onclick="cancelImport()">Cancel</button>
      </div>
    </div>`;
  document.getElementById('import-preview').innerHTML = previewHtml;
}

function cancelImport() {
  _importPreview = null;
  document.getElementById('import-preview').innerHTML = '';
}

function parseRowsByType(type, headers, dataRows) {
  const errors = [];
  let parsed = [];
  let mapping = {};

  if (type === 'coa') {
    mapping = {
      code: findCol(headers, ['account code','account no','code','계정코드','a/c code','acc code']),
      name: findCol(headers, ['account name','account description','description','name','계정명']),
      type: findCol(headers, ['account type','type','category','구분','special type']),
    };
    if (mapping.code < 0 || mapping.name < 0) throw new Error('Required columns not found. Need at least Account Code and Account Name.');
    dataRows.forEach((row, i) => {
      const code = String(row[mapping.code]||'').trim();
      const name = String(row[mapping.name]||'').trim();
      const typeStr = mapping.type>=0 ? String(row[mapping.type]||'').trim() : '';
      if (!code || !name) { errors.push({row:i+2, msg:'missing code or name'}); return; }
      let accType = mapAccountType(typeStr) || 'asset';
      const inferred = inferTypeFromCode(code);
      if (inferred && (!typeStr || mapAccountType(typeStr)==='asset')) accType = inferred;
      parsed.push({code, name, type: accType, raw_type: typeStr});
    });
  }
  else if (type === 'customers') {
    mapping = {
      code: findCol(headers, ['customer code','code','customer no','cust code']),
      name: findCol(headers, ['customer name','name','company name']),
      contact: findCol(headers, ['contact','contact person','attn','attention']),
      phone:   findCol(headers, ['phone','tel','telephone','contact no']),
      email:   findCol(headers, ['email','e-mail']),
      regNo:   findCol(headers, ['registration no','reg no','tax reg','company reg','sst no']),
      address: findCol(headers, ['address','address1','billing address']),
      credit:  findCol(headers, ['credit limit','limit']),
      terms:   findCol(headers, ['terms','payment terms','term days','credit terms']),
    };
    if (mapping.code < 0 || mapping.name < 0) throw new Error('Required columns not found. Need at least Customer Code and Customer Name.');
    dataRows.forEach((row, i) => {
      const code = String(row[mapping.code]||'').trim();
      const name = String(row[mapping.name]||'').trim();
      if (!code||!name) { errors.push({row:i+2, msg:'missing code or name'}); return; }
      parsed.push({
        code, name,
        contact:  mapping.contact>=0 ? String(row[mapping.contact]||'').trim() : '',
        phone:    mapping.phone>=0   ? String(row[mapping.phone]||'').trim()   : '',
        email:    mapping.email>=0   ? String(row[mapping.email]||'').trim()   : '',
        regNo:    mapping.regNo>=0   ? String(row[mapping.regNo]||'').trim()   : '',
        address:  mapping.address>=0 ? String(row[mapping.address]||'').trim() : '',
        creditLimit: mapping.credit>=0 ? parseAmount(row[mapping.credit]) : 0,
        terms:    mapping.terms>=0   ? Number(parseAmount(row[mapping.terms])) || 30 : 30,
      });
    });
  }
  else if (type === 'suppliers') {
    mapping = {
      code: findCol(headers, ['supplier code','code','vendor code','supp code']),
      name: findCol(headers, ['supplier name','name','vendor name','company name']),
      contact: findCol(headers, ['contact','contact person','attn','attention']),
      phone:   findCol(headers, ['phone','tel','telephone','contact no']),
      email:   findCol(headers, ['email','e-mail']),
      regNo:   findCol(headers, ['registration no','reg no','tax reg','company reg','sst no']),
      address: findCol(headers, ['address','address1','billing address']),
      terms:   findCol(headers, ['terms','payment terms','term days']),
    };
    if (mapping.code < 0 || mapping.name < 0) throw new Error('Required columns not found. Need at least Supplier Code and Supplier Name.');
    dataRows.forEach((row, i) => {
      const code = String(row[mapping.code]||'').trim();
      const name = String(row[mapping.name]||'').trim();
      if (!code||!name) { errors.push({row:i+2, msg:'missing code or name'}); return; }
      parsed.push({
        code, name,
        contact:  mapping.contact>=0 ? String(row[mapping.contact]||'').trim() : '',
        phone:    mapping.phone>=0   ? String(row[mapping.phone]||'').trim()   : '',
        email:    mapping.email>=0   ? String(row[mapping.email]||'').trim()   : '',
        regNo:    mapping.regNo>=0   ? String(row[mapping.regNo]||'').trim()   : '',
        address:  mapping.address>=0 ? String(row[mapping.address]||'').trim() : '',
        terms:    mapping.terms>=0   ? Number(parseAmount(row[mapping.terms]))||30 : 30,
      });
    });
  }
  else if (type === 'gl') {
    // GL transactions — most common and most useful for 3-year migration
    mapping = {
      date: findCol(headers, ['date','transaction date','doc date','trx date']),
      ref:  findCol(headers, ['reference','ref','ref no','doc no','document no','voucher','voucher no','jv no']),
      desc: findCol(headers, ['description','desc','particular','particulars','remark','remarks','narration']),
      account: findCol(headers, ['account code','account','acc code','a/c code','code']),
      debit: findCol(headers, ['debit','dr','debit amount','dr amount']),
      credit: findCol(headers, ['credit','cr','credit amount','cr amount']),
    };
    if (mapping.date < 0 || mapping.account < 0) throw new Error('Required columns not found. Need at least Date and Account Code.');
    if (mapping.debit < 0 && mapping.credit < 0) throw new Error('Need at least one of Debit or Credit columns.');
    dataRows.forEach((row, i) => {
      const date = parseImportDate(row[mapping.date]);
      const accCode = String(row[mapping.account]||'').trim();
      const debit  = mapping.debit>=0  ? parseAmount(row[mapping.debit])  : 0;
      const credit = mapping.credit>=0 ? parseAmount(row[mapping.credit]) : 0;
      if (!date) { errors.push({row:i+2, msg:'invalid/missing date'}); return; }
      if (!accCode) { errors.push({row:i+2, msg:'missing account code'}); return; }
      if (debit === 0 && credit === 0) { errors.push({row:i+2, msg:'no debit/credit amount'}); return; }
      parsed.push({
        date, accCode,
        ref:  mapping.ref>=0  ? String(row[mapping.ref]||'').trim()  : '',
        desc: mapping.desc>=0 ? String(row[mapping.desc]||'').trim() : '',
        debit, credit,
      });
    });
  }
  else if (type === 'sales' || type === 'purchases') {
    // Combined header+detail or flat-line invoice exports
    const isPurchase = type === 'purchases';
    mapping = {
      number: findCol(headers, isPurchase ? ['voucher no','our ref','purchase no','pv no','ref no','reference'] : ['invoice no','inv no','document no','doc no','reference']),
      supInv: findCol(headers, ['supplier inv','supplier invoice','sup inv no','original ref']),
      date:   findCol(headers, ['date','invoice date','doc date']),
      due:    findCol(headers, ['due date','due']),
      party:  findCol(headers, isPurchase ? ['supplier code','supplier','vendor code','vendor'] : ['customer code','customer','debtor code']),
      partyName: findCol(headers, isPurchase ? ['supplier name','vendor name'] : ['customer name','debtor name']),
      desc:   findCol(headers, ['description','desc','particular','particulars','remark']),
      qty:    findCol(headers, ['qty','quantity']),
      price:  findCol(headers, ['unit price','price','rate']),
      amount: findCol(headers, ['amount','sub total','subtotal','net amount']),
      sstPct: findCol(headers, ['tax %','sst %','tax rate','tax pct']),
      sstAmt: findCol(headers, ['tax amount','sst amount','tax amt']),
      total:  findCol(headers, ['total','total amount','grand total','gross']),
      account: findCol(headers, ['account code','account','expense account']),
    };
    if (mapping.number < 0 || mapping.date < 0 || mapping.party < 0) throw new Error('Required columns not found. Need at least Document Number, Date, and Customer/Supplier code.');

    // Group by document number (Mr. Accounting often exports flat with one line per item)
    const grouped = {};
    dataRows.forEach((row, i) => {
      const number = String(row[mapping.number]||'').trim();
      const date = parseImportDate(row[mapping.date]);
      const party = String(row[mapping.party]||'').trim();
      if (!number||!date) { errors.push({row:i+2, msg:'missing document number or date'}); return; }
      const amount = mapping.amount>=0 ? parseAmount(row[mapping.amount]) :
                    (mapping.qty>=0 && mapping.price>=0 ?
                     parseAmount(row[mapping.qty]) * parseAmount(row[mapping.price]) : 0);
      const sstAmt = mapping.sstAmt>=0 ? parseAmount(row[mapping.sstAmt]) : 0;
      const lineKey = number;
      if (!grouped[lineKey]) {
        grouped[lineKey] = {
          number, date, party,
          partyName: mapping.partyName>=0 ? String(row[mapping.partyName]||'').trim() : '',
          dueDate: mapping.due>=0 ? parseImportDate(row[mapping.due]) : '',
          supInv:  mapping.supInv>=0 ? String(row[mapping.supInv]||'').trim() : '',
          lines: [],
        };
      }
      grouped[lineKey].lines.push({
        desc: mapping.desc>=0 ? String(row[mapping.desc]||'').trim() : '',
        qty: mapping.qty>=0 ? parseAmount(row[mapping.qty]) || 1 : 1,
        unitPrice: mapping.price>=0 ? parseAmount(row[mapping.price]) : amount,
        sstPct: mapping.sstPct>=0 ? parseAmount(row[mapping.sstPct]) : (sstAmt>0&&amount>0?Math.round(sstAmt/amount*1000)/10:0),
        amount,
        sstAmt,
        accountCode: mapping.account>=0 ? String(row[mapping.account]||'').trim() : '',
      });
    });
    parsed = Object.values(grouped);
  }
  else if (type === 'receipts' || type === 'payments') {
    const isPayment = type === 'payments';
    mapping = {
      number: findCol(headers, isPayment ? ['payment no','pv no','voucher no','ref no'] : ['receipt no','or no','voucher no','ref no']),
      date:   findCol(headers, ['date','receipt date','payment date','doc date']),
      party:  findCol(headers, isPayment ? ['supplier code','supplier','vendor code'] : ['customer code','customer','debtor code']),
      bank:   findCol(headers, ['bank','bank code','bank account','cash/bank account']),
      amount: findCol(headers, ['amount','total','total amount','received','paid']),
      cheque: findCol(headers, ['cheque no','cheque','check no','ref no']),
      method: findCol(headers, ['method','payment method','mode']),
      desc:   findCol(headers, ['description','remark','particulars']),
      knockoff: findCol(headers, ['knockoff','knock off','invoice no','bill no','allocate to']),
    };
    if (mapping.number < 0 || mapping.date < 0 || mapping.party < 0 || mapping.amount < 0) throw new Error('Required columns not found. Need Number, Date, Customer/Supplier code, and Amount.');
    dataRows.forEach((row, i) => {
      const number = String(row[mapping.number]||'').trim();
      const date = parseImportDate(row[mapping.date]);
      const party = String(row[mapping.party]||'').trim();
      const amount = parseAmount(row[mapping.amount]);
      if (!number||!date||!party) { errors.push({row:i+2, msg:'missing required field'}); return; }
      if (amount <= 0) { errors.push({row:i+2, msg:'amount must be positive'}); return; }
      parsed.push({
        number, date, party, amount,
        bank:   mapping.bank>=0   ? String(row[mapping.bank]||'').trim()   : '',
        cheque: mapping.cheque>=0 ? String(row[mapping.cheque]||'').trim() : '',
        method: mapping.method>=0 ? String(row[mapping.method]||'').trim() : (isPayment?'Bank Transfer':'Bank Transfer'),
        desc:   mapping.desc>=0   ? String(row[mapping.desc]||'').trim()   : '',
        knockoff: mapping.knockoff>=0 ? String(row[mapping.knockoff]||'').trim() : '',
      });
    });
  }
  else {
    throw new Error('Unknown import type: ' + type);
  }

  return {mapping, parsed, summary: {valid: parsed.length, invalid: errors.length, errors}};
}

// ── Commit Import to DB ───────────────────────────────
function commitImport() {
  if (!_importPreview) return;
  const {type, parsed} = _importPreview;
  let result;
  try {
    if (type === 'coa')        result = commitCoA(parsed);
    else if (type === 'customers') result = commitCustomers(parsed);
    else if (type === 'suppliers') result = commitSuppliers(parsed);
    else if (type === 'gl')        result = commitGL(parsed);
    else if (type === 'sales')     result = commitInvoices(parsed, false);
    else if (type === 'purchases') result = commitInvoices(parsed, true);
    else if (type === 'receipts')  result = commitReceipts(parsed, false);
    else if (type === 'payments')  result = commitReceipts(parsed, true);
  } catch (err) {
    console.error(err);
    alert('Import failed: ' + err.message);
    return;
  }
  saveDB();
  populateLedgerSelect();
  populateAccountDropdowns();
  document.getElementById('import-preview').innerHTML = `
    <div class="alert alert-success" style="margin-top:1rem">
      <strong>✓ Import complete.</strong> ${result.created} created, ${result.updated} updated, ${result.skipped} skipped.
      ${result.warnings && result.warnings.length ? `<details style="margin-top:.5rem"><summary style="cursor:pointer">⚠ ${result.warnings.length} warning(s)</summary><ul style="font-size:.75rem;max-height:140px;overflow:auto;margin-top:.4rem;padding-left:1.25rem">${result.warnings.slice(0,50).map(w=>`<li>${w}</li>`).join('')}</ul></details>` : ''}
    </div>`;
  _importPreview = null;
}

function commitCoA(rows) {
  let created = 0, updated = 0, skipped = 0;
  for (const r of rows) {
    const existing = DB.accounts.find(a=>a.code===r.code);
    if (existing) {
      // Update name only — preserve type if user customized it
      existing.nameEn = r.name;
      if (!existing.nameKr) existing.nameKr = r.name;
      updated++;
    } else {
      DB.accounts.push({
        id: 'a'+r.code+'_'+uid().slice(0,4),
        code: r.code,
        nameEn: r.name,
        nameKr: r.name,   // user can later edit Korean translation
        type: r.type,
      });
      created++;
    }
  }
  return {created, updated, skipped};
}

function commitCustomers(rows) {
  let created = 0, updated = 0, skipped = 0;
  for (const r of rows) {
    const existing = DB.customers.find(c=>c.code===r.code);
    if (existing) { Object.assign(existing, r); updated++; }
    else { DB.customers.push({id: uid(), ...r}); created++; }
  }
  return {created, updated, skipped};
}

function commitSuppliers(rows) {
  let created = 0, updated = 0, skipped = 0;
  for (const r of rows) {
    const existing = DB.suppliers.find(s=>s.code===r.code);
    if (existing) { Object.assign(existing, r); updated++; }
    else { DB.suppliers.push({id: uid(), ...r}); created++; }
  }
  return {created, updated, skipped};
}

function commitGL(rows) {
  // Group by date+reference into journal entries (so DR/CR for same voucher merge)
  const grouped = {};
  const warnings = [];
  for (const r of rows) {
    const key = `${r.date}__${r.ref||'NOREF'}`;
    if (!grouped[key]) grouped[key] = {date: r.date, ref: r.ref, desc: r.desc, lines: []};
    const acc = findAccountByCode(r.accCode);
    if (!acc) {
      warnings.push(`Date ${r.date} ref "${r.ref||'-'}": account code "${r.accCode}" not found — line skipped`);
      continue;
    }
    if (!grouped[key].desc && r.desc) grouped[key].desc = r.desc;
    grouped[key].lines.push({accountId: acc.id, debit: r.debit, credit: r.credit});
  }
  let created = 0, updated = 0, skipped = 0;
  for (const key in grouped) {
    const g = grouped[key];
    if (!g.lines.length) { skipped++; continue; }
    // Validate balance
    const dr = g.lines.reduce((s,l)=>s+l.debit,0);
    const cr = g.lines.reduce((s,l)=>s+l.credit,0);
    if (Math.abs(dr-cr) > 0.01) {
      warnings.push(`${g.date} ref "${g.ref||'-'}": unbalanced (DR ${fmtN(dr)} ≠ CR ${fmtN(cr)}) — imported anyway`);
    }
    DB.entries.push({
      id: uid(), date: g.date,
      reference: g.ref || `IMP-${key.slice(-6)}`,
      description: g.desc || '(imported)',
      lines: g.lines,
      source: 'import',
    });
    created++;
  }
  return {created, updated, skipped, warnings};
}

function commitInvoices(docs, isPurchase) {
  let created = 0, updated = 0, skipped = 0;
  const warnings = [];
  for (const d of docs) {
    let partyId;
    if (isPurchase) {
      let sup = DB.suppliers.find(s=>s.code===d.party);
      if (!sup) {
        sup = {id: uid(), code: d.party, name: d.partyName||d.party, terms: 30};
        DB.suppliers.push(sup);
        warnings.push(`Auto-created supplier "${d.party}" — please review`);
      }
      partyId = sup.id;
    } else {
      let cust = DB.customers.find(c=>c.code===d.party);
      if (!cust) {
        cust = {id: uid(), code: d.party, name: d.partyName||d.party, terms: 30};
        DB.customers.push(cust);
        warnings.push(`Auto-created customer "${d.party}" — please review`);
      }
      partyId = cust.id;
    }
    const subtotal = d.lines.reduce((s,l)=>s+l.amount,0);
    const sstTotal = d.lines.reduce((s,l)=>s+l.sstAmt,0);
    const total = subtotal + sstTotal;

    const list = isPurchase ? DB.bills : DB.invoices;
    if (list.find(x=>x.number===d.number)) {
      warnings.push(`${isPurchase?'Bill':'Invoice'} ${d.number} already exists — skipped`);
      skipped++;
      continue;
    }
    const doc = {
      id: uid(),
      number: d.number,
      date: d.date,
      dueDate: d.dueDate || '',
      [isPurchase?'supplierId':'customerId']: partyId,
      lines: d.lines.map(l=>({
        desc: l.desc, qty: l.qty, unitPrice: l.unitPrice,
        sstPct: l.sstPct, amount: l.amount, sstAmt: l.sstAmt,
        accountId: isPurchase ? (findAccountByCode(l.accountCode)?.id || '') : undefined,
      })),
      subtotal, sstTotal, total, paid: 0,
    };
    if (isPurchase) doc.supInv = d.supInv;
    list.push(doc);
    // Auto-post journal
    if (isPurchase) postBillJournal(doc);
    else postInvoiceJournal(doc);
    created++;
  }
  return {created, updated, skipped, warnings};
}

function commitReceipts(rows, isPayment) {
  let created = 0, skipped = 0, updated = 0;
  const warnings = [];
  for (const r of rows) {
    let partyId;
    const partyList = isPayment ? DB.suppliers : DB.customers;
    let party = partyList.find(p=>p.code===r.party);
    if (!party) {
      party = {id: uid(), code: r.party, name: r.party, terms: 30};
      partyList.push(party);
      warnings.push(`Auto-created ${isPayment?'supplier':'customer'} "${r.party}" — please review`);
    }
    partyId = party.id;
    // Find bank account
    let bankAcc = null;
    if (r.bank) {
      bankAcc = findAccountByCode(r.bank) || DB.accounts.find(a=>a.nameEn?.toLowerCase().includes(r.bank.toLowerCase()));
    }
    if (!bankAcc) bankAcc = DB.accounts.find(a=>a.id===DB.settings.defaultBankAccount) || DB.accounts.find(a=>a.code==='1002');
    if (!bankAcc) { warnings.push(`No bank account for ${r.number} — skipped`); skipped++; continue; }
    const list = isPayment ? DB.payments : DB.receipts;
    if (list.find(x=>x.number===r.number)) { warnings.push(`${isPayment?'Payment':'Receipt'} ${r.number} already exists — skipped`); skipped++; continue; }
    // Try to allocate to existing invoice/bill if knock-off ref provided
    const allocations = [];
    let onAccount = r.amount;
    if (r.knockoff) {
      const docList = isPayment ? DB.bills : DB.invoices;
      const refs = r.knockoff.split(/[,;|]/).map(s=>s.trim()).filter(Boolean);
      let remain = r.amount;
      for (const ref of refs) {
        const doc = docList.find(d => d.number===ref && (isPayment?d.supplierId:d.customerId)===partyId);
        if (doc) {
          const bal = Number(doc.total||0) - Number(doc.paid||0);
          const alloc = Math.min(remain, bal);
          if (alloc > 0) {
            allocations.push({[isPayment?'billId':'invoiceId']: doc.id, amount: alloc});
            doc.paid = Number(doc.paid||0) + alloc;
            remain -= alloc;
          }
        }
      }
      onAccount = Math.max(0, remain);
    }
    const doc = {
      id: uid(),
      number: r.number,
      date: r.date,
      [isPayment?'supplierId':'customerId']: partyId,
      bankAccountId: bankAcc.id,
      method: r.method || 'Bank Transfer',
      chequeNo: r.cheque || '',
      notes: r.desc || '',
      allocations, onAccount,
      totalAmount: r.amount,
    };
    list.push(doc);
    if (isPayment) postPaymentJournal(doc);
    else postReceiptJournal(doc);
    created++;
  }
  return {created, updated, skipped, warnings};
}

// ── Render Import Section / Templates ─────────────────
function renderImportSection() {
  // Add download-template buttons next to the import controls (only once)
  if (document.getElementById('mr-templates-block')) return;
  const block = document.createElement('div');
  block.id = 'mr-templates-block';
  block.style.cssText = 'margin-top:.75rem;padding-top:.75rem;border-top:1px dashed var(--border)';
  block.innerHTML = `
    <p style="font-size:.78rem;color:var(--text-muted);margin-bottom:.5rem"><strong>📋 Sample CSV templates</strong> — open in Excel, fill data, then save as CSV / XLSX (or export to PDF / DOCX with the table preserved):</p>
    <div style="display:flex;flex-wrap:wrap;gap:.4rem">
      ${[
        {t:'coa',label:'Chart of Accounts'},
        {t:'customers',label:'Customers'},
        {t:'suppliers',label:'Suppliers'},
        {t:'gl',label:'GL Transactions'},
        {t:'sales',label:'Sales Invoices'},
        {t:'purchases',label:'Purchase Invoices'},
        {t:'receipts',label:'Customer Receipts'},
        {t:'payments',label:'Supplier Payments'},
      ].map(o=>`<button class="btn btn-sm btn-outline" onclick="downloadTemplate('${o.t}')">↓ ${o.label}</button>`).join('')}
    </div>`;
  // Insert into the Mr. Accounting card (after the file input)
  const card = document.querySelector('#section-import .card:nth-child(2)');
  if (card && !card.querySelector('#mr-templates-block')) card.appendChild(block);

  // Expand the import-type dropdown to all supported types
  const sel = document.getElementById('mr-import-type');
  if (sel && sel.options.length < 8) {
    sel.innerHTML = `
      <option value="coa">Chart of Accounts (master)</option>
      <option value="customers">Customers (master)</option>
      <option value="suppliers">Suppliers (master)</option>
      <option value="gl">GL Transactions / Journal Entries</option>
      <option value="sales">Sales Invoices</option>
      <option value="purchases">Purchase Invoices</option>
      <option value="receipts">Customer Receipts</option>
      <option value="payments">Supplier Payments</option>`;
  }
}

const TEMPLATES = {
  coa: 'Account Code,Account Name,Account Type\n1001,Cash in Hand,Asset\n1002,Bank - Maybank,Asset\n4001,Sales Revenue,Income\n5001,Cost of Goods Sold,Expense\n',
  customers: 'Customer Code,Customer Name,Contact Person,Phone,Email,Registration No,Address,Credit Limit,Payment Terms\nC0001,ABC Sdn Bhd,Mr. Tan,03-12345678,info@abc.com.my,202001234567,"Lot 1, Jalan Sample, KL",50000,30\n',
  suppliers: 'Supplier Code,Supplier Name,Contact Person,Phone,Email,Registration No,Address,Payment Terms\nS0001,XYZ Trading,Mr. Lee,03-87654321,contact@xyz.com.my,202112345678,"No 5, Jalan Vendor, PJ",30\n',
  gl: 'Date,Reference,Description,Account Code,Debit,Credit\n01/01/2023,JV0001,Opening balance,1002,15000.00,0\n01/01/2023,JV0001,Opening balance,3001,0,15000.00\n',
  sales: 'Invoice No,Date,Customer Code,Customer Name,Description,Qty,Unit Price,Amount,Tax %,Tax Amount,Total,Due Date\nINV202301001,15/01/2023,C0001,ABC Sdn Bhd,Commission Jan 2023,1,5000.00,5000.00,0,0,5000.00,14/02/2023\n',
  purchases: 'Voucher No,Supplier Inv,Date,Supplier Code,Supplier Name,Description,Account Code,Qty,Unit Price,Amount,Tax %,Tax Amount,Total,Due Date\nPV202301001,SUP-001,10/01/2023,S0001,XYZ Trading,Office rent Jan 2023,5003,1,800.00,800.00,0,0,800.00,09/02/2023\n',
  receipts: 'Receipt No,Date,Customer Code,Bank Code,Amount,Cheque No,Payment Method,Description,Knockoff\nOR202301001,20/01/2023,C0001,1002,5000.00,123456,Bank Transfer,Receipt for INV202301001,INV202301001\n',
  payments: 'Payment No,Date,Supplier Code,Bank Code,Amount,Cheque No,Payment Method,Description,Knockoff\nPY202301001,12/01/2023,S0001,1002,800.00,654321,Bank Transfer,Payment for SUP-001,PV202301001\n',
};

function downloadTemplate(type) {
  const csv = TEMPLATES[type];
  if (!csv) return;
  const bom = '﻿'; // UTF-8 BOM for Excel compatibility
  const blob = new Blob([bom+csv], {type:'text/csv;charset=utf-8'});
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `mr_accounting_${type}_template.csv`;
  a.click();
}
