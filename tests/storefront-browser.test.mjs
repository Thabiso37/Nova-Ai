import test, {after} from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import {createServer} from "node:http";
import {chromium} from "playwright";


const retailProduct={id:40,name:"Test Black T-Shirt",category:"Office & Stationery",price:200,seller_name:"Nova Test Store",seller_id:"seller-1",status:"approved",description:"T shirt",image_url:"",images:[]};
const retailStore={user_id:"seller-1",store_name:"Raider Retail",store_slug:"raider-retail",description:"",status:"approved"};
const retailLocation={user_id:"seller-1",province:"Gauteng",city:"Pretoria",suburb:"Centurion",public_location_enabled:true,approval_status:"approved"};
async function waitForRetailMarketplace(page){
 const status=page.locator("#dbStatus");
 await page.waitForFunction(()=>{
  const text=document.getElementById("dbStatus")?.textContent||"";
  return text.includes("REAL MARKETPLACE CONNECTED")||text.includes("MARKETPLACE CONNECTION ERROR");
 },{},{timeout:10000}).catch(async error=>{
  const diagnostics=await page.evaluate(()=>({
   status:document.getElementById("dbStatus")?.textContent||"<missing>",
   message:document.getElementById("catalogueMessage")?.textContent||"<missing>",
   productCards:document.querySelectorAll("#products .product").length
  })).catch(()=>({page:"unavailable"}));
  throw new Error("Retail catalogue did not reach a terminal state: "+JSON.stringify(diagnostics)+"; "+error.message);
 });
 const actual=await status.textContent();
 assert.equal(actual,"REAL MARKETPLACE CONNECTED","Retail fixture failed to connect: "+(await page.locator("#catalogueMessage").textContent()));
}

