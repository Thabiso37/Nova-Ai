-- NOVAAI MARKET Workstream 1 / Option B2
-- Customer Order Privacy and Seller Fulfilment Privacy.
-- Prepared from live catalogue evidence. Do not execute against production until reviewed.
-- Both place_order overloads and place_novaai_order are deliberately not replaced.

begin;

-- 1. Private revocation-time evidence registries. No product FK is used.
create table if not exists private.seller_fulfillment_revocation_events (
  event_id uuid primary key default gen_random_uuid(),
  seller_id uuid not null,
  revoked_at timestamptz not null default now(),
  source_table text not null check (source_table in ('seller_stores','seller_marketplace_permissions')),
  source_record_id uuid not null,
  previous_status text not null,
  new_status text
);

create table if not exists private.seller_fulfillment_historical_access (
  revocation_event_id uuid not null references private.seller_fulfillment_revocation_events(event_id) on delete restrict,
  fulfillment_id uuid not null,
  order_id uuid not null,
  seller_id uuid not null,
  recorded_at timestamptz not null default now(),
  primary key (revocation_event_id, fulfillment_id)
);

create table if not exists private.seller_fulfillment_historical_items (
  revocation_event_id uuid not null,
  fulfillment_id uuid not null,
  order_item_id uuid not null,
  order_id uuid not null,
  seller_id uuid not null,
  product_id bigint not null,
  recorded_at timestamptz not null default now(),
  primary key (revocation_event_id, fulfillment_id, order_item_id),
  foreign key (revocation_event_id, fulfillment_id)
    references private.seller_fulfillment_historical_access(revocation_event_id, fulfillment_id)
    on delete restrict
);

create index if not exists seller_fulfillment_historical_access_seller_idx
  on private.seller_fulfillment_historical_access (seller_id, fulfillment_id);
create index if not exists seller_fulfillment_historical_items_item_idx
  on private.seller_fulfillment_historical_items (order_item_id, seller_id);

alter table private.seller_fulfillment_revocation_events enable row level security;
alter table private.seller_fulfillment_historical_access enable row level security;
alter table private.seller_fulfillment_historical_items enable row level security;

revoke all privileges on table
  private.seller_fulfillment_revocation_events,
  private.seller_fulfillment_historical_access,
  private.seller_fulfillment_historical_items
from public, anon, authenticated, service_role;

create or replace function private.reject_historical_registry_mutation()
returns trigger language plpgsql set search_path = ''
as $function$
begin
  raise exception 'Option B2 historical access evidence is immutable'
    using errcode = '55000';
end;
$function$;

revoke all on function private.reject_historical_registry_mutation() from public, anon, authenticated, service_role;

create trigger seller_fulfillment_revocation_events_immutable
before update or delete on private.seller_fulfillment_revocation_events
for each row execute function private.reject_historical_registry_mutation();
create trigger seller_fulfillment_historical_access_immutable
before update or delete on private.seller_fulfillment_historical_access
for each row execute function private.reject_historical_registry_mutation();
create trigger seller_fulfillment_historical_items_immutable
before update or delete on private.seller_fulfillment_historical_items
for each row execute function private.reject_historical_registry_mutation();

-- 2. Exact seller/order/item relationship validation.
create or replace function private.seller_fulfillment_item_set_valid(
  p_fulfillment_id uuid, p_order_id uuid, p_seller_id uuid
)
returns boolean
language sql stable security definer
set search_path = '' set row_security = off
as $function$
  select
    exists (
      select 1 from public.seller_fulfillments f
      where f.id = p_fulfillment_id and f.order_id = p_order_id and f.seller_id = p_seller_id
    )
    and exists (
      select 1 from public.order_items oi
      where oi.order_id = p_order_id and oi.seller_id = p_seller_id
        and (oi.fulfillment_id is null or oi.fulfillment_id = p_fulfillment_id)
    )
    and not exists (
      select 1 from public.order_items oi
      where oi.fulfillment_id = p_fulfillment_id
        and (oi.order_id <> p_order_id or oi.seller_id <> p_seller_id)
    )
    and not exists (
      select 1 from public.order_items oi
      where oi.order_id = p_order_id and oi.seller_id = p_seller_id
        and oi.fulfillment_id is not null and oi.fulfillment_id <> p_fulfillment_id
    )
    and not exists (
      select 1
      from public.order_items oi
      left join public."Products" p on p.id = oi.product_id
      where oi.order_id = p_order_id and oi.seller_id = p_seller_id
        and (oi.fulfillment_id is null or oi.fulfillment_id = p_fulfillment_id)
        and p.seller_id is distinct from p_seller_id
    );
$function$;

