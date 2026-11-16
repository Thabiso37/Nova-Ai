-- NOVAAI MARKET — Seller Store Likes & Followers
-- Migration candidate: 20261116-seller-store-likes-followers.sql
-- STATUS: PROPOSED FOR REVIEW ONLY. NOT EXECUTED. NOT PRODUCTION APPROVED.
--
-- Scope is limited to the two engagement tables, their constraints and RLS,
-- the approved-store helper, and the aggregate engagement RPC.
-- No seller, marketplace-permission, product, profile, order, fulfilment,
-- Storage, branding, or frontend objects are modified.
--
-- The older docs/sql/20261115-seller-storefront-branding.sql candidate also
-- contains engagement object definitions. This migration fails closed if any
-- target engagement table/function already exists. Do not apply both blindly.
--
-- Live schema has not been inspected. Review and test in a disposable approved
-- environment before considering production execution.

begin;

-- 1. Fail-closed preflight.
do $preflight$
declare
  v_missing integer;
  v_policy_count integer;
  v_policy_hash text;
begin
  if pg_catalog.to_regclass('auth.users') is null then
    raise exception 'Preflight failed: auth.users is missing.';
  end if;
  if pg_catalog.to_regclass('public.seller_stores') is null then
    raise exception 'Preflight failed: public.seller_stores is missing.';
  end if;
  if pg_catalog.to_regclass('public.seller_marketplace_permissions') is null then
    raise exception 'Preflight failed: public.seller_marketplace_permissions is missing.';
  end if;
  if pg_catalog.to_regprocedure('auth.uid()') is null then
    raise exception 'Preflight failed: auth.uid() is missing.';
  end if;

  if pg_catalog.to_regclass('public.seller_store_likes') is not null then
    raise exception 'Preflight stopped: public.seller_store_likes already exists. Inspect it; do not overwrite it.';
  end if;
  if pg_catalog.to_regclass('public.seller_store_follows') is not null then
    raise exception 'Preflight stopped: public.seller_store_follows already exists. Inspect it; do not overwrite it.';
  end if;
  if pg_catalog.to_regprocedure('public.novaai_is_approved_store_for_engagement(uuid)') is not null then
    raise exception 'Preflight stopped: public.novaai_is_approved_store_for_engagement(uuid) already exists. Inspect it; do not replace it.';
  end if;
  if pg_catalog.to_regprocedure('public.get_seller_store_engagement(uuid)') is not null then
    raise exception 'Preflight stopped: public.get_seller_store_engagement(uuid) already exists. Inspect it; do not replace it.';
  end if;

  if not exists (select 1 from pg_catalog.pg_roles where rolname = 'anon')
     or not exists (select 1 from pg_catalog.pg_roles where rolname = 'authenticated') then
    raise exception 'Preflight failed: expected Supabase anon/authenticated roles are missing.';
  end if;

  select count(*) into v_missing
  from (
    values
      ('auth', 'users', 'id', 'uuid'),
      ('public', 'seller_stores', 'user_id', 'uuid'),
      ('public', 'seller_stores', 'status', 'text'),
      ('public', 'seller_stores', 'primary_marketplace', 'text'),
      ('public', 'seller_marketplace_permissions', 'user_id', 'uuid'),
      ('public', 'seller_marketplace_permissions', 'marketplace', 'text'),
      ('public', 'seller_marketplace_permissions', 'status', 'text')
  ) as expected(schema_name, table_name, column_name, type_name)
  where not exists (
    select 1
    from pg_catalog.pg_namespace n
    join pg_catalog.pg_class c on c.relnamespace = n.oid
    join pg_catalog.pg_attribute a on a.attrelid = c.oid
    where n.nspname = expected.schema_name
      and c.relname = expected.table_name
      and c.relkind in ('r', 'p')
      and a.attname = expected.column_name
      and a.attnum > 0
      and not a.attisdropped
      and a.atttypid = pg_catalog.to_regtype(expected.type_name)
  );
  if v_missing <> 0 then
    raise exception 'Preflight failed: % required columns are missing or have unexpected types.', v_missing;
  end if;

  -- The review baseline records six existing seller_stores policies.
  select count(*) into v_policy_count
  from pg_catalog.pg_policies
  where schemaname = 'public' and tablename = 'seller_stores';
  if v_policy_count <> 6 then
    raise exception 'Preflight failed: expected 6 existing public.seller_stores policies, found %. No seller_stores policy will be changed.', v_policy_count;
  end if;

  select pg_catalog.md5(coalesce(
    pg_catalog.string_agg(
      pg_catalog.concat_ws(pg_catalog.chr(31), policyname, permissive,
        roles::text, cmd, coalesce(qual, ''), coalesce(with_check, '')),
      pg_catalog.chr(30) order by policyname
    ), ''))
  into v_policy_hash
  from pg_catalog.pg_policies
  where schemaname = 'public' and tablename = 'seller_stores';

  perform pg_catalog.set_config(
    'novaai.seller_store_engagement.seller_stores_policy_hash',
    v_policy_hash, true
  );
