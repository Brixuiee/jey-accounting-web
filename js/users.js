'use strict';
// ══════════════════════════════════════════════════════
//  User Management & Permissions (localStorage-based)
//  ══════════════════════════════════════════════════════

const ROLES = {
  admin:      {label:'관리자 (Admin)',       perms: ['*']},
  manager:    {label:'매니저 (Manager)',     perms: ['view','create','edit','delete','reports','close']},
  bookkeeper: {label:'경리/회계 (Bookkeeper)', perms: ['view','create','edit','reports']},
  viewer:     {label:'조회 (Viewer)',         perms: ['view','reports']},
};

let _currentUser = null;

// Initialize user system (Supabase Auth + localStorage role)
async function initUserSystem() {
  try {
    const session = await getSupabaseSession();
    if (!session || !session.user) {
      showLoginScreen();
    } else {
      _currentUser = {
        id: session.user.id,
        email: session.user.email,
        role: localStorage.getItem('jey_user_role') || 'viewer'
      };
      updateUserBadge();
      applyPermissionUI();
      // 이미 로그인된 세션 → Supabase에서 최신 데이터 로드
      if (typeof initSupabaseData === 'function') {
        initSupabaseData().catch(e => console.warn('initSupabaseData 실패:', e));
      }
    }
  } catch (error) {
    console.error('initUserSystem error:', error);
    showLoginScreen();
  }
}

function currentUser() {
  return _currentUser;
}

function hasPermission(action) {
  const u = currentUser();
  if (!u) return false;
  const role = ROLES[u.role] || ROLES.viewer;
  return role.perms.includes('*') || role.perms.includes(action);
}

function logAction(action, target='', details='') {
  if (!DB.auditLog) DB.auditLog = [];
  const u = currentUser();
  DB.auditLog.push({
    id: uid(),
    timestamp: new Date().toISOString(),
    user: u?.email || 'unknown',
    action,
    target,
    details
  });
  if (DB.auditLog.length > 1000) DB.auditLog = DB.auditLog.slice(-1000);
  saveDB();
}

function checkPermission(action) {
  if (!hasPermission(action)) {
    alert(`권한 없음 (${action}). 관리자에게 문의하세요.`);
    return false;
  }
  return true;
}

function applyPermissionUI() {
  const u = currentUser();
  if (!u) return;
  const isViewer = u.role === 'viewer';
  const isBookkeeper = u.role === 'bookkeeper';
  let style = document.getElementById('perm-style');
  if (!style) {
    style = document.createElement('style');
    style.id = 'perm-style';
    document.head.appendChild(style);
  }
  let css = '';
  if (isViewer) {
    css = `
      .btn-primary, .btn-accent, .btn-danger {
        display: none !important;
      }
      input, select, textarea { background:#f8fafc !important; pointer-events:none; }
    `;
  } else if (isBookkeeper) {
    css = `
      .btn-danger { opacity: 0.5; pointer-events: none; }
    `;
  }
  style.textContent = css;
}

function updateUserBadge() {
  const u = currentUser();
  let badge = document.getElementById('user-badge');
  if (!badge) {
    badge = document.createElement('div');
    badge.id = 'user-badge';
    badge.style.cssText = `
      padding:.5rem .75rem;background:rgba(0,0,0,.15);margin:auto .75rem .75rem;
      border-radius:6px;font-size:.78rem;color:white;cursor:pointer;
      transition:background .15s;
    `;
    badge.title = '클릭하여 로그아웃';
    badge.onclick = handleLogout;
    badge.onmouseenter = () => badge.style.background = 'rgba(0,0,0,.3)';
    badge.onmouseleave = () => badge.style.background = 'rgba(0,0,0,.15)';
    const sidebar = document.getElementById('sidebar');
    if (sidebar) sidebar.appendChild(badge);
  }
  if (u) {
    const roleLabel = ROLES[u.role]?.label || u.role;
    badge.innerHTML = `<strong>${u.email}</strong><br><span style="font-size:.7rem;opacity:.8">${roleLabel}</span>`;
    badge.style.display = '';
  } else {
    badge.style.display = 'none';
  }
}