create or replace function private.seller_fulfillment_historical_access_allowed(
  p_fulfillment_id uuid, p_order_id uuid, p_seller_id uuid
)
returns boolean
language sql stable security definer
set search_path = '' set row_security = off
as $function$
  select exists (
    select 1
    from private.seller_fulfillment_historical_access ha
    join private.seller_fulfillment_revocation_events e
      on e.event_id = ha.revocation_event_id and e.seller_id = ha.seller_id
    where ha.fulfillment_id = p_fulfillment_id
      and ha.order_id = p_order_id
      and ha.seller_id = p_seller_id
      and private.seller_fulfillment_item_set_valid(ha.fulfillment_id, ha.order_id, ha.seller_id)
      and not exists (
        select 1
        from public.order_items oi
        where oi.order_id = ha.order_id
          and oi.seller_id = ha.seller_id
          and (oi.fulfillment_id is null or oi.fulfillment_id = ha.fulfillment_id)
          and not exists (
            select 1
            from private.seller_fulfillment_historical_items hi
            where hi.revocation_event_id = ha.revocation_event_id
              and hi.fulfillment_id = ha.fulfillment_id
              and hi.order_item_id = oi.id
              and hi.order_id = oi.order_id
              and hi.seller_id = oi.seller_id
              and hi.product_id = oi.product_id
          )
      )
      and not exists (
        select 1
        from private.seller_fulfillment_historical_items hi
        where hi.revocation_event_id = ha.revocation_event_id
          and hi.fulfillment_id = ha.fulfillment_id
          and not exists (
            select 1
            from public.order_items oi
            where oi.id = hi.order_item_id
              and oi.order_id = hi.order_id
              and oi.seller_id = hi.seller_id
              and oi.product_id = hi.product_id
              and (oi.fulfillment_id is null or oi.fulfillment_id = ha.fulfillment_id)
          )
      )
  );
$function$;

create or replace function private.seller_fulfillment_current_access_allowed(
  p_fulfillment_id uuid, p_order_id uuid, p_seller_id uuid
)
returns boolean
language sql stable security definer
set search_path = '' set row_security = off
as $function$
  select
    private.seller_fulfillment_item_set_valid(p_fulfillment_id, p_order_id, p_seller_id)
    and exists (
      select 1
      from public.seller_stores s
      join public.seller_marketplace_permissions mp
        on mp.user_id = s.user_id and mp.marketplace = s.primary_marketplace
      where s.user_id = p_seller_id and s.status = 'approved' and mp.status = 'approved'
    )
    and exists (
      select 1
      from public.order_items oi
      join public."Products" p on p.id = oi.product_id
      where oi.order_id = p_order_id and oi.seller_id = p_seller_id
        and (oi.fulfillment_id is null or oi.fulfillment_id = p_fulfillment_id)
        and p.seller_id = p_seller_id
        and private.product_marketplace_access_allowed(p.seller_id, p.category)
    )
    and not exists (
      select 1
      from public.order_items oi
      join public."Products" p on p.id = oi.product_id
      where oi.order_id = p_order_id and oi.seller_id = p_seller_id
        and (oi.fulfillment_id is null or oi.fulfillment_id = p_fulfillment_id)
        and (p.seller_id is distinct from p_seller_id
          or not private.product_marketplace_access_allowed(p.seller_id, p.category))
    );
$function$;

revoke all on function private.seller_fulfillment_item_set_valid(uuid,uuid,uuid) from public, anon, authenticated, service_role;
revoke all on function private.seller_fulfillment_historical_access_allowed(uuid,uuid,uuid) from public, anon, authenticated, service_role;
revoke all on function private.seller_fulfillment_current_access_allowed(uuid,uuid,uuid) from public, anon, authenticated, service_role;

-- 3. One seller advisory lock. Checkout uses try-locks (retry on conflict) before
-- permission-row then store-row FOR SHARE locks. Approval/revocation RPCs acquire
-- the same lock before their permission-row then store-row FOR UPDATE locks.
-- Direct row updates use try-lock triggers so they fail/retry rather than deadlock.
create or replace function private.guard_seller_marketplace_write_lock()
returns trigger language plpgsql set search_path = ''
as $function$
declare
  v_seller_id uuid;
begin
  if tg_op = 'DELETE' then
    v_seller_id := old.user_id;
  else
    v_seller_id := new.user_id;
  end if;

  if v_seller_id is not null
     and not pg_catalog.pg_try_advisory_xact_lock(
       pg_catalog.hashtextextended('novaai-seller-marketplace:' || v_seller_id::text, 0)
     ) then
    raise exception 'Seller marketplace access is being changed concurrently; retry this operation'
      using errcode = '40001';
  end if;

  if tg_op = 'UPDATE' and old.user_id is distinct from new.user_id
     and not pg_catalog.pg_try_advisory_xact_lock(
       pg_catalog.hashtextextended('novaai-seller-marketplace:' || old.user_id::text, 0)
     ) then
    raise exception 'Seller marketplace access is being changed concurrently; retry this operation'
      using errcode = '40001';
  end if;

  if tg_op = 'DELETE' then return old; end if;
  return new;
end;
$function$;

revoke all on function private.guard_seller_marketplace_write_lock() from public, anon, authenticated, service_role;

drop trigger if exists a_lock_seller_marketplace_write on public.seller_stores;
create trigger a_lock_seller_marketplace_write
before insert or update or delete on public.seller_stores
for each row execute function private.guard_seller_marketplace_write_lock();

drop trigger if exists a_lock_seller_marketplace_write on public.seller_marketplace_permissions;
create trigger a_lock_seller_marketplace_write
before insert or update or delete on public.seller_marketplace_permissions
for each row execute function private.guard_seller_marketplace_write_lock();

create or replace function private.guard_order_item_seller_lock()
returns trigger language plpgsql set search_path = ''
as $function$
declare
  v_new_seller_id uuid;
  v_old_seller_id uuid;
