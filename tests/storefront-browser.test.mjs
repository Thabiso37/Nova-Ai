import test, {after} from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import {createServer} from "node:http";
import {chromium} from "playwright";

const retailProduct={id:40,name:"Test Black T-Shirt",category:"Office & Stationery",price:200,seller_name:"Nova Test Store",seller_id:"seller-1",status:"approved",description:"T shirt",image_url:"",images:[]};
const retailStore={user_id:"seller-1",store_name:"Raider Retail",store_slug:"raider-retail",description:"",phone:"012 555 0101",status:"approved"};
const retailLocation={user_id:"seller-1",province:"Gauteng",city:"Pretoria",suburb:"Centurion",public_location_enabled:true,approval_status:"approved"};
function retailMockScript(){return `(()=>{const tables={Products:[${JSON.stringify(retailProduct)}],seller_stores:[${JSON.stringify(retailStore)}],seller_public_locations:[${JSON.stringify(retailLocation)}]};class Q{constructor(t){this.t=t;this.filters=[];}select(){return this;}eq(k,v){this.filters.push(x=>String(x[k])===String(v));return this;}in(k,vs){this.filters.push(x=>(vs||[]).map(String).includes(String(x[k])));return this;}order(){return this;}rows(){return (tables[this.t]||[]).filter(x=>this.filters.every(f=>f(x)));}maybeSingle(){return Promise.resolve({data:this.rows()[0]||null,error:null});}then(resolve,reject){return Promise.resolve({data:this.rows(),error:null}).then(resolve,reject);}}const client={from:t=>new Q(t),rpc:async()=>({data:null,error:{message:"RPC disabled in browser fixture"}}),auth:{getSession:async()=>({data:{session:null},error:null}),onAuthStateChange:()=>({data:{subscription:{unsubscribe(){}}}}),getUser:async()=>({data:{user:null},error:null}),signOut:async()=>({error:null})},storage:{from:()=>({getPublicUrl:()=>({data:{publicUrl:""}}),upload:async()=>({error:{message:"Storage disabled"}}),remove:async()=>({error:{message:"Storage disabled"}})})}};window.supabase={createClient:()=>client};window.NOVAAI_SUPABASE_CLIENT=client;})();`;}
const server=createServer((req,res)=>{
 const requestUrl=new URL(req.url,"http://127.0.0.1");
 if(requestUrl.pathname==="/retail.html"){
  let html=fs.readFileSync(path.resolve("retail.html"),"utf8");
  html=html.replace(/<script src="https:\/\/cdn\.jsdelivr\.net\/npm\/@supabase\/supabase-js@2"[^>]*><\/script>/i,'<script>'+retailMockScript()+'</script>');
  html=html.replace(/<script src="\.\/(?:nearby-search\.js|novaai-ad-slots\.js[^"]*|novaai-share-visits\.js[^"]*|novaai-product-sharing\.js[^"]*|novaai-storefront\.js[^"]*)"[^>]*><\/script>/gi,"");
  res.setHeader("Content-Type","text/html");res.end(html);return;
 }
 if(requestUrl.pathname!=="/store-page.html"){res.writeHead(404);res.end("Not found");return;}
 const userId=requestUrl.searchParams.get("test_user")||"customer-1";
 let html=fs.readFileSync(path.resolve("store-page.html"),"utf8");
 const storefrontSource=fs.readFileSync(path.resolve("novaai-storefront.js"),"utf8");
 html=html.replace('<script src="https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2"></script>','<script>'+mockScript(userId)+'</script>');
 html=html.replace('<script src="./novaai-storefront.js?v=1"></script>','<script>'+storefrontSource+'</script>');
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
function mockScript(userId="customer-1"){
 return "(() => {" +
  "const userId="+JSON.stringify(userId)+";" +
  "const store={id:'store-1',user_id:'seller-1',store_name:'Raider Retail',store_slug:'raider-retail',phone:'012 555 0101',status:'approved',store_logo_url:null,store_banner_url:null};" +
  "const likes=new Set(['customer-existing']),follows=new Set(['customer-existing','customer-two']);" +
  "const data="+JSON.stringify(products)+";" +
  "const result=(table,filters)=>table==='seller_stores'?[store]:table==='Products'?data.filter(p=>Object.entries(filters).every(([k,v])=>p[k]===v)):[];" +
  "window.__storeState={likes,follows};" +
  "window.__client={auth:{getUser:async()=>({data:{user:{id:userId}},error:null})}," +
  "rpc:async()=>({data:[{likes_count:likes.size,followers_count:follows.size,liked:likes.has(userId),following:follows.has(userId)}],error:null})," +
  "from(table){const q={table,filters:{},action:'select',select(){return this},eq(k,v){this.filters[k]=v;return this}," +
  "order:async()=>({data:result(table,q.filters),error:null})," +
  "maybeSingle:async()=>({data:table==='seller_stores'?store:(q.filters.customer_id===userId&&(table==='seller_store_likes'?likes.has(userId):follows.has(userId))?{store_user_id:'seller-1'}:null),error:null})," +
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
  assert.match(await page.locator(".nova-store-contact").textContent(),/012 555 0101/);
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


test("Retail product-detail modal fits a 360px Android viewport without horizontal overflow",async()=>{
 const browser=await chromium.launch({headless:true});
 try{
  const page=await browser.newPage({viewport:{width:360,height:800},deviceScaleFactor:1,isMobile:true,hasTouch:true});
  const errors=[];page.on("pageerror",e=>errors.push(e.message));
  await page.goto("http://127.0.0.1:"+server.address().port+"/retail.html",{waitUntil:"domcontentloaded"});
  await page.waitForFunction(()=>document.getElementById("dbStatus")?.textContent.includes("REAL MARKETPLACE CONNECTED"));
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
  await page.waitForFunction(()=>document.getElementById("dbStatus")?.textContent.includes("REAL MARKETPLACE CONNECTED"));
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
