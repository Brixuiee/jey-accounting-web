'use strict';
// ══════════════════════════════════════════════════════
//  Cloud Backup — 클라우드 자동 백업
//  ----------------------------------------------------
//  3가지 백업 방식:
//   1) 수동 다운로드 (기존) → iCloud Drive 폴더로 저장
//   2) 자동 스케줄 (일/주/월) → 백업 알림 + 자동 다운로드
//   3) File System Access API (Chrome) → 지정 폴더 자동 저장
//
//  iCloud 통합:
//   - macOS/iOS Safari에서 다운로드 폴더를
//     ~/Library/Mobile Documents/com~apple~CloudDocs/JEY/
//     로 설정하면 자동으로 iCloud 동기화됨
// ══════════════════════════════════════════════════════

const BACKUP_INTERVALS = {
  daily:   86400000,        // 1일
  weekly:  604800000,       // 7일
  monthly: 2592000000,      // 30일
};

function ensureBackupSettings() {
  if (!DB.backupSettings) {
    DB.backupSettings = {
      autoEnabled: false,
      interval: 'daily',
      lastBackup: null,
      retainCount: 30,    // keep last 30 backups in browser
      directoryHandle: null,   // File System API handle
    };
    saveDB();
  }
  if (!DB.backupHistory) {
    DB.backupHistory = [];
    saveDB();
  }
}

// ── Auto-backup Scheduler ────────────────────────────
function checkAutoBackup() {
  ensureBackupSettings();
  const s = DB.backupSettings;
  if (!s.autoEnabled) return;
  const now = Date.now();
  const last = s.lastBackup ? new Date(s.lastBackup).getTime() : 0;
  const interval = BACKUP_INTERVALS[s.interval] || BACKUP_INTERVALS.daily;
  if (now - last >= interval) {
    performAutoBackup();
  }
}

async function performAutoBackup() {
  ensureBackupSettings();
  const filename = `jey_accounting_auto_${today()}.json`;
  const data = JSON.stringify(DB, null, 2);

  let savedTo = null;
  // Try File System Access API first (Chrome desktop)
  if (DB.backupSettings.directoryHandle && 'showDirectoryPicker' in window) {
    try {
      const dir = DB.backupSettings.directoryHandle;
      // Verify permission
      const perm = await dir.queryPermission({mode:'readwrite'});
      if (perm === 'granted') {
        const fileHandle = await dir.getFileHandle(filename, {create: true});
        const writable = await fileHandle.createWritable();
        await writable.write(data);
        await writable.close();
        savedTo = `폴더 (${dir.name})`;
      }
    } catch (e) {
      console.warn('Directory backup failed:', e);
    }
  }

  // Fallback: download
  if (!savedTo) {
    const blob = new Blob([data], {type:'application/json'});
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = filename;
    a.click();
    URL.revokeObjectURL(a.href);
    savedTo = 'Downloads 폴더';
  }

  // Record
  DB.backupSettings.lastBackup = new Date().toISOString();
  DB.backupHistory.push({
    timestamp: new Date().toISOString(),
    filename, savedTo,
    size: data.length,
    auto: true,
  });
  // Trim history
  if (DB.backupHistory.length > DB.backupSettings.retainCount) {
    DB.backupHistory = DB.backupHistory.slice(-DB.backupSettings.retainCount);
  }
  saveDB();
  if (typeof renderCloudBackup === 'function') renderCloudBackup();
  // Notification
  showBackupToast(`✓ 자동 백업 완료: ${savedTo}`);
}

function showBackupToast(msg) {
  const t = document.createElement('div');
  t.style.cssText = `
    position:fixed;bottom:20px;right:20px;
    background:#1a3c5e;color:white;padding:.75rem 1.25rem;
    border-radius:6px;box-shadow:0 4px 12px rgba(0,0,0,.2);
    z-index:9999;font-size:.9rem;
  `;
  t.textContent = msg;
  document.body.appendChild(t);
  setTimeout(() => t.remove(), 4000);
}

