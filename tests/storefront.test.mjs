import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
const root=process.cwd();
const page=fs.readFileSync(path.join(root,"store-page.html"),"utf8");
const js=fs.readFileSync(path.join(root,"novaai-storefront.js"),"utf8");
const sql=fs.readFileSync(path.join(root,"docs/sql/20261115-seller-storefront-branding.sql"),"utf8");
const home=fs.readFileSync(path.join(root,"index.html"),"utf8");
const retail=fs.readFileSync(path.join(root,"retail.html"),"utf8");
const motors=fs.readFileSync(path.join(root,"seller-motors-houses.html"),"utf8");
const seller=fs.readFileSync(path.join(root,"seller.html"),"utf8");
const branding=fs.readFileSync(path.join(root,"novaai-store-branding.js"),"utf8");
const videoSql=fs.readFileSync(path.join(root,"docs/sql/20261115-retail-product-videos.sql"),"utf8");
test("all existing marketplace cards expose a seller identity for View Store links",()=>{
 for(const [name,source] of [["Home",home],["Retail",retail],["Motors and Property",motors]]){
  assert.match(source,/data-store-owner-id/,name+" cards missing seller owner id");
  assert.match(source,/novaai-storefront\.js/,name+" missing Store Page integration");
 }
});
test("Seller Portal branding controls cover upload, preview, replacement and removal",()=>{
 assert.match(seller,/novaai-store-branding\.js/);
 assert.match(seller,/NOVAAI_SUPABASE_CLIENT=sb/);
 assert.match(branding,/novaStoreLogoPreview/);
 assert.match(branding,/novaStoreBannerPreview/);
 assert.match(branding,/Upload \/ Replace logo/);
 assert.match(branding,/Upload \/ Replace banner/);
 assert.match(branding,/novaStoreLogoRemove/);
 assert.match(branding,/novaStoreBannerRemove/);
});
test("store page is a dedicated page and has no directory route",()=>{
 assert.match(page,/id="novaStorePage"/);
 assert.match(js,/store-page\.html\?store=/);
 assert.doesNotMatch(js,/store-directory|all-stores/i);
});
test("storefront only queries approved stores and approved seller products",()=>{
 assert.match(js,/eq\("status","approved"\)/);
 assert.match(js,/eq\("seller_id",store\.user_id\)\.eq\("status","approved"\)/);
});
test("product cards use existing public detail routes",()=>{
 assert.match(js,/property-details\.html\?id=/);
 assert.match(js,/index\.html\?product=/);
 assert.match(js,/index\.html\?product=/);
});
test("like/follow persistence is unique and customer-scoped",()=>{
 assert.match(sql,/primary key \(store_user_id, customer_id\)/i);
 assert.match(sql,/customer_id = \(select auth\.uid\(\)\)/i);
 assert.match(sql,/for delete to authenticated[\s\S]*?using \(customer_id = \(select auth\.uid\(\)\)\)/i);
 assert.match(sql,/get_seller_store_engagement/i);
 assert.match(sql,/returns table\(likes_count bigint, followers_count bigint, liked boolean, following boolean\)/i);
 assert.match(sql,/customers can view own store likes/i);
 assert.doesNotMatch(sql,/for select to anon, authenticated using \(true\)/i);
});
test("branding Storage mutations require an existing seller owner and matching auth folder",()=>{
 const policies=[...sql.matchAll(/create policy "Sellers (?:upload|update|remove) own NOVAAI store branding"[\s\S]*?;/gi)].map(m=>m[0]);
 assert.equal(policies.length,3);
 for(const policy of policies){
  assert.match(policy,/to authenticated/i);
  assert.match(policy,/bucket_id = 'novaai-store-branding'/i);
  assert.match(policy,/\(storage\.foldername\(name\)\)\[1\] = \(select auth\.uid\(\)\)::text/i);
  assert.match(policy,/exists\s*\(\s*select 1\s*from public\.seller_stores s\s*where s\.user_id = \(select auth\.uid\(\)\)/i);
 }
 assert.match(policies.find(p=>/update/i.test(p)),/using[\s\S]*with check/i);
 assert.match(sql,/file_size_limit[\s\S]*5242880/);
});
test("branding bucket creation never overwrites existing configuration",()=>{
 assert.match(sql,/on conflict \(id\) do nothing/i);
 assert.doesNotMatch(sql,/on conflict \(id\) do update/i);
 assert.match(sql,/actual_bucket\.public is distinct from true/i);
 assert.match(sql,/actual_bucket\.file_size_limit is distinct from 5242880/i);
 assert.match(sql,/actual_bucket\.allowed_mime_types is distinct from expected_mime_types/i);
 assert.match(sql,/raise exception[\s\S]*Existing novaai-store-branding bucket configuration/i);
});
test("engagement tables have customer lookup indexes and preserve approved-store privacy controls",()=>{
 assert.match(sql,/seller_store_likes_customer_id_idx[\s\S]*on public\.seller_store_likes \(customer_id\)/i);
 assert.match(sql,/seller_store_follows_customer_id_idx[\s\S]*on public\.seller_store_follows \(customer_id\)/i);
 assert.match(sql,/s\.status = 'approved'/i);
 assert.match(sql,/returns table\(likes_count bigint, followers_count bigint, liked boolean, following boolean\)[\s\S]*security definer/i);
 assert.doesNotMatch(sql,/returns table\([^)]*customer_id/i);
});
test("Store Page exposes no store description or private seller address",()=>{
 assert.doesNotMatch(page,/store\.description|store_description|delivery_address|street_address/i);
 assert.match(js,/Public contact:/);
 assert.match(js,/eq\("status","approved"\)/);
});
test("no existing commerce tables are altered",()=>{
 assert.doesNotMatch(sql,/alter\s+table\s+public\.(products|orders|order_items|seller_fulfillments)/i);
});

test("Retail product detail includes description, public seller location, store navigation and secure contact controls",()=>{
 assert.match(home,/nova-retail-detail/);assert.match(home,/Product description/);assert.match(home,/seller has not supplied a product description/i);assert.match(home,/seller_public_locations/);
 assert.match(retail,/modalCallSeller/);assert.match(retail,/modalWhatsAppSeller/);assert.match(retail,/property-contact-action/);
});
test("Retail video upload UI is separate from photo inputs and Storage proposal is seller-scoped",()=>{
 assert.match(seller,/retailProductVideoFile/);assert.match(seller,/video\/mp4,video\/webm/);assert.match(seller,/50\*1024\*1024/);assert.match(seller,/d>90/);
 assert.match(retail,/modalProductVideoPlayer/);assert.match(retail,/videoWrap\.hidden=!videoUrl/);
 assert.match(videoSql,/product_video_url/);assert.match(videoSql,/novaai-retail-product-videos/);assert.match(videoSql,/primary_marketplace='retail'/);assert.match(videoSql,/mp\.status='approved'/);assert.match(videoSql,/on conflict \(id\) do nothing/i);
});
test("Store Page engagement uses professional icons and retains customer authentication restrictions",()=>{
 assert.match(js,/likeButton\.innerHTML=heart/);assert.match(js,/followButton\.innerHTML=followIcon/);assert.match(js,/canEngage=signedIn&&!ownStore&&engagementReady/);assert.match(js,/storeEngagementStatus/);
});
