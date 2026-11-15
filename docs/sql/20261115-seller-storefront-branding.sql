-- NOVAAI Seller Storefront & Branding
-- PREPARED FOR REVIEW ONLY. DO NOT APPLY until explicitly approved.
-- Adds nullable branding metadata and customer-to-store engagement records.
-- Does not modify existing seller, product, order, fulfilment or permission rows.

begin;

alter table public.seller_stores
  add column if not exists store_logo_url text,
  add column if not exists store_banner_url text;

-- Customer relationships are unique per store/customer pair and reference
-- the seller's existing auth user identity.
create table if not exists public.seller_store_likes (
  store_user_id uuid not null references auth.users(id) on delete cascade,
  customer_id uuid not null references auth.users(id) on delete cascade,
  created_at timestamptz not null default now(),
  constraint seller_store_likes_pk primary key (store_user_id, customer_id),
  constraint seller_store_likes_not_self check (store_user_id <> customer_id)
);

create table if not exists public.seller_store_follows (
  store_user_id uuid not null references auth.users(id) on delete cascade,
  customer_id uuid not null references auth.users(id) on delete cascade,
  created_at timestamptz not null default now(),
  constraint seller_store_follows_pk primary key (store_user_id, customer_id),
  constraint seller_store_follows_not_self check (store_user_id <> customer_id)
);

-- The composite primary keys serve store count lookups. These additional
-- indexes make customer-owned row lookups/deletes efficient.
create index if not exists seller_store_likes_customer_id_idx
  on public.seller_store_likes (customer_id);
create index if not exists seller_store_follows_customer_id_idx
  on public.seller_store_follows (customer_id);

alter table public.seller_store_likes enable row level security;
alter table public.seller_store_follows enable row level security;

revoke all on public.seller_store_likes from anon, public;
revoke all on public.seller_store_follows from anon, public;
grant select, insert, delete on public.seller_store_likes to authenticated;
grant select, insert, delete on public.seller_store_follows to authenticated;

drop policy if exists "Public can count store likes" on public.seller_store_likes;
drop policy if exists "Customers can view own store likes" on public.seller_store_likes;
create policy "Customers can view own store likes" on public.seller_store_likes
  for select to authenticated
  using (customer_id = (select auth.uid()));

drop policy if exists "Customers can like approved stores" on public.seller_store_likes;
create policy "Customers can like approved stores" on public.seller_store_likes
  for insert to authenticated
  with check (
    customer_id = (select auth.uid())
    and store_user_id <> (select auth.uid())
    and exists (
      select 1
      from public.seller_stores s
      where s.user_id = store_user_id
        and s.status = 'approved'
    )
  );

drop policy if exists "Customers can remove own store likes" on public.seller_store_likes;
create policy "Customers can remove own store likes" on public.seller_store_likes
  for delete to authenticated
  using (customer_id = (select auth.uid()));

drop policy if exists "Public can count store follows" on public.seller_store_follows;
drop policy if exists "Customers can view own store follows" on public.seller_store_follows;
create policy "Customers can view own store follows" on public.seller_store_follows
  for select to authenticated
  using (customer_id = (select auth.uid()));

drop policy if exists "Customers can follow approved stores" on public.seller_store_follows;
create policy "Customers can follow approved stores" on public.seller_store_follows
  for insert to authenticated
  with check (
    customer_id = (select auth.uid())
    and store_user_id <> (select auth.uid())
    and exists (
      select 1
      from public.seller_stores s
      where s.user_id = store_user_id
        and s.status = 'approved'
    )
  );

drop policy if exists "Customers can unfollow own stores" on public.seller_store_follows;
create policy "Customers can unfollow own stores" on public.seller_store_follows
  for delete to authenticated
  using (customer_id = (select auth.uid()));

-- Aggregate-only public endpoint: returns counts and only the caller's own
-- relationship state. It never returns customer IDs or relationship rows.
create or replace function public.get_seller_store_engagement(p_store_user_id uuid)
returns table(likes_count bigint, followers_count bigint, liked boolean, following boolean)
language sql
stable
security definer
set search_path = pg_catalog, public, auth
as $function$
  select
    (select count(*) from public.seller_store_likes l where l.store_user_id = p_store_user_id),
    (select count(*) from public.seller_store_follows f where f.store_user_id = p_store_user_id),
    exists (
      select 1 from public.seller_store_likes l
      where l.store_user_id = p_store_user_id
        and l.customer_id = (select auth.uid())
    ),
    exists (
      select 1 from public.seller_store_follows f
      where f.store_user_id = p_store_user_id
        and f.customer_id = (select auth.uid())
    )
  where exists (
    select 1 from public.seller_stores s
    where s.user_id = p_store_user_id
      and s.status = 'approved'
  );
