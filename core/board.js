// core/board.js — 코드 올리기 폼 + 세션 카드 보드 + 내 현황

import { sb, rpc } from './api.js';
import { $, h, toast, parseTs, fmtLeft, fmtAgo, courseKey } from './ui.js';
import { getState, setStats, refreshStats, on, emit } from './acs.js';
import { createCoursePicker } from './coursePicker.js';

const WINDOW_MIN = 60; // 최근 60분 안에 끝난 세션까지 불러옴
const STATUS = { pending: '확인 대기', verified: '확인됨', wrong: '틀림' };

const B = {
  sessions: new Map(),   // id -> sessions 행
  mine: new Map(),       // session_id -> 내 submission { id, code, status }
  unlocked: new Set(),   // 내가 연 session_id
  views: new Map(),      // session_id -> session_candidates 결과
  fresh: new Set(),
  cardEls: new Map(),
  viewTimers: new Map(),
  filter: '',
  showExpired: false,
  justSubmitted: null,   // { key, at } 내 업로드로 생긴 세션 알림 억제용
};
let picker = null;

/* ------------------------------------------------------------------ *
 *  초기화
 * ------------------------------------------------------------------ */
export function initBoard() {
  picker = createCoursePicker();
  $('#course-picker').replaceChildren(picker.el);

  const form = $('#form-upload');
  form.code.addEventListener('input', (e) => { e.target.value = e.target.value.replace(/\D/g, '').slice(0, 4); });
  form.addEventListener('submit', onSubmit);

  $('#filter').addEventListener('input', (e) => { B.filter = e.target.value; renderAll(); });
  $('#show-expired').addEventListener('change', (e) => { B.showExpired = e.target.checked; renderAll(); });

  on('stats', renderStats);
  setInterval(tick, 1000);
}

export function resetBoard() {
  B.sessions.clear(); B.mine.clear(); B.unlocked.clear(); B.views.clear(); B.fresh.clear();
  B.cardEls.clear();
  $('#cards').replaceChildren();
  renderStats({ uploaded: 0, verified: 0, pending: 0, wrong: 0, unlocked: 0, credits: 0 });
}

export async function loadBoard() {
  const since = new Date(Date.now() - WINDOW_MIN * 60000).toISOString();
  const { data, error } = await sb
    .from('sessions').select('*')
    .gte('expires_at', since)
    .order('opened_at', { ascending: false })
    .limit(300);
  if (error) throw error;

  B.sessions = new Map(data.map((r) => [r.id, r]));
  B.mine.clear(); B.unlocked.clear(); B.views.clear();
  const ids = data.map((r) => r.id);
  if (ids.length) {
    const [subs, unl] = await Promise.all([
      sb.from('submissions').select('id, session_id, code, status').in('session_id', ids), // RLS: 내 것만
      sb.from('session_unlocks').select('session_id').in('session_id', ids),               // RLS: 내 것만
    ]);
    if (subs.error) throw subs.error;
    if (unl.error) throw unl.error;
    subs.data.forEach((s) => B.mine.set(s.session_id, s));
    unl.data.forEach((u) => B.unlocked.add(u.session_id));
    await Promise.all([...new Set([...B.mine.keys(), ...B.unlocked])].map(fetchView));
  }
  renderAll();
}

async function fetchView(id) {
  try { B.views.set(id, await rpc('session_candidates', { p_session_id: id })); }
  catch (err) { console.warn('[board] session_candidates', id, err.message); }
}

function scheduleView(id) {
  clearTimeout(B.viewTimers.get(id));
  B.viewTimers.set(id, setTimeout(async () => { await fetchView(id); refreshCard(id); }, 250));
}

/* ------------------------------------------------------------------ *
 *  실시간 이벤트 (main.js 가 연결)
 * ------------------------------------------------------------------ */