function retailMockScript(description=retailProduct.description){const product={...retailProduct,description};return `(()=>{const tables={Products:[${JSON.stringify(product)}],seller_stores:[${JSON.stringify(retailStore)}],seller_public_locations:[${JSON.stringify(retailLocation)}]};class Q{constructor(t){this.t=t;this.filters=[];}select(){return this;}eq(k,v){this.filters.push(x=>String(x[k])===String(v));return this;}in(k,vs){this.filters.push(x=>(vs||[]).map(String).includes(String(x[k])));return this;}order(){return this;}rows(){return (tables[this.t]||[]).filter(x=>this.filters.every(f=>f(x)));}maybeSingle(){return Promise.resolve({data:this.rows()[0]||null,error:null});}then(resolve,reject){return Promise.resolve({data:this.rows(),error:null}).then(resolve,reject);}}const client={from:t=>new Q(t),rpc:async()=>({data:null,error:{message:"RPC disabled in browser fixture"}}),auth:{getSession:async()=>({data:{session:null},error:null}),onAuthStateChange:()=>({data:{subscription:{unsubscribe(){}}}}),getUser:async()=>({data:{user:null},error:null}),signOut:async()=>({error:null})},storage:{from:()=>({getPublicUrl:()=>({data:{publicUrl:""}}),upload:async()=>({error:{message:"Storage disabled"}}),remove:async()=>({error:{message:"Storage disabled"}})})}};window.supabase={createClient:()=>client};window.NOVAAI_SUPABASE_CLIENT=client;})();`;}
const server=createServer((req,res)=>{
 const requestUrl=new URL(req.url,"http://127.0.0.1");
 if(requestUrl.pathname==="/retail.html"){
  let html=fs.readFileSync(path.resolve("retail.html"),"utf8");
  html=html.replace(/<script src="https:\/\/cdn\.jsdelivr\.net\/npm\/@supabase\/supabase-js@2"[^>]*><\/script>/i,'<script>'+retailMockScript(requestUrl.searchParams.has("no_description")?"":retailProduct.description)+'</script>');
  html=html.replace(/<script src="\.\/(?:nearby-search\.js|novaai-ad-slots\.js[^"]*|novaai-share-visits\.js[^"]*|novaai-product-sharing\.js[^"]*|novaai-storefront\.js[^"]*)"[^>]*><\/script>/gi,"");
  res.setHeader("Content-Type","text/html");res.end(html);return;
 }
 if(requestUrl.pathname==="/index.html"){
  let html=fs.readFileSync(path.resolve("index.html"),"utf8");
  const homeMock='<script>(()=>{const wait=ms=>new Promise(resolve=>setTimeout(resolve,ms));const client={auth:{onAuthStateChange:()=>({data:{subscription:{unsubscribe(){}}}}),getSession:async()=>({data:{session:null},error:null})},from:table=>({select(){return this},eq(){return this},maybeSingle:()=>new Promise(resolve=>setTimeout(()=>resolve({data:null,error:null}),1200)),order(){return this},then(resolve,reject){return Promise.resolve({data:[],error:null}).then(resolve,reject)}}),rpc:async()=>({data:null,error:null})};window.supabase={createClient:()=>client};})();</script>';
  html=html.replace('<script src="https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2"></script>',homeMock);
  html=html.replace(/<script src="[^"]+"><\/script>/gi,"");
  res.setHeader("Content-Type","text/html");res.end(html);return;
 }
 if(requestUrl.pathname!=="/store-page.html"){res.writeHead(404);res.end("Not found");return;}
 const userId=requestUrl.searchParams.get("test_user")||"customer-1";
 const options={delayProducts:Number(requestUrl.searchParams.get("delay_products")||0),delayLocation:Number(requestUrl.searchParams.get("delay_location")||0),missingLogo:requestUrl.searchParams.get("missing_logo")==="1",failProducts:requestUrl.searchParams.get("fail_products")==="1"};
 let html=fs.readFileSync(path.resolve("store-page.html"),"utf8");
 const storefrontSource=fs.readFileSync(path.resolve("novaai-storefront.js"),"utf8");
 html=html.replace('<script src="https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2"></script>','<script>'+mockScript(userId,options)+'</script>');
 html=html.replace(/<script src="\.\/novaai-storefront\.js(?:\?[^"]*)?"><\/script>/i,'<script>'+storefrontSource+'</script>');
 res.setHeader("Content-Type","text/html");res.end(html);
});
await new Promise(resolve=>server.listen(0,"127.0.0.1",resolve));
const baseFile="http://127.0.0.1:"+server.address().port+"/store-page.html?store=raider-retail";
fs.mkdirSync("artifacts",{recursive:true});
after(()=>new Promise(resolve=>server.close(resolve)));
const products=[
 {id:101,name:"Retail item",price:120,category:"Clothing",image_url:"",images:[],seller_id:"seller-1",status:"approved"},
 {id:102,name:"Property item",price:950000,category:"Property For Sale",image_url:"",images:[],seller_id:"seller-1",status:"approved"}
];
function mockScript(userId="customer-1",options={}){
 return "(() => {" +
  "const userId="+JSON.stringify(userId)+";" +
  "window.__testControl="+JSON.stringify(options)+";const wait=ms=>new Promise(resolve=>setTimeout(resolve,ms));" +
  "const store={id:'store-1',user_id:'seller-1',store_name:'Raider Retail',store_slug:'raider-retail',phone:'012 555 0101',status:'approved',store_logo_url:null,store_banner_url:'data:image/gif;base64,R0lGODlhAQABAAD/ACwAAAAAAQABAAACADs='};" +
  "const likes=new Set(['customer-existing']),follows=new Set(['customer-existing','customer-two']);" +
  "const data="+JSON.stringify(products)+";" +
  "const result=(table,filters)=>table==='seller_stores'?[store]:table==='Products'?data.filter(p=>Object.entries(filters).every(([k,v])=>p[k]===v)):[];" +
  "window.__storeState={likes,follows};" +
  "window.__client={auth:{getUser:async()=>({data:{user:{id:userId}},error:null})}," +
  "rpc:async()=>({data:[{likes_count:likes.size,followers_count:follows.size,liked:likes.has(userId),following:follows.has(userId)}],error:null})," +
  "from(table){const q={table,filters:{},action:'select',columns:'',select(columns){this.columns=columns||'';return this},eq(k,v){this.filters[k]=v;return this}," +
  "order:async()=>{if(table==='Products'){await wait(window.__testControl.delayProducts||0);if(window.__testControl.failProducts)return {data:null,error:{message:'simulated product query failure'}};}return {data:result(table,q.filters),error:null}}, " +
  "maybeSingle:async()=>{if(table==='seller_stores'&&window.__testControl.missingLogo&&q.columns.includes('store_logo_url'))return {data:null,error:{message:'column store_logo_url does not exist'}};if(table==='seller_public_locations')await wait(window.__testControl.delayLocation||0);return {data:table==='seller_stores'?store:(q.filters.customer_id===userId&&(table==='seller_store_likes'?likes.has(userId):follows.has(userId))?{store_user_id:'seller-1'}:null),error:null}}, " +
  "insert:async()=>{(table==='seller_store_likes'?likes:follows).add(userId);return {error:null}},delete(){this.action='delete';return this}," +
  "then(resolve,reject){if(this.action==='delete')(table==='seller_store_likes'?likes:follows).delete(userId);return Promise.resolve({data:null,error:null}).then(resolve,reject)}};return q;}};" +
  "window.supabase={createClient:()=>window.__client};})();";
}
async function openPage(browser,userId,viewport){
 const page=await browser.newPage({viewport});
 const pageErrors=[];
 page.on("pageerror",error=>pageErrors.push(error.message));
 page.on("console",message=>{if(message.type()==="error")pageErrors.push(message.text());});
 page.setDefaultTimeout(10000);
 await page.goto(baseFile+"&test_user="+encodeURIComponent(userId),{waitUntil:"domcontentloaded"});
 try{
  await page.waitForSelector(".nova-store-identity h1",{timeout:8000});
  await page.waitForSelector("#novaStoreProducts .nova-store-product",{timeout:8000});
 }catch(error){
  const state=await page.locator("#novaStorePage").textContent().catch(()=>" <missing store root>");
  throw new Error("Store Page did not render: "+state+"; browser errors: "+pageErrors.join(" | "));
 }
 return page;
}
test("Store Page renders approved identity, public phone, product details and accurate counts",async()=>{
 const browser=await chromium.launch({headless:true});
 try{
  const page=await openPage(browser,"customer-1",{width:393,height:852});
  assert.equal(await page.locator("h1").textContent(),"Raider Retail");
  assert.match(await page.locator(".nova-store-public-whatsapp").getAttribute("href"),/functions\/v1\/property-contact-action\?listing_id=101&action=whatsapp/);
  assert.equal(await page.locator(".nova-store-public-whatsapp").getAttribute("aria-label"),"Contact this store on WhatsApp");
  assert.equal(await page.locator("#storeLikeCount").textContent(),"1");
  assert.equal(await page.locator("#storeFollowerCount").textContent(),"2");
  assert.equal(await page.locator(".nova-store-product").count(),2);
  assert.ok(await page.locator("#storeLikeButton svg").count());
  assert.ok(await page.locator("#storeFollowButton svg").count());
  await page.screenshot({path:"artifacts/pr39-store-page-engagement-393.png",fullPage:true});
  assert.match(await page.locator(".nova-store-product a").nth(0).getAttribute("href"),/index\.html\?product=101/);
  assert.match(await page.locator(".nova-store-product a").nth(1).getAttribute("href"),/property-details\.html\?id=102/);
  assert.equal(await page.locator("body").evaluate(el=>el.innerText.includes("delivery_address")),false);
  await page.close();
 }finally{await browser.close();}
});
test("Customers can like/unlike and follow/unfollow without duplicate relationships",async()=>{
 const browser=await chromium.launch({headless:true});
 try{
  const page=await openPage(browser,"customer-1",{width:360,height:800});
  await page.locator("#storeLikeButton").click();
  assert.equal(await page.locator("#storeLikeButton").textContent(),"Liked");
  assert.equal(await page.locator("#storeLikeCount").textContent(),"2");
  await page.locator("#storeLikeButton").click();
  assert.equal(await page.locator("#storeLikeButton").textContent(),"Like Store");
  assert.equal(await page.locator("#storeLikeCount").textContent(),"1");
  await page.locator("#storeFollowButton").click();
  assert.equal(await page.locator("#storeFollowButton").textContent(),"Following");
  assert.equal(await page.locator("#storeFollowerCount").textContent(),"3");
  await page.locator("#storeFollowButton").click();
  assert.equal(await page.locator("#storeFollowButton").textContent(),"Follow Store");
  assert.equal(await page.locator("#storeFollowerCount").textContent(),"2");
  await page.close();
 }finally{await browser.close();}
});
test("A seller cannot like or follow their own store and mobile layout does not overflow",async()=>{
 const browser=await chromium.launch({headless:true});
 try{
  const page=await openPage(browser,"seller-1",{width:360,height:800});
  assert.equal(await page.locator("#storeLikeButton").isDisabled(),true);
  assert.equal(await page.locator("#storeFollowButton").isDisabled(),true);
  const dimensions=await page.evaluate(()=>({width:innerWidth,scroll:document.documentElement.scrollWidth}));
  assert.ok(dimensions.scroll<=dimensions.width+1,JSON.stringify(dimensions));
  await page.close();
 }finally{await browser.close();}
});


