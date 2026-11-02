# 출석코드 공유소 (모의 프로젝트)

LMS 출석 코드(숫자 4자리, 10분 유효)를 **올린 만큼만 남의 코드를 볼 수 있는** 실시간 공유 웹사이트입니다.
수업용 모의 프로젝트이며 실제 출석에는 사용하지 않습니다.

- 프론트엔드: 순수 HTML/CSS/JS (빌드 없음) → GitHub Pages로 배포
- 백엔드: Supabase (Auth · Postgres · Row Level Security · Realtime)

## 규칙

| 동작 | 결과 |
| --- | --- |
| 코드 1개 올리기 | 열람권 +1 |
| 남의 코드 1개 열기 | 열람권 -1 (이미 연 코드는 다시 봐도 무료) |
| 만료된 코드 열기 | 거절, 열람권 차감 없음 |
| 같은 과목에 연달아 올리기 | 내 코드가 유효한 동안은 거절 (열람권 부풀리기 방지) |
| 연 코드 평가 | "맞았어요 / 틀렸어요" — 틀렸다는 제보가 많으면 경고 표시 |

열람권 = (내가 올린 코드 수) − (내가 연 코드 수). 이 계산과 모든 쓰기는 **서버(Postgres 함수)에서만** 일어나므로 브라우저에서 값을 조작해도 소용없습니다.

## 구조

```
index.html          화면
style.css           스타일 (라이트/다크 모드, 모바일 대응)
app.js              로그인 · 올리기 · 열기 · 평가 · 실시간 구독
config.js           Supabase URL + anon 키
supabase/schema.sql 테이블 · RLS · RPC · Realtime 설정 (한 번 실행)
```

### 데이터가 새지 않는 이유

- `codes` 테이블: 과목, 올린 사람, 만료 시각, 열람 수 — **숫자 없음**. 로그인한 모두가 읽을 수 있고 Realtime으로 JSON 이벤트가 전송됩니다.
- `code_secrets` 테이블: 실제 4자리 숫자. RLS로 **올린 사람 본인 + 열람권을 써서 연 사람**만 읽을 수 있습니다.
- `unlocks`, `votes`: 본인 기록만 읽을 수 있습니다.
- insert/update/delete 정책이 없어서 클라이언트는 테이블에 직접 쓸 수 없고, `submit_code` / `unlock_code` / `vote_code` RPC로만 바꿀 수 있습니다.
- 같은 사용자의 동시 요청은 프로필 행 잠금으로 직렬화되어 열람권을 두 번 쓸 수 없습니다.

## 설정 방법

### 1. Supabase 스키마 적용

Supabase 대시보드 → **SQL Editor** → `supabase/schema.sql` 내용을 붙여넣고 **Run**.
(여러 번 실행해도 안전합니다.)

### 2. 이메일 로그인 설정

대시보드 → **Authentication**

1. **Sign In / Providers → Email**: 켜져 있는지 확인
2. **URL Configuration**
   - Site URL: `https://dlcofud.github.io/attendence-code/`
   - Redirect URLs에 추가: `https://dlcofud.github.io/attendence-code/**`, 로컬 테스트용 `http://localhost:8000/**`
3. Supabase 기본 메일 발송은 **시간당 몇 통**으로 제한돼 있어요. 여러 계정으로 테스트할 땐 Email 설정의 **Confirm email**을 잠시 꺼 두면 편합니다.

### 3. `config.js`에 키 넣기

대시보드 → **Project Settings → API Keys** 에서 `anon` `public` 키(또는 publishable 키)를 복사해 `SUPABASE_ANON_KEY`에 넣습니다.
이 키는 공개돼도 되는 키입니다. **`service_role` / secret 키는 절대 넣지 마세요.**

### 4. 로컬에서 실행

```bash
python -m http.server 8000
# 브라우저에서 http://localhost:8000
```

### 5. GitHub Pages 배포

```bash
git add .
git commit -m "출석코드 공유소 초기 버전"
git branch -M main
git push -u origin main
```

GitHub 저장소 → **Settings → Pages** → Source: *Deploy from a branch*, Branch: `main` / `(root)` → Save.
1~2분 뒤 `https://dlcofud.github.io/attendence-code/` 에서 열립니다.

## 실시간(JSON) 동작

`app.js`는 `codes` 테이블의 `postgres_changes`를 구독합니다.

- 누가 코드를 올리면 `INSERT` 이벤트 → 모든 접속자 화면에 카드가 즉시 추가
- 누가 코드를 열거나 평가하면 `UPDATE` 이벤트 → 열람 수·평가 수가 즉시 갱신
- 화면 아래 **실시간 JSON 로그**에서 받은 이벤트 원문을 확인할 수 있습니다

```json
{
  "eventType": "INSERT",
  "table": "codes",
  "new": {
    "id": 12,
    "course": "자료구조 01분반",
    "uploader_nickname": "민수",
    "created_at": "2026-11-02T01:03:00+00:00",
    "expires_at": "2026-11-02T01:11:00+00:00",
    "unlock_count": 0, "ok_count": 0, "bad_count": 0
  }
}
```

## 확장 아이디어

- 틀렸다는 제보가 일정 수를 넘은 코드는 올린 사람의 열람권 회수
- 과목 목록을 고정(드롭다운)해 오타로 과목이 갈라지는 것 방지
- 학교 이메일 도메인만 가입 허용
