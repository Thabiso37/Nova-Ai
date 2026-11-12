-- NOVAAI advertisement share analytics.
-- Isolated from existing impression/click counters and all campaign/payment records.

create table private.novaai_ad_share_events (
  event_id uuid primary key,
  campaign_code text not null
    references public.novaai_ad_campaigns(campaign_code) on update cascade on delete restrict,
  created_at timestamptz not null default now()
);

create index novaai_ad_share_events_campaign_created_idx
  on private.novaai_ad_share_events (campaign_code, created_at desc);

create table private.novaai_ad_campaign_share_counts (
  campaign_code text primary key
    references public.novaai_ad_campaigns(campaign_code) on update cascade on delete restrict,
  share_count bigint not null default 0 check (share_count >= 0),
  updated_at timestamptz not null default now()
);

alter table private.novaai_ad_share_events enable row level security;
alter table private.novaai_ad_campaign_share_counts enable row level security;

revoke all on table private.novaai_ad_share_events from public, anon, authenticated, service_role;
revoke all on table private.novaai_ad_campaign_share_counts from public, anon, authenticated, service_role;

create or replace function public.record_novaai_ad_share_v1(
  p_event_id uuid,
  p_campaign_code text
)
returns boolean
language plpgsql
security definer
set search_path = pg_catalog, private
as $function$
declare
  v_rows integer;
  v_campaign_code text;
begin
  if p_event_id is null then
    raise exception 'Share event ID is required';
  end if;

  if p_campaign_code is null or btrim(p_campaign_code) = '' then
    raise exception 'Campaign code is required';
  end if;

  select c.campaign_code
    into v_campaign_code
  from public.novaai_ad_campaigns as c
  where c.campaign_code = btrim(p_campaign_code)
    and c.status = 'active'
    and (c.starts_at is null or c.starts_at <= now())
    and (c.ends_at is null or c.ends_at > now());

  if not found then
    raise exception 'Active advertisement campaign not found';
  end if;

  insert into private.novaai_ad_share_events (event_id, campaign_code)
  values (p_event_id, v_campaign_code)
  on conflict (event_id) do nothing;

  get diagnostics v_rows = row_count;

  if v_rows = 0 then
    return false;
  end if;

  insert into private.novaai_ad_campaign_share_counts (campaign_code, share_count, updated_at)
  values (v_campaign_code, 1, now())
  on conflict (campaign_code) do update
    set share_count = private.novaai_ad_campaign_share_counts.share_count + 1,
        updated_at = now();

  return true;
end;
$function$;

revoke all on function public.record_novaai_ad_share_v1(uuid, text) from public, anon, authenticated;
grant execute on function public.record_novaai_ad_share_v1(uuid, text) to service_role;