end;
$preflight$;

-- 2. Engagement tables. Composite primary keys enforce one row per pair.
create table public.seller_store_likes (
  store_user_id uuid not null references auth.users(id) on delete cascade,
  customer_id uuid not null references auth.users(id) on delete cascade,
  created_at timestamptz not null default pg_catalog.now(),
  constraint seller_store_likes_pk primary key (store_user_id, customer_id),
  constraint seller_store_likes_not_self check (store_user_id <> customer_id)
);

create table public.seller_store_follows (
  store_user_id uuid not null references auth.users(id) on delete cascade,
  customer_id uuid not null references auth.users(id) on delete cascade,
  created_at timestamptz not null default pg_catalog.now(),
  constraint seller_store_follows_pk primary key (store_user_id, customer_id),
  constraint seller_store_follows_not_self check (store_user_id <> customer_id)
);

alter table public.seller_store_likes enable row level security;
alter table public.seller_store_follows enable row level security;

revoke all privileges on table public.seller_store_likes from public, anon, authenticated;
revoke all privileges on table public.seller_store_follows from public, anon, authenticated;
grant select, insert, delete on table public.seller_store_likes to authenticated;
grant select, insert, delete on table public.seller_store_follows to authenticated;

-- 3. Approved-store helper.
-- Authenticated callers can probe approval state for a supplied UUID; review
-- whether this boolean disclosure is acceptable or move the helper to a private
-- schema before production approval.
create function public.novaai_is_approved_store_for_engagement(p_store_user_id uuid)
returns boolean
language sql
stable
security definer
set search_path = pg_catalog
as $function$
  select exists (
    select 1
    from public.seller_stores s
    join public.seller_marketplace_permissions mp
      on mp.user_id = s.user_id
     and mp.marketplace = s.primary_marketplace
    where s.user_id = p_store_user_id
      and s.status = 'approved'
      and mp.status = 'approved'
  );
$function$;

revoke all privileges on function public.novaai_is_approved_store_for_engagement(uuid)
  from public, anon, authenticated;
grant execute on function public.novaai_is_approved_store_for_engagement(uuid)
  to authenticated;

-- 4. Customer-owned RLS policies. No UPDATE privilege or policy is provided.
create policy seller_store_likes_select_own
  on public.seller_store_likes for select to authenticated
  using (customer_id = (select auth.uid()));

create policy seller_store_likes_insert_own_approved_store
  on public.seller_store_likes for insert to authenticated
  with check (
    customer_id = (select auth.uid())
    and store_user_id <> (select auth.uid())
    and public.novaai_is_approved_store_for_engagement(store_user_id)
  );

create policy seller_store_likes_delete_own
  on public.seller_store_likes for delete to authenticated
  using (customer_id = (select auth.uid()));

create policy seller_store_follows_select_own
  on public.seller_store_follows for select to authenticated
  using (customer_id = (select auth.uid()));

create policy seller_store_follows_insert_own_approved_store
  on public.seller_store_follows for insert to authenticated
  with check (
    customer_id = (select auth.uid())
    and store_user_id <> (select auth.uid())
    and public.novaai_is_approved_store_for_engagement(store_user_id)
  );

create policy seller_store_follows_delete_own
  on public.seller_store_follows for delete to authenticated
  using (customer_id = (select auth.uid()));

-- 5. Aggregate-only RPC. No customer IDs or relationship rows are returned.
-- Anonymous callers receive counts and false personal flags. Missing/unapproved
-- stores return no row.
create function public.get_seller_store_engagement(p_store_user_id uuid)
returns table (
  likes_count bigint,
  followers_count bigint,
  liked boolean,
  following boolean
)
language sql
stable
security definer
set search_path = pg_catalog
as $function$
  select
    (select pg_catalog.count(*) from public.seller_store_likes l
      where l.store_user_id = p_store_user_id) as likes_count,
    (select pg_catalog.count(*) from public.seller_store_follows f
      where f.store_user_id = p_store_user_id) as followers_count,
    exists (select 1 from public.seller_store_likes l
      where l.store_user_id = p_store_user_id
        and l.customer_id = (select auth.uid())) as liked,
    exists (select 1 from public.seller_store_follows f
      where f.store_user_id = p_store_user_id
        and f.customer_id = (select auth.uid())) as following
  where public.novaai_is_approved_store_for_engagement(p_store_user_id);