test("Retail product-detail modal clearly explains when a seller has not supplied a description",async()=>{
 const browser=await chromium.launch({headless:true});
 try{
  const page=await browser.newPage({viewport:{width:393,height:852},deviceScaleFactor:1,isMobile:true,hasTouch:true});
  await page.goto("http://127.0.0.1:"+server.address().port+"/retail.html?no_description=1",{waitUntil:"domcontentloaded"});
  await waitForRetailMarketplace(page);
  await page.locator('[data-open-product="db-40"]').click();
  await page.waitForSelector("#productModal.open");
  assert.equal(await page.locator("#modalProductDescription").textContent(),"The seller has not supplied a product description.");
  await page.close();
 }finally{await browser.close();}
});

test("Retail product-detail modal fits a 360px Android viewport without horizontal overflow",async()=>{
 const browser=await chromium.launch({headless:true});
 try{
  const page=await browser.newPage({viewport:{width:360,height:800},deviceScaleFactor:1,isMobile:true,hasTouch:true});
  const errors=[];page.on("pageerror",e=>errors.push(e.message));
  await page.goto("http://127.0.0.1:"+server.address().port+"/retail.html",{waitUntil:"domcontentloaded"});
  await waitForRetailMarketplace(page);
  await page.locator('[data-open-product="db-40"]').click();
  await page.waitForSelector("#productModal.open");
  const dimensions=await page.evaluate(()=>({width:innerWidth,scroll:document.documentElement.scrollWidth,modal:document.querySelector("#productModal .product-modal-card")?.getBoundingClientRect().width}));
  assert.ok(dimensions.scroll<=dimensions.width+1,JSON.stringify(dimensions));
  assert.ok(dimensions.modal<=dimensions.width+1,JSON.stringify(dimensions));
  assert.equal(await page.locator("#modalProductDescription").textContent(),"T shirt");
  assert.equal(await page.locator("#modalProductVideo").isHidden(),true);
  assert.deepEqual(errors,[]);
  await page.close();
 }finally{await browser.close();}
});

