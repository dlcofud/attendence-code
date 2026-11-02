// core/main.js — 앱 시작점: 화면 전환, 로그인 후 데이터·실시간·기능 연결

import { isConfigured, hasLib, sb } from './api.js';
import { $, toast } from './ui.js';
import { initAuth } from './auth.js';
import { initBoard, loadBoard, resetBoard, onSessionChange, onSubmissionChange } from './board.js';
import { subscribe, unsubscribe, renderLog, clearLog } from './realtime.js';
import { setUser, refreshStats, emit, registerFeature, mountFeatures, unmountFeatures } from './acs.js';

const views = { setup: $('#view-setup'), auth: $('#view-auth'), app: $('#view-app') };
function show(name) {
  for (const [key, el] of Object.entries(views)) el.hidden = key !== name;
  $('#session').hidden = name !== 'app';
}

async function loadNickname(user) {
  const { data } = await sb.from('profiles').select('nickname').eq('id', user.id).maybeSingle();
  return (data && data.nickname) || (user.user_metadata && user.user_metadata.nickname) || user.email;
}

// 기능 목록은 동적으로 불러옴 → features 쪽 코드에 오류가 있어도 core 는 정상 동작
function loadFeatures() {
  import('../features/index.js')
    .then((m) => (m.default || []).forEach(registerFeature))
    .catch((err) => console.error('[features] 기능 목록을 불러오지 못했어요', err));
}

function boot() {
  if (!isConfigured || !hasLib) {
    show('setup');
    if (isConfigured && !hasLib) $('#view-setup p').textContent = 'Supabase 라이브러리를 불러오지 못했어요. 네트워크를 확인하고 새로고침해 주세요.';
    return;
  }

  initBoard();
  renderLog();
  loadFeatures();

  initAuth({
    async onSignedIn(user) {
      show('app');
      const nickname = await loadNickname(user).catch(() => user.email);
      setUser(user, nickname);
      $('#me-nick').textContent = nickname;
      try {
        await Promise.all([refreshStats(), loadBoard()]);
      } catch (err) {
        toast(`불러오기 실패: ${err.message || err}`, 'error');
      }
      subscribe({
        session: onSessionChange,
        submission: onSubmissionChange,
        ledger: (p) => { refreshStats().catch(() => {}); emit('ledger:insert', p.new); },
        resync: () => { loadBoard().catch(() => {}); refreshStats().catch(() => {}); },
      });
      mountFeatures($('#features'));
      emit('ready', { user, nickname });
    },
    onSignedOut() {
      unsubscribe();
      unmountFeatures();
      setUser(null, '');
      resetBoard();
      clearLog();
      emit('logout');
      show('auth');
    },
  });

  // 탭이 잠들었다 깨면 놓친 변경을 다시 동기화
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible' && $('#view-app').hidden === false) {
      loadBoard().catch(() => {});
      refreshStats().catch(() => {});
    }
  });
}

boot();