begin
  if tg_op <> 'INSERT' then v_old_seller_id := old.seller_id; end if;

  if tg_op <> 'DELETE' then
    v_new_seller_id := new.seller_id;
    if v_new_seller_id is null then
      select p.seller_id into v_new_seller_id
      from public."Products" p where p.id = new.product_id;
    end if;
    if v_new_seller_id is null then
      raise exception 'Order item seller could not be resolved' using errcode = '23503';
    end if;
  end if;

  if v_new_seller_id is not null
     and not pg_catalog.pg_try_advisory_xact_lock(
       pg_catalog.hashtextextended('novaai-seller-marketplace:' || v_new_seller_id::text, 0)
     ) then
    raise exception 'Seller marketplace access is being changed concurrently; retry this operation'
      using errcode = '40001';
  end if;

  if v_old_seller_id is not null and v_old_seller_id is distinct from v_new_seller_id
     and not pg_catalog.pg_try_advisory_xact_lock(
       pg_catalog.hashtextextended('novaai-seller-marketplace:' || v_old_seller_id::text, 0)
     ) then
    raise exception 'Seller marketplace access is being changed concurrently; retry this operation'
      using errcode = '40001';
  end if;

  if tg_op = 'DELETE' then return old; end if;
  return new;
end;
$function$;

revoke all on function private.guard_order_item_seller_lock() from public, anon, authenticated, service_role;

drop trigger if exists a_lock_order_item_seller on public.order_items;
create trigger a_lock_order_item_seller
before insert or update of order_id, seller_id, product_id, fulfillment_id or delete
on public.order_items
for each row execute function private.guard_order_item_seller_lock();

-- Existing marketplace validation is retained and gains the serialisation gate.
create or replace function private.enforce_order_item_marketplace_access()
returns trigger
language plpgsql
security definer
set search_path = ''
set row_security = off
as $function$
declare
  v_category text;
  v_status text;
  v_price numeric;
  v_store_status text;
  v_store_marketplace text;
  v_permission_status text;
  v_permission_marketplace text;
  v_expected_marketplace text;
begin
  select p.category, p.status, p.price, p.seller_id
    into v_category, v_status, v_price, new.seller_id
  from public."Products" p
  where p.id = new.product_id;

  if not found then
    raise exception 'Product unavailable for ordering: %', new.product_id
      using errcode = 'P0001';
  end if;

  v_expected_marketplace := case
    when v_category = any(array['Auto','Motors & Vehicles']::text[]) then 'motors'
    when v_category = any(array['Property For Sale','Property To Rent']::text[]) then 'property'
    else 'retail'
  end;

  if not pg_catalog.pg_try_advisory_xact_lock(
    pg_catalog.hashtextextended('novaai-seller-marketplace:' || new.seller_id::text, 0)
  ) then
    raise exception 'Seller marketplace access is being changed concurrently; retry checkout'
      using errcode = '40001';
  end if;

  select mp.status, mp.marketplace
    into v_permission_status, v_permission_marketplace
  from public.seller_marketplace_permissions mp
  where mp.user_id = new.seller_id and mp.marketplace = v_expected_marketplace
  for share;

  select s.status, s.primary_marketplace
    into v_store_status, v_store_marketplace
  from public.seller_stores s
  where s.user_id = new.seller_id
  for share;

  if v_status is distinct from 'approved' then
    raise exception 'Product is not approved for ordering: %', new.product_id
      using errcode = 'P0001';
  end if;

  if v_store_status is distinct from 'approved'
     or v_permission_status is distinct from 'approved'
     or v_store_marketplace is distinct from v_expected_marketplace
     or v_permission_marketplace is distinct from v_expected_marketplace
     or not private.product_marketplace_access_allowed(new.seller_id, v_category) then
    raise exception 'Seller is not approved for this product marketplace'
      using errcode = '42501';
  end if;

  if new.unit_price is distinct from v_price then
    raise exception 'Order item price does not match the current product price'
      using errcode = '23514';
  end if;
  if new.quantity is null or new.quantity < 1 then
    raise exception 'Order item quantity must be positive'
      using errcode = '23514';
  end if;
  return new;
end;
$function$;

-- Direct service-role fulfilment inserts also require the same seller lock and
-- approved seller state; an AFTER trigger validates their complete item set.
create or replace function private.guard_seller_fulfillment_creation()
returns trigger
language plpgsql
security definer
set search_path = ''
set row_security = off
as $function$
declare
  v_permission_status text;
  v_permission_marketplace text;
  v_store_status text;
  v_store_marketplace text;
begin
  if tg_op = 'UPDATE' then
    if new.order_id is distinct from old.order_id or new.seller_id is distinct from old.seller_id then
      raise exception 'Fulfilment order and seller identity are immutable' using errcode = '55000';
    end if;
    return new;
  end if;

  if new.seller_id is null or new.order_id is null then
    raise exception 'Fulfilment seller and order are required' using errcode = '23502';
  end if;

  if not pg_catalog.pg_try_advisory_xact_lock(
    pg_catalog.hashtextextended('novaai-seller-marketplace:' || new.seller_id::text, 0)
  ) then
    raise exception 'Seller marketplace access is being changed concurrently; retry this operation'
      using errcode = '40001';
  end if;

  select mp.status, mp.marketplace into v_permission_status, v_permission_marketplace
  from public.seller_marketplace_permissions mp
  where mp.user_id = new.seller_id
  for share;

  select s.status, s.primary_marketplace into v_store_status, v_store_marketplace
  from public.seller_stores s
  where s.user_id = new.seller_id
  for share;

  if v_permission_status is distinct from 'approved'
     or v_store_status is distinct from 'approved'
     or v_permission_marketplace is distinct from v_store_marketplace then
    raise exception 'Only an approved seller marketplace can create fulfilments'
      using errcode = '42501';
  end if;

  if not exists (
    select 1 from public.order_items oi
    join public."Products" p on p.id = oi.product_id
    where oi.order_id = new.order_id and oi.seller_id = new.seller_id
      and p.seller_id = new.seller_id
      and private.product_marketplace_access_allowed(p.seller_id, p.category)
  ) or exists (
    select 1 from public.order_items oi
    join public."Products" p on p.id = oi.product_id
    where oi.order_id = new.order_id and oi.seller_id = new.seller_id
      and (p.seller_id is distinct from new.seller_id
        or not private.product_marketplace_access_allowed(p.seller_id, p.category))
  ) then
    raise exception 'Fulfilment items do not match an approved seller marketplace'
      using errcode = '42501';
  end if;

  return new;