test("Retail product-detail modal renders an approved listing and captures a responsive screenshot",async()=>{
 const browser=await chromium.launch({headless:true});
 try{
  const page=await browser.newPage({viewport:{width:393,height:852},deviceScaleFactor:1,isMobile:true,hasTouch:true});
  const errors=[];page.on("pageerror",e=>errors.push(e.message));
  await page.goto("http://127.0.0.1:"+server.address().port+"/retail.html",{waitUntil:"domcontentloaded"});
  await waitForRetailMarketplace(page);
  await page.locator('[data-open-product="db-40"]').click();
  await page.waitForSelector("#productModal.open");
  assert.equal(await page.locator("#modalProductName").textContent(),"Test Black T-Shirt");
  assert.equal(await page.locator("#modalProductDescription").textContent(),"T shirt");
  assert.equal(await page.locator("#modalSellerName").textContent(),"Raider Retail");
  assert.match(await page.locator("#modalSellerLocation").textContent(),/Centurion, Pretoria, Gauteng/);
  assert.equal(await page.locator("#modalProductVideo").isHidden(),true);
  assert.ok(await page.locator("#modalCallSeller svg").count());
  assert.ok(await page.locator("#modalWhatsAppSeller svg").count());
  await page.screenshot({path:"artifacts/pr39-retail-product-detail-393.png",fullPage:true});
  assert.deepEqual(errors,[]);
  await page.close();
 }finally{await browser.close();}
});



