alter table public.novaai_ad_campaigns
  add column if not exists slot_ids text[] not null default '{}',
  add column if not exists creative_type text not null default 'image',
  add column if not exists duration_seconds integer not null default 5,
  add column if not exists impression_count bigint not null default 0,
  add column if not exists click_count bigint not null default 0;

update public.novaai_ad_campaigns set slot_ids=array[slot_id] where cardinality(slot_ids)=0;

alter table public.novaai_ad_campaigns
  drop constraint if exists novaai_ad_campaigns_slot_ids_check,
  drop constraint if exists novaai_ad_campaigns_creative_type_check,
  drop constraint if exists novaai_ad_campaigns_duration_seconds_check,
  drop constraint if exists novaai_ad_campaigns_impression_count_check,
  drop constraint if exists novaai_ad_campaigns_click_count_check;

alter table public.novaai_ad_campaigns
  add constraint novaai_ad_campaigns_slot_ids_check check(cardinality(slot_ids) between 1 and 9 and slot_ids <@ array['home_hero','shop_tv','cart_banner','wishlist_banner','motors_banner','property_banner','shop_footer','motors_footer','property_footer']::text[]),
  add constraint novaai_ad_campaigns_creative_type_check check(creative_type in ('image','video')),
  add constraint novaai_ad_campaigns_duration_seconds_check check(duration_seconds between 2 and 60),
  add constraint novaai_ad_campaigns_impression_count_check check(impression_count>=0),
  add constraint novaai_ad_campaigns_click_count_check check(click_count>=0);

create index if not exists novaai_ad_campaigns_active_schedule_idx on public.novaai_ad_campaigns(status,starts_at,ends_at,priority desc);

create or replace function public.get_live_novaai_ad_campaigns()
returns jsonb language sql stable set search_path to 'pg_catalog','public'
as $function$
  select coalesce(jsonb_agg(jsonb_build_object(
    'campaign_id',c.campaign_code,'slot_id',board.slot_id,'title',c.title,'description',c.description,
    'creative_type',c.creative_type,'creative_url',c.creative_url,'destination_url',c.destination_url,
    'cta_text',c.cta_text,'status',c.status,'starts_at',c.starts_at,'ends_at',c.ends_at,
    'priority',c.priority,'duration_seconds',c.duration_seconds
  ) order by c.priority desc,c.created_at desc),'[]'::jsonb)
  from public.novaai_ad_campaigns c cross join lateral unnest(c.slot_ids) as board(slot_id)
  where c.status='active' and (c.starts_at is null or c.starts_at<=now()) and (c.ends_at is null or c.ends_at>now());
$function$;

create or replace function public.admin_save_novaai_ad_campaign(p_campaign jsonb)
returns jsonb language plpgsql set search_path to 'pg_catalog','public','auth'
as $function$
declare
  v_id uuid; v_code text; v_slots text[]; v_slot text; v_title text; v_description text;
  v_creative text; v_creative_type text; v_destination text; v_cta text; v_status text;
  v_start timestamptz; v_end timestamptz; v_priority integer; v_duration integer;
  v_row public.novaai_ad_campaigns%rowtype;
