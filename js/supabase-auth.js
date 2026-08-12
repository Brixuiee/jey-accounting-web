/**
 * Supabase Authentication Module
 * Handles login, logout, and session management via Supabase Auth
 */

const SUPABASE_URL = 'https://yynxgmhzphqvklgbkgtn.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Inl5bnhnbWh6cGhxdmtsZ2JrZ3RuIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzkzNTk3NzYsImV4cCI6MjA5NDkzNTc3Nn0.PSFu97f1HBfE7CqP1ZYg-rs2o85NeL5ujmpvPzTyG54';

// 세션 정리
(function cleanupSessions() {
  // 1) 구 프로젝트 세션 제거
  Object.keys(localStorage)
    .filter(k => k.startsWith('sb-') && !k.includes('yynxgmhzphqvklgbkgtn'))
    .forEach(k => localStorage.removeItem(k));

  // 2) file:// 로 열면 Supabase CORS 제한 → 세션 캐시 무효, 항상 로그인 화면 표시
  if (location.protocol === 'file:') {
    Object.keys(localStorage)
      .filter(k => k.startsWith('sb-'))
      .forEach(k => localStorage.removeItem(k));
  }
})();

// Initialize Supabase client.
// The auth options are Supabase's defaults, but spelled out because this app
// depends on them: the session must survive closing the browser (한 번 로그인하면
// 계속 유지), and the access token must renew itself in the background so an
// expired token never bounces the user back to the login screen.
const _supabase = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
  auth: {
    persistSession: true,       // localStorage에 세션 보관 → 재방문 시 자동 로그인
    autoRefreshToken: true,     // 만료 전 토큰 자동 갱신
    detectSessionInUrl: false,  // OAuth 리디렉션 플로우를 쓰지 않음
  },
});

/**
 * Check if user is authenticated and get current session
 */
async function getSupabaseSession() {
  try {
    const { data, error } = await _supabase.auth.getSession();
    if (error) throw error;
    return data.session;
  } catch (error) {
    console.error('Failed to get session:', error);
    return null;
  }
}

/**
 * Sign in with email and password
 */
async function supabaseSignIn(email, password) {
  try {
    const { data, error } = await _supabase.auth.signInWithPassword({
      email: email,
      password: password,
    });
    if (error) throw error;
    return { success: true, user: data.user };
  } catch (error) {
    console.error('Sign in failed:', error);
    return { success: false, error: error.message };
  }
}

/**
 * Sign out (clear Supabase session)
 */
async function supabaseSignOut() {
  try {
    const { error } = await _supabase.auth.signOut();
    if (error) throw error;
    return { success: true };
  } catch (error) {
    console.error('Sign out failed:', error);
    return { success: false, error: error.message };
  }
}

/**
 * Get current user from Supabase session
 */
async function getSupabaseUser() {
  try {
    const { data, error } = await _supabase.auth.getUser();
    if (error) throw error;
    return data.user;
  } catch (error) {
    console.error('Failed to get user:', error);
    return null;
  }
}

/**
 * Listen to auth state changes (login/logout)
 */
function onSupabaseAuthStateChange(callback) {
  const { data: { subscription } } = _supabase.auth.onAuthStateChange((event, session) => {
    callback(event, session);
  });
  return subscription;
}