test("Store Page reveals its identity while delayed location and products load",async()=>{
 const browser=await chromium.launch({headless:true});
 try{
  const page=await browser.newPage({viewport:{width:393,height:852}});
  await page.goto(baseFile+"&delay_products=700&delay_location=900",{waitUntil:"domcontentloaded"});
  await page.waitForSelector(".nova-store-identity h1");
  assert.equal(await page.locator(".nova-store-identity h1").textContent(),"Raider Retail");
  assert.equal(await page.locator("#novaStoreProducts .nova-store-loading").count(),1);
  assert.equal(await page.locator("#novaStoreProducts .nova-store-product").count(),0);
  await page.waitForSelector("#novaStoreProducts .nova-store-product");
  await page.close();
 }finally{await browser.close();}
});

test("Store Page retains its banner when the optional logo column is unavailable",async()=>{
 const browser=await chromium.launch({headless:true});
 try{
  const page=await browser.newPage({viewport:{width:393,height:852}});
  await page.goto(baseFile+"&missing_logo=1",{waitUntil:"domcontentloaded"});
  await page.waitForSelector(".nova-store-identity h1");
  assert.equal(await page.locator(".nova-store-banner img").count(),1);
  assert.equal(await page.locator(".nova-store-identity h1").textContent(),"Raider Retail");
  await page.close();
 }finally{await browser.close();}
});

test("Store Page refresh keeps the currently rendered identity visible until replacement products finish",async()=>{
 const browser=await chromium.launch({headless:true});
 try{
  const page=await openPage(browser,"customer-1",{width:390,height:844});
  await page.evaluate(()=>{
   window.__oldStoreIdentity=document.querySelector(".nova-store-identity");
   window.__testControl.delayProducts=650;
   document.dispatchEvent(new Event("DOMContentLoaded"));
  });
  await page.waitForTimeout(120);
  assert.equal(await page.evaluate(()=>window.__oldStoreIdentity?.isConnected),true,"existing identity must remain connected during refresh");
  assert.equal(await page.locator(".nova-store-product").count(),2,"existing products must remain visible during refresh");
  await page.waitForFunction(()=>document.querySelector(".nova-store-identity")!==window.__oldStoreIdentity);
  assert.equal(await page.locator(".nova-store-product").count(),2);
  await page.close();
 }finally{await browser.close();}
});

test("Store Page shows a recoverable product message when the products request fails",async()=>{
 const browser=await chromium.launch({headless:true});
 try{
  const page=await browser.newPage({viewport:{width:360,height:800}});
  await page.goto(baseFile+"&fail_products=1",{waitUntil:"domcontentloaded"});
  await page.waitForSelector(".nova-store-identity h1");
  await page.waitForSelector("#novaStoreProducts .nova-store-empty[role=status]");
  assert.match(await page.locator("#novaStoreProducts").textContent(),/could not be loaded/i);
  assert.equal(await page.locator(".nova-store-identity h1").textContent(),"Raider Retail");
  const dimensions=await page.evaluate(()=>({width:innerWidth,scroll:document.documentElement.scrollWidth}));
  assert.ok(dimensions.scroll<=dimensions.width+1,JSON.stringify(dimensions));
  await page.close();
 }finally{await browser.close();}
});

test("Store Page layout has no horizontal overflow at 360px and 390px",async()=>{
 const browser=await chromium.launch({headless:true});
 try{
  for(const width of [360,390]){
   const page=await openPage(browser,"customer-1",{width,height:844});
   const dimensions=await page.evaluate(()=>({width:innerWidth,scroll:document.documentElement.scrollWidth}));
   assert.ok(dimensions.scroll<=dimensions.width+1,JSON.stringify(dimensions));
   await page.close();
  }
 }finally{await browser.close();}
});


