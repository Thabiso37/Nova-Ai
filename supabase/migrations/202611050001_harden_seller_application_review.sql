create or replace function public.review_seller_application(
  p_permission_id uuid,
  p_status text
)
returns jsonb
language plpgsql
set search_path = ''
as $function$
declare
  v_admin_id uuid := (select auth.uid());
  v_user_id uuid;
  v_marketplace text;
  v_store_id uuid;
  v_store_marketplace text;
  v_store_status text;
  v_reviewed_at timestamptz;
  v_store_rows integer;
begin
  if v_admin_id is null or not private.is_novaai_admin() then
    raise exception 'Only NOVAAI administrators can review seller applications'
      using errcode = '42501';
  end if;

  if p_status is null or p_status not in ('approved', 'rejected') then
    raise exception 'Application status must be approved or rejected'
      using errcode = '22023';
  end if;

  select mp.user_id, mp.marketplace
    into v_user_id, v_marketplace
  from public.seller_marketplace_permissions mp
  where mp.id = p_permission_id
    and mp.status = 'pending'
  for update;

  if v_user_id is null then
    raise exception 'Pending marketplace application not found'
      using errcode = 'P0002';
  end if;

  select s.id, s.primary_marketplace, s.status
    into v_store_id, v_store_marketplace, v_store_status
  from public.seller_stores s
  where s.user_id = v_user_id
  for update;

  if v_store_id is null then
    raise exception 'No seller store is linked to this application. The seller must complete the normal store registration before review.'
      using errcode = '23503';
  end if;

  if v_store_marketplace is distinct from v_marketplace then
    raise exception 'Seller store and marketplace application do not match'
      using errcode = '23514';
  end if;

  if v_store_status is distinct from 'pending' then
    raise exception 'Linked seller store is not pending review'
      using errcode = '23514';
  end if;

  update public.seller_marketplace_permissions
  set status = p_status,
      reviewed_at = pg_catalog.now(),
      reviewed_by = v_admin_id
  where id = p_permission_id
    and user_id = v_user_id
    and marketplace = v_marketplace
    and status = 'pending'
  returning reviewed_at into v_reviewed_at;

  if v_reviewed_at is null then
    raise exception 'Marketplace application changed before review could be saved'
      using errcode = '40001';
  end if;

  update public.seller_stores
  set status = p_status
  where id = v_store_id
    and user_id = v_user_id
    and primary_marketplace = v_marketplace
    and status = 'pending';

  get diagnostics v_store_rows = row_count;
  if v_store_rows <> 1 then
    raise exception 'Linked seller store changed before review could be saved'
      using errcode = '40001';
  end if;

  return pg_catalog.jsonb_build_object(
    'store_id', v_store_id,
    'user_id', v_user_id,
    'primary_marketplace', v_marketplace,
    'application_status', p_status,
    'store_status', p_status,
    'reviewed_by', v_admin_id,
    'reviewed_at', v_reviewed_at
  );
end;
$function$;
