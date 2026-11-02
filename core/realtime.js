// core/realtime.js — Supabase Realtime 구독 + JSON 로그 패널

import { sb } from './api.js';
import { $ } from './ui.js';

const LOG_MAX = 30;
let channel = null;
let subscribedOnce = false;
const log = [];

function setLive(status) {
  const el = $('#live');
  const text = $('#live-text');
  if (status === 'SUBSCRIBED') { el.dataset.state = 'on'; text.textContent = '실시간'; }
  else if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT') { el.dataset.state = 'error'; text.textContent = '재연결 중'; }
  else { el.dataset.state = 'off'; text.textContent = '연결 중'; }
}

function pushLog(p) {
  log.unshift({
    received_at: new Date().toISOString(),
    eventType: p.eventType,
    table: p.table,
    commit_timestamp: p.commit_timestamp,
    new: p.new && Object.keys(p.new).length ? p.new : undefined,
    old: p.old && Object.keys(p.old).length ? p.old : undefined,
  });
  log.length = Math.min(log.length, LOG_MAX);
  renderLog();
}

export function renderLog() {
  $('#log').textContent = log.length
    ? log.map((e) => JSON.stringify(e, null, 2)).join('\n\n')
    : '아직 받은 이벤트가 없어요. 누군가 코드를 올리면 여기에 JSON으로 찍혀요.';
  $('#log-count').textContent = `${log.length}건`;
}

export function clearLog() {
  log.length = 0;
  renderLog();
}

/**
 * handlers: { session(payload), submission(payload), ledger(payload), resync() }
 *  - sessions      : 모두에게 전달 (숫자 없음)
 *  - submissions   : RLS 때문에 내 행만 전달됨
 *  - credit_ledger : RLS 때문에 내 행만 전달됨
 */
export function subscribe(handlers) {
  unsubscribe();
  const wrap = (fn) => (p) => { pushLog(p); try { fn(p); } catch (err) { console.error(err); } };
  channel = sb
    .channel('acs-core')
    .on('postgres_changes', { event: '*', schema: 'public', table: 'sessions' }, wrap(handlers.session))
    .on('postgres_changes', { event: '*', schema: 'public', table: 'submissions' }, wrap(handlers.submission))
    .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'credit_ledger' }, wrap(handlers.ledger))
    .subscribe((status) => {
      setLive(status);
      if (status === 'SUBSCRIBED') {
        if (subscribedOnce) handlers.resync(); // 재연결 시 놓친 변경 동기화
        subscribedOnce = true;
      }
    });
}

export function unsubscribe() {
  if (channel) sb.removeChannel(channel);
  channel = null;
  subscribedOnce = false;
  setLive('CLOSED');
}