$function$;

revoke all on function public.get_seller_store_engagement(uuid) from public;
grant execute on function public.get_seller_store_engagement(uuid) to anon, authenticated;

-- Create the dedicated public-read bucket only when it does not already exist.
-- ON CONFLICT DO NOTHING prevents silently changing an existing bucket.
-- If an existing bucket differs from the exact expected configuration, abort
-- the transaction and require a separate, explicit administrative decision.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'novaai-store-branding',
  'novaai-store-branding',
  true,
  5242880,
  array['image/jpeg', 'image/png', 'image/webp']::text[]
)
on conflict (id) do nothing;

do $validate_branding_bucket$
declare
  actual_bucket record;
  expected_mime_types text[] := array['image/jpeg', 'image/png', 'image/webp']::text[];
begin
  select b.id, b.name, b.public, b.file_size_limit, b.allowed_mime_types
    into actual_bucket
  from storage.buckets b
  where b.id = 'novaai-store-branding';

  if not found then
    raise exception 'Required Storage bucket novaai-store-branding was not created or is not visible.';
  end if;

  if actual_bucket.name is distinct from 'novaai-store-branding'
     or actual_bucket.public is distinct from true
     or actual_bucket.file_size_limit is distinct from 5242880
     or actual_bucket.allowed_mime_types is distinct from expected_mime_types then
    raise exception
      'Existing novaai-store-branding bucket configuration does not match the approved expected configuration. No bucket settings were changed.';
  end if;
end;
$validate_branding_bucket$;

-- Public reads are limited to this dedicated bucket. Writes, replacements and
-- deletions require an authenticated user who owns an existing seller_stores
-- row AND stores the object in that same user's first-level folder.
drop policy if exists "Public can view NOVAAI store branding" on storage.objects;
create policy "Public can view NOVAAI store branding" on storage.objects
  for select to public
  using (bucket_id = 'novaai-store-branding');

drop policy if exists "Sellers upload own NOVAAI store branding" on storage.objects;
create policy "Sellers upload own NOVAAI store branding" on storage.objects
  for insert to authenticated
  with check (
    bucket_id = 'novaai-store-branding'
    and (storage.foldername(name))[1] = (select auth.uid())::text
    and exists (
      select 1
      from public.seller_stores s
      where s.user_id = (select auth.uid())
    )
  );

drop policy if exists "Sellers update own NOVAAI store branding" on storage.objects;
create policy "Sellers update own NOVAAI store branding" on storage.objects
  for update to authenticated
  using (
    bucket_id = 'novaai-store-branding'
    and (storage.foldername(name))[1] = (select auth.uid())::text
    and exists (
      select 1
      from public.seller_stores s
      where s.user_id = (select auth.uid())
    )
  )
  with check (
    bucket_id = 'novaai-store-branding'
    and (storage.foldername(name))[1] = (select auth.uid())::text
    and exists (
      select 1
      from public.seller_stores s
      where s.user_id = (select auth.uid())
    )
  );

drop policy if exists "Sellers remove own NOVAAI store branding" on storage.objects;
create policy "Sellers remove own NOVAAI store branding" on storage.objects
  for delete to authenticated
  using (
    bucket_id = 'novaai-store-branding'
    and (storage.foldername(name))[1] = (select auth.uid())::text
    and exists (
      select 1
      from public.seller_stores s
      where s.user_id = (select auth.uid())
    )
  );

commit;

-- Review notes:
-- 1. No existing seller identity, store name, phone, approval status or marketplace
--    permission is changed. seller_stores receives only two nullable URL columns.
-- 2. Public store visibility and engagement counts still require status = 'approved'.
-- 3. Customers can read/delete only their own likes/follows and can insert only
--    their own relationship with an approved store; self-engagement is blocked.
-- 4. Public count access is aggregate-only; customer identities are not returned.
-- 5. Branding Storage INSERT/UPDATE/DELETE is restricted to authenticated owners
--    of an existing seller_stores row and their own auth.uid() folder. Ordinary
--    customer accounts without a seller_stores row cannot manage bucket objects.
-- 6. The bucket is created only if absent. An existing bucket is never reconfigured;
--    a mismatch raises an exception and rolls back the transaction.
-- 7. The bucket is public-read for rendering approved store branding. Public Store
--    Page queries must continue to expose branding URLs only for approved stores.
-- 8. No existing Storage bucket, product, order, order item, fulfilment or payment
--    object is changed by this script.
