# features — 기능 팀 영역

열람권 뽑기, 열람권 맞추기처럼 **core(코드 공유 본체) 위에 얹는 기능**을 만드는 곳입니다.
이 폴더와 `supabase/features/` 안에서만 작업하면 core 와 충돌하지 않습니다.

## 구조

```
features/
├── index.js            ← 기능 등록 목록 (여기에 한 줄 추가)
├── features.css        ← 기능 팀 스타일
├── _template/
│   └── feature.js      ← 복사해서 시작
├── gacha/feature.js    ← 예: 열람권 뽑기
└── guess/feature.js    ← 예: 열람권 맞추기

supabase/features/
├── _template.sql       ← 서버 함수 템플릿
├── gacha.sql
└── guess.sql
```

## 새 기능 만들기 (5단계)

1. `features/_template/feature.js` → `features/<이름>/feature.js` 로 복사, `id`·`title` 수정
2. `supabase/features/_template.sql` → `supabase/features/<이름>.sql` 로 복사, `feat_example_` → `feat_<이름>_` 로 바꾸기
3. Supabase SQL Editor 에서 `<이름>.sql` 실행
4. `features/index.js` 에 import 하고 배열에 추가
5. 로컬에서 확인 (`python -m http.server 8000`) → `feat/<이름>` 브랜치로 PR

## 기능 객체 형식

```js
export default {
  id: 'gacha',                 // 고유 id
  title: '열람권 뽑기',          // 카드 제목
  owner: '담당: OOO',           // (선택)
  mount(el, ACS) {             // 로그인 후 호출. el = 카드 안쪽 영역
    // … 화면 만들기 …
    return () => { /* 로그아웃 시 정리 */ };
  },
};
```

## ACS — core 가 주는 API

| 이름 | 설명 |
| --- | --- |
| `ACS.stats` | `{ uploaded, verified, pending, wrong, unlocked, credits }` (credits = 남은 열람권) |
| `ACS.user`, `ACS.nickname` | 로그인한 사용자 |
| `ACS.rpc(name, args)` | 서버 함수 호출. 실패하면 `Error` (message 는 서버가 보낸 한국어) |
| `ACS.refreshStats()` | 잔액 다시 읽기 |
| `ACS.on(event, fn)` | 이벤트 구독, 해제 함수 반환. `ready` `logout` `stats` `session:insert` `session:update` `ledger:insert` |
| `ACS.toast(msg, 'error'?)` | 알림 |
| `ACS.h(tag, attrs, ...children)` | 안전한 DOM 생성기 (문자열은 textContent 로 들어가 XSS 안전) |
| `ACS.supabase` | Supabase 클라이언트 (기능 전용 테이블 읽기용) |

전체 설명은 `core/acs.js` 맨 위 주석에 있습니다.

## 지켜 주세요

- **열람권은 서버에서만 바꿉니다.** 브라우저는 `ACS.rpc('feat_…')` 로 요청만 하고, 확률·정답 판정과 지급은 SQL 함수 안에서 `internal.credit_add()` 로 합니다. 자세한 건 `supabase/features/README.md`.
- core 파일(`core/`, `supabase/core/`, `index.html`)은 수정하지 않습니다. 필요한 API 가 있으면 이슈로 요청해 주세요.
- 클래스 이름은 `.feat-<id>-` 로 시작합니다.
- `innerHTML` 에 사용자 입력을 넣지 말고 `ACS.h()` 를 쓰세요.
