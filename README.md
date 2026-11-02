# 출석코드 공유소 (모의 프로젝트)

LMS 출석 코드(숫자 4자리, 10분 유효)를 올리고, **확인받은 만큼 남의 코드를 볼 수 있는** 실시간 공유 웹사이트입니다.
수업용 모의 프로젝트이며 실제 출석에는 사용하지 않습니다.

- 프론트엔드: HTML/CSS/ES 모듈 (빌드 없음) → GitHub Pages
- 백엔드: Supabase (Auth · Postgres · RLS · Realtime)
- 협업: core / features 두 영역으로 분리 → [CONTRIBUTING.md](CONTRIBUTING.md)

## 규칙

| 개념 | 내용 |
| --- | --- |
| **과목 선택** | 고려대 2026-2학기 학부 개설과목 목록에서 검색("자료" → 자료구조) 후 분반 선택. 목록에 없으면 직접 입력 |
| **세션** | 같은 과목·분반(학수번호-분반)에 유효시간 안에 올라온 코드 묶음 |
| **업로드** | 누구나 가능. 세션당 1인 1회. 그 세션을 열람한 사람은 올릴 수 없음 |
| **확인(검증)** | 다른 사람과 같은 숫자를 올렸거나, 열람자에게 '맞았어요'를 받으면(맞음 > 틀림) → **열람권 +1** |
| **틀림** | '틀렸어요' 2개 이상이고 맞음보다 많으면 후보에서 제외, 그 업로드의 보상도 취소 |
| **열람** | 열람권 1개로 세션 전체(틀림 제외 후보, 믿을 만한 순)를 봄. 직접 올린 세션은 열 수 없음 |
| **열람권** | (확인된 내 업로드 수) + (장부 합계: 열람 −1, features 지급·차감) |

모든 판정과 열람권 계산은 서버(Postgres 함수)에서만 일어납니다.

### 왜 이렇게 했나

- **다수가 올리고 틀린 것만 제외:** 한 사람만 보상받으면 아무도 안 올립니다. 대신 "확인된 업로드"에만 보상해서 가짜 코드로 열람권을 모으는 걸 막습니다.
- **열어 본 사람은 업로드 금지:** 연 코드를 그대로 다시 올려 열람권을 돌려받는 구멍(v1 버그)을 막습니다.
- **업로더는 다른 후보 숫자를 못 봄:** 아무 숫자나 올려서 세션을 공짜로 들여다보는 걸 막습니다.

## 구조

```
index.html                 화면 뼈대
config.js                  Supabase URL + publishable 키
core/                      ── core 팀 ──
  main.js                  시작점 (로그인 후 연결)
  acs.js                   features 에 주는 공용 API (ACS)
  board.js                 업로드 폼 · 세션 카드 · 내 현황
  coursePicker.js          개설과목 검색·분반 선택
  auth.js / realtime.js / api.js / ui.js
  core.css
data/courses.json          고려대 학부 개설과목 (학기마다 갱신)
tools/courses/             개설과목 수집기 + 갱신 방법
supabase/core/schema.sql   core 스키마 (테이블 · RLS · RPC · 실시간)
features/                  ── features 팀 ──
  index.js                 기능 등록 목록
  _template/feature.js     기능 템플릿
  features.css
supabase/features/         기능 팀 SQL (+ _template.sql)
scripts/check.mjs          PR 자동 검사 (.github/workflows/check.yml)
```

## 설정

1. **스키마:** Supabase SQL Editor 에서 `supabase/core/schema.sql` 실행 (v1 테이블이 있으면 자동 정리)
2. **로그인 URL:** Authentication → URL Configuration
   - Site URL: `https://dlcofud.github.io/attendence-code/`
   - Redirect URLs: `https://dlcofud.github.io/attendence-code/**`, `http://localhost:8000/**`
3. **키:** `config.js` 에 Project URL 과 publishable 키 (service_role/secret 키는 절대 넣지 않기)
4. **배포:** `main` 에 push → Settings → Pages (Deploy from a branch, `main` / root)

### 이메일 인증 (시연 전에 켜기)

지금은 개발 편의를 위해 꺼져 있습니다. 끄면 가짜 이메일로 부계정을 만들어 열람권을 모을 수 있으니 시연 전에는 켜세요.
Supabase 기본 메일 서버는 **프로젝트 팀원 이메일에만** 발송하므로, 그냥 켜면 아무도 가입하지 못합니다.

1. Resend·Brevo 등 메일 발송 서비스에서 SMTP 정보 발급
2. Authentication → Emails → SMTP Settings 에 입력
3. Authentication → Sign In / Providers → **Confirm email** 켜기

## 로컬 실행

```bash
python -m http.server 8000   # → http://localhost:8000
```

## 실시간

`sessions`(모두), `submissions`·`credit_ledger`(RLS 로 본인 것만) 변경을 구독합니다.
화면 아래 **실시간 JSON 로그**에서 이벤트 원문을 볼 수 있습니다. 남의 코드 숫자는 실시간으로 전송되지 않습니다.