end;
$function$;

create or replace function private.validate_seller_fulfillment_item_set_after_insert()
returns trigger
language plpgsql
security definer
set search_path = ''
set row_security = off
as $function$
begin
  if not private.seller_fulfillment_item_set_valid(new.id, new.order_id, new.seller_id) then
    raise exception 'Fulfilment % does not have a consistent seller/order/item set', new.id
      using errcode = '23514';
  end if;
  return null;
end;
$function$;

revoke all on function private.guard_seller_fulfillment_creation() from public, anon, authenticated, service_role;
revoke all on function private.validate_seller_fulfillment_item_set_after_insert() from public, anon, authenticated, service_role;

drop trigger if exists a_guard_seller_fulfillment_creation on public.seller_fulfillments;
create trigger a_guard_seller_fulfillment_creation
before insert or update of order_id, seller_id on public.seller_fulfillments
for each row execute function private.guard_seller_fulfillment_creation();

drop trigger if exists validate_seller_fulfillment_item_set_after_insert on public.seller_fulfillments;
create trigger validate_seller_fulfillment_item_set_after_insert
after insert on public.seller_fulfillments
for each row execute function private.validate_seller_fulfillment_item_set_after_insert();

-- 4. Immutable snapshot at every transition away from approved access.
create or replace function private.record_seller_fulfillment_revocation(
  p_seller_id uuid, p_source_table text, p_source_record_id uuid,
  p_previous_status text, p_new_status text
)
returns uuid
language plpgsql security definer
set search_path = '' set row_security = off
as $function$
declare
  v_event_id uuid;
  v_f record;
begin
  insert into private.seller_fulfillment_revocation_events (
    seller_id, source_table, source_record_id, previous_status, new_status
  )
  values (p_seller_id, p_source_table, p_source_record_id, p_previous_status, p_new_status)
  returning event_id into v_event_id;

  for v_f in
    select f.id, f.order_id, f.seller_id
    from public.seller_fulfillments f
    where f.seller_id = p_seller_id
    order by f.id
  loop
    if not private.seller_fulfillment_item_set_valid(v_f.id, v_f.order_id, v_f.seller_id) then
      raise exception 'Cannot revoke seller access: fulfilment % has inconsistent order/item relationships', v_f.id
        using errcode = '23514';
    end if;

    insert into private.seller_fulfillment_historical_access (
      revocation_event_id, fulfillment_id, order_id, seller_id
    ) values (v_event_id, v_f.id, v_f.order_id, v_f.seller_id);

    insert into private.seller_fulfillment_historical_items (
      revocation_event_id, fulfillment_id, order_item_id, order_id, seller_id, product_id
    )
    select v_event_id, v_f.id, oi.id, oi.order_id, oi.seller_id, oi.product_id
    from public.order_items oi
    where oi.order_id = v_f.order_id and oi.seller_id = v_f.seller_id
      and (oi.fulfillment_id is null or oi.fulfillment_id = v_f.id);
  end loop;

  return v_event_id;
end;
$function$;

create or replace function private.snapshot_seller_fulfillment_revocation()
returns trigger
language plpgsql security definer
set search_path = '' set row_security = off
as $function$
declare
  v_seller_id uuid;
  v_record_id uuid;
  v_old_status text;
  v_new_status text;
begin
  if tg_op = 'DELETE' then
    v_seller_id := old.user_id;
    v_record_id := old.id;
    v_old_status := old.status;
    v_new_status := null;
  else
    if old.status is distinct from 'approved' or new.status is not distinct from 'approved' then
      return new;
    end if;
    v_seller_id := old.user_id;
    v_record_id := old.id;
    v_old_status := old.status;
    v_new_status := new.status;
  end if;

  if v_old_status = 'approved' then
    -- When both approval records are changed in one transaction, snapshot once:
    -- the first transition sees the counterpart still approved; the second does not.
    if tg_table_name = 'seller_stores' then
      if exists (
        select 1 from public.seller_marketplace_permissions mp
        where mp.user_id = v_seller_id
          and mp.marketplace = old.primary_marketplace
          and mp.status = 'approved'
      ) then
        perform private.record_seller_fulfillment_revocation(
          v_seller_id, tg_table_name, v_record_id, v_old_status, v_new_status
        );
      end if;
    elsif tg_table_name = 'seller_marketplace_permissions' then
      if exists (
        select 1 from public.seller_stores s
        where s.user_id = v_seller_id
          and s.primary_marketplace = old.marketplace
          and s.status = 'approved'
      ) then
        perform private.record_seller_fulfillment_revocation(
          v_seller_id, tg_table_name, v_record_id, v_old_status, v_new_status
        );
      end if;
    end if;
  end if;

  if tg_op = 'DELETE' then return old; end if;
  return new;
