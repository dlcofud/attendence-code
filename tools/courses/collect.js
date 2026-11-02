/* tools/courses/collect.js — 고려대 학부 개설과목 → data/courses.json 수집기 (core 팀)
 *
 * 사용법 (학기마다 한 번):
 *   1. https://sugang.korea.ac.kr → 왼쪽 메뉴 "과목조회 > 학부 과목조회" 를 연다 (로그인 불필요)
 *   2. F12 → Console 탭에 이 파일 내용을 통째로 붙여넣고 Enter
 *   3. 아래 YEAR / TERM / CAMPUS 를 확인 (기본: 2026년 2학기 서울)
 *   4. 3~6분 뒤 courses.json 이 다운로드됨 → 저장소의 data/courses.json 으로 교체 후 커밋
 *
 * 동작: 페이지의 "조회" 버튼을 직접 눌러 결과를 모읍니다(대기열 시스템을 그대로 거침).
 *       전공·학문의기초는 대학 → 학과별로, 교양은 영역별로, 교직·군사학·평생교육사는 한 번씩 조회.
 *       요청 사이에 쉬는 시간을 두어 서버에 부담을 주지 않습니다.
 */
(async () => {
  const YEAR = '2026';
  const TERM = '2R';     // 1R=1학기, 1S=여름계절, 2R=2학기, 2W=겨울계절
  const CAMPUS = '1';    // 1=서울, 2=세종
  const TERM_LABEL = { '1R': '1학기', '1S': '여름계절', '2R': '2학기', '2W': '겨울계절' }[TERM];

  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const el = (id) => document.getElementById(id);
  const setSel = (id, v) => { const e = el(id); e.value = v; e.dispatchEvent(new Event('change', { bubbles: true })); };
  const opts = (id) => [...el(id).options].map((o) => ({ v: o.value, t: o.text })).filter((o) => o.v);
  const btn = [...document.querySelectorAll('button, a, input[type=button]')].find((e) => (e.innerText || e.value || '').trim() === '조회');
  if (!btn || !el('pCourDiv')) { alert('학부 과목조회 화면에서 실행해 주세요.'); return; }

  // 조회 응답 가로채기
  let seq = 0; let lastText = '';
  const origFetch = window.fetch;
  window.fetch = async function (u, o) {
    const r = await origFetch.apply(this, arguments);
    try { if (String(u).includes('/d/v/lectHakbu')) { lastText = await r.clone().text(); seq++; } } catch (e) { /* 무시 */ }
    return r;
  };

  const courses = new Map();
  const log = (...a) => console.log('[collect]', ...a);
  const waitOptsChange = async (id, prev) => {
    for (let i = 0; i < 40; i++) { await sleep(150); const k = opts(id).map((o) => o.v).join(','); if (k && k !== prev) return; }
  };
  const clean = (s) => String(s || '').replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim();

  async function search(label) {
    const before = seq;
    btn.click();
    for (let i = 0; i < 100 && seq === before; i++) await sleep(150);
    if (seq === before) { log('시간 초과:', label); return; }
    try {
      const rows = JSON.parse(lastText).rows || [];
      for (const r of rows) {
        const key = `${r.COUR_CD}-${r.COUR_CLS}`;
        if (!courses.has(key)) {
          courses.set(key, [clean(r.COUR_CD), clean(r.COUR_CLS), clean(r.COUR_NM), clean(r.PROF_NM),
                            clean(r.TIME_ROOM), clean(r.DEPARTMENT), clean(r.ISU_NM), clean(r.CREDIT)]);
        }
      }
      log(label, rows.length, '→ 누적', courses.size);
    } catch (e) { log('해석 실패:', label); }
    await sleep(700);
  }

  setSel('pYear', YEAR); setSel('pTerm', TERM); setSel('pCampus', CAMPUS); setSel('pGradCd', '0136');
  for (const cd of ['00', '24']) {            // 전공, 학문의기초
    setSel('pCourDiv', cd); await sleep(1200);
    for (const col of opts('pCol')) {
      const prev = opts('pDept').map((o) => o.v).join(',');
      setSel('pCol', col.v); await waitOptsChange('pDept', prev); await sleep(300);
      for (const dept of opts('pDept')) { setSel('pDept', dept.v); await sleep(150); await search(`${cd}/${col.t}/${dept.t}`); }
    }
  }
  setSel('pCourDiv', '01'); await sleep(1200); // 교양
  for (const g of opts('pGroupCd')) { setSel('pGroupCd', g.v); await sleep(150); await search(`교양/${g.t}`); }
  for (const cd of ['30', '41', '71']) { setSel('pCourDiv', cd); await sleep(1000); await search(cd); } // 교직, 군사학, 평생교육사

  window.fetch = origFetch;

  const rows = [...courses.values()].sort((a, b) => a[2].localeCompare(b[2], 'ko') || a[1].localeCompare(b[1], 'ko', { numeric: true }));
  const out = {
    term: `${YEAR}-${TERM_LABEL}`,
    campus: CAMPUS === '1' ? '서울' : '세종',
    source: '고려대학교 수강신청시스템 > 과목조회 > 학부 과목조회',
    generated_at: new Date().toISOString(),
    fields: ['code', 'section', 'name', 'prof', 'time', 'dept', 'type', 'credit'],
    rows,
  };
  const blob = new Blob([JSON.stringify(out)], { type: 'application/json' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = 'courses.json';
  a.click();
  log(`완료: ${rows.length}개 분반 → courses.json 다운로드`);
})();
