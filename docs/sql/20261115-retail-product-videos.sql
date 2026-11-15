-- NOVAAI Retail Product Video Support
-- REVIEW ONLY. Do not apply until the user explicitly approves.
begin;
alter table public."Products" add column if not exists product_video_url text;
insert into storage.buckets (id,name,public,file_size_limit,allowed_mime_types) values ('novaai-retail-product-videos','novaai-retail-product-videos',true,52428800,array['video/mp4','video/webm']::text[]) on conflict (id) do nothing;
do $validate_retail_video_bucket$ declare b record; begin
 select id,name,public,file_size_limit,allowed_mime_types into b from storage.buckets where id='novaai-retail-product-videos';
 if not found then raise exception 'Required Retail video bucket is unavailable.'; end if;
 if b.name is distinct from 'novaai-retail-product-videos' or b.public is distinct from true or b.file_size_limit is distinct from 52428800 or b.allowed_mime_types is distinct from array['video/mp4','video/webm']::text[] then raise exception 'Existing Retail video bucket configuration differs from reviewed configuration. No settings changed.'; end if;
end; $validate_retail_video_bucket$;
drop policy if exists "Public can view NOVAAI Retail product videos" on storage.objects;
create policy "Public can view NOVAAI Retail product videos" on storage.objects for select to public using(bucket_id='novaai-retail-product-videos');
drop policy if exists "Approved Retail sellers upload own product videos" on storage.objects;
create policy "Approved Retail sellers upload own product videos" on storage.objects for insert to authenticated with check(bucket_id='novaai-retail-product-videos' and (storage.foldername(name))[1]=(select auth.uid())::text and exists(select 1 from public.seller_stores s where s.user_id=(select auth.uid()) and s.status='approved' and s.primary_marketplace='retail') and exists(select 1 from public.seller_marketplace_permissions mp where mp.user_id=(select auth.uid()) and mp.marketplace='retail' and mp.status='approved'));
drop policy if exists "Approved Retail sellers update own product videos" on storage.objects;
create policy "Approved Retail sellers update own product videos" on storage.objects for update to authenticated using(bucket_id='novaai-retail-product-videos' and (storage.foldername(name))[1]=(select auth.uid())::text and exists(select 1 from public.seller_stores s where s.user_id=(select auth.uid()) and s.status='approved' and s.primary_marketplace='retail') and exists(select 1 from public.seller_marketplace_permissions mp where mp.user_id=(select auth.uid()) and mp.marketplace='retail' and mp.status='approved')) with check(bucket_id='novaai-retail-product-videos' and (storage.foldername(name))[1]=(select auth.uid())::text and exists(select 1 from public.seller_stores s where s.user_id=(select auth.uid()) and s.status='approved' and s.primary_marketplace='retail') and exists(select 1 from public.seller_marketplace_permissions mp where mp.user_id=(select auth.uid()) and mp.marketplace='retail' and mp.status='approved'));
drop policy if exists "Approved Retail sellers delete own product videos" on storage.objects;
create policy "Approved Retail sellers delete own product videos" on storage.objects for delete to authenticated using(bucket_id='novaai-retail-product-videos' and (storage.foldername(name))[1]=(select auth.uid())::text and exists(select 1 from public.seller_stores s where s.user_id=(select auth.uid()) and s.status='approved' and s.primary_marketplace='retail') and exists(select 1 from public.seller_marketplace_permissions mp where mp.user_id=(select auth.uid()) and mp.marketplace='retail' and mp.status='approved'));
commit;
-- Existing Nova AI image bucket/policies are not changed. Dedicated video bucket:
-- public playback, 50 MiB, MP4/WebM. Upload/update/delete require seller UUID
-- folder, approved store and approved Retail permission. Duration check in browser
-- is not tamper-resistant; server-side media inspection is needed for enforcement.
-- This SQL has NOT been executed.
