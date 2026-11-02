-- =====================================================================
--  출석코드 공유소 (모의 프로젝트) — Supabase 스키마
--  Supabase 대시보드 > SQL Editor 에 통째로 붙여넣고 Run 하면 됩니다.
--  여러 번 실행해도 안전하도록(idempotent) 작성했습니다.
--
--  핵심 규칙
--   · 코드 1개를 올리면 열람권 +1, 남의 코드 1개를 열면 열람권 -1
--     → 열람권 = (내가 올린 코드 수) - (내가 연 코드 수)
--   · 코드 숫자(4자리)는 code_secrets 테이블에 따로 보관하고,
--     RLS 로 "올린 사람 본인 + 열람권을 써서 연 사람"만 읽을 수 있음
--   · 목록(과목·올린 사람·만료 시각·열람 수)은 codes 테이블 → 실시간 전송
--   · 쓰기는 전부 RPC(security definer 함수)로만 가능 → 클라이언트 조작 차단
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1. 테이블
-- ---------------------------------------------------------------------

-- 닉네임 (이메일 대신 화면에 표시)
create table if not exists public.profiles (
  id         uuid primary key references auth.users (id) on delete cascade,
  nickname   text not null check (char_length(nickname) between 1 and 20),
  created_at timestamptz not null default now()
);

-- 코드 메타데이터 (숫자 자체는 없음 → 모두에게 공개, 실시간 전송 대상)
create table if not exists public.codes (
  id                bigint generated always as identity primary key,
  course            text not null check (char_length(course) between 1 and 40),
  uploader_id       uuid not null references auth.users (id) on delete cascade,
  uploader_nickname text not null,
  created_at        timestamptz not null default now(),
  expires_at        timestamptz not null,
  unlock_count      integer not null default 0,
  ok_count          integer not null default 0,
  bad_count         integer not null default 0
);
create index if not exists codes_expires_at_idx on public.codes (expires_at desc);
create index if not exists codes_uploader_idx   on public.codes (uploader_id);

-- 실제 4자리 코드 (RLS 로 보호)
create table if not exists public.code_secrets (
  code_id bigint primary key references public.codes (id) on delete cascade,
  code    text not null check (code ~ '^[0-9]{4}$')
);