test("Homepage product route shows the skeleton immediately and hides homepage sections while data is delayed",async()=>{
 const browser=await chromium.launch({headless:true});
 try{
  const page=await browser.newPage({viewport:{width:360,height:800},reducedMotion:"reduce"});
  const errors=[];page.on("pageerror",error=>errors.push(error.message));
  await page.goto("http://127.0.0.1:"+server.address().port+"/index.html?product=101",{waitUntil:"domcontentloaded"});
  await page.waitForSelector(".product-loading-shell");
  await page.waitForTimeout(180);
  assert.equal(await page.locator(".product-loading-shell").count(),1);
  assert.match(await page.locator(".product-loading-status").textContent(),/Loading approved product details/);
  assert.equal(await page.locator("body").evaluate(el=>el.classList.contains("product-view-active")),true);
  for(const selector of [".home-search-wrap",".nova-hero-carousel","#novaAiLaunchCard",".home-category-tiles",".home-seller-banner"]){
   const node=page.locator(selector).first();
   if(await node.count())assert.equal(await node.evaluate(el=>getComputedStyle(el).display==="none"||el.hidden),true,selector+" should be hidden");
  }
  const dimensions=await page.evaluate(()=>({width:innerWidth,scroll:document.documentElement.scrollWidth}));
  assert.ok(dimensions.scroll<=dimensions.width+1,JSON.stringify(dimensions));
  assert.deepEqual(errors,[]);
  await page.close();
 }finally{await browser.close();}
});

test("Advertising boards hide stale fallback creative until the campaign feed resolves",async()=>{
 const browser=await chromium.launch({headless:true});
 try{
  const page=await browser.newPage({viewport:{width:393,height:852}});
  const adSource=fs.readFileSync(path.resolve("novaai-ad-slots.js"),"utf8");
  await page.setContent('<!doctype html><html class="nova-ads-pending"><head><style>.nova-ads-pending [data-nova-ad-slot]{position:relative;visibility:visible;background:#174ea6}.nova-ads-pending [data-nova-ad-slot] *{visibility:hidden}.nova-ads-pending [data-nova-ad-slot]::after{content:"Loading advertisements…";position:absolute;inset:0;display:grid;place-items:center}</style></head><body><div data-nova-ad-slot="cart_banner"><strong>Old fallback headline</strong><span>Old fallback copy</span></div></body></html>');
  await page.evaluate(()=>{
   window.__campaignRequestStarted=false;
   window.fetch=()=>{window.__campaignRequestStarted=true;return new Promise(()=>{});};
   window.__novaAdsRevealBoards=()=>document.documentElement.classList.remove("nova-ads-pending");
  });
  await page.addScriptTag({content:adSource});
  assert.equal(await page.evaluate(()=>window.__campaignRequestStarted),true,"live campaign request should have started");
  assert.equal(await page.locator('[data-nova-ad-slot="cart_banner"] strong').evaluate(el=>getComputedStyle(el).visibility),"hidden","stale fallback text must not flash while refresh is pending");
  assert.equal(await page.locator("html").evaluate(el=>el.classList.contains("nova-ads-pending")),true,"loading gate stays active until the campaign feed settles");
  await page.close();
 }finally{await browser.close();}
});


test("All nine advertising boards keep one stable fallback without legacy carousel timers",async()=>{
 const browser=await chromium.launch({headless:true});
 try{
  const page=await browser.newPage({viewport:{width:393,height:852}});
  const errors=[];page.on("pageerror",error=>errors.push(error.message));
  const ids=["home_hero","shop_tv","cart_banner","wishlist_banner","motors_banner","property_banner","shop_footer","motors_footer","property_footer"];
  const markup=ids.map(id=>'<section data-nova-ad-slot="'+id+'"><strong>Fallback '+id+'</strong></section>').join("");
  await page.setContent('<!doctype html><html><head></head><body>'+markup+'</body></html>');
  await page.evaluate(()=>{window.fetch=async()=>({ok:true,text:async()=>"[]"});});
  const adSource=fs.readFileSync(path.resolve("novaai-ad-slots.js"),"utf8");
  await page.addScriptTag({content:adSource});
  await page.waitForFunction(()=>window.NOVAAI_ADS&&document.querySelectorAll("[data-nova-ad-slot]").length===9);
  await page.waitForTimeout(100);
  const before=await page.locator("[data-nova-ad-slot]").evaluateAll(nodes=>nodes.map(node=>node.textContent.trim()));
  await page.waitForTimeout(5300);
  const after=await page.locator("[data-nova-ad-slot]").evaluateAll(nodes=>nodes.map(node=>node.textContent.trim()));
  assert.deepEqual(await page.evaluate(()=>window.NOVAAI_ADS.getPlacements().map(item=>item.slot_id)),ids);
  assert.deepEqual(after,before,"fallback headlines must remain stable rather than being replaced by old rotations");
  assert.equal(await page.locator(".nova-live-controls,.nova-live-onair,.nova-live-dots").count(),0);
  assert.deepEqual(errors,[]);
  await page.close();
 }finally{await browser.close();}
});


