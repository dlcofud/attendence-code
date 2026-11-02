// core/auth.js — 이메일+비밀번호 로그인 / 회원가입

import { sb } from './api.js';
import { $ } from './ui.js';

function authError(err) {
  const m = String((err && err.message) || '').toLowerCase();
  if (m.includes('invalid login')) return '이메일 또는 비밀번호가 맞지 않아요.';
  if (m.includes('email not confirmed')) return '이메일 인증을 먼저 완료해 주세요. 받은편지함(스팸함 포함)을 확인해 보세요.';
  if (m.includes('already registered')) return '이미 가입된 이메일이에요. 로그인해 주세요.';
  if (m.includes('not authorized')) return '인증 메일을 보낼 수 없는 주소예요. 관리자에게 SMTP 설정을 요청해 주세요.';
  if (m.includes('rate limit')) return '요청이 너무 많아요. 잠시 후 다시 시도해 주세요.';
  if (m.includes('password')) return '비밀번호는 6자 이상이어야 해요.';
  if (m.includes('email')) return '이메일 형식을 확인해 주세요.';
  return (err && err.message) || '알 수 없는 오류가 발생했어요.';
}

export function initAuth({ onSignedIn, onSignedOut }) {
  const form = $('#form-auth');
  const msg = $('#auth-msg');
  const submitBtn = $('#auth-submit');
  let mode = 'login';
  let currentUserId = null;

  const setMsg = (text, kind) => { msg.textContent = text || ''; msg.className = `form-msg ${kind || ''}`; };
  const setMode = (m, keepMsg) => {
    mode = m;
    document.querySelectorAll('.tab').forEach((t) => t.setAttribute('aria-selected', String(t.dataset.tab === m)));
    $('#field-nick').hidden = m !== 'signup';
    submitBtn.textContent = m === 'signup' ? '가입하기' : '로그인';
    form.password.setAttribute('autocomplete', m === 'signup' ? 'new-password' : 'current-password');
    if (!keepMsg) setMsg('');
  };
  document.querySelectorAll('.tab').forEach((t) => t.addEventListener('click', () => setMode(t.dataset.tab)));

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const email = form.email.value.trim();
    const password = form.password.value;
    const nickname = form.nickname.value.trim();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return setMsg('이메일 형식을 확인해 주세요.', 'error');
    if (password.length < 6) return setMsg('비밀번호는 6자 이상이어야 해요.', 'error');
    if (mode === 'signup' && (nickname.length < 1 || nickname.length > 20)) {
      return setMsg('닉네임을 1~20자로 입력해 주세요.', 'error');
    }

    submitBtn.disabled = true;
    setMsg(mode === 'signup' ? '가입 중…' : '로그인 중…');
    try {
      if (mode === 'signup') {
        const { data, error } = await sb.auth.signUp({
          email, password,
          options: { data: { nickname }, emailRedirectTo: location.origin + location.pathname },
        });
        if (error) throw error;
        if (!data.session) {
          setMode('login', true);
          const dup = data.user && Array.isArray(data.user.identities) && data.user.identities.length === 0;
          setMsg(dup ? '이미 가입된 이메일이에요. 로그인해 주세요.'
                     : '인증 메일을 보냈어요. 메일의 링크를 누르면 자동으로 로그인돼요.', dup ? 'error' : 'ok');
        }
      } else {
        const { error } = await sb.auth.signInWithPassword({ email, password });
        if (error) throw error;
      }
    } catch (err) {
      setMsg(authError(err), 'error');
    } finally {
      submitBtn.disabled = false;
    }
  });

  $('#logout').addEventListener('click', () => sb.auth.signOut());

  // 콜백 안에서 바로 supabase 를 호출하면 교착될 수 있어 다음 틱으로 미룸
  sb.auth.onAuthStateChange((_event, session) => setTimeout(() => {
    const user = session && session.user;
    if (!user) {
      if (currentUserId !== null || _event === 'INITIAL_SESSION' || _event === 'SIGNED_OUT') {
        currentUserId = null;
        onSignedOut();
      }
      return;
    }
    if (currentUserId === user.id) return; // 토큰 갱신 등
    currentUserId = user.id;
    onSignedIn(user);
  }, 0));
}