export function onSessionChange(p) {
  if (!getState().user) return;
  if (p.eventType === 'INSERT') {
    const r = p.new;
    B.sessions.set(r.id, r);
    const mineJust = B.justSubmitted && B.justSubmitted.key === r.course_key && Date.now() - B.justSubmitted.at < 8000;
    if (!mineJust) {
      B.fresh.add(r.id);
      setTimeout(() => { B.fresh.delete(r.id); refreshCard(r.id); }, 5000);
      toast(`새 코드: ${r.course}`);
    }
    renderAll();
    emit('session:insert', r);
  } else if (p.eventType === 'UPDATE') {
    const r = { ...(B.sessions.get(p.new.id) || {}), ...p.new };
    B.sessions.set(r.id, r);
    if (B.unlocked.has(r.id) || B.mine.has(r.id)) scheduleView(r.id);
    refreshCard(r.id);
    emit('session:update', r);
  }
}

export function onSubmissionChange(p) {
  const r = p.new;
  if (!r || !r.session_id) return;
  const prev = B.mine.get(r.session_id);
  B.mine.set(r.session_id, { id: r.id, session_id: r.session_id, code: r.code, status: r.status });
  if (prev && prev.status !== r.status) {
    const course = (B.sessions.get(r.session_id) || {}).course || '';
    if (r.status === 'verified') toast(`내 코드(${course})가 확인됐어요! 열람권 +1`);
    else if (r.status === 'wrong') toast(`내 코드(${course})가 틀린 것으로 판정돼 보상이 취소됐어요.`, 'error');
    refreshStats().catch(() => {});
  }
  scheduleView(r.session_id);
}

/* ------------------------------------------------------------------ *
 *  동작
 * ------------------------------------------------------------------ */
async function onSubmit(e) {
  e.preventDefault();
  const form = e.currentTarget;
  const course = picker.getValue();
  const code = form.code.value.trim();
  const minutes = Number(form.minutes.value);
  if (!course) { toast('과목과 분반을 골라 주세요.', 'error'); picker.focus(); return; }
  if (!/^\d{4}$/.test(code)) { toast('출석 코드는 숫자 4자리예요.', 'error'); return; }

  const btn = $('#upload-submit');
  btn.disabled = true;
  B.justSubmitted = { key: course.id ? `id:${course.id}` : courseKey(course.label), at: Date.now() };
  try {
    const data = await rpc('submit_code', { p_course: course.label, p_code: code, p_minutes: minutes, p_course_id: course.id });
    B.mine.set(data.session_id, { id: data.submission_id, session_id: data.session_id, code: data.code, status: data.status });
    form.code.value = '';
    form.minutes.value = '10';
    picker.afterSubmit();
    if (!B.sessions.has(data.session_id)) {
      const { data: row } = await sb.from('sessions').select('*').eq('id', data.session_id).maybeSingle();
      if (row) B.sessions.set(row.id, row);
    }
    await fetchView(data.session_id);
    setStats(data.stats);
    renderAll();
    toast(data.status === 'verified'
      ? '다른 사람 코드와 일치해서 바로 확인됐어요! 열람권 +1'
      : "올렸어요. 다른 사람 코드와 일치하거나 '맞았어요'를 받으면 열람권 +1");
  } catch (err) {
    toast(err.message || '올리지 못했어요.', 'error');
  } finally {
    btn.disabled = false;
  }
}

async function unlock(id, btn) {
  if (btn) btn.disabled = true;
  try {
    const data = await rpc('unlock_session', { p_session_id: id });
    B.unlocked.add(id);
    B.views.set(id, data.view);
    setStats(data.stats);
    toast(data.charged ? '열람권 1개를 사용했어요.' : '이미 연 세션이에요.');
  } catch (err) {
    toast(err.message || '열지 못했어요.', 'error');
    if (btn) btn.disabled = false;
    refreshStats().catch(() => {});
  }
}

async function vote(id, code, ok) {
  try {
    B.views.set(id, await rpc('vote_candidate', { p_session_id: id, p_code: code, p_ok: ok }));
    refreshCard(id);
  } catch (err) {
    toast(err.message || '평가하지 못했어요.', 'error');
  }
}

function copy(code) {
  navigator.clipboard.writeText(code).then(() => toast('코드를 복사했어요'), () => toast('복사하지 못했어요', 'error'));
}