end;
$function$;

revoke all on function private.record_seller_fulfillment_revocation(uuid,text,uuid,text,text) from public, anon, authenticated, service_role;
revoke all on function private.snapshot_seller_fulfillment_revocation() from public, anon, authenticated, service_role;

drop trigger if exists snapshot_seller_fulfillment_access_on_store_revocation on public.seller_stores;
create trigger snapshot_seller_fulfillment_access_on_store_revocation
after update of status or delete on public.seller_stores
for each row execute function private.snapshot_seller_fulfillment_revocation();

drop trigger if exists snapshot_seller_fulfillment_access_on_permission_revocation on public.seller_marketplace_permissions;
create trigger snapshot_seller_fulfillment_access_on_permission_revocation
after update of status or delete on public.seller_marketplace_permissions
for each row execute function private.snapshot_seller_fulfillment_revocation();

-- 5. Seller application and review functions acquire the shared advisory lock
-- before row locks. The existing permission-first/store-second row lock order stays.
create or replace function public.submit_seller_application(
  p_store_name text, p_phone text, p_marketplace text
)
returns jsonb language plpgsql set search_path = ''
as $function$
declare
  v_user_id uuid := (select auth.uid());
  v_slug text;
  v_store_id uuid;
  v_existing_market text;
  v_existing_status text;
begin
  if v_user_id is null then
    raise exception 'Sign in before submitting a seller application' using errcode = '28000';
  end if;

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('novaai-seller-marketplace:' || v_user_id::text, 0)
  );

  if nullif(btrim(p_store_name), '') is null or length(btrim(p_store_name)) > 100 then
    raise exception 'Enter a store or business name (maximum 100 characters)' using errcode = '22023';
  end if;
  if nullif(btrim(p_phone), '') is null or length(btrim(p_phone)) > 30 then
    raise exception 'Enter a valid contact phone number' using errcode = '22023';
  end if;
  if p_marketplace not in ('retail','motors','property') then
    raise exception 'Choose Retail, Motors or Property' using errcode = '22023';
  end if;

  select s.id,s.primary_marketplace,s.status
    into v_store_id,v_existing_market,v_existing_status
  from public.seller_stores s where s.user_id = v_user_id;

  if found then
    if v_existing_market = p_marketplace and exists (
      select 1 from public.seller_marketplace_permissions mp
      where mp.user_id=v_user_id and mp.marketplace=p_marketplace
    ) then
      return pg_catalog.jsonb_build_object(
        'store_id',v_store_id,
        'primary_marketplace',v_existing_market,
        'application_status',coalesce((
          select mp.status from public.seller_marketplace_permissions mp
          where mp.user_id=v_user_id and mp.marketplace=p_marketplace
        ),v_existing_status)
      );
    end if;
    raise exception 'A seller application already exists for this account. Contact an administrator to request a marketplace change'
      using errcode = '23505';
  end if;

  v_slug := left(regexp_replace(lower(btrim(p_store_name)), '[^a-z0-9]+', '-', 'g'), 48)
    || '-' || substr(replace(pg_catalog.gen_random_uuid()::text, '-', ''), 1, 8);

  insert into public.seller_stores(user_id,store_name,store_slug,phone,status,primary_marketplace)
  values (v_user_id,btrim(p_store_name),v_slug,btrim(p_phone),'pending',p_marketplace)
  returning id into v_store_id;

  insert into public.seller_marketplace_permissions(user_id,marketplace,status,requested_at)
  values (v_user_id,p_marketplace,'pending',pg_catalog.now());

  return pg_catalog.jsonb_build_object(
    'store_id',v_store_id,'primary_marketplace',p_marketplace,'application_status','pending'
  );
end;
$function$;

create or replace function public.review_seller_application(p_permission_id uuid, p_status text)
returns jsonb language plpgsql set search_path = ''
as $function$
declare
  v_admin_id uuid := (select auth.uid());
  v_prelock_user_id uuid;
  v_user_id uuid;
  v_marketplace text;
  v_store_id uuid;
  v_store_marketplace text;
  v_store_status text;
  v_reviewed_at timestamptz;
  v_store_rows integer;