begin
  if not public.is_novaai_admin() then raise exception 'Administrator access required' using errcode='42501'; end if;
  v_id:=nullif(p_campaign->>'id','')::uuid;
  v_code:=coalesce(nullif(p_campaign->>'campaign_code',''),'NOVA-'||upper(substr(replace(gen_random_uuid()::text,'-',''),1,10)));
  if jsonb_typeof(p_campaign->'slot_ids')='array' then
    select array_agg(value order by ordinality) into v_slots from jsonb_array_elements_text(p_campaign->'slot_ids') with ordinality as s(value,ordinality);
  else v_slots:=array[coalesce(p_campaign->>'slot_id','')]; end if;
  v_slot:=v_slots[1]; v_title:=btrim(coalesce(p_campaign->>'title',''));
  v_description:=coalesce(p_campaign->>'description',''); v_creative:=p_campaign->>'creative_url';
  v_creative_type:=coalesce(nullif(p_campaign->>'creative_type',''),'image'); v_destination:=p_campaign->>'destination_url';
  v_cta:=coalesce(nullif(p_campaign->>'cta_text',''),'Explore offer →'); v_status:=coalesce(nullif(p_campaign->>'status',''),'draft');
  v_start:=nullif(p_campaign->>'starts_at','')::timestamptz; v_end:=nullif(p_campaign->>'ends_at','')::timestamptz;
  v_priority:=coalesce(nullif(p_campaign->>'priority','')::integer,0); v_duration:=coalesce(nullif(p_campaign->>'duration_seconds','')::integer,5);
  if coalesce(cardinality(v_slots),0) not between 1 and 9 or exists(select 1 from unnest(v_slots) s where s not in ('home_hero','shop_tv','cart_banner','wishlist_banner','motors_banner','property_banner','shop_footer','motors_footer','property_footer')) then raise exception 'Select one or more valid NOVAAI advertising boards'; end if;
  if char_length(v_title) not between 1 and 100 then raise exception 'Title must be 1 to 100 characters'; end if;
  if char_length(v_description)>180 then raise exception 'Description must be 180 characters or fewer'; end if;
  if v_creative !~ '^https://' or v_destination !~ '^https://' then raise exception 'Creative and destination must use HTTPS URLs'; end if;
  if v_creative_type not in ('image','video') then raise exception 'Invalid creative type'; end if;
  if v_duration not between 2 and 60 then raise exception 'Duration must be between 2 and 60 seconds'; end if;
  if char_length(v_cta) not between 1 and 36 then raise exception 'Button text must be 1 to 36 characters'; end if;
  if v_status not in ('draft','active','paused','ended') then raise exception 'Invalid campaign status'; end if;
  if v_start is not null and v_end is not null and v_end<=v_start then raise exception 'End date must be after start date'; end if;
  if v_id is null then
    insert into public.novaai_ad_campaigns(campaign_code,slot_id,slot_ids,title,description,creative_url,creative_type,destination_url,cta_text,status,starts_at,ends_at,priority,duration_seconds,created_by)
    values(v_code,v_slot,v_slots,v_title,v_description,v_creative,v_creative_type,v_destination,v_cta,v_status,v_start,v_end,v_priority,v_duration,auth.uid()) returning * into v_row;
  else
    update public.novaai_ad_campaigns set slot_id=v_slot,slot_ids=v_slots,title=v_title,description=v_description,creative_url=v_creative,creative_type=v_creative_type,destination_url=v_destination,cta_text=v_cta,status=v_status,starts_at=v_start,ends_at=v_end,priority=v_priority,duration_seconds=v_duration,updated_at=now()
    where id=v_id returning * into v_row;
    if not found then raise exception 'Campaign not found'; end if;
  end if;
  return to_jsonb(v_row);
end;
$function$;

create or replace function public.record_novaai_ad_event(p_campaign_code text,p_event_type text)
returns void language plpgsql security definer set search_path to 'pg_catalog','public'
as $function$
begin
  if p_event_type not in ('impression','click') then raise exception 'Invalid advertisement event'; end if;
  update public.novaai_ad_campaigns
  set impression_count=impression_count+case when p_event_type='impression' then 1 else 0 end,
      click_count=click_count+case when p_event_type='click' then 1 else 0 end
  where campaign_code=p_campaign_code and status='active'
    and (starts_at is null or starts_at<=now()) and (ends_at is null or ends_at>now());
end;
$function$;

revoke all on function public.record_novaai_ad_event(text,text) from public;
grant execute on function public.record_novaai_ad_event(text,text) to anon,authenticated;

update storage.buckets set allowed_mime_types=array['image/jpeg','image/png','image/webp','video/mp4','video/webm'],file_size_limit=104857600 where id='Nova AI';