/* ------------------------------------------------------------------ *
 *  그리기
 * ------------------------------------------------------------------ */
function renderStats(s) {
  $('#stat-uploaded').textContent = s.uploaded;
  $('#stat-verified').textContent = s.verified;
  $('#stat-pending').textContent = s.pending;
  $('#stat-credits').textContent = s.credits;
  $('#credit-pill').textContent = s.credits;
  renderAll();
}

function visibleSessions() {
  const now = Date.now();
  const q = courseKey(B.filter);
  return [...B.sessions.values()]
    .filter((r) => {
      const expired = parseTs(r.expires_at) <= now;
      if (expired && !B.showExpired) return false;
      if (q && !courseKey(`${r.course} ${r.course_id || ''}`).includes(q)) return false;
      return true;
    })
    .sort((a, b) => {
      const ea = parseTs(a.expires_at) <= now;
      const eb = parseTs(b.expires_at) <= now;
      if (ea !== eb) return ea ? 1 : -1;
      return parseTs(b.opened_at) - parseTs(a.opened_at);
    });
}

export function renderAll() {
  if (!getState().user) return;
  const list = visibleSessions();
  const keep = new Set(list.map((r) => r.id));
  for (const [id, el] of B.cardEls) if (!keep.has(id)) { el.remove(); B.cardEls.delete(id); }
  const box = $('#cards');
  list.forEach((r, i) => {
    let el = B.cardEls.get(r.id);
    if (!el) { el = h('article', { class: 'code-card' }); B.cardEls.set(r.id, el); }
    fillCard(el, r.id);
    if (box.children[i] !== el) box.insertBefore(el, box.children[i] || null);
  });
  const empty = $('#empty');
  empty.hidden = list.length > 0;
  empty.textContent = B.filter ? '검색한 과목의 세션이 없어요.' : '지금 열려 있는 세션이 없어요. 첫 코드를 올려 보세요.';
}

function refreshCard(id) {
  const el = B.cardEls.get(id);
  if (el) fillCard(el, id);
}

function statusChip(status) {
  return h('span', { class: `chip ${status}`, text: STATUS[status] || status });
}