begin
  if v_admin_id is null or not private.is_novaai_admin() then
    raise exception 'Only NOVAAI administrators can review seller applications' using errcode = '42501';
  end if;
  if p_status is null or p_status not in ('approved','rejected') then
    raise exception 'Application status must be approved or rejected' using errcode = '22023';
  end if;

  select mp.user_id into v_prelock_user_id
  from public.seller_marketplace_permissions mp
  where mp.id = p_permission_id and mp.status = 'pending';
  if v_prelock_user_id is null then
    raise exception 'Pending marketplace application not found' using errcode = 'P0002';
  end if;

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('novaai-seller-marketplace:' || v_prelock_user_id::text, 0)
  );

  select mp.user_id,mp.marketplace into v_user_id,v_marketplace
  from public.seller_marketplace_permissions mp
  where mp.id = p_permission_id and mp.status = 'pending'
  for update;
  if v_user_id is null or v_user_id is distinct from v_prelock_user_id then
    raise exception 'Pending marketplace application changed before review' using errcode = '40001';
  end if;

  select s.id,s.primary_marketplace,s.status
    into v_store_id,v_store_marketplace,v_store_status
  from public.seller_stores s where s.user_id = v_user_id
  for update;

  if v_store_id is null then
    raise exception 'No seller store is linked to this application' using errcode = '23503';
  end if;
  if v_store_marketplace is distinct from v_marketplace then
    raise exception 'Seller store and marketplace application do not match' using errcode = '23514';
  end if;
  if v_store_status is distinct from 'pending' then
    raise exception 'Linked seller store is not pending review' using errcode = '23514';
  end if;

  update public.seller_marketplace_permissions
  set status=p_status,reviewed_at=pg_catalog.now(),reviewed_by=v_admin_id
  where id=p_permission_id and user_id=v_user_id and marketplace=v_marketplace and status='pending'
  returning reviewed_at into v_reviewed_at;
  if v_reviewed_at is null then
    raise exception 'Marketplace application changed before review could be saved' using errcode = '40001';
  end if;

  update public.seller_stores
  set status=p_status
  where id=v_store_id and user_id=v_user_id
    and primary_marketplace=v_marketplace and status='pending';
  get diagnostics v_store_rows = row_count;
  if v_store_rows <> 1 then
    raise exception 'Linked seller store changed before review could be saved' using errcode = '40001';
  end if;

  return pg_catalog.jsonb_build_object(
    'store_id',v_store_id,'user_id',v_user_id,'primary_marketplace',v_marketplace,
    'application_status',p_status,'store_status',p_status,
    'reviewed_by',v_admin_id,'reviewed_at',v_reviewed_at
  );
end;
$function$;

create or replace function public.revoke_seller_marketplace_access(p_permission_id uuid)
returns jsonb language plpgsql set search_path = ''
as $function$
declare
  v_admin_id uuid := (select auth.uid());
  v_prelock_user_id uuid;
  v_user_id uuid;
  v_marketplace text;
  v_permission_status text;
  v_store_id uuid;
  v_store_status text;
  v_reviewed_at timestamptz;
begin
  if v_admin_id is null or not private.is_novaai_admin() then
    raise exception 'Only NOVAAI administrators can revoke seller marketplace access' using errcode = '42501';
  end if;

  select mp.user_id into v_prelock_user_id
  from public.seller_marketplace_permissions mp where mp.id=p_permission_id;
  if v_prelock_user_id is null then
    raise exception 'Marketplace permission not found' using errcode = 'P0002';
  end if;

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('novaai-seller-marketplace:' || v_prelock_user_id::text, 0)
  );

  select mp.user_id,mp.marketplace,mp.status,mp.reviewed_at
    into v_user_id,v_marketplace,v_permission_status,v_reviewed_at
  from public.seller_marketplace_permissions mp
  where mp.id=p_permission_id
  for update;

  if v_user_id is distinct from v_prelock_user_id
     or v_permission_status not in ('approved','rejected') then
    raise exception 'Only an approved or partially revoked seller permission can be completed' using errcode = '22023';
  end if;

  select s.id,s.status into v_store_id,v_store_status
  from public.seller_stores s
  where s.user_id=v_user_id and s.primary_marketplace=v_marketplace
  for update;
  if v_store_id is null or v_store_status not in ('approved','rejected') then
    raise exception 'The seller store could not be verified for revocation' using errcode = '23514';
  end if;

  if v_permission_status = 'approved' then
    update public.seller_marketplace_permissions
    set status='rejected',reviewed_at=pg_catalog.now(),reviewed_by=v_admin_id
    where id=p_permission_id and user_id=v_user_id and marketplace=v_marketplace and status='approved'
    returning reviewed_at into v_reviewed_at;
    if v_reviewed_at is null then
      raise exception 'Marketplace permission changed during revocation' using errcode = '40001';
    end if;
  end if;

  if v_store_status = 'approved' then
    update public.seller_stores set status='rejected'
    where id=v_store_id and user_id=v_user_id and status='approved';
    if not found then
      raise exception 'Seller store changed during revocation' using errcode = '40001';
    end if;
  end if;

  if v_permission_status = 'rejected' and v_store_status = 'rejected' then
    raise exception 'Seller marketplace access is already revoked' using errcode = '22023';
  end if;

  v_reviewed_at := coalesce(v_reviewed_at, pg_catalog.now());

  return pg_catalog.jsonb_build_object(
    'store_id',v_store_id,'user_id',v_user_id,'marketplace',v_marketplace,
    'status','rejected','revoked_by',v_admin_id,'revoked_at',v_reviewed_at
  );
end;
$function$;

