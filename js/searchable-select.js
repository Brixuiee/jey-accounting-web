'use strict';
// ══════════════════════════════════════════════════════
//  검색되는 드롭다운 (Searchable Select)
//  ----------------------------------------------------
//  계정과목처럼 목록이 긴 <select>를, 몇 글자만 쳐도 걸러지는
//  입력창으로 바꿔준다. "주유", "5022", "petrol", "72900"
//  (감사코드) 어느 쪽으로 쳐도 찾아진다.
//
//  구현 방침: 기존 <select>를 DOM에 그대로 남겨두고(감춘 뒤) 그 앞에
//  입력창만 덧씌운다. 앱 곳곳이 `.qe-account[data-idx=..]`처럼 select를
//  직접 찾아 `.value`를 읽고 onchange를 걸어 쓰기 때문에, 이 방식이면
//  기존 코드를 한 줄도 고치지 않아도 된다. 입력창에는 select의 클래스를
//  절대 복사하지 않는다 — 복사하면 querySelector가 select 대신 입력창을
//  집어가서 값 읽기가 전부 깨진다.
// ══════════════════════════════════════════════════════

// 명시적으로 검색을 붙일 대상 + 옵션이 많은 select는 자동으로 붙는다.
const SS_EXPLICIT = [
  '.je-account', '.dc-acc', '.bs-account', '.bs-reclass-account',
  '.qe-account', '.qe-credit-account',
  '#pending-account', '#ledger-account',
  '[data-searchable]',
].join(',');
const SS_MIN_OPTIONS = 12;   // 이보다 짧으면 기본 드롭다운이 오히려 편하다

let _ssOpen = null;          // 현재 열려 있는 {sel, input, list, opts, idx}

function _ssShouldUpgrade(sel) {
  if (!(sel instanceof HTMLSelectElement)) return false;
  if (sel.multiple || sel.dataset.ssUpgraded || sel.dataset.ssSkip) return false;
  if (sel.matches(SS_EXPLICIT)) return true;
  return sel.options.length >= SS_MIN_OPTIONS;
}

function _ssLabel(sel) {
  const o = sel.selectedOptions[0];
  return o && o.value ? o.textContent.trim() : '';
}

// 화면에 보이는 글자만으로는 "petrol"(영문명)이나 "72900"(감사코드)로 못 찾는다.
// 표시는 그대로 두고, 검색 대상만 원본 데이터까지 넓힌다.
function _ssHaystack(o) {
  const s = o.textContent;
  const id = o.value;
  // DB는 app.js에서 `let`으로 선언되어 window.DB로는 잡히지 않는다 (let/const는
  // 전역 객체에 프로퍼티를 만들지 않음). 스코프 체인으로 직접 참조해야 한다.
  if (!id || typeof DB === 'undefined' || !DB) return s;
  const acc = DB.accounts?.find(a => a.id === id);
  if (acc) return `${s} ${acc.code||''} ${acc.nameKr||''} ${acc.nameEn||''} ${acc.auditCode||''}`;
  const party = DB.customers?.find(c => c.id === id) || DB.suppliers?.find(x => x.id === id);
  if (party) return `${s} ${party.code||''} ${party.name||''}`;
  return s;
}

// "주유 5022" 처럼 여러 조각을 쳐도 전부 포함되면 통과 (AND 매칭)
function _ssMatch(text, query) {
  const t = text.toLowerCase();
  return query.toLowerCase().split(/\s+/).filter(Boolean).every(tok => t.includes(tok));
}

function upgradeSearchableSelect(sel) {
  if (!_ssShouldUpgrade(sel)) return;
  sel.dataset.ssUpgraded = '1';

  const wrap = document.createElement('div');
  wrap.className = 'ss-wrap';
  sel.parentNode.insertBefore(wrap, sel);
  wrap.appendChild(sel);
  sel.style.display = 'none';

  const input = document.createElement('input');
  input.type = 'text';
  input.className = 'input ss-input';        // select의 식별 클래스는 복사 금지
  input.autocomplete = 'off';
  input.placeholder = sel.dataset.ssPlaceholder || '이름·코드 입력';
  input.style.cssText = sel.style.cssText.replace(/display\s*:\s*none;?/i, '');
  wrap.appendChild(input);

  const sync = () => { input.value = _ssLabel(sel); };
  sync();

  // 다른 코드가 sel.value를 프로그램적으로 바꿨을 때를 대비해 다시 맞춘다.
  sel.addEventListener('change', sync);
  input.addEventListener('focus', () => { sync(); _ssOpenList(sel, input, ''); input.select(); });
  input.addEventListener('click', () => { if (!_ssOpen) _ssOpenList(sel, input, ''); });
  input.addEventListener('input', () => _ssOpenList(sel, input, input.value));
  input.addEventListener('blur', () => setTimeout(() => { if (!_ssOpen) sync(); }, 150));
  input.addEventListener('keydown', e => _ssKey(e, sel, input));
}