$function$;

revoke all privileges on function public.get_seller_store_engagement(uuid)
  from public, anon, authenticated;
grant execute on function public.get_seller_store_engagement(uuid)
  to anon, authenticated;

-- 6. Postflight assertions. Any failure rolls back the transaction.
do $postflight$
declare
  v_policy_count integer;
  v_policy_hash text;
begin
  if not (select c.relrowsecurity from pg_catalog.pg_class c
          where c.oid = 'public.seller_store_likes'::pg_catalog.regclass) then
    raise exception 'Postflight failed: RLS is not enabled on seller_store_likes.';
  end if;
  if not (select c.relrowsecurity from pg_catalog.pg_class c
          where c.oid = 'public.seller_store_follows'::pg_catalog.regclass) then
    raise exception 'Postflight failed: RLS is not enabled on seller_store_follows.';
  end if;

  if (select count(*) from pg_catalog.pg_policies
      where schemaname = 'public' and tablename = 'seller_store_likes') <> 3 then
    raise exception 'Postflight failed: unexpected seller_store_likes policy count.';
  end if;
  if (select count(*) from pg_catalog.pg_policies
      where schemaname = 'public' and tablename = 'seller_store_follows') <> 3 then
    raise exception 'Postflight failed: unexpected seller_store_follows policy count.';
  end if;

  if pg_catalog.has_table_privilege('anon', 'public.seller_store_likes', 'SELECT')
     or pg_catalog.has_table_privilege('anon', 'public.seller_store_follows', 'SELECT') then
    raise exception 'Postflight failed: anon has direct engagement-table SELECT access.';
  end if;
  if not pg_catalog.has_table_privilege('authenticated', 'public.seller_store_likes', 'SELECT')
     or not pg_catalog.has_table_privilege('authenticated', 'public.seller_store_likes', 'INSERT')
     or not pg_catalog.has_table_privilege('authenticated', 'public.seller_store_likes', 'DELETE')
     or not pg_catalog.has_table_privilege('authenticated', 'public.seller_store_follows', 'SELECT')
     or not pg_catalog.has_table_privilege('authenticated', 'public.seller_store_follows', 'INSERT')
     or not pg_catalog.has_table_privilege('authenticated', 'public.seller_store_follows', 'DELETE') then
    raise exception 'Postflight failed: authenticated engagement table grants are incomplete.';
  end if;
  if pg_catalog.has_table_privilege('authenticated', 'public.seller_store_likes', 'UPDATE')
     or pg_catalog.has_table_privilege('authenticated', 'public.seller_store_follows', 'UPDATE') then
    raise exception 'Postflight failed: authenticated unexpectedly has UPDATE access.';
  end if;

  if pg_catalog.has_function_privilege('anon',
       'public.novaai_is_approved_store_for_engagement(uuid)', 'EXECUTE') then
    raise exception 'Postflight failed: anon can execute the approval helper.';
  end if;
  if not pg_catalog.has_function_privilege('authenticated',
       'public.novaai_is_approved_store_for_engagement(uuid)', 'EXECUTE')
     or not pg_catalog.has_function_privilege('anon',
       'public.get_seller_store_engagement(uuid)', 'EXECUTE')
     or not pg_catalog.has_function_privilege('authenticated',
       'public.get_seller_store_engagement(uuid)', 'EXECUTE') then
    raise exception 'Postflight failed: expected helper/RPC execute grants are incomplete.';
  end if;

  select count(*) into v_policy_count
  from pg_catalog.pg_policies
  where schemaname = 'public' and tablename = 'seller_stores';
  if v_policy_count <> 6 then
    raise exception 'Postflight failed: seller_stores policy count changed from the expected six.';
  end if;

  select pg_catalog.md5(coalesce(
    pg_catalog.string_agg(
      pg_catalog.concat_ws(pg_catalog.chr(31), policyname, permissive,
        roles::text, cmd, coalesce(qual, ''), coalesce(with_check, '')),
      pg_catalog.chr(30) order by policyname
    ), ''))
  into v_policy_hash
  from pg_catalog.pg_policies
  where schemaname = 'public' and tablename = 'seller_stores';

  if v_policy_hash is distinct from pg_catalog.current_setting(
       'novaai.seller_store_engagement.seller_stores_policy_hash', true) then
    raise exception 'Postflight failed: existing seller_stores policies changed.';
  end if;
end;
$postflight$;

commit;

-- FINAL STATUS: PROPOSED — NOT EXECUTED — NOT PRODUCTION APPROVED.
-- Required before production approval: verify actual schema/effective grants,
-- parse and test in a disposable environment, run role-based RLS tests, verify
-- PostgREST exposure/frontend empty-result behavior, and review helper disclosure.
