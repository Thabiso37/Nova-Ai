-- NOVAAI Seller Storefront & Branding
-- PREPARED FOR REVIEW ONLY. DO NOT APPLY until explicitly approved.
-- Adds only branding metadata and customer-to-store engagement records.
-- Existing seller_stores rows, Products, orders, fulfilments and permissions are untouched.

begin;

alter table public.seller_stores
  add column if not exists store_logo_url text,
  add column if not exists store_banner_url text;

-- Keep engagement identities tied to a seller store owner (auth user id).
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

alter table public.seller_store_likes enable row level security;
alter table public.seller_store_follows enable row level security;

revoke all on public.seller_store_likes from anon, public;
revoke all on public.seller_store_follows from anon, public;
grant select, insert, delete on public.seller_store_likes to authenticated;
grant select, insert, delete on public.seller_store_follows to authenticated;

drop policy if exists "Public can count store likes" on public.seller_store_likes;
drop policy if exists "Customers can view own store likes" on public.seller_store_likes;
create policy "Customers can view own store likes" on public.seller_store_likes
  for select to authenticated using (customer_id = (select auth.uid()));
drop policy if exists "Customers can like approved stores" on public.seller_store_likes;
create policy "Customers can like approved stores" on public.seller_store_likes
  for insert to authenticated with check (
    customer_id = (select auth.uid())
    and store_user_id <> (select auth.uid())
    and exists (select 1 from public.seller_stores s
      where s.user_id = store_user_id and s.status = 'approved')
  );
drop policy if exists "Customers can remove own store likes" on public.seller_store_likes;
create policy "Customers can remove own store likes" on public.seller_store_likes
  for delete to authenticated using (customer_id = (select auth.uid()));

drop policy if exists "Public can count store follows" on public.seller_store_follows;
drop policy if exists "Customers can view own store follows" on public.seller_store_follows;
create policy "Customers can view own store follows" on public.seller_store_follows
  for select to authenticated using (customer_id = (select auth.uid()));
drop policy if exists "Customers can follow approved stores" on public.seller_store_follows;
create policy "Customers can follow approved stores" on public.seller_store_follows
  for insert to authenticated with check (
    customer_id = (select auth.uid())
    and store_user_id <> (select auth.uid())
    and exists (select 1 from public.seller_stores s
      where s.user_id = store_user_id and s.status = 'approved')
  );
drop policy if exists "Customers can unfollow own stores" on public.seller_store_follows;
create policy "Customers can unfollow own stores" on public.seller_store_follows
  for delete to authenticated using (customer_id = (select auth.uid()));


-- Aggregate-only public endpoint: never returns customer identities.
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
    exists(select 1 from public.seller_store_likes l where l.store_user_id = p_store_user_id and l.customer_id = auth.uid()),
    exists(select 1 from public.seller_store_follows f where f.store_user_id = p_store_user_id and f.customer_id = auth.uid())
  where exists(select 1 from public.seller_stores s where s.user_id = p_store_user_id and s.status = 'approved');
$function$;
revoke all on function public.get_seller_store_engagement(uuid) from public;
grant execute on function public.get_seller_store_engagement(uuid) to anon, authenticated;

-- A dedicated public-read bucket; each authenticated seller may manage only
-- objects inside their own auth.uid() folder. Images are limited to 5 MiB.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('novaai-store-branding', 'novaai-store-branding', true, 5242880,
  array['image/jpeg','image/png','image/webp'])
on conflict (id) do update set
  public = excluded.public,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists "Public can view NOVAAI store branding" on storage.objects;
create policy "Public can view NOVAAI store branding" on storage.objects
  for select to public using (bucket_id = 'novaai-store-branding');
drop policy if exists "Sellers upload own NOVAAI store branding" on storage.objects;
create policy "Sellers upload own NOVAAI store branding" on storage.objects
  for insert to authenticated with check (
    bucket_id = 'novaai-store-branding'
    and (storage.foldername(name))[1] = (select auth.uid())::text
  );
drop policy if exists "Sellers update own NOVAAI store branding" on storage.objects;
create policy "Sellers update own NOVAAI store branding" on storage.objects
  for update to authenticated using (
    bucket_id = 'novaai-store-branding'
    and (storage.foldername(name))[1] = (select auth.uid())::text
  ) with check (
    bucket_id = 'novaai-store-branding'
    and (storage.foldername(name))[1] = (select auth.uid())::text
  );
drop policy if exists "Sellers remove own NOVAAI store branding" on storage.objects;
create policy "Sellers remove own NOVAAI store branding" on storage.objects
  for delete to authenticated using (
    bucket_id = 'novaai-store-branding'
    and (storage.foldername(name))[1] = (select auth.uid())::text
  );

commit;

-- Notes:
-- 1. No seller identity, store name, phone, approval status or marketplace permission is changed.
-- 2. The seller_stores existing owner/admin policies remain in force.
-- 3. Like/follow primary keys prevent duplicates; customers can delete only their own rows.
-- 4. Product visibility continues to be enforced by the existing Products RLS policy.
-- 5. Branding URLs are seller-managed fields on an already-approved store. If per-asset
--    administrator moderation is required, separate review fields/admin UI are needed
--    and should be approved as a distinct extension before public rendering is enabled.