function _ssOpenList(sel, input, query) {
  _ssCloseList(false);

  const opts = [...sel.options]
    .filter(o => o.value !== '' || !query)          // 빈 "-- 선택 --" 은 검색 중엔 숨김
    .filter(o => !query || _ssMatch(_ssHaystack(o), query));

  const list = document.createElement('div');
  list.className = 'ss-list';
  // overflow:auto 컨테이너(표 안 등)에 잘리지 않도록 fixed로 띄운다.
  list.style.position = 'fixed';
  list.style.zIndex = '99999';

  if (!opts.length) {
    list.innerHTML = `<div class="ss-empty">일치하는 계정이 없습니다</div>`;
  } else {
    list.innerHTML = opts.map((o, i) =>
      `<div class="ss-opt${o.value === sel.value ? ' ss-cur' : ''}" data-i="${i}">${o.textContent}</div>`
    ).join('');
  }
  document.body.appendChild(list);

  _ssOpen = {sel, input, list, opts, idx: Math.max(0, opts.findIndex(o => o.value === sel.value))};
  _ssPosition();
  _ssHighlight();

  list.addEventListener('mousedown', e => {       // blur보다 먼저 잡아야 한다
    const el = e.target.closest('.ss-opt');
    if (!el) return;
    e.preventDefault();
    _ssPick(opts[Number(el.dataset.i)]);
  });
}

function _ssPosition() {
  if (!_ssOpen) return;
  const r = _ssOpen.input.getBoundingClientRect();
  const list = _ssOpen.list;
  const below = window.innerHeight - r.bottom;
  list.style.left = `${r.left}px`;
  list.style.width = `${Math.max(r.width, 240)}px`;
  if (below < 200 && r.top > below) {            // 아래 공간이 좁으면 위로 편다
    list.style.top = 'auto';
    list.style.bottom = `${window.innerHeight - r.top + 2}px`;
    list.style.maxHeight = `${Math.min(280, r.top - 8)}px`;
  } else {
    list.style.bottom = 'auto';
    list.style.top = `${r.bottom + 2}px`;
    list.style.maxHeight = `${Math.min(280, below - 8)}px`;
  }
}

function _ssHighlight() {
  if (!_ssOpen) return;
  const els = [..._ssOpen.list.querySelectorAll('.ss-opt')];
  els.forEach((el, i) => el.classList.toggle('ss-active', i === _ssOpen.idx));
  els[_ssOpen.idx]?.scrollIntoView({block: 'nearest'});
}

function _ssPick(opt) {
  if (!_ssOpen || !opt) return;
  const {sel, input} = _ssOpen;
  sel.value = opt.value;
  input.value = opt.textContent.trim();
  _ssCloseList(false);
  // 기존 onchange 핸들러(onQETypeChange, updateDCTotals 등)가 돌도록 알린다.
  sel.dispatchEvent(new Event('change', {bubbles: true}));
}

function _ssCloseList(restoreLabel = true) {
  if (!_ssOpen) return;
  const {sel, input, list} = _ssOpen;
  list.remove();
  _ssOpen = null;
  if (restoreLabel) input.value = _ssLabel(sel);
}

function _ssKey(e, sel, input) {
  if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
    e.preventDefault();
    if (!_ssOpen) return _ssOpenList(sel, input, input.value);
    _ssOpen.idx = Math.max(0, Math.min(_ssOpen.opts.length - 1,
      _ssOpen.idx + (e.key === 'ArrowDown' ? 1 : -1)));
    _ssHighlight();
  } else if (e.key === 'Enter') {
    if (_ssOpen && _ssOpen.opts.length) { e.preventDefault(); _ssPick(_ssOpen.opts[_ssOpen.idx]); }
  } else if (e.key === 'Escape') {
    if (_ssOpen) { e.preventDefault(); _ssCloseList(); input.blur(); }
  } else if (e.key === 'Tab') {
    _ssCloseList();
  }
}

document.addEventListener('mousedown', e => {
  if (_ssOpen && !e.target.closest('.ss-wrap') && !e.target.closest('.ss-list')) _ssCloseList();
});
window.addEventListener('scroll', () => _ssPosition(), true);
window.addEventListener('resize', () => _ssPosition());

// ── 새로 그려지는 화면(미리보기·분개줄 등)도 자동으로 적용 ─────────────
function upgradeAllSearchableSelects(root = document) {
  root.querySelectorAll('select').forEach(upgradeSearchableSelect);
}

(function _ssInit() {
  const style = document.createElement('style');
  style.textContent = `
    .ss-wrap { position: relative; display: block; }
    .ss-input { width: 100%; cursor: text; }
    .ss-list {
      background: #fff; border: 1px solid #cbd5e1; border-radius: 6px;
      box-shadow: 0 8px 24px rgba(15,23,42,.18); overflow-y: auto; font-size: .82rem;
    }
    .ss-opt { padding: .38rem .6rem; cursor: pointer; white-space: nowrap;
              overflow: hidden; text-overflow: ellipsis; }
    .ss-opt:hover, .ss-opt.ss-active { background: #eef2ff; }
    .ss-opt.ss-cur { font-weight: 700; }
    .ss-empty { padding: .5rem .6rem; color: #94a3b8; }
  `;
  document.head.appendChild(style);

  const run = () => {
    upgradeAllSearchableSelects();
    // 미리보기 화면들이 innerHTML 직후 select.value를 프로그램적으로 채우므로,
    // 그보다 늦게 붙어야 입력창에 올바른 라벨이 표시된다.
    new MutationObserver(muts => {
      let touched = false;
      for (const m of muts) for (const n of m.addedNodes) {
        if (n.nodeType === 1 && (n.matches?.('select') || n.querySelector?.('select'))) touched = true;
      }
      if (touched) setTimeout(upgradeAllSearchableSelects, 60);
    }).observe(document.body, {childList: true, subtree: true});
  };

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', run);
  else run();
})();