function fillCard(el, id) {
  const s = B.sessions.get(id);
  if (!s) return;
  const now = Date.now();
  const opened = parseTs(s.opened_at);
  const expires = parseTs(s.expires_at);
  const expired = expires <= now;
  const role = B.mine.has(id) ? 'uploader' : B.unlocked.has(id) ? 'unlocked' : 'locked';
  const view = B.views.get(id);
  const credits = getState().stats.credits;

  el.className = ['code-card', role !== 'locked' && role, expired && 'expired', B.fresh.has(id) && 'fresh']
    .filter(Boolean).join(' ');
  el.dataset.expired = String(expired);
  el._opened = opened;
  el._expires = expires;

  const time = h('span', { class: 'cc-time' });
  const bar = h('div', { class: 'bar' }, h('i'));
  const ago = h('span');
  el._time = time; el._bar = bar; el._ago = ago;

  let body;
  if (role === 'uploader') {
    const mine = (view && view.mine) || B.mine.get(id);
    const hint = {
      pending: "다른 사람 코드와 일치하거나 '맞았어요'를 받으면 열람권 +1",
      verified: '확인돼서 열람권 +1 받았어요',
      wrong: '틀린 코드로 판정돼 보상이 취소됐어요',
    }[mine.status];
    body = h('div', { class: 'cc-body' },
      h('div', { class: 'cand mine' },
        h('span', { class: 'digits', text: mine.code }),
        statusChip(mine.status),
        h('button', { class: 'btn soft sm', text: '복사', onclick: () => copy(mine.code) }),
      ),
      h('p', { class: 'cc-note', text: hint }),
      view && view.mine
        ? h('p', { class: 'cc-note muted', text: `같은 코드 ${view.mine.same_code_uploaders}명 · 다른 후보 ${view.other_candidates}개 · 맞음 ${view.mine.ok} · 틀림 ${view.mine.bad}` })
        : null,
    );
  } else if (role === 'unlocked') {
    const cands = (view && view.candidates) || [];
    body = h('div', { class: 'cc-body' },
      cands.length
        ? cands.map((c, i) => h('div', { class: `cand${i === 0 ? ' top' : ''}` },
            h('span', { class: 'digits', text: c.code }),
            h('div', { class: 'cand-meta' },
              statusChip(c.status),
              h('span', { class: 'muted small', text: `${c.uploaders}명이 올림` }),
            ),
            h('button', { class: 'btn soft sm', text: '복사', onclick: () => copy(c.code) }),
            h('div', { class: 'votes' },
              h('button', { class: 'vote ok', 'aria-pressed': String(c.my_vote === true), text: `맞았어요 ${c.ok}`, onclick: () => vote(id, c.code, true) }),
              h('button', { class: 'vote bad', 'aria-pressed': String(c.my_vote === false), text: `틀렸어요 ${c.bad}`, onclick: () => vote(id, c.code, false) }),
            ),
          ))
        : h('p', { class: 'cc-note', text: '볼 수 있는 코드가 없어요.' }),
      cands.length > 1 ? h('p', { class: 'cc-note muted', text: '위에 있을수록 믿을 만한 코드예요. 넣어 본 뒤 결과를 눌러 주세요.' }) : null,
    );
  } else {
    let action;
    if (expired) action = null;
    else if (s.candidate_count === 0) action = h('span', { class: 'muted small', text: '볼 수 있는 코드 없음' });
    else {
      const noCredit = credits <= 0;
      action = h('button', {
        class: 'btn primary sm',
        text: noCredit ? '열람권 없음' : '열람권 1개로 보기',
        disabled: noCredit,
        title: noCredit ? '코드를 올리고 확인되면 열람권이 생겨요' : undefined,
        onclick: (ev) => unlock(id, ev.currentTarget),
      });
    }
    body = h('div', { class: 'cc-body' },
      h('div', { class: 'cand locked' }, h('span', { class: 'digits hidden', text: '••••', 'aria-label': '가려진 코드' }), action),
    );
  }

  el.replaceChildren(
    h('div', { class: 'cc-top' },
      h('div', null,
        h('div', { class: 'cc-course', text: s.course }),
        h('div', { class: 'cc-meta' }, s.course_id ? `${s.course_id} · ` : '', ago),
      ),
      h('div', { class: 'cc-right' },
        time,
        role === 'uploader' ? h('span', { class: 'tag', text: '내가 올림' }) : null,
        role === 'unlocked' ? h('span', { class: 'tag', text: '열람함' }) : null,
      ),
    ),
    bar,
    body,
    h('div', { class: 'cc-foot' },
      h('span', { text: `올린 사람 ${s.upload_count}명 · 후보 ${s.candidate_count}개` }),
      h('span', null,
        s.verified_count > 0 ? h('span', { class: 'chip verified', text: '확인된 코드 있음' }) : null,
        s.excluded_count > 0 ? h('span', { class: 'chip wrong', text: `틀린 코드 ${s.excluded_count}개 제외` }) : null,
        h('span', { class: 'muted', text: ` 열람 ${s.unlock_count}명` }),
      ),
    ),
  );
  tickCard(el, now);
}

function tickCard(el, now) {
  const left = el._expires - now;
  const total = Math.max(el._expires - el._opened, 1);
  const soon = left > 0 && left < 60000;
  el._time.textContent = fmtLeft(left);
  el._time.className = `cc-time${soon ? ' soon' : ''}${left <= 0 ? ' over' : ''}`;
  el._bar.className = `bar${soon ? ' soon' : ''}`;
  el._bar.firstChild.style.width = `${Math.max(0, Math.min(100, (left / total) * 100))}%`;
  el._ago.textContent = fmtAgo(el._opened);
}

function tick() {
  if (!getState().user) return;
  const now = Date.now();
  let changed = false;
  for (const el of B.cardEls.values()) {
    if (String(el._expires <= now) !== el.dataset.expired) changed = true;
    else tickCard(el, now);
  }
  if (changed) renderAll();
}
