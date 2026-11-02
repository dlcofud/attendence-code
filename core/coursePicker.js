// core/coursePicker.js — 개설과목 목록(data/courses.json)에서 과목·분반 고르기
//
//  "자료" → 자료구조, "ㅈㄹㄱㅈ" (초성), "COSE213" (학수번호), "홍길동" (교수명) 모두 검색됨.
//  과목을 고르면 그 아래 분반 목록이 펼쳐지고, 스크롤해서 분반을 고르는 방식.
//  목록에 없는 과목은 "직접 입력"으로 전환 가능.

import { h, store } from './ui.js';

const CHO = 'ㄱㄲㄴㄷㄸㄹㅁㅂㅃㅅㅆㅇㅈㅉㅊㅋㅌㅍㅎ';
const MAX_GROUPS = 40;

const norm = (s) => String(s || '').toLowerCase().replace(/[\s·.,()\[\]\-_/]/g, '');
function chosung(s) {
  let out = '';
  for (const ch of String(s || '')) {
    const c = ch.charCodeAt(0);
    if (c >= 0xac00 && c <= 0xd7a3) out += CHO[Math.floor((c - 0xac00) / 588)];
    else if (/[a-z0-9ㄱ-ㅎ]/i.test(ch)) out += ch.toLowerCase();
  }
  return out;
}

let catalog = null;
let loading = null;

export function loadCatalog() {
  if (!loading) {
    loading = fetch('data/courses.json', { cache: 'no-cache' })
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(`HTTP ${r.status}`))))
      .then((j) => (catalog = buildCatalog(j)))
      .catch((err) => {
        console.warn('[courses] 개설과목 목록을 불러오지 못했어요', err);
        return (catalog = { term: '', campus: '', groups: [] });
      });
  }
  return loading;
}

function buildCatalog(j) {
  const f = j.fields;
  const groups = new Map();
  // 학수번호 기준으로 묶음 (같은 과목의 '(영강)' 분반도 한 과목 아래에)
  for (const arr of j.rows) {
    const r = Object.fromEntries(f.map((k, i) => [k, arr[i] ?? '']));
    let g = groups.get(r.code);
    if (!g) {
      g = { code: r.code, name: r.name, dept: r.dept, type: r.type, credit: r.credit, sections: [] };
      groups.set(r.code, g);
    }
    if (r.name.length < g.name.length) g.name = r.name; // 가장 짧은 이름을 대표 이름으로
    g.sections.push(r);
  }
  for (const g of groups.values()) {
    g.sections.sort((a, b) => a.section.localeCompare(b.section, 'ko', { numeric: true }));
    const names = [...new Set(g.sections.map((s) => s.name))];
    g.key = norm(g.name);
    g.allKeys = norm(names.join('|'));
    g.cho = chosung(g.name);
    g.profs = norm(g.sections.map((s) => s.prof).join(' '));
  }
  return { term: j.term || '', campus: j.campus || '', generated_at: j.generated_at || '', groups: [...groups.values()] };
}

function search(q) {
  if (!catalog) return [];
  const nq = norm(q);
  if (!nq) return [];
  const isCho = /^[ㄱ-ㅎ]+$/.test(nq);
  const up = q.trim().toUpperCase().replace(/\s/g, '');
  const hits = [];
  for (const g of catalog.groups) {
    let s = -1;
    if (isCho) {
      if (g.cho.startsWith(nq)) s = 3;
      else if (g.cho.includes(nq)) s = 2;
    } else if (g.key.startsWith(nq)) s = 6;
    else if (g.allKeys.includes(nq)) s = 5;
    else if (g.code.startsWith(up)) s = 4;
    else if (nq.length >= 2 && g.profs.includes(nq)) s = 1;
    if (s >= 0) hits.push([s, g]);
  }
  hits.sort((a, b) => b[0] - a[0] || a[1].name.length - b[1].name.length || a[1].name.localeCompare(b[1].name, 'ko'));
  return hits.slice(0, MAX_GROUPS).map((x) => x[1]);
}

/**
 * 과목 선택기를 만든다.
 * 반환: { el, getValue(), clear() }
 *   getValue() → { label: '자료구조 02분반', id: 'COSE213-02' }  (직접 입력이면 id: null)  또는 null
 */
