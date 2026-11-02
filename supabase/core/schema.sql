-- =====================================================================
--  출석코드 공유소 (모의 프로젝트) — CORE 스키마 v2
--  담당: core 팀 (features 팀은 이 파일을 수정하지 말고 supabase/features/ 를 쓰세요)
--
--  Supabase 대시보드 > SQL Editor 에 통째로 붙여넣고 Run.
--  여러 번 실행해도 안전합니다(idempotent). v1 테이블이 있으면 정리합니다.
--
--  ┌─ 규칙 ─────────────────────────────────────────────────────────────┐
--  │ 세션   : 같은 과목(공백·대소문자 무시)에 유효시간 안에 올라온 코드 묶음   │
--  │ 업로드 : 누구나 가능. 단 세션당 1인 1회, 그 세션을 열람한 사람은 불가     │
--  │ 검증   : 다른 사람과 숫자가 일치  또는  '맞았어요' ≥1 이고 맞음>틀림      │
--  │ 틀림   : '틀렸어요' ≥2 이고 틀림>맞음 → 후보에서 제외                     │
--  │ 열람권 : (검증된 내 업로드 수) + (장부 합계)                             │
--  │          → 틀림으로 바뀌면 그 업로드 보상은 자동으로 사라짐              │
--  │ 열람   : 열람권 1개로 세션 전체(틀림 제외 후보들)를 봄. 업로더는 불가    │
--  │ 평가   : 세션을 연 사람만, 후보 코드별로 1인 1표(변경 가능)              │
--  └────────────────────────────────────────────────────────────────────┘
-- =====================================================================

-- ---------------------------------------------------------------------
-- 0. v1 정리 (codes / code_secrets / unlocks / votes 구조)
-- ---------------------------------------------------------------------
drop function if exists public.submit_code(text, text, integer);
drop function if exists public.unlock_code(bigint);
drop function if exists public.vote_code(bigint, boolean);
drop function if exists public.my_stats();
drop table if exists public.votes, public.unlocks, public.code_secrets, public.codes cascade;

-- 내부 전용 스키마: API 로 노출되지 않음. features 팀의 서버 함수가 여기 함수를 호출.
create schema if not exists internal;
revoke all on schema internal from public, anon, authenticated;

-- ---------------------------------------------------------------------
-- 1. 테이블
-- ---------------------------------------------------------------------
create table if not exists public.profiles (
  id         uuid primary key references auth.users (id) on delete cascade,
  nickname   text not null check (char_length(nickname) between 1 and 20),
  created_at timestamptz not null default now()
);

-- 세션: 숫자 없음 → 로그인 사용자 모두 읽기 + 실시간 전송
create table if not exists public.sessions (
  id              bigint generated always as identity primary key,
  course          text not null check (char_length(course) between 1 and 80),
  course_id       text,                          -- 학수번호-분반 (개설과목 목록에서 고른 경우) 예: COSE213-02
  course_key      text not null,
  opened_at       timestamptz not null default now(),
  expires_at      timestamptz not null,
  upload_count    integer not null default 0,   -- 올린 사람 수
  verified_count  integer not null default 0,   -- 검증된 업로드 수
  candidate_count integer not null default 0,   -- 틀림 제외, 서로 다른 코드 수
  excluded_count  integer not null default 0,   -- 틀림으로 제외된 서로 다른 코드 수
  unlock_count    integer not null default 0,   -- 열람한 사람 수
  updated_at      timestamptz not null default now()
);
alter table public.sessions add column if not exists course_id text;
create index if not exists sessions_open_idx    on public.sessions (course_key, expires_at desc);
create index if not exists sessions_expires_idx on public.sessions (expires_at desc);

-- 업로드: 숫자 포함 → 본인 행만 직접 읽기 (열람자는 RPC 로 집계본을 봄)
create table if not exists public.submissions (
  id         bigint generated always as identity primary key,
  session_id bigint not null references public.sessions (id) on delete cascade,
  user_id    uuid   not null references auth.users (id) on delete cascade,
  code       text   not null check (code ~ '^[0-9]{4}$'),
  status     text   not null default 'pending' check (status in ('pending', 'verified', 'wrong')),
  created_at timestamptz not null default now(),
  unique (session_id, user_id)
);
create index if not exists submissions_user_idx         on public.submissions (user_id);
create index if not exists submissions_session_code_idx on public.submissions (session_id, code);