-- 6. Narrow seller/customer RPCs. Historical branch never calls the current
-- marketplace helper; it is authorised only by the immutable snapshot tables.
create or replace function public.get_my_seller_order_items()
returns table (
  order_id uuid, order_created_at timestamptz, order_item_id uuid,
  product_id bigint, product_name text, quantity integer,
  unit_price numeric, line_total numeric
)
language plpgsql stable security definer
set search_path = '' set row_security = off
as $function$
declare v_user_id uuid := auth.uid();
begin
  if v_user_id is null then raise exception 'Authentication required' using errcode = '28000'; end if;

  return query
  select o.id,o.created_at,oi.id,oi.product_id,oi.product_name,oi.quantity,oi.unit_price,oi.line_total
  from public.order_items oi
  join public.orders o on o.id=oi.order_id
  join public."Products" p on p.id=oi.product_id
  where oi.seller_id=v_user_id and p.seller_id=v_user_id
    and (
      (
        exists (
          select 1 from public.seller_stores s
          join public.seller_marketplace_permissions mp
            on mp.user_id=s.user_id and mp.marketplace=s.primary_marketplace
          where s.user_id=v_user_id and s.status='approved' and mp.status='approved'
        )
        and private.product_marketplace_access_allowed(p.seller_id,p.category)
      )
      or exists (
        select 1
        from private.seller_fulfillment_historical_access ha
        join private.seller_fulfillment_historical_items hi
          on hi.revocation_event_id=ha.revocation_event_id
         and hi.fulfillment_id=ha.fulfillment_id
         and hi.order_item_id=oi.id
         and hi.order_id=oi.order_id
         and hi.seller_id=oi.seller_id
         and hi.product_id=oi.product_id
        where ha.seller_id=v_user_id
          and private.seller_fulfillment_historical_access_allowed(ha.fulfillment_id,ha.order_id,ha.seller_id)
      )
    )
  order by o.created_at desc;
end;
$function$;

create or replace function public.get_my_seller_fulfillments()
returns table (
  id uuid, order_id uuid, fulfillment_status text, tracking_number text,
  courier_name text, delivery_date timestamptz, updated_at timestamptz
)
language plpgsql stable security definer
set search_path = '' set row_security = off
as $function$
declare v_user_id uuid := auth.uid();
begin
  if v_user_id is null then raise exception 'Authentication required' using errcode = '28000'; end if;
  return query
  select f.id,f.order_id,f.fulfillment_status,f.tracking_number,f.courier_name,f.delivery_date,f.updated_at
  from public.seller_fulfillments f
  where f.seller_id=v_user_id
    and (
      private.seller_fulfillment_current_access_allowed(f.id,f.order_id,f.seller_id)
      or private.seller_fulfillment_historical_access_allowed(f.id,f.order_id,f.seller_id)
    )
  order by f.created_at desc;
end;
$function$;

create or replace function public.get_my_customer_order_fulfillments()
returns table (
  id uuid, order_id uuid, fulfillment_status text, courier_name text,
  tracking_number text, delivery_date timestamptz
)
language plpgsql stable security definer
set search_path = '' set row_security = off
as $function$
declare v_user_id uuid := auth.uid();
begin
  if v_user_id is null then raise exception 'Authentication required' using errcode = '28000'; end if;
  return query
  select f.id,f.order_id,f.fulfillment_status,f.courier_name,f.tracking_number,f.delivery_date
  from public.seller_fulfillments f
  join public.orders o on o.id=f.order_id
  where o.customer_id=v_user_id
  order by o.created_at desc;
end;
$function$;

create or replace function public.update_my_seller_fulfillment_shipping(
  p_fulfillment_id uuid,p_courier_name text,p_tracking_number text,p_delivery_date timestamptz
)
returns boolean
language plpgsql security definer
set search_path = '' set row_security = off
as $function$
declare
  v_user_id uuid := auth.uid();
  v_seller_id uuid;
  v_order_id uuid;
begin
  if v_user_id is null then raise exception 'Authentication required' using errcode = '28000'; end if;

  select f.seller_id,f.order_id into v_seller_id,v_order_id
  from public.seller_fulfillments f where f.id=p_fulfillment_id;
  if v_seller_id is distinct from v_user_id then return false; end if;

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('novaai-seller-marketplace:' || v_user_id::text,0)
  );

  if not (
    private.seller_fulfillment_current_access_allowed(p_fulfillment_id,v_order_id,v_user_id)
    or private.seller_fulfillment_historical_access_allowed(p_fulfillment_id,v_order_id,v_user_id)
  ) then return false; end if;

  update public.seller_fulfillments
  set courier_name=nullif(pg_catalog.btrim(p_courier_name),''),
      tracking_number=nullif(pg_catalog.btrim(p_tracking_number),''),
      delivery_date=p_delivery_date,
      updated_at=pg_catalog.now()
  where id=p_fulfillment_id and seller_id=v_user_id;
  return found;
end;
$function$;

create or replace function public.update_my_seller_fulfillment_status(
  p_fulfillment_id uuid,p_status text
)
returns boolean
language plpgsql security definer
set search_path = '' set row_security = off
as $function$
declare
  v_user_id uuid := auth.uid();
  v_seller_id uuid;
  v_order_id uuid;
begin
  if v_user_id is null then raise exception 'Authentication required' using errcode = '28000'; end if;
  if p_status is null or p_status not in ('pending','processing','shipped','delivered','cancelled') then
    raise exception 'Invalid fulfilment status' using errcode = '22023';
  end if;

  select f.seller_id,f.order_id into v_seller_id,v_order_id
  from public.seller_fulfillments f where f.id=p_fulfillment_id;
  if v_seller_id is distinct from v_user_id then return false; end if;

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('novaai-seller-marketplace:' || v_user_id::text,0)
  );

  if not (
    private.seller_fulfillment_current_access_allowed(p_fulfillment_id,v_order_id,v_user_id)
    or private.seller_fulfillment_historical_access_allowed(p_fulfillment_id,v_order_id,v_user_id)
  ) then return false; end if;

  update public.seller_fulfillments
  set fulfillment_status=p_status,updated_at=pg_catalog.now()
  where id=p_fulfillment_id and seller_id=v_user_id;
  return found;
end;
$function$;