export function createCoursePicker() {
  let selected = null;     // { label, id, name, section, prof, time, code }
  let manual = false;
  let activeIdx = -1;
  let options = [];

  const input = h('input', {
    class: 'pk-input', type: 'search', autocomplete: 'off', role: 'combobox',
    'aria-expanded': 'false', 'aria-controls': 'pk-list',
    placeholder: '과목명·초성·학수번호·교수명 (예: 자료)',
  });
  const list = h('div', { class: 'pk-list', id: 'pk-list', role: 'listbox', hidden: true });
  const chip = h('div', { class: 'pk-chip', hidden: true });
  const manualInput = h('input', { class: 'pk-input', maxlength: '80', placeholder: '과목명 직접 입력 (예: 자료구조 02분반)', hidden: true });
  const meta = h('div', { class: 'pk-meta muted small' });
  const toggle = h('button', { type: 'button', class: 'linklike small', text: '목록에 없어요 · 직접 입력' });
  const el = h('div', { class: 'picker' }, input, manualInput, chip, list, h('div', { class: 'pk-foot' }, meta, toggle));

  function open(v) { list.hidden = !v; input.setAttribute('aria-expanded', String(v)); }

  function renderList() {
    const groups = search(input.value);
    options = [];
    activeIdx = -1;
    if (!input.value.trim()) { open(false); return; }
    if (!groups.length) {
      list.replaceChildren(h('div', { class: 'pk-empty', text: '일치하는 과목이 없어요. 아래 "직접 입력"을 써 보세요.' }));
      open(true);
      return;
    }
    const nodes = [];
    for (const g of groups) {
      nodes.push(h('div', { class: 'pk-group' },
        h('b', { text: g.name }),
        h('span', { class: 'muted', text: ` ${g.code} · ${g.dept}${g.type ? ' · ' + g.type : ''} · 분반 ${g.sections.length}개` }),
      ));
      for (const s of g.sections) {
        const opt = h('button', {
          type: 'button', class: 'pk-opt', role: 'option',
          onclick: () => choose(g, s),
          onmousedown: (e) => e.preventDefault(),
        },
          h('span', { class: 'pk-sec', text: `${s.section}분반` }),
          h('span', { class: 'pk-prof', text: s.prof || '교수 미정' }),
          h('span', { class: 'pk-time muted', text: (s.name !== g.name ? `[${s.name.replace(g.name, '').replace(/[()]/g, '') || s.name}] ` : '') + (s.time || '') }),
        );
        opt._pick = () => choose(g, s);
        options.push(opt);
        nodes.push(opt);
      }
    }
    list.replaceChildren(...nodes);
    list.scrollTop = 0;
    open(true);
  }

  function setActive(i) {
    if (!options.length) return;
    if (activeIdx >= 0) options[activeIdx].classList.remove('active');
    activeIdx = (i + options.length) % options.length;
    const o = options[activeIdx];
    o.classList.add('active');
    o.scrollIntoView({ block: 'nearest' });
  }

  function choose(g, s) {
    selected = {
      label: `${s.name} ${s.section}분반`, id: `${g.code}-${s.section}`,
      name: s.name, code: g.code, section: s.section, prof: s.prof, time: s.time,
    };
    store.set('acs:lastCourse', JSON.stringify(selected));
    showChip();
  }

  function showChip() {
    input.hidden = true;
    open(false);
    chip.hidden = false;
    chip.replaceChildren(
      h('div', null,
        h('b', { text: selected.name }), ` ${selected.section}분반`,
        h('div', { class: 'muted small', text: [selected.id, selected.prof, selected.time].filter(Boolean).join(' · ') }),
      ),
      h('button', { type: 'button', class: 'btn ghost sm', text: '변경', onclick: () => { clearSel(); input.focus(); } }),
    );
  }

  function clearSel() {
    selected = null;
    chip.hidden = true;
    input.hidden = manual;
    input.value = '';
    open(false);
  }

  function setManual(v) {
    manual = v;
    clearSel();
    input.hidden = v;
    manualInput.hidden = !v;
    toggle.textContent = v ? '개설과목 목록에서 고르기' : '목록에 없어요 · 직접 입력';
    (v ? manualInput : input).focus();
  }

  input.addEventListener('input', renderList);
  input.addEventListener('focus', () => { if (input.value.trim()) renderList(); });
  input.addEventListener('blur', () => setTimeout(() => open(false), 120));
  input.addEventListener('keydown', (e) => {
    if (e.key === 'ArrowDown') { e.preventDefault(); if (list.hidden) renderList(); setActive(activeIdx + 1); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setActive(activeIdx - 1); }
    else if (e.key === 'Enter' && activeIdx >= 0) { e.preventDefault(); options[activeIdx]._pick(); }
    else if (e.key === 'Escape') open(false);
  });
  toggle.addEventListener('click', () => setManual(!manual));

  loadCatalog().then((c) => {
    if (!c.groups.length) {
      meta.textContent = '개설과목 목록이 없어 직접 입력만 가능해요.';
      setManual(true);
      toggle.hidden = true;
      return;
    }
    const n = c.groups.reduce((a, g) => a + g.sections.length, 0);
    meta.textContent = `${c.term} ${c.campus} 개설과목 ${c.groups.length.toLocaleString()}과목 · ${n.toLocaleString()}분반 기준`;
    try {
      const last = JSON.parse(store.get('acs:lastCourse') || 'null');
      if (last && last.id && c.groups.some((g) => g.code === last.code && g.sections.some((s) => s.section === last.section))) {
        selected = last;
        showChip();
      }
    } catch { /* 무시 */ }
  });

  return {
    el,
    getValue() {
      if (manual) {
        const v = manualInput.value.trim().replace(/\s+/g, ' ');
        return v ? { label: v, id: null } : null;
      }
      return selected ? { label: selected.label, id: selected.id } : null;
    },
    focus() { (manual ? manualInput : input).focus(); },
    afterSubmit() { if (manual) manualInput.value = ''; },
  };
}
