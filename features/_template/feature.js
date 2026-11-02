// features/_template/feature.js — 기능 템플릿
//
// 복사해서 features/<이름>/feature.js 로 만들고, features/index.js 에 등록하세요.
// 짝이 되는 서버 함수는 supabase/features/_template.sql 을 참고하세요.

export default {
  id: 'example',               // 고유 id (영문 소문자). CSS 클래스도 .feat-example- 로 시작
  title: '예제: 반반 게임',     // 카드 제목
  owner: '담당: 기능 팀',       // (선택) 카드 오른쪽 위 작은 글씨

  /**
   * 로그인 후 호출됩니다.
   * @param {HTMLElement} el  이 기능에 주어진 카드 안쪽 영역
   * @param {object} ACS      core 가 제공하는 API (core/acs.js 맨 위 주석 참고)
   * @returns {Function|void} 로그아웃할 때 실행할 정리 함수
   */
  mount(el, ACS) {
    const { h } = ACS;

    const balance = h('b', { text: String(ACS.stats.credits) });
    const result = h('p', { class: 'muted small', text: '열람권 1개를 걸고 0 또는 1을 고르세요. 맞히면 2개.' });
    const buttons = [0, 1].map((n) => h('button', {
      class: 'btn primary', text: String(n), onclick: () => play(n),
    }));

    el.append(
      h('p', null, '현재 열람권 ', balance, '개'),
      h('div', { style: 'display:flex;gap:8px' }, ...buttons),
      result,
    );

    const setEnabled = (credits) => buttons.forEach((b) => { b.disabled = credits <= 0; });
    setEnabled(ACS.stats.credits);

    // 잔액이 바뀔 때마다 (업로드 확인, 열람, 다른 기능 등) 자동 갱신
    const off = ACS.on('stats', (s) => { balance.textContent = s.credits; setEnabled(s.credits); });

    async function play(choice) {
      buttons.forEach((b) => { b.disabled = true; });
      try {
        // 판정·지급은 반드시 서버 함수에서 (supabase/features/_template.sql 의 feat_example_play)
        const r = await ACS.rpc('feat_example_play', { p_choice: choice });
        result.textContent = r.win ? '맞혔어요! 열람권 +2' : '아쉬워요. 열람권 -1';
        await ACS.refreshStats();
      } catch (err) {
        ACS.toast(err.message, 'error');
        setEnabled(ACS.stats.credits);
      }
    }

    return () => off(); // 로그아웃 시 구독 해제
  },
};
