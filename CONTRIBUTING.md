# 협업 규칙

이 저장소는 두 영역으로 나뉩니다. **각자 자기 영역 폴더만 수정**하면 충돌이 거의 나지 않습니다.

| 영역 | 담당 | 폴더 | 하는 일 |
| --- | --- | --- | --- |
| **core** | 채령 | `core/` `supabase/core/` `index.html` `config.js` `data/` `tools/` `scripts/` | 로그인, 코드 업로드·세션·검증, 열람, 실시간, 개설과목 목록, 공용 API(ACS) |
| **features** | 기능 팀원 | `features/` `supabase/features/` | 열람권 뽑기, 열람권 맞추기 같은 부가 기능 |

두 영역의 경계는 딱 두 곳입니다.

- **브라우저:** `ACS` 객체 (`core/acs.js` 맨 위 주석). features 는 `mount(el, ACS)` 로 받은 ACS 만 씁니다.
- **서버:** `internal.credit_add()` / `internal.balance()` (`supabase/features/README.md`). features 의 SQL 함수는 열람권을 이 함수로만 바꿉니다.

core 는 이 두 경계의 모양을 바꾸지 않기로 약속합니다. 바꿔야 하면 `ACS.version` 을 올리고 미리 알립니다.
features 에 새 API 가 필요하면 core 파일을 직접 고치지 말고 이슈로 요청해 주세요.

## 브랜치

```
main            ← GitHub Pages 로 바로 배포되는 브랜치 (직접 push 하지 않기)
core/<내용>      ← core 작업      예) core/session-ui
feat/<기능이름>   ← features 작업  예) feat/gacha
```

```bash
git switch main && git pull
git switch -c feat/gacha
# … 작업 …
npm run check            # Node 가 없으면 생략 가능 (PR 에서 자동 실행됨)
git add features/gacha supabase/features/gacha.sql features/index.js
git commit -m "feat(gacha): 열람권 뽑기 추가"
git push -u origin feat/gacha
# GitHub 에서 Pull Request 생성 → 상대방 리뷰 → Merge
```

## 커밋 메시지

`<영역>(<범위>): <내용>` 형식을 권장합니다.

- `core(board): 세션 카드에 후보 정렬 표시`
- `feat(guess): 정답 판정 서버 함수 추가`
- `data: 2027-1학기 개설과목 갱신`

## SQL 변경

- core: `supabase/core/schema.sql` 을 고치고 SQL Editor 에서 전체 실행 (여러 번 실행해도 안전하게 유지)
- features: `supabase/features/<기능>.sql` 을 만들고 SQL Editor 에서 실행
- PR 설명에 "어느 SQL 을 적용했는지" 적기

## 로컬 실행

```bash
python -m http.server 8000
# http://localhost:8000
```

ES 모듈을 쓰기 때문에 `index.html` 을 더블클릭(file://)으로 열면 동작하지 않습니다. 꼭 위처럼 서버로 여세요.

## GitHub 설정 (저장소 주인이 한 번)

1. **Settings → Collaborators** 에서 팀원 초대
2. `.github/CODEOWNERS` 의 팀원 아이디 줄 주석 해제
3. **Settings → Branches → Add rule** (`main`): *Require a pull request before merging*, *Require status checks (check)* 켜기