-- 누가 어떤 코드를 열었는지 (열람권 사용 기록)
create table if not exists public.unlocks (
  user_id    uuid   not null references auth.users (id) on delete cascade,
  code_id    bigint not null references public.codes (id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (user_id, code_id)
);
create index if not exists unlocks_code_idx on public.unlocks (code_id);

-- 연 사람이 남기는 "맞았어요 / 틀렸어요" 평가
create table if not exists public.votes (
  user_id    uuid    not null references auth.users (id) on delete cascade,
  code_id    bigint  not null references public.codes (id) on delete cascade,
  ok         boolean not null,
  created_at timestamptz not null default now(),
  primary key (user_id, code_id)
);

-- ---------------------------------------------------------------------
-- 2. RLS (행 수준 보안)
-- ---------------------------------------------------------------------
alter table public.profiles     enable row level security;
alter table public.codes        enable row level security;
alter table public.code_secrets enable row level security;
alter table public.unlocks      enable row level security;
alter table public.votes        enable row level security;

drop policy if exists "profiles: 로그인 사용자 읽기" on public.profiles;
create policy "profiles: 로그인 사용자 읽기" on public.profiles
  for select to authenticated using (true);

drop policy if exists "codes: 로그인 사용자 읽기" on public.codes;
create policy "codes: 로그인 사용자 읽기" on public.codes
  for select to authenticated using (true);

drop policy if exists "code_secrets: 본인 또는 연 사람만" on public.code_secrets;
create policy "code_secrets: 본인 또는 연 사람만" on public.code_secrets
  for select to authenticated using (
    exists (select 1 from public.codes c
             where c.id = code_secrets.code_id
               and c.uploader_id = (select auth.uid()))
    or exists (select 1 from public.unlocks u
                where u.code_id = code_secrets.code_id
                  and u.user_id = (select auth.uid()))
  );

drop policy if exists "unlocks: 본인 기록만" on public.unlocks;
create policy "unlocks: 본인 기록만" on public.unlocks
  for select to authenticated using (user_id = (select auth.uid()));

drop policy if exists "votes: 본인 기록만" on public.votes;
create policy "votes: 본인 기록만" on public.votes
  for select to authenticated using (user_id = (select auth.uid()));

-- insert / update / delete 정책은 일부러 만들지 않음 → 아래 RPC 로만 쓰기 가능

-- 비로그인(anon) 은 아무것도 못 보게 권한 자체를 회수
revoke all on public.profiles, public.codes, public.code_secrets,
              public.unlocks, public.votes from anon;
revoke insert, update, delete, truncate on public.profiles, public.codes,
              public.code_secrets, public.unlocks, public.votes from authenticated;

-- ---------------------------------------------------------------------
-- 3. 가입 시 프로필 자동 생성 (signUp 의 options.data.nickname 사용)
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
-- 4. RPC 함수
-- ---------------------------------------------------------------------

-- 내 현황: 올린 수 / 연 수 / 남은 열람권
create or replace function public.my_stats()
returns json
language sql
stable
security definer
set search_path = public
as $$
  with s as (
    select (select count(*) from public.codes   where uploader_id = auth.uid()) as uploaded,
           (select count(*) from public.unlocks where user_id     = auth.uid()) as unlocked
  )
  select json_build_object(
           'uploaded', uploaded,
           'unlocked', unlocked,
           'credits',  uploaded - unlocked)
    from s;
$$;

-- 코드 올리기: 열람권 +1
--   p_minutes : 남은 유효 시간(1~10분). 교수님이 코드를 띄운 지 3분 지났으면 7 을 넣는 식.
create or replace function public.submit_code(p_course text, p_code text, p_minutes integer default 10)
returns json
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid     uuid    := auth.uid();
  v_course  text    := btrim(regexp_replace(coalesce(p_course, ''), '\s+', ' ', 'g'));
  v_code    text    := btrim(coalesce(p_code, ''));
  v_minutes integer := least(greatest(coalesce(p_minutes, 10), 1), 10);
  v_nick    text;
  v_row     public.codes;
begin
  if v_uid is null then
    raise exception '로그인이 필요합니다.' using errcode = '28000';
  end if;
  if v_code !~ '^[0-9]{4}$' then
    raise exception '출석 코드는 숫자 4자리여야 합니다.' using errcode = '22023';
  end if;
  if char_length(v_course) not between 1 and 40 then
    raise exception '과목명은 1~40자로 입력해 주세요.' using errcode = '22023';
  end if;

  -- 같은 사용자의 동시 요청 직렬화 (프로필 행 잠금)
  select nickname into v_nick from public.profiles where id = v_uid for update;
  if v_nick is null then
    raise exception '프로필이 없습니다. 다시 로그인해 주세요.' using errcode = 'P0002';
  end if;

  -- 열람권 부풀리기 방지: 같은 과목에 아직 유효한 내 코드가 있으면 거절
  if exists (select 1 from public.codes
              where uploader_id = v_uid
                and course = v_course
                and expires_at > now()) then
    raise exception '이 과목에 올린 코드가 아직 유효해요. 만료된 뒤에 다시 올릴 수 있어요.'
      using errcode = 'P0001';
  end if;

  insert into public.codes (course, uploader_id, uploader_nickname, expires_at)
  values (v_course, v_uid, v_nick, now() + make_interval(mins => v_minutes))
  returning * into v_row;

  insert into public.code_secrets (code_id, code) values (v_row.id, v_code);

  return json_build_object(
    'id',         v_row.id,
    'code',       v_code,
    'expires_at', v_row.expires_at,
    'stats',      public.my_stats());
end;
$$;

-- 남의 코드 열기: 열람권 -1 (이미 연 코드는 무료로 다시 보여줌)
create or replace function public.unlock_code(p_code_id bigint)
returns json
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid   uuid := auth.uid();
  v_row   public.codes;
  v_code  text;
  v_stats json;
begin
  if v_uid is null then
    raise exception '로그인이 필요합니다.' using errcode = '28000';
  end if;

  -- 같은 사용자의 동시 요청 직렬화 → 열람권 이중 사용 방지
  perform 1 from public.profiles where id = v_uid for update;

  select * into v_row from public.codes where id = p_code_id;
  if not found then
    raise exception '존재하지 않는 코드입니다.' using errcode = 'P0002';
  end if;

  select code into v_code from public.code_secrets where code_id = p_code_id;

  -- 내 코드거나 이미 연 코드면 그냥 반환
  if v_row.uploader_id = v_uid
     or exists (select 1 from public.unlocks where user_id = v_uid and code_id = p_code_id) then
    return json_build_object('code', v_code, 'charged', false, 'stats', public.my_stats());
  end if;

  if v_row.expires_at <= now() then
    raise exception '이미 만료된 코드예요. 열람권은 차감되지 않았어요.' using errcode = 'P0001';
  end if;

  v_stats := public.my_stats();
  if (v_stats ->> 'credits')::int <= 0 then
    raise exception '열람권이 없어요. 코드를 하나 올리면 하나를 볼 수 있어요.' using errcode = 'P0001';
  end if;

  insert into public.unlocks (user_id, code_id) values (v_uid, p_code_id);
  update public.codes set unlock_count = unlock_count + 1 where id = p_code_id;

  return json_build_object('code', v_code, 'charged', true, 'stats', public.my_stats());
end;
$$;

-- 연 코드 평가: 맞았어요(true) / 틀렸어요(false). 다시 누르면 바뀜.
create or replace function public.vote_code(p_code_id bigint, p_ok boolean)
returns json
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_ok  integer;
  v_bad integer;
begin
  if v_uid is null then
    raise exception '로그인이 필요합니다.' using errcode = '28000';
  end if;
  if p_ok is null then
    raise exception '평가 값이 비었습니다.' using errcode = '22023';
  end if;
  if not exists (select 1 from public.unlocks where user_id = v_uid and code_id = p_code_id) then
    raise exception '열람한 코드만 평가할 수 있어요.' using errcode = 'P0001';
  end if;

  insert into public.votes (user_id, code_id, ok) values (v_uid, p_code_id, p_ok)
  on conflict (user_id, code_id) do update set ok = excluded.ok, created_at = now();

  select count(*) filter (where ok), count(*) filter (where not ok)
    into v_ok, v_bad
    from public.votes where code_id = p_code_id;

  update public.codes set ok_count = v_ok, bad_count = v_bad where id = p_code_id;

  return json_build_object('ok_count', v_ok, 'bad_count', v_bad, 'my_vote', p_ok);
end;
$$;

-- 함수 실행 권한: 로그인 사용자만
revoke all on function public.my_stats()                        from public, anon;
revoke all on function public.submit_code(text, text, integer)  from public, anon;
revoke all on function public.unlock_code(bigint)               from public, anon;
revoke all on function public.vote_code(bigint, boolean)        from public, anon;
revoke all on function public.handle_new_user()                 from public, anon, authenticated;
grant execute on function public.my_stats()                       to authenticated;
grant execute on function public.submit_code(text, text, integer) to authenticated;
grant execute on function public.unlock_code(bigint)              to authenticated;
grant execute on function public.vote_code(bigint, boolean)       to authenticated;

-- ---------------------------------------------------------------------
-- 5. 실시간(Realtime): codes 테이블 변경을 JSON 으로 브로드캐스트
--    (코드 숫자는 codes 에 없으므로 실시간으로 새어 나가지 않음)
-- ---------------------------------------------------------------------
do $$
begin
  if not exists (select 1 from pg_publication_tables
                  where pubname = 'supabase_realtime'
                    and schemaname = 'public'
                    and tablename = 'codes') then
    alter publication supabase_realtime add table public.codes;
  end if;
end;
$$;