// ── Cloud Backup UI ──────────────────────────────────
function renderCloudBackup() {
  ensureBackupSettings();
  const s = DB.backupSettings;
  const history = (DB.backupHistory||[]).slice(-20).reverse();
  const hasFileSystemAPI = 'showDirectoryPicker' in window;
  const lastBackupStr = s.lastBackup ? new Date(s.lastBackup).toLocaleString('ko-KR') : '없음';
  const nextScheduled = s.autoEnabled && s.lastBackup
    ? new Date(new Date(s.lastBackup).getTime() + BACKUP_INTERVALS[s.interval]).toLocaleString('ko-KR')
    : '—';

  document.getElementById('backup-output').innerHTML = `
    <div class="cards-grid" style="grid-template-columns:repeat(3,1fr);gap:.5rem;margin-bottom:1rem">
      <div class="stat-card">
        <div class="label">자동 백업</div>
        <div class="value" style="color:${s.autoEnabled?'#0ea572':'#dc2626'}">${s.autoEnabled?'ON':'OFF'}</div>
        <div style="font-size:.7rem;color:var(--text-muted);margin-top:.2rem">주기: ${{daily:'매일',weekly:'매주',monthly:'매월'}[s.interval]||s.interval}</div>
      </div>
      <div class="stat-card">
        <div class="label">최근 백업</div>
        <div class="value" style="font-size:.95rem">${lastBackupStr}</div>
      </div>
      <div class="stat-card">
        <div class="label">백업 이력</div>
        <div class="value">${(DB.backupHistory||[]).length}건</div>
      </div>
    </div>

    <div class="card">
      <h3>⚙️ 자동 백업 설정</h3>
      <div class="form-row" style="margin-top:.75rem">
        <div class="form-group">
          <label style="display:flex;align-items:center;gap:.5rem;font-weight:normal">
            <input type="checkbox" id="bk-auto-enabled" ${s.autoEnabled?'checked':''} onchange="updateBackupSettings()">
            자동 백업 활성화
          </label>
        </div>
        <div class="form-group">
          <label>주기</label>
          <select id="bk-interval" class="input" onchange="updateBackupSettings()">
            <option value="daily" ${s.interval==='daily'?'selected':''}>매일 (Daily)</option>
            <option value="weekly" ${s.interval==='weekly'?'selected':''}>매주 (Weekly)</option>
            <option value="monthly" ${s.interval==='monthly'?'selected':''}>매월 (Monthly)</option>
          </select>
        </div>
        <div class="form-group">
          <label>다음 예정</label>
          <input type="text" class="input" value="${nextScheduled}" readonly>
        </div>
      </div>
      <div style="margin-top:.5rem;display:flex;gap:.5rem">
        <button class="btn btn-primary" onclick="performAutoBackup()">💾 지금 백업</button>
        ${hasFileSystemAPI ? `<button class="btn btn-outline" onclick="pickBackupDirectory()">📁 백업 폴더 지정 ${s.directoryHandle?'(설정됨)':'(미설정)'}</button>` : ''}
      </div>
    </div>

    <div class="card" style="margin-top:1rem;background:linear-gradient(135deg,#e0e7ff,#eef2ff);border-left:4px solid #6366f1">
      <h3>☁️ iCloud Drive 설정 가이드 (Mac/iPhone)</h3>
      <ol style="font-size:.82rem;line-height:1.7;padding-left:1.25rem;margin-top:.5rem">
        <li><strong>Mac:</strong> Finder → iCloud Drive → "JEY Backup" 폴더 생성
          <code style="background:#f1f5f9;padding:.1rem .3rem;border-radius:3px;font-size:.72rem">~/Library/Mobile Documents/com~apple~CloudDocs/JEY Backup</code>
        </li>
        <li><strong>Mac Chrome:</strong> 위의 [📁 백업 폴더 지정] 클릭 → "JEY Backup" 폴더 선택
          <br>→ 자동 백업 시 이 폴더로 직접 저장 → iCloud 자동 동기화</li>
        <li><strong>Mac Safari / iPhone:</strong> 다운로드 후 "공유" → "파일에 저장" → iCloud Drive/JEY Backup</li>
        <li><strong>PWA로 설치한 경우:</strong> Mac Chrome 주소창 → 설치 아이콘 → 앱처럼 사용</li>
      </ol>
      <p style="font-size:.78rem;color:#3730a3;margin-top:.5rem">
        💡 <strong>iCloud Drive에 저장된 백업</strong>은 모든 Apple 기기 + Windows iCloud에서 동기화됩니다.
        다른 PC에서 같은 데이터로 작업 가능.
      </p>
    </div>

    <div class="card" style="margin-top:1rem">
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:.75rem">
        <h3>📜 백업 이력 (최근 20건)</h3>
        <div>
          <button class="btn btn-outline btn-sm" onclick="exportBackupHistory()">↓ 이력 CSV</button>
          <button class="btn btn-danger btn-sm" onclick="clearBackupHistory()" style="margin-left:.25rem">이력 초기화</button>
        </div>
      </div>
      <table class="table" style="font-size:.78rem">
        <thead><tr><th>시각</th><th>파일명</th><th>저장 위치</th><th class="num">크기</th><th>유형</th></tr></thead>
        <tbody>
          ${history.map(h => `<tr>
            <td>${new Date(h.timestamp).toLocaleString('ko-KR')}</td>
            <td style="font-family:monospace;font-size:.72rem">${h.filename}</td>
            <td>${h.savedTo}</td>
            <td class="num">${(h.size/1024).toFixed(1)} KB</td>
            <td>${h.auto?'<span style="color:#0ea572">자동</span>':'<span>수동</span>'}</td>
          </tr>`).join('') || '<tr><td colspan="5" class="empty-msg">백업 이력 없음</td></tr>'}
        </tbody>
      </table>
    </div>

    <div class="card" style="margin-top:1rem">
      <h3>📂 백업 파일에서 복원</h3>
      <p style="font-size:.82rem;color:var(--text-muted);margin:.5rem 0">
        과거 백업 파일(.json)을 선택하여 데이터 복원. <strong>현재 데이터를 덮어쓰므로 주의.</strong>
      </p>
      <label class="btn btn-outline" style="cursor:pointer;display:inline-block">
        📂 백업 파일 선택 (Restore)
        <input type="file" accept=".json" style="display:none" onchange="importJsonBackup(event)">
      </label>
    </div>
  `;
}