// ── Login Screen ───────────────────────────────────────
function showLoginScreen() {
  const overlay = document.createElement('div');
  overlay.id = 'login-overlay';
  overlay.style.cssText = `
    position: fixed; top: 0; left: 0; right: 0; bottom: 0;
    background: rgba(0,0,0,0.7); display: flex; align-items: center;
    justify-content: center; z-index: 9999;
  `;

  overlay.innerHTML = `
    <div style="background: white; padding: 40px; border-radius: 8px; width: 300px; box-shadow: 0 4px 6px rgba(0,0,0,0.1)">
      <h2 style="margin-top: 0; color: #333">로그인</h2>
      <form onsubmit="handleLogin(this); return false">
        <div style="margin-bottom: 15px">
          <label style="display: block; margin-bottom: 5px; font-weight: bold">이메일</label>
          <input type="email" id="login-username" placeholder="admin@jey.com" required style="width: 100%; padding: 8px; border: 1px solid #ddd; border-radius: 4px; box-sizing: border-box">
        </div>
        <div style="margin-bottom: 15px">
          <label style="display: block; margin-bottom: 5px; font-weight: bold">비밀번호</label>
          <input type="password" id="login-password" placeholder="password" required style="width: 100%; padding: 8px; border: 1px solid #ddd; border-radius: 4px; box-sizing: border-box">
        </div>
        <div style="margin-bottom: 15px">
          <label style="display: block; margin-bottom: 5px; font-weight: bold">역할</label>
          <select id="login-role" style="width: 100%; padding: 8px; border: 1px solid #ddd; border-radius: 4px; box-sizing: border-box">
            <option value="admin">관리자</option>
            <option value="manager">매니저</option>
            <option value="bookkeeper">경리</option>
            <option value="viewer">조회만</option>
          </select>
        </div>
        <button type="submit" style="width: 100%; padding: 10px; background: #007AFF; color: white; border: none; border-radius: 4px; font-weight: bold; cursor: pointer">로그인</button>
      </form>
      <div id="login-error" style="color: red; margin-top: 10px; font-size: 12px"></div>
    </div>
  `;

  document.body.appendChild(overlay);
}

async function handleLogin(form) {
  const email = document.getElementById('login-username').value;
  const password = document.getElementById('login-password').value;
  const role = document.getElementById('login-role').value;

  if (!email || !password) {
    document.getElementById('login-error').textContent = '이메일과 비밀번호를 입력하세요';
    return;
  }

  try {
    const result = await supabaseSignIn(email, password);
    if (!result.success) {
      document.getElementById('login-error').textContent = result.error || '로그인 실패';
      return;
    }

    // Store user info
    const user = result.user;
    _currentUser = {
      id: user.id,
      email: user.email,
      role: role
    };

    // Store role in localStorage (Phase 2: will read from profiles table)
    localStorage.setItem('jey_user_role', role);

    updateUserBadge();
    applyPermissionUI();
    logAction('login', 'session', `로그인 from ${navigator.userAgent.slice(0,30)}`);

    // Remove login overlay
    const overlay = document.getElementById('login-overlay');
    if (overlay) overlay.remove();

    // 로그인 직후 Supabase에서 최신 데이터 로드
    if (typeof initSupabaseData === 'function') {
      initSupabaseData().catch(e => console.warn('initSupabaseData 실패:', e));
    }
  } catch (error) {
    console.error('Login error:', error);
    document.getElementById('login-error').textContent = '로그인 중 오류 발생';
  }
}

async function handleLogout() {
  if (!confirm('로그아웃하시겠습니까?')) return;
  try {
    logAction('logout', 'session');
    await supabaseSignOut();
    localStorage.removeItem('jey_user_role');
    _currentUser = null;
    location.reload();
  } catch (error) {
    console.error('Logout error:', error);
    alert('로그아웃 중 오류 발생');
  }
}

// ── User Management UI ──────────────────────────────────
function renderUsersManagement() {
  const u = currentUser();
  const out = document.getElementById('users-output');
  if (!out) return;

  out.innerHTML = `
    <div class="card">
      <h3 style="margin-bottom:.5rem">현재 로그인</h3>
      <p style="font-size:.85rem">
        <strong>${u?.email || '—'}</strong>
        &nbsp;(${ROLES[u?.role]?.label || u?.role || '—'})
      </p>
      <p style="font-size:.75rem;color:var(--text-muted)">
        역할은 로그인 화면에서 선택합니다. 계정별 역할 관리는 추후 지원 예정입니다.
      </p>
    </div>

    <div class="card" style="margin-top:1rem">
      <h3 style="margin-bottom:.5rem">📜 활동 로그 (Audit Log) — 최근 50건</h3>
      <table class="table" style="font-size:.78rem">
        <thead><tr><th>시각</th><th>사용자</th><th>동작</th><th>대상</th><th>상세</th></tr></thead>
        <tbody>
          ${(DB.auditLog||[]).slice(-50).reverse().map(log=>`<tr>
            <td style="font-family:monospace;font-size:.7rem">${new Date(log.timestamp).toLocaleString('ko-KR')}</td>
            <td>${log.user}</td>
            <td>${log.action}</td>
            <td>${log.target}</td>
            <td>${log.details}</td>
          </tr>`).join('')}
        </tbody>
      </table>
    </div>
  `;
}

// Initialize on page load
window.addEventListener('load', () => {
  initUserSystem().catch(error => {
    console.error('Failed to initialize user system:', error);
    showLoginScreen();
  });
});
