create or replace function public.admin_save_novaai_ad_campaign(p_campaign jsonb)
returns jsonb language plpgsql set search_path to 'pg_catalog','public','auth'
as $function$
declare
  v_id uuid; v_code text; v_slots text[]; v_slot text; v_title text; v_description text;
  v_creative text; v_creative_type text; v_destination text; v_cta text; v_status text;
  v_start timestamptz; v_end timestamptz; v_priority integer; v_duration integer;
  v_row public.novaai_ad_campaigns%rowtype;
  v_attempt integer;
  v_constraint_name text;
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
  if coalesce(cardinality(v_slots),0) not between 1 and 9 or exists(select 1 from unnest(v_slots) s where s not in ('home_hero','shop_tv','cart_banner','wishlist_banner','motors_banner','property_banner','shop_footer','motors_footer','property_footer')) then raise exception 'Select between 1 and 9 valid advertising boards'; end if;
  if char_length(v_title) not between 1 and 100 then raise exception 'Title must be 1 to 100 characters'; end if;
  if char_length(v_description)>180 then raise exception 'Description must be 180 characters or fewer'; end if;
  if v_creative !~ '^https://' or v_destination !~ '^https://' then raise exception 'Creative and destination must use HTTPS URLs'; end if;
  if v_creative_type not in ('image','video') then raise exception 'Invalid creative type'; end if;
  if v_duration not between 2 and 60 then raise exception 'Duration must be between 2 and 60 seconds'; end if;
  if char_length(v_cta) not between 1 and 36 then raise exception 'Button text must be 1 to 36 characters'; end if;
  if v_status not in ('draft','active','paused','ended') then raise exception 'Invalid campaign status'; end if;
  if v_start is not null and v_end is not null and v_end<=v_start then raise exception 'End date must be after start date'; end if;
  if v_id is null then
    for v_attempt in 1..10 loop
      if v_attempt>1 then
        v_code:='NOVA-'||upper(substr(replace(gen_random_uuid()::text,'-',''),1,10));
      end if;
      begin
        insert into public.novaai_ad_campaigns(campaign_code,slot_id,slot_ids,title,description,creative_url,creative_type,destination_url,cta_text,status,starts_at,ends_at,priority,duration_seconds,created_by)
        values(v_code,v_slot,v_slots,v_title,v_description,v_creative,v_creative_type,v_destination,v_cta,v_status,v_start,v_end,v_priority,v_duration,auth.uid()) returning * into v_row;
        exit;
      exception when unique_violation then
        get stacked diagnostics v_constraint_name = constraint_name;
        if v_constraint_name is distinct from 'novaai_ad_campaigns_campaign_code_key' then raise; end if;
        if v_attempt=10 then raise; end if;
      end;
    end loop;
  else
    update public.novaai_ad_campaigns set slot_id=v_slot,slot_ids=v_slots,title=v_title,description=v_description,creative_url=v_creative,creative_type=v_creative_type,destination_url=v_destination,cta_text=v_cta,status=v_status,starts_at=v_start,ends_at=v_end,priority=v_priority,duration_seconds=v_duration,updated_at=now()
    where id=v_id returning * into v_row;
    if not found then raise exception 'Campaign not found'; end if;
  end if;
  return to_jsonb(v_row);
end;
$function$;
