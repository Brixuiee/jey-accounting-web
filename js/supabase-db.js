'use strict';
// ======================================================
//  JEY 회계프로그램 — Supabase DB 레이어 (Phase 2~6)
//  Load order in index.html:
//    1) Supabase CDN
//    2) js/supabase-auth.js  → _supabase 클라이언트
//    3) js/app.js            → DB 객체, loadDB/saveDB
//    4) js/supabase-db.js   ← 이 파일
//
//  테이블:
//    accounts     : id(text PK), code, name_kr, name_en, type, user_id
//    entries      : id(text PK), user_id, entry_date, description, ref, lines(jsonb)
//    sync_records : (collection, id, user_id) PK, data(jsonb)  ← Phase 4~5
//    user_settings: user_id PK, data(jsonb)                    ← Phase 6
// ======================================================

// ── Phase 2: 계정과목 (accounts) ──────────────────────

// `audit_code`(감사법인 GL 코드) and `contra`(차감계정 표시) are newer columns.
// A project whose accounts table predates them would fail the whole query, so
// we probe once and fall back to the original column set — the app then keeps
// working, just without carrying those two fields through the cloud.
let _accountsHaveExtraCols = true;
const _ACC_COLS_FULL = 'id, code, name_kr, name_en, type, audit_code, contra';
const _ACC_COLS_BASE = 'id, code, name_kr, name_en, type';

function _missingColumn(error) {
  const m = (error?.message || '').toLowerCase();
  return m.includes('column') || m.includes('does not exist') || error?.code === '42703';
}

async function loadAccountsFromSupabase() {
  const session = await getSupabaseSession();
  if (!session) return null;

  const fetch = cols => _supabase.from('accounts').select(cols).order('code');
  let { data, error } = await fetch(_accountsHaveExtraCols ? _ACC_COLS_FULL : _ACC_COLS_BASE);
  if (error && _accountsHaveExtraCols && _missingColumn(error)) {
    console.warn('accounts: audit_code/contra 컬럼 없음 — 기본 컬럼으로 재시도합니다.');
    _accountsHaveExtraCols = false;
    ({ data, error } = await fetch(_ACC_COLS_BASE));
  }

  if (error) { console.warn('loadAccountsFromSupabase:', error.message); return null; }
  if (!data || data.length === 0) return [];

  return data.map(r => ({
    id: r.id, code: r.code, nameKr: r.name_kr, nameEn: r.name_en, type: r.type,
    ...(r.audit_code ? { auditCode: r.audit_code } : {}),
    ...(r.contra     ? { contra: true }          : {}),
  }));
}

async function _bulkUpsertAccounts(accounts, userId) {
  if (!accounts.length) return;
  const CHUNK = 100;
  for (let i = 0; i < accounts.length; i += CHUNK) {
    const chunk = accounts.slice(i, i + CHUNK);
    const base = a => ({
      id: a.id, code: a.code, name_kr: a.nameKr, name_en: a.nameEn, type: a.type, user_id: userId
    });
    const full = a => ({ ...base(a), audit_code: a.auditCode || null, contra: !!a.contra });

    let { error } = await _supabase.from('accounts').upsert(chunk.map(_accountsHaveExtraCols ? full : base));
    if (error && _accountsHaveExtraCols && _missingColumn(error)) {
      console.warn('accounts: audit_code/contra 컬럼 없음 — 기본 컬럼으로 저장합니다.');
      _accountsHaveExtraCols = false;
      ({ error } = await _supabase.from('accounts').upsert(chunk.map(base)));
    }
    if (error) throw error;
  }
}

window.syncAccountsToSupabase = async function () {
  const session = await getSupabaseSession();
  if (!session) return;
  try { await _bulkUpsertAccounts(DB.accounts, session.user.id); }
  catch (e) { console.warn('syncAccountsToSupabase 실패:', e.message); }
};

// ── Phase 3: 분개 (entries) ───────────────────────────

async function loadEntriesFromSupabase(opts = {}) {
  const session = await getSupabaseSession();
  if (!session) return null;

  // PostgREST caps rows per request (this project: 1000) regardless of the
  // client library, so past 1000 entries a single unpaginated query silently
  // truncates — DB.entries = cloudEntries then drops the rest on every login.
  // Page through with .range() until a page comes back short, unless the
  // caller passed an explicit opts.limit (then honor that as a hard cap).
  const PAGE = 1000;
  let all = [];
  let offset = 0;
  while (true) {
    let query = _supabase
      .from('entries')
      .select('id, entry_date, description, ref, lines')
      .order('entry_date', { ascending: false });

    if (opts.fromDate) query = query.gte('entry_date', opts.fromDate);
    if (opts.toDate)   query = query.lte('entry_date', opts.toDate);

    const pageSize = opts.limit ? Math.min(PAGE, opts.limit - offset) : PAGE;
    if (pageSize <= 0) break;
    query = query.range(offset, offset + pageSize - 1);

    const { data, error } = await query;
    if (error) { console.warn('loadEntriesFromSupabase:', error.message); return offset === 0 ? null : all.map(_mapEntryRow); }

    all = all.concat(data || []);
    if (!data || data.length < pageSize) break;
    offset += data.length;
    if (opts.limit && offset >= opts.limit) break;
  }

  return all.map(_mapEntryRow);
}

