-- =====================================================================
--  features 서버 함수 템플릿 — 이 파일을 복사해서 쓰세요
--  예) supabase/features/gacha.sql, supabase/features/guess.sql
--
--  ⚠ 이 템플릿 파일 자체는 실행하지 마세요. 복사본에서 <name> 을 바꾼 뒤 실행.
--  ⚠ core/schema.sql 을 먼저 실행한 프로젝트에서만 동작합니다.
-- =====================================================================
--
--  규칙 (core 와 충돌하지 않기 위한 약속)
--   1. 이름 앞에 feat_<기능이름>_ 를 붙인다       예) feat_gacha_draw(), feat_gacha_log
--   2. core 테이블(sessions, submissions, …)에 직접 쓰지 않는다
--   3. 열람권 변경은 오직 internal.credit_add() 로만
--        internal.credit_add(사용자, 증감, '사유', '참조')  → 변경 후 잔액 반환
--        차감(-) 시 잔액이 모자라면 예외가 나고 트랜잭션 전체가 취소됨
--        사유는 'feature:<기능이름>:<동작>' 형식  예) 'feature:gacha:cost'
--   4. 잔액 조회는 internal.balance(사용자)
--   5. 브라우저에서 부를 함수는 security definer + search_path 고정 +
--      anon 권한 회수 + authenticated 에만 execute 부여
--   6. 확률·정답 판정은 반드시 서버(SQL)에서. 브라우저 값은 믿지 않는다.
-- =====================================================================

-- (선택) 기능 전용 테이블: 기록이 필요할 때
create table if not exists public.feat_example_log (
  id         bigint generated always as identity primary key,
  user_id    uuid not null references auth.users (id) on delete cascade,
  result     jsonb not null,
  created_at timestamptz not null default now()
);
alter table public.feat_example_log enable row level security;

drop policy if exists "feat_example_log: 본인 것만" on public.feat_example_log;
create policy "feat_example_log: 본인 것만" on public.feat_example_log
  for select to authenticated using (user_id = (select auth.uid()));

revoke all on public.feat_example_log from anon;
revoke insert, update, delete, truncate on public.feat_example_log from authenticated;

-- 브라우저에서 부르는 함수: ACS.rpc('feat_example_play', { p_choice: 1 })
create or replace function public.feat_example_play(p_choice integer)
returns json
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid     uuid := auth.uid();
  v_balance integer;
  v_win     boolean;
begin
  if v_uid is null then
    raise exception '로그인이 필요합니다.' using errcode = '28000';
  end if;

  -- 1) 비용 차감 (모자라면 여기서 예외 → 아래 코드는 실행되지 않음)
  v_balance := internal.credit_add(v_uid, -1, 'feature:example:cost');

  -- 2) 판정은 서버에서
  v_win := (floor(random() * 2)::int = p_choice);

  -- 3) 보상 지급
  if v_win then
    v_balance := internal.credit_add(v_uid, 2, 'feature:example:reward');
  end if;

  insert into public.feat_example_log (user_id, result)
  values (v_uid, jsonb_build_object('choice', p_choice, 'win', v_win));

  return json_build_object('win', v_win, 'balance', v_balance);
end;
$$;

revoke all on function public.feat_example_play(integer) from public, anon;
grant execute on function public.feat_example_play(integer) to authenticated;
