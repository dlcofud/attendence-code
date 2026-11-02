// core/ui.js — DOM·시간 유틸 (core 전용이지만 ACS.h 로 features 에도 제공)

export const $ = (sel, root = document) => root.querySelector(sel);

// 안전한 DOM 생성기: 문자열은 항상 textContent 로 들어가므로 XSS 걱정 없음
export function h(tag, attrs, ...children) {
  const el = document.createElement(tag);
  if (attrs) {
    for (const [k, v] of Object.entries(attrs)) {
      if (v === undefined || v === null || v === false) continue;
      if (k === 'class') el.className = v;
      else if (k === 'text') el.textContent = v;
      else if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2), v);
      else el.setAttribute(k, v === true ? '' : v);
    }
  }
  for (const c of children.flat()) if (c != null && c !== false) el.append(c);
  return el;
}

export function toast(msg, kind) {
  const box = $('#toasts');
  if (!box) return;
  const el = h('div', { class: `toast ${kind || ''}`, text: String(msg) });
  box.append(el);
  setTimeout(() => el.remove(), kind === 'error' ? 4500 : 2800);
}

// Postgres/Realtime 타임스탬프를 어떤 형식으로 받아도 ms 로
export function parseTs(s) {
  if (!s) return NaN;
  let t = String(s).trim().replace(' ', 'T');
  t = t.replace(/(\.\d{3})\d+/, '$1');
  t = t.replace(/([+-]\d{2})$/, '$1:00');
  if (!/(Z|[+-]\d{2}:?\d{2})$/i.test(t)) t += 'Z';
  return Date.parse(t);
}

export function fmtLeft(ms) {
  if (ms <= 0) return '종료';
  const s = Math.ceil(ms / 1000);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

export function fmtAgo(ts) {
  const m = Math.floor((Date.now() - ts) / 60000);
  if (m < 1) return '방금';
  if (m < 60) return `${m}분 전`;
  return `${Math.floor(m / 60)}시간 전`;
}

export const courseKey = (c) => String(c || '').toLowerCase().replace(/\s+/g, '');

export const store = {
  get(k) { try { return localStorage.getItem(k); } catch { return null; } },
  set(k, v) { try { localStorage.setItem(k, v); } catch { /* 무시 */ } },
};