create table if not exists public.session_unlocks (
  user_id    uuid   not null references auth.users (id) on delete cascade,
  session_id bigint not null references public.sessions (id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (user_id, session_id)
);
create index if not exists session_unlocks_session_idx on public.session_unlocks (session_id);

create table if not exists public.candidate_votes (
  user_id    uuid    not null,
  session_id bigint  not null,
  code       text    not null check (code ~ '^[0-9]{4}$'),
  ok         boolean not null,
  created_at timestamptz not null default now(),
  primary key (user_id, session_id, code),
  foreign key (user_id, session_id) references public.session_unlocks (user_id, session_id) on delete cascade
);
create index if not exists candidate_votes_session_idx on public.candidate_votes (session_id, code);

-- 열람권 장부: 열람(-1), features 의 지급/차감 등. 업로드 보상은 submissions 에서 계산.
create table if not exists public.credit_ledger (
  id         bigint generated always as identity primary key,
  user_id    uuid    not null references auth.users (id) on delete cascade,
  delta      integer not null check (delta <> 0),
  reason     text    not null check (char_length(reason) between 1 and 60),
  ref        text,
  created_at timestamptz not null default now()
);
create index if not exists credit_ledger_user_idx on public.credit_ledger (user_id);

-- ---------------------------------------------------------------------
-- 2. RLS
-- ---------------------------------------------------------------------
alter table public.profiles        enable row level security;
alter table public.sessions        enable row level security;
alter table public.submissions     enable row level security;
alter table public.session_unlocks enable row level security;
alter table public.candidate_votes enable row level security;
alter table public.credit_ledger   enable row level security;

drop policy if exists "profiles: 로그인 사용자 읽기" on public.profiles;
create policy "profiles: 로그인 사용자 읽기" on public.profiles
  for select to authenticated using (true);

drop policy if exists "sessions: 로그인 사용자 읽기" on public.sessions;
create policy "sessions: 로그인 사용자 읽기" on public.sessions
  for select to authenticated using (true);

drop policy if exists "submissions: 본인 것만" on public.submissions;
create policy "submissions: 본인 것만" on public.submissions
  for select to authenticated using (user_id = (select auth.uid()));

drop policy if exists "session_unlocks: 본인 것만" on public.session_unlocks;
create policy "session_unlocks: 본인 것만" on public.session_unlocks
  for select to authenticated using (user_id = (select auth.uid()));

drop policy if exists "candidate_votes: 본인 것만" on public.candidate_votes;
create policy "candidate_votes: 본인 것만" on public.candidate_votes
  for select to authenticated using (user_id = (select auth.uid()));

drop policy if exists "credit_ledger: 본인 것만" on public.credit_ledger;
create policy "credit_ledger: 본인 것만" on public.credit_ledger
  for select to authenticated using (user_id = (select auth.uid()));

-- 쓰기 정책 없음 → 모든 쓰기는 아래 RPC 로만
revoke all on public.profiles, public.sessions, public.submissions,
              public.session_unlocks, public.candidate_votes, public.credit_ledger from anon;
revoke insert, update, delete, truncate on public.profiles, public.sessions, public.submissions,
              public.session_unlocks, public.candidate_votes, public.credit_ledger from authenticated;

-- ---------------------------------------------------------------------
-- 3. 가입 시 프로필 자동 생성
-- ---------------------------------------------------------------------
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.profiles (id, nickname)
  values (
    new.id,
    left(coalesce(nullif(btrim(new.raw_user_meta_data ->> 'nickname'), ''),
                  split_part(new.email, '@', 1),
                  '익명'), 20)
  )
  on conflict (id) do nothing;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- ---------------------------------------------------------------------
-- 4. 내부 함수 (internal 스키마: 브라우저에서 호출 불가)
-- ---------------------------------------------------------------------

-- 열람권 잔액 = 검증된 업로드 수 + 장부 합계
create or replace function internal.balance(p_uid uuid)
returns integer
language sql
stable
security definer
set search_path = public
as $$
  select (select count(*) from public.submissions where user_id = p_uid and status = 'verified')::int
       + coalesce((select sum(delta) from public.credit_ledger where user_id = p_uid), 0)::int;
$$;

-- 열람권 증감 (features 팀이 쓰는 유일한 입구)
--   p_delta < 0 이면 잔액이 모자랄 때 예외. 같은 사용자의 동시 요청은 프로필 행 잠금으로 직렬화.
--   반환: 변경 후 잔액
create or replace function internal.credit_add(p_uid uuid, p_delta integer, p_reason text, p_ref text default null)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_balance integer;
begin
  if p_uid is null then
    raise exception '로그인이 필요합니다.' using errcode = '28000';
  end if;
  if p_delta is null or p_delta = 0 then
    raise exception 'credit_add: delta 는 0이 아니어야 합니다.' using errcode = '22023';
  end if;

  perform 1 from public.profiles where id = p_uid for update;
  v_balance := internal.balance(p_uid);

  if p_delta < 0 and v_balance + p_delta < 0 then
    raise exception '열람권이 부족해요. (현재 %개)', v_balance using errcode = 'P0001';
  end if;

  insert into public.credit_ledger (user_id, delta, reason, ref)
  values (p_uid, p_delta, p_reason, p_ref);

  return v_balance + p_delta;
end;
$$;

-- 세션 재계산: 후보별 상태(검증/대기/틀림)와 세션 집계를 갱신
create or replace function internal.refresh_session(p_session_id bigint)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  with v as (
    select code,
           count(*) filter (where ok)     as ok,
           count(*) filter (where not ok) as bad
      from public.candidate_votes
     where session_id = p_session_id
     group by code
  ), c as (
    select s.code,
           count(*)               as uploaders,
           coalesce(max(v.ok), 0)  as ok,
           coalesce(max(v.bad), 0) as bad
      from public.submissions s
      left join v on v.code = s.code
     where s.session_id = p_session_id
     group by s.code
  ), st as (
    select code,
           case
             when bad >= 2 and bad > ok              then 'wrong'
             when uploaders >= 2 or (ok >= 1 and ok > bad) then 'verified'
             else 'pending'
           end as status
      from c
  )
  update public.submissions s
     set status = st.status
    from st
   where s.session_id = p_session_id
     and s.code = st.code
     and s.status <> st.status;

  update public.sessions x
     set upload_count    = (select count(*) from public.submissions where session_id = p_session_id),
         verified_count  = (select count(*) from public.submissions where session_id = p_session_id and status = 'verified'),
         candidate_count = (select count(distinct code) from public.submissions where session_id = p_session_id and status <> 'wrong'),
         excluded_count  = (select count(distinct code) from public.submissions where session_id = p_session_id and status = 'wrong'),
         updated_at      = now()
   where x.id = p_session_id;
end;
$$;

revoke all on all functions in schema internal from public, anon, authenticated;

-- ---------------------------------------------------------------------
-- 5. 공개 RPC (로그인 사용자용)
-- ---------------------------------------------------------------------

-- 내 현황
create or replace function public.my_stats()
returns json
language sql
stable
security definer
set search_path = public
as $$
  select json_build_object(
    'uploaded', (select count(*) from public.submissions where user_id = auth.uid()),
    'verified', (select count(*) from public.submissions where user_id = auth.uid() and status = 'verified'),
    'pending',  (select count(*) from public.submissions where user_id = auth.uid() and status = 'pending'),
    'wrong',    (select count(*) from public.submissions where user_id = auth.uid() and status = 'wrong'),
    'unlocked', (select count(*) from public.session_unlocks where user_id = auth.uid()),
    'credits',  internal.balance(auth.uid())
  );
$$;

-- 세션 내용 보기
--   열람한 사람: 틀림 제외 후보 전체 (신뢰도 순)
--   업로더    : 내 코드와 상태 + 일치 인원 + 다른 후보 '개수'만 (다른 숫자는 비공개)
create or replace function public.session_candidates(p_session_id bigint)
returns json
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_uid  uuid := auth.uid();
  v_sess public.sessions;
  v_mine public.submissions;
begin
  if v_uid is null then
    raise exception '로그인이 필요합니다.' using errcode = '28000';
  end if;
  select * into v_sess from public.sessions where id = p_session_id;
  if not found then
    raise exception '존재하지 않는 세션입니다.' using errcode = 'P0002';
  end if;

  if exists (select 1 from public.session_unlocks where user_id = v_uid and session_id = p_session_id) then
    return json_build_object(
      'role', 'unlocked',
      'excluded_count', v_sess.excluded_count,
      'candidates', coalesce((
        select json_agg(row_to_json(t) order by t.rank_status, t.score desc, t.uploaders desc, t.last_at desc)
          from (
            select s.code,
                   count(*)                                   as uploaders,
                   max(s.status)                              as status,
                   case max(s.status) when 'verified' then 0 else 1 end as rank_status,
                   coalesce(v.ok, 0)                          as ok,
                   coalesce(v.bad, 0)                         as bad,
                   coalesce(v.ok, 0) - coalesce(v.bad, 0)     as score,
                   max(s.created_at)                          as last_at,
                   (select cv.ok from public.candidate_votes cv
                     where cv.user_id = v_uid and cv.session_id = p_session_id and cv.code = s.code) as my_vote
              from public.submissions s
              left join (
                select code, count(*) filter (where ok) as ok, count(*) filter (where not ok) as bad
                  from public.candidate_votes where session_id = p_session_id group by code
              ) v on v.code = s.code
             where s.session_id = p_session_id and s.status <> 'wrong'
             group by s.code, v.ok, v.bad
          ) t
      ), '[]'::json)
    );
  end if;

  select * into v_mine from public.submissions where session_id = p_session_id and user_id = v_uid;
  if found then
    return json_build_object(
      'role', 'uploader',
      'excluded_count', v_sess.excluded_count,
      'mine', json_build_object(
        'code',   v_mine.code,
        'status', v_mine.status,
        'same_code_uploaders', (select count(*) from public.submissions
                                 where session_id = p_session_id and code = v_mine.code),
        'ok',  (select count(*) from public.candidate_votes where session_id = p_session_id and code = v_mine.code and ok),
        'bad', (select count(*) from public.candidate_votes where session_id = p_session_id and code = v_mine.code and not ok)
      ),
      'other_candidates', (select count(distinct code) from public.submissions
                            where session_id = p_session_id and code <> v_mine.code and status <> 'wrong'),
      'candidates', '[]'::json
    );
  end if;

  raise exception '열람권으로 연 세션만 볼 수 있어요.' using errcode = 'P0001';
end;
$$;

-- 코드 올리기
--   p_course    : 화면에 보일 과목 이름 (예: '자료구조 02분반')
--   p_course_id : 개설과목 목록에서 골랐다면 학수번호-분반 (예: 'COSE213-02') → 세션 묶음 기준
--                 없으면(직접 입력) 과목 이름에서 공백·대소문자를 무시한 값이 기준
drop function if exists public.submit_code(text, text, integer);
create or replace function public.submit_code(p_course text, p_code text, p_minutes integer default 10,
                                              p_course_id text default null)
returns json
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid       uuid    := auth.uid();
  v_course    text    := btrim(regexp_replace(coalesce(p_course, ''), '\s+', ' ', 'g'));
  v_course_id text    := nullif(upper(btrim(coalesce(p_course_id, ''))), '');
  v_key       text;
  v_code      text    := btrim(coalesce(p_code, ''));
  v_minutes   integer := least(greatest(coalesce(p_minutes, 10), 1), 10);
  v_sess      public.sessions;
  v_sub       public.submissions;
begin
  if v_uid is null then
    raise exception '로그인이 필요합니다.' using errcode = '28000';
  end if;
  if v_code !~ '^[0-9]{4}$' then
    raise exception '출석 코드는 숫자 4자리여야 합니다.' using errcode = '22023';
  end if;
  if char_length(v_course) not between 1 and 80 then
    raise exception '과목명은 1~80자로 입력해 주세요.' using errcode = '22023';
  end if;
  if v_course_id is not null and v_course_id !~ '^[A-Z0-9]{3,12}-[A-Z0-9]{1,4}$' then
    raise exception '학수번호 형식이 올바르지 않아요.' using errcode = '22023';
  end if;
  v_key := coalesce('id:' || v_course_id, lower(replace(v_course, ' ', '')));

  perform 1 from public.profiles where id = v_uid for update;
  if not found then
    raise exception '프로필이 없습니다. 다시 로그인해 주세요.' using errcode = 'P0002';
  end if;

  -- 같은 과목에 동시에 세션이 두 개 생기지 않도록 과목 단위 잠금
  perform pg_advisory_xact_lock(hashtext('acs-session:' || v_key));

  select * into v_sess from public.sessions
   where course_key = v_key and expires_at > now()
   order by opened_at desc limit 1;

  if not found then
    insert into public.sessions (course, course_id, course_key, expires_at)
    values (v_course, v_course_id, v_key, now() + make_interval(mins => v_minutes))
    returning * into v_sess;
  end if;

  if exists (select 1 from public.session_unlocks where user_id = v_uid and session_id = v_sess.id) then
    raise exception '이 세션은 열람권으로 열어 봤기 때문에 코드를 올릴 수 없어요.' using errcode = 'P0001';
  end if;
  if exists (select 1 from public.submissions where user_id = v_uid and session_id = v_sess.id) then
    raise exception '이 수업에는 이미 코드를 올렸어요. 세션이 끝나면 다시 올릴 수 있어요.' using errcode = 'P0001';
  end if;

  insert into public.submissions (session_id, user_id, code)
  values (v_sess.id, v_uid, v_code)
  returning * into v_sub;

  perform internal.refresh_session(v_sess.id);
  select * into v_sub from public.submissions where id = v_sub.id;

  return json_build_object(
    'session_id',    v_sess.id,
    'submission_id', v_sub.id,
    'code',          v_sub.code,
    'status',        v_sub.status,
    'stats',         public.my_stats());
end;
$$;

-- 세션 열기: 열람권 -1 (이미 연 세션은 무료)
create or replace function public.unlock_session(p_session_id bigint)
returns json
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid  uuid := auth.uid();
  v_sess public.sessions;
begin
  if v_uid is null then
    raise exception '로그인이 필요합니다.' using errcode = '28000';
  end if;

  perform 1 from public.profiles where id = v_uid for update;

  select * into v_sess from public.sessions where id = p_session_id;
  if not found then
    raise exception '존재하지 않는 세션입니다.' using errcode = 'P0002';
  end if;

  if exists (select 1 from public.session_unlocks where user_id = v_uid and session_id = p_session_id) then
    return json_build_object('charged', false,
                             'view', public.session_candidates(p_session_id),
                             'stats', public.my_stats());
  end if;
  if exists (select 1 from public.submissions where user_id = v_uid and session_id = p_session_id) then
    raise exception '직접 코드를 올린 세션이에요. 내 코드는 열람권 없이 볼 수 있어요.' using errcode = 'P0001';
  end if;
  if v_sess.expires_at <= now() then
    raise exception '이미 끝난 세션이에요. 열람권은 차감되지 않았어요.' using errcode = 'P0001';
  end if;
  if v_sess.candidate_count = 0 then
    raise exception '볼 수 있는 코드가 없어요(모두 틀림으로 제외됨).' using errcode = 'P0001';
  end if;

  perform internal.credit_add(v_uid, -1, 'unlock', 'session:' || p_session_id);
  insert into public.session_unlocks (user_id, session_id) values (v_uid, p_session_id);
  update public.sessions set unlock_count = unlock_count + 1, updated_at = now() where id = p_session_id;

  return json_build_object('charged', true,
                           'view', public.session_candidates(p_session_id),
                           'stats', public.my_stats());
end;
$$;

-- 후보 코드 평가 (세션을 연 사람만). 다시 누르면 바뀜.
create or replace function public.vote_candidate(p_session_id bigint, p_code text, p_ok boolean)
returns json
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
begin
  if v_uid is null then
    raise exception '로그인이 필요합니다.' using errcode = '28000';
  end if;
  if p_ok is null then
    raise exception '평가 값이 비었습니다.' using errcode = '22023';
  end if;
  if not exists (select 1 from public.session_unlocks where user_id = v_uid and session_id = p_session_id) then
    raise exception '열람한 세션의 코드만 평가할 수 있어요.' using errcode = 'P0001';
  end if;
  if not exists (select 1 from public.submissions where session_id = p_session_id and code = p_code) then
    raise exception '이 세션에 없는 코드예요.' using errcode = 'P0002';
  end if;

  insert into public.candidate_votes (user_id, session_id, code, ok)
  values (v_uid, p_session_id, p_code, p_ok)
  on conflict (user_id, session_id, code) do update set ok = excluded.ok, created_at = now();

  perform internal.refresh_session(p_session_id);
  return public.session_candidates(p_session_id);
end;
$$;

-- 함수 실행 권한
revoke all on function public.handle_new_user()                       from public, anon, authenticated;
revoke all on function public.my_stats()                              from public, anon;
revoke all on function public.session_candidates(bigint)              from public, anon;
revoke all on function public.submit_code(text, text, integer, text)  from public, anon;
revoke all on function public.unlock_session(bigint)                  from public, anon;
revoke all on function public.vote_candidate(bigint, text, boolean)   from public, anon;
grant execute on function public.my_stats()                            to authenticated;
grant execute on function public.session_candidates(bigint)            to authenticated;
grant execute on function public.submit_code(text, text, integer, text) to authenticated;
grant execute on function public.unlock_session(bigint)                to authenticated;
grant execute on function public.vote_candidate(bigint, text, boolean) to authenticated;

-- ---------------------------------------------------------------------
-- 6. 실시간
--    sessions      : 모두에게 (숫자 없음)
--    submissions   : RLS 로 본인 행만 전달 → "내 코드 검증됨 +1" 알림
--    credit_ledger : RLS 로 본인 행만 전달 → features 지급/차감 시 잔액 갱신
-- ---------------------------------------------------------------------
do $$
declare
  t text;
begin
  foreach t in array array['sessions', 'submissions', 'credit_ledger'] loop
    if not exists (select 1 from pg_publication_tables
                    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = t) then
      execute format('alter publication supabase_realtime add table public.%I', t);
    end if;
  end loop;
end;
$$;