-- Admin financial access is preserved through an explicit administrator-only RPC.
create or replace function public.admin_get_seller_fulfillment_financials()
returns table (
  id uuid, order_id uuid, seller_id uuid, item_subtotal numeric,
  platform_commission numeric, payout_amount numeric, fulfillment_status text,
  settlement_status text, courier_name text, tracking_number text,
  delivery_date timestamptz, created_at timestamptz
)
language plpgsql stable security definer
set search_path = '' set row_security = off
as $function$
begin
  if auth.uid() is null or not private.is_novaai_admin() then
    raise exception 'Administrator access required' using errcode = '42501';
  end if;
  return query
  select f.id,f.order_id,f.seller_id,f.item_subtotal,f.platform_commission,
         f.payout_amount,f.fulfillment_status,f.settlement_status,
         f.courier_name,f.tracking_number,f.delivery_date,f.created_at
  from public.seller_fulfillments f
  order by f.created_at desc;
end;
$function$;

-- Preserve the legacy RPC identity/return signature but null every customer PII
-- and payment/status field. The seller portal is migrated to the narrow RPC above.
create or replace function public.get_my_seller_orders()
returns table (
  order_id uuid, customer_name text, customer_phone text, delivery_address text,
  order_status text, payment_status text, order_created_at timestamptz,
  order_item_id uuid, product_id bigint, product_name text, quantity integer,
  unit_price numeric, line_total numeric
)
language sql stable security definer
set search_path = '' set row_security = off
as $function$
  select o.id,null::text,null::text,null::text,null::text,null::text,o.created_at,
         oi.id,oi.product_id,oi.product_name,oi.quantity,oi.unit_price,oi.line_total
  from public.orders o
  join public.order_items oi on oi.order_id=o.id
  join public."Products" p on p.id=oi.product_id
  where oi.seller_id=auth.uid() and p.seller_id=auth.uid()
    and (
      (
        exists (
          select 1 from public.seller_stores s
          join public.seller_marketplace_permissions mp
            on mp.user_id=s.user_id and mp.marketplace=s.primary_marketplace
          where s.user_id=auth.uid() and s.status='approved' and mp.status='approved'
        )
        and private.product_marketplace_access_allowed(p.seller_id,p.category)
      )
      or exists (
        select 1
        from private.seller_fulfillment_historical_access ha
        join private.seller_fulfillment_historical_items hi
          on hi.revocation_event_id=ha.revocation_event_id
         and hi.fulfillment_id=ha.fulfillment_id
         and hi.order_item_id=oi.id
         and hi.order_id=oi.order_id
         and hi.seller_id=oi.seller_id
         and hi.product_id=oi.product_id
        where ha.seller_id=auth.uid()
          and private.seller_fulfillment_historical_access_allowed(ha.fulfillment_id,ha.order_id,ha.seller_id)
      )
    )
  order by o.created_at desc;
$function$;

-- 7. RLS: seller access to orders/items is through narrow RPCs, not base rows.
drop policy if exists "Secure customers and sellers view orders" on public.orders;

drop policy if exists "Sellers and customers view marketplace-scoped order items" on public.order_items;
create policy "Customers view own order items"
on public.order_items for select to authenticated
using (
  exists (
    select 1 from public.orders o
    where o.id=order_items.order_id and o.customer_id=(select auth.uid())
  )
);

drop policy if exists "Sellers view own primary marketplace fulfillments" on public.seller_fulfillments;
drop policy if exists "Sellers update own primary marketplace fulfillments" on public.seller_fulfillments;

-- Remove every direct client privilege, including table-level TRUNCATE/TRIGGER
-- and prior column-level financial SELECT/operational UPDATE grants. service_role
-- and postgres grants are deliberately untouched.
revoke all privileges on table public.seller_fulfillments from anon, authenticated;
revoke select (
  id,order_id,seller_id,item_subtotal,platform_commission,payout_amount,
  fulfillment_status,settlement_status,created_at,updated_at,
  tracking_number,courier_name,delivery_date
) on table public.seller_fulfillments from anon, authenticated;
revoke update (
  courier_name,delivery_date,fulfillment_status,tracking_number,updated_at
) on table public.seller_fulfillments from anon, authenticated;

-- Explicit client execution grants. The legacy seller RPC keeps its existing ACL.
revoke all on function public.get_my_seller_order_items() from public, anon;
revoke all on function public.get_my_seller_fulfillments() from public, anon;
revoke all on function public.get_my_customer_order_fulfillments() from public, anon;
revoke all on function public.update_my_seller_fulfillment_shipping(uuid,text,text,timestamptz) from public, anon;
revoke all on function public.update_my_seller_fulfillment_status(uuid,text) from public, anon;
revoke all on function public.admin_get_seller_fulfillment_financials() from public, anon;
revoke all on function public.revoke_seller_marketplace_access(uuid) from public, anon;

grant execute on function public.get_my_seller_order_items() to authenticated;
grant execute on function public.get_my_seller_fulfillments() to authenticated;
grant execute on function public.get_my_customer_order_fulfillments() to authenticated;
grant execute on function public.update_my_seller_fulfillment_shipping(uuid,text,text,timestamptz) to authenticated;
grant execute on function public.update_my_seller_fulfillment_status(uuid,text) to authenticated;
grant execute on function public.admin_get_seller_fulfillment_financials() to authenticated;
grant execute on function public.revoke_seller_marketplace_access(uuid) to authenticated;

commit;