test("Motors refresh preserves only cards belonging to the active market",async()=>{
 const source=fs.readFileSync(path.resolve("seller-motors-houses.html"),"utf8");
 const start=source.indexOf("async function loadListings(marketType, searchQuery = '')");
 const end=source.indexOf("\n}\n\nlet motorsPartCategory",start);
 assert.ok(start>=0&&end>start,"Motors/Property listing loader must be present");
 const loader=source.slice(start,end+2);
 const setup=`
 let listingLoadRun=0;
 const listingCache=Object.create(null),listingCacheAt=Object.create(null),listingPending=Object.create(null);
 let approvedStoreIdsCache=null,approvedStoreIdsCacheAt=0,approvedStoreIdsPending=null;
 let publicSellerLocationsById=Object.create(null);
 const MARKET_DATA_TTL=30000;
 const rows=[{id:501,name:"Toyota car battery",description:"Car battery",price:1200,category:"Auto",seller_id:"seller-1",seller_name:"Test seller"}];
 let failProducts=true;
 class Query{
  constructor(table){this.table=table;this.filters=[];}
  select(){return this;}
  eq(k,v){this.filters.push(x=>String(x[k])===String(v));return this;}
  in(k,values){this.filters.push(x=>(values||[]).map(String).includes(String(x[k])));return this;}
  order(){return this;}
  then(resolve,reject){
   if(this.table==="Products"&&failProducts)return Promise.reject(new Error("simulated refresh failure")).then(resolve,reject);
   const data=(this.table==="Products"?rows:this.table==="seller_stores"?[{user_id:"seller-1"}]:[]).filter(x=>this.filters.every(fn=>fn(x)));
   return Promise.resolve({data,error:null}).then(resolve,reject);
  }
 }
 const sb={from:table=>new Query(table)};
 const grid=document.createElement("div");grid.id="productGrid";document.body.append(grid);
 const stat=document.createElement("span");stat.id="statCount";document.body.append(stat);
 const documentGet=document.getElementById.bind(document);
 document.getElementById=id=>id==="productGrid"?grid:id==="statCount"?stat:documentGet(id);
 function renderMotorsParts(items){grid.innerHTML=items.map(x=>'<article class="motors-part-card" data-product-id="'+x.id+'"></article>').join("");}
 function applyPropertyFilters(){}
 `;
 const browser=await chromium.launch({headless:true});
 try{
  const page=await browser.newPage({viewport:{width:393,height:852}});
  await page.setContent("<html><body></body></html>");
  await page.addScriptTag({content:setup+loader});
  const sameMarket=await page.evaluate(async()=>{
   const grid=document.getElementById("productGrid");grid.dataset.listingMarket="motors";grid.innerHTML='<article class="motors-part-card" data-product-id="old-motors"></article>';
   await loadListings("motors");
   return {oldCard:!!grid.querySelector('[data-product-id="old-motors"]'),error:!!grid.querySelector('[role="alert"]'),text:grid.textContent};
  });
  assert.equal(sameMarket.oldCard,true,"same-market cards must remain visible after a failed background refresh");
  assert.equal(sameMarket.error,false,"a refresh failure must not replace same-market cards with an error");
  const switchedMarket=await page.evaluate(async()=>{
   const grid=document.getElementById("productGrid");grid.dataset.listingMarket="property";grid.innerHTML='<article class="property-card" data-product-id="old-property"></article>';
   await loadListings("motors");
   return {oldProperty:!!grid.querySelector(".property-card"),motorsLoading:grid.textContent.includes("Loading listings"),error:grid.querySelector('[role="alert"]')?.textContent||""};
  });
  assert.equal(switchedMarket.oldProperty,false,"previous-market cards must be cleared on market switch");
  assert.equal(switchedMarket.motorsLoading,false,"failed market switch should end in an error, not a permanent loader");
  assert.match(switchedMarket.error,/Listings could not be loaded/);
  await page.close();
 }finally{await browser.close();}
});