function _mapEntryRow(r) {
  return { id: r.id, date: r.entry_date, description: r.description || '', reference: r.ref || '', lines: r.lines };
}

async function _bulkUpsertEntries(entries, userId) {
  if (!entries.length) return;
  const CHUNK = 100;
  for (let i = 0; i < entries.length; i += CHUNK) {
    const chunk = entries.slice(i, i + CHUNK).map(e => ({
      id: e.id, user_id: userId, entry_date: e.date,
      description: e.description, ref: e.reference || '',
      lines: e.lines, updated_at: new Date().toISOString()
    }));
    const { error } = await _supabase.from('entries').upsert(chunk);
    if (error) throw error;
  }
}

window.syncEntriesToSupabase = async function () {
  const session = await getSupabaseSession();
  if (!session) return;
  try { await _bulkUpsertEntries(DB.entries, session.user.id); }
  catch (e) { console.warn('syncEntriesToSupabase 실패:', e.message); }
};

// ── Phase 4~5: 범용 컬렉션 (sync_records) ─────────────

// 동기화 대상 컬렉션 목록 (DB 키 이름)
const SYNC_COLLECTIONS = [
  'customers', 'suppliers', 'invoices', 'bills', 'receipts', 'payments',
  'assets', 'employees', 'payrollRuns', 'currencies', 'exchangeRates',
  'pendingEntries', 'bankTransactions'
];

async function _loadCollection(collection) {
  const { data, error } = await _supabase
    .from('sync_records')
    .select('data')
    .eq('collection', collection);

  if (error) { console.warn(`_loadCollection(${collection}):`, error.message); return null; }
  return (data || []).map(r => r.data);
}

async function _bulkUpsertCollection(collection, items, userId) {
  if (!items || !items.length) return;
  const CHUNK = 100;
  for (let i = 0; i < items.length; i += CHUNK) {
    const rows = items.slice(i, i + CHUNK).map(item => ({
      collection,
      id: item.id || String(i),
      user_id: userId,
      data: item,
      updated_at: new Date().toISOString()
    }));
    const { error } = await _supabase
      .from('sync_records')
      .upsert(rows, { onConflict: 'collection,id' });
    if (error) throw error;
  }
}

// ── Phase 6: 설정 (user_settings) ────────────────────

async function _loadSettings(userId) {
  const { data, error } = await _supabase
    .from('user_settings')
    .select('data')
    .eq('user_id', userId)
    .maybeSingle();

  if (error) { console.warn('_loadSettings:', error.message); return null; }
  return data?.data || null;
}

async function _saveSettings(settings, userId) {
  // directoryHandle은 직렬화 불가 → 제외
  const { directoryHandle, ...safeSettings } = settings || {};
  const { error } = await _supabase.from('user_settings').upsert({
    user_id: userId,
    data: safeSettings,
    updated_at: new Date().toISOString()
  });
  if (error) throw error;
}

// ── 종합 동기화 (saveDB 후 호출) ──────────────────────

window.syncAllToSupabase = async function () {
  const session = await getSupabaseSession();
  if (!session) return;
  const userId = session.user.id;

  // accounts + entries
  syncAccountsToSupabase().catch(() => {});
  syncEntriesToSupabase().catch(() => {});

  // 컬렉션
  for (const col of SYNC_COLLECTIONS) {
    if (DB[col] && DB[col].length > 0) {
      _bulkUpsertCollection(col, DB[col], userId)
        .catch(e => console.warn(`sync ${col}:`, e.message));
    }
  }

  // 설정
  if (DB.settings) {
    _saveSettings(DB.settings, userId)
      .catch(e => console.warn('sync settings:', e.message));
  }
};

// ── 초기화: 로그인 후 Supabase에서 데이터 로드 ─────────

