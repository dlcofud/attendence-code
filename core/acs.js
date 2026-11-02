// core/acs.js — features 팀에게 제공하는 공용 API (ACS = Attendance Code Share)
//
//  features 는 이 파일의 ACS 객체만 사용합니다. core 내부 구조가 바뀌어도
//  ACS 의 모양(아래 문서)은 유지하는 것이 core 팀의 약속입니다.
//
//  ACS.version                 1
//  ACS.supabase                Supabase 클라이언트 (기능 전용 테이블 읽기 등)
//  ACS.user / ACS.nickname     로그인한 사용자 / 닉네임
//  ACS.stats                   { uploaded, verified, pending, wrong, unlocked, credits }
//  ACS.rpc(name, args)         서버 함수 호출 → 결과 (실패 시 Error, message 는 한국어)
//  ACS.refreshStats()          잔액 다시 읽기 → stats
//  ACS.toast(msg, 'error'?)    알림
//  ACS.on(event, fn) → off()   이벤트 구독. 이벤트:
//        'ready'            로그인 완료 { user, nickname }
//        'logout'
//        'stats'            stats 객체
//        'session:insert'   새 세션(코드 묶음) 행
//        'session:update'   세션 집계 변경 행
//        'ledger:insert'    내 열람권 장부에 새 줄 (지급/차감)
//  ACS.h(tag, attrs, ...children)  안전한 DOM 생성기

import { sb, rpc } from './api.js';
import { h, toast } from './ui.js';

const listeners = new Map();
const state = {
  user: null,
  nickname: '',
  stats: { uploaded: 0, verified: 0, pending: 0, wrong: 0, unlocked: 0, credits: 0 },
};
const features = [];
const mounted = new Map();
let slotRoot = null;

export function on(event, fn) {
  if (!listeners.has(event)) listeners.set(event, new Set());
  listeners.get(event).add(fn);
  return () => listeners.get(event).delete(fn);
}

export function emit(event, payload) {
  for (const fn of listeners.get(event) || []) {
    try { fn(payload); } catch (err) { console.error(`[ACS] '${event}' 처리 중 오류`, err); }
  }
}

export function getState() { return state; }

export function setUser(user, nickname) {
  state.user = user;
  state.nickname = nickname || '';
}

export function setStats(s) {
  if (!s) return;
  const n = (v) => Number(v) || 0;
  state.stats = {
    uploaded: n(s.uploaded), verified: n(s.verified), pending: n(s.pending),
    wrong: n(s.wrong), unlocked: n(s.unlocked), credits: n(s.credits),
  };
  emit('stats', { ...state.stats });
}

export async function refreshStats() {
  setStats(await rpc('my_stats'));
  return { ...state.stats };
}

/* ---------------- 기능(feature) 등록 · 마운트 ---------------- */

export function registerFeature(def) {
  if (!def || typeof def.id !== 'string' || typeof def.mount !== 'function') {
    console.error('[ACS] 기능 정의에는 id(문자열)와 mount(함수)가 필요해요.', def);
    return;
  }
  if (features.some((f) => f.id === def.id)) {
    console.warn(`[ACS] 기능 id '${def.id}' 가 중복이에요. 무시합니다.`);
    return;
  }
  features.push(def);
  if (state.user && slotRoot) mountOne(def);
}

export function mountFeatures(root) {
  slotRoot = root;
  root.replaceChildren();
  features.forEach(mountOne);
  root.hidden = features.length === 0;
}

export function unmountFeatures() {
  for (const m of mounted.values()) {
    try { if (m.cleanup) m.cleanup(); } catch (err) { console.error(err); }
    m.card.remove();
  }
  mounted.clear();
  if (slotRoot) slotRoot.hidden = true;
}

function mountOne(def) {
  const body = h('div', { class: 'feature-body' });
  const card = h('section', { class: 'card feature', 'data-feature': def.id },
    h('div', { class: 'section-head' },
      h('h2', { text: def.title || def.id }),
      def.owner ? h('span', { class: 'muted small', text: def.owner }) : null,
    ),
    body,
  );
  slotRoot.append(card);
  slotRoot.hidden = false;
  const entry = { card, cleanup: null };
  mounted.set(def.id, entry);

  const fail = (err) => {
    console.error(`[feature:${def.id}]`, err);
    body.replaceChildren(h('p', { class: 'form-msg error', text: `이 기능을 불러오지 못했어요: ${err.message || err}` }));
  };
  try {
    Promise.resolve(def.mount(body, ACS))
      .then((cleanup) => { if (typeof cleanup === 'function') entry.cleanup = cleanup; })
      .catch(fail);
  } catch (err) {
    fail(err);
  }
}

export const ACS = Object.freeze({
  version: 1,
  get supabase() { return sb; },
  get user() { return state.user; },
  get nickname() { return state.nickname; },
  get stats() { return { ...state.stats }; },
  rpc,
  refreshStats,
  toast,
  on,
  h,
});

window.ACS = ACS;
