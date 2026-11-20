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
const ads=fs.readFileSync(path.join(root,"novaai-ad-slots.js"),"utf8");
const seller=fs.readFileSync(path.join(root,"seller.html"),"utf8");
const branding=fs.readFileSync(path.join(root,"novaai-store-branding.js"),"utf8");
const videoSql=fs.readFileSync(path.join(root,"docs/sql/20261115-retail-product-videos.sql"),"utf8");
test("Ad boards reveal before the background campaign request and font readiness never blocks first paint",()=>{
 const boot=ads.indexOf("function bootLiveAds()");
 const reveal=ads.indexOf("window.__novaAdsRevealBoards();",boot);
 const campaignFetch=ads.indexOf("loadManagedCampaigns().catch",boot);
 assert.ok(boot>=0&&reveal>boot&&campaignFetch>reveal,"fallback reveal must happen before campaign loading");
 assert.match(ads,/Promise\.race\(\[[\s\S]*?document\.fonts\.ready[\s\S]*?1200/,"managed campaign font wait must be bounded");
 assert.ok(ads.indexOf("document.fonts.ready")>ads.indexOf("async function loadManagedCampaigns"),"font readiness must be used only in the background campaign path");
 assert.doesNotMatch(ads,/await\s+document\.fonts\.ready/,"no unbounded font wait is allowed");
});
test("Store Page selects the public phone field before rendering its WhatsApp contact",()=>{
 assert.match(js,/select\("user_id,store_name,store_slug,status,store_banner_url,store_logo_url,phone"\)/);
 assert.match(js,/select\("user_id,store_name,store_slug,status,store_banner_url,phone"\)/);
 assert.match(js,/store\.phone/);
});
test("Home and Retail cards expose seller identity for View Store links without changing Motors or Property cards",()=>{
 for(const [name,source] of [["Home",home],["Retail",retail]]){
  assert.match(source,/data-store-owner-id/,name+" cards missing seller owner id");
  assert.match(source,/novaai-storefront\.js/,name+" missing Store Page integration");
 }
 assert.doesNotMatch(motors,/data-store-owner-id/,"Motors and Property cards must remain outside this enhancement");
 assert.doesNotMatch(motors,/novaai-storefront\\.js/,"Motors and Property must not load the Store Page enhancement");
});
test("Seller Portal exposes secure banner upload, preview, replacement and removal",()=>{
 assert.match(seller,/novaai-store-branding\.js/);
 assert.match(seller,/NOVAAI_SUPABASE_CLIENT=sb/);
 assert.match(branding,/novaStoreBannerPreview/);
 assert.match(branding,/Upload \/ Replace banner/);
 assert.match(branding,/novaStoreBannerRemove/);
 assert.match(branding,/approved, signed-in seller store is required/i);
 assert.match(branding,/selected\.type\)\|\|selected\.size>5\*1024\*1024/);
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
 assert.match(js,/Public contact\s/);
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


test("Store Page renders its identity before waiting for public location, products or engagement",()=>{
 const start=js.indexOf("async function loadStorePage()");
 const end=js.indexOf("\n}",start)+2;
 const loader=js.slice(start,end);
 assert.ok(start>=0&&end>start);
 assert.ok(loader.indexOf("nextView.append(banner,identity)")<loader.indexOf("const locationTask="),"store identity must be attached before secondary requests");
 assert.match(loader,/Promise\.all\(\[authPromise,locationTask\.catch[\s\S]*?productsTask\.catch/);
 assert.match(loader,/productGrid\.innerHTML=.*Loading this store/);
 assert.match(loader,/if\(!hadContent\)root\.innerHTML/,"first load should show a loader without clearing an existing store");
 assert.match(loader,/const nextView=document\.createDocumentFragment\(\)/,"refresh view must be prepared off-screen");
 assert.match(loader,/if\(hadContent\)root\.replaceChildren\(nextView\)/,"existing store view must be swapped only after secondary requests finish");
 assert.match(loader,/root\.removeAttribute\("aria-busy"\)/);
});

test("Homepage product route shows a stable detail skeleton and hides all homepage-only sections",()=>{
 assert.match(home,/product-loading-shell/);
 assert.match(home,/Loading approved product details/);
 assert.match(home,/product-view-active #novaAiLaunchCard/);
 assert.match(home,/product-view-active \.home-category-tiles/);
 assert.match(home,/product-view-active \.home-seller-banner/);
 assert.match(home,/product-view-active \.home-search-wrap/);
 assert.match(home,/product-view-active \.nova-hero-carousel/);
});

test("Homepage product cards reserve image space and keep asynchronous image decoding",()=>{
 assert.match(home,/\.home-product-photo\{[^}]*aspect-ratio:1\/1/);
 assert.match(home,/loading=\"lazy\" decoding=\"async\"/);
});


test("Homepage product loading failures replace the skeleton with a recoverable error state",()=>{
 assert.match(home,/if\(requestedId\)\{const main=document\.querySelector\(\x27main\x27\);if\(main\)main\.innerHTML=.*Return to homepage/);
});

test("Homepage advertising first paint remains independent from managed campaign loading",()=>{
 const boot=ads.indexOf("function bootLiveAds()");
 const reveal=ads.indexOf("window.__novaAdsRevealBoards();",boot);
 const managed=ads.indexOf("loadManagedCampaigns().catch",boot);
 assert.ok(reveal>boot&&managed>reveal);
 assert.match(ads,/setInterval\(\(\)=>show\(active\+1\),5000\)/);
 assert.match(home,/\.nova-hero-slide\{[^}]*min-height:190px/);
});