async function initSupabaseData(_retried = false) {
  const session = await getSupabaseSession();
  if (!session) return;

  const userId = session.user.id;
  _showSyncBanner('☁️ 클라우드에서 데이터 로드 중...');

  try {
    // Phase 2: 계정과목
    const cloudAccounts = await loadAccountsFromSupabase();
    if (cloudAccounts !== null) {
      if (cloudAccounts.length > 0) {
        DB.accounts = cloudAccounts;
        console.log(`✅ 계정과목 ${cloudAccounts.length}개 로드됨`);
        // The cloud snapshot can be older than this browser's app.js — e.g. a
        // new default account shipped in a code update but no device has yet
        // completed a login where the upload wins the race against this very
        // fetch. ensureAuditChartAccounts() is idempotent (code-based), so
        // re-running it here re-appends anything cloud is still missing and
        // pushes the healed list back up — every login self-heals the cloud
        // instead of the new accounts silently vanishing on each fetch.
        if (typeof ensureAuditChartAccounts === 'function' && ensureAuditChartAccounts()) {
          await _bulkUpsertAccounts(DB.accounts, userId);
          console.log(`☁️ 계정과목 보정 업로드됨 (${DB.accounts.length}개)`);
        }
      } else {
        await _bulkUpsertAccounts(DB.accounts, userId);
        console.log(`☁️ 계정과목 ${DB.accounts.length}개 업로드됨`);
      }
    }

    // Phase 3: 분개
    const cloudEntries = await loadEntriesFromSupabase();
    if (cloudEntries !== null) {
      if (cloudEntries.length > 0) {
        DB.entries = cloudEntries;
        console.log(`✅ 분개 ${cloudEntries.length}건 로드됨`);
      } else if (DB.entries.length > 0) {
        await _bulkUpsertEntries(DB.entries, userId);
        console.log(`☁️ 분개 ${DB.entries.length}건 업로드됨`);
      }
    }

    // Phase 4~5: 컬렉션
    for (const col of SYNC_COLLECTIONS) {
      const cloud = await _loadCollection(col);
      if (cloud === null) continue;
      if (cloud.length > 0) {
        DB[col] = cloud;
        console.log(`✅ ${col} ${cloud.length}건 로드됨`);
      } else if (DB[col] && DB[col].length > 0) {
        await _bulkUpsertCollection(col, DB[col], userId);
        console.log(`☁️ ${col} ${DB[col].length}건 업로드됨`);
      }
    }

    // Phase 6: 설정
    const cloudSettings = await _loadSettings(userId);
    if (cloudSettings) {
      DB.settings = { ...DB.settings, ...cloudSettings };
      console.log('✅ 설정 로드됨');
    } else if (DB.settings) {
      await _saveSettings(DB.settings, userId);
      console.log('☁️ 설정 업로드됨');
    }

    saveDB();

    // 현재 화면 새로고침
    const activeSection = document.querySelector('.section.active');
    if (activeSection && typeof showSection === 'function') {
      showSection(activeSection.id.replace('section-', ''));
    }

    _showSyncBanner('✅ 동기화 완료', 2500);
  } catch (e) {
    console.error('initSupabaseData 실패:', e);
    const msg = (e.message || '').toLowerCase();

    // A dropped connection is not a failed login. Signing out here would throw
    // away a perfectly good persisted session and make the user type their
    // password again after any Wi-Fi hiccup, laptop wake, or slow Supabase
    // response — so network faults keep the session and fall back to local data.
    // 'invalid' alone is also too broad (it matches ordinary SQL errors), hence
    // the narrower token/claim wording below.
    const isNetworkError = msg.includes('fetch') || msg.includes('network') ||
                           msg.includes('timeout') || msg.includes('abort');
    const isAuthError = !isNetworkError && (
      msg.includes('jwt') || msg.includes('unauthorized') || msg.includes('forbidden') ||
      msg.includes('invalid token') || msg.includes('invalid claim') ||
      msg.includes('session') && msg.includes('expired'));

    if (isAuthError) {
      // Try the refresh token before falling back to a password prompt.
      if (!_retried) {
        const refreshed = await _supabase.auth.refreshSession().catch(() => null);
        if (refreshed && refreshed.data && refreshed.data.session) {
          _showSyncBanner('🔄 세션 갱신 — 다시 시도합니다', 2500);
          return initSupabaseData(true);
        }
      }
      console.warn('인증 만료 — 재로그인 필요');
      await _supabase.auth.signOut().catch(() => {});
      if (typeof showLoginScreen === 'function') showLoginScreen();
    } else {
      _showSyncBanner('⚠️ 클라우드 연결 실패 — 로컬 데이터로 계속합니다 (로그인 유지됨)', 4000);
    }
  }
}

// ── 배너 UI ───────────────────────────────────────────

function _showSyncBanner(msg, autoHideMs = 0) {
  let el = document.getElementById('supabase-sync-banner');
  if (!el) {
    el = document.createElement('div');
    el.id = 'supabase-sync-banner';
    el.style.cssText = [
      'position:fixed', 'bottom:16px', 'right:16px', 'z-index:9998',
      'background:#1e293b', 'color:#e2e8f0', 'padding:10px 18px',
      'border-radius:8px', 'font-size:13px',
      'box-shadow:0 4px 12px rgba(0,0,0,0.3)', 'transition:opacity 0.4s'
    ].join(';');
    document.body.appendChild(el);
  }
  el.textContent = msg;
  el.style.opacity = '1';
  if (autoHideMs) setTimeout(() => { el.style.opacity = '0'; }, autoHideMs);
}