function updateBackupSettings() {
  ensureBackupSettings();
  DB.backupSettings.autoEnabled = document.getElementById('bk-auto-enabled').checked;
  DB.backupSettings.interval = document.getElementById('bk-interval').value;
  saveDB();
  renderCloudBackup();
}

async function pickBackupDirectory() {
  if (!('showDirectoryPicker' in window)) {
    alert('이 브라우저는 폴더 선택을 지원하지 않습니다. Chrome 데스크탑을 사용하세요.');
    return;
  }
  try {
    const dir = await window.showDirectoryPicker({mode: 'readwrite'});
    DB.backupSettings.directoryHandle = dir;  // Note: not serializable, but works in-session
    // We can't actually serialize this; user must re-pick after browser restart
    saveDB();
    alert(`✓ 백업 폴더 설정됨: ${dir.name}\n\n주의: 브라우저 재시작 후에는 다시 선택해야 합니다.`);
    renderCloudBackup();
  } catch (e) {
    if (e.name !== 'AbortError') console.error(e);
  }
}

function exportBackupHistory() {
  const csv = ['Timestamp,Filename,Location,Size (bytes),Type'];
  (DB.backupHistory||[]).forEach(h => {
    csv.push([h.timestamp, h.filename, h.savedTo, h.size, h.auto?'auto':'manual'].join(','));
  });
  const blob = new Blob(['﻿'+csv.join('\n')], {type:'text/csv;charset=utf-8'});
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `backup_history_${today()}.csv`;
  a.click();
}

function clearBackupHistory() {
  if (!confirm('백업 이력 기록을 초기화하시겠습니까? (실제 백업 파일은 영향 없음)')) return;
  DB.backupHistory = [];
  saveDB();
  renderCloudBackup();
}

// Wrap exportData (manual backup) to track in history
const _origExportData = typeof exportData === 'function' ? exportData : null;
window.exportData = function() {
  if (_origExportData) _origExportData();
  ensureBackupSettings();
  DB.backupHistory.push({
    timestamp: new Date().toISOString(),
    filename: `jey_accounting_${today()}.json`,
    savedTo: 'Downloads 폴더',
    size: JSON.stringify(DB).length,
    auto: false,
  });
  if (DB.backupHistory.length > DB.backupSettings.retainCount) {
    DB.backupHistory = DB.backupHistory.slice(-DB.backupSettings.retainCount);
  }
  saveDB();
};

// Check auto-backup on page load and every hour
setTimeout(() => {
  ensureBackupSettings();
  checkAutoBackup();
}, 5000);
setInterval(checkAutoBackup, 3600000);  // every hour
