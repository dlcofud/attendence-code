# supabase/features — 기능 팀 SQL

열람권 뽑기·맞추기처럼 **열람권을 주거나 빼는 기능**의 서버 코드를 두는 곳입니다.
core 스키마(`../core/schema.sql`)는 수정하지 않습니다.

## 파일 규칙

```
supabase/features/
├── _template.sql   ← 복사해서 시작 (이 파일 자체는 실행 X)
├── gacha.sql       ← 예: 열람권 뽑기
└── guess.sql       ← 예: 열람권 맞추기
```

- 기능 하나 = SQL 파일 하나. 여러 번 실행해도 안전하게 (`create ... if not exists`, `create or replace`, `drop policy if exists`).
- 테이블·함수 이름은 `feat_<기능이름>_` 으로 시작.
- 적용: Supabase 대시보드 → SQL Editor → 파일 내용 붙여넣고 Run.

## core 가 제공하는 서버 API

| 함수 | 설명 |
| --- | --- |
| `internal.credit_add(uid, delta, reason, ref)` | 열람권 증감. 반환값 = 변경 후 잔액. 차감 시 잔액 부족이면 예외 → 트랜잭션 전체 취소 |
| `internal.balance(uid)` | 현재 잔액 |
| `auth.uid()` | 지금 호출한 사용자 |

`internal` 스키마는 브라우저에서 직접 부를 수 없습니다. 반드시 **내 기능의 `security definer` 함수 안에서** 호출하세요. 그래야 "판정은 서버, 지급도 서버"가 보장됩니다.

`reason` 형식: `feature:<기능이름>:<동작>` (예: `feature:gacha:cost`, `feature:gacha:reward`). 장부(`credit_ledger`)에 그대로 남아서 나중에 통계를 내기 쉽습니다.

## 열람권이 어떻게 계산되나

```
잔액 = (검증된 내 업로드 수) + (credit_ledger 의 delta 합계)
```

- 업로드 보상은 장부에 쓰지 않고 업로드 상태(`verified`)로 계산합니다. 그래서 코드가 나중에 "틀림"으로 판정되면 보상이 자동으로 사라집니다(잔액이 음수가 될 수도 있음).
- 열람(-1)과 features 의 지급·차감은 장부에 기록됩니다.
- 장부 변경은 실시간으로 본인 화면에 전달되어 잔액 표시가 자동 갱신됩니다.

## 체크리스트

- [ ] 확률·정답은 SQL 에서 결정했나? (브라우저가 보낸 "당첨" 값을 믿으면 안 됨)
- [ ] `security definer` + `set search_path = public` 을 붙였나?
- [ ] `revoke all on function ... from public, anon;` + `grant execute ... to authenticated;` 를 했나?
- [ ] 기능 테이블에 RLS 를 켜고 쓰기 권한을 회수했나?
- [ ] 같은 요청이 두 번 와도 문제없나? (필요하면 `ref` 로 중복 확인)
