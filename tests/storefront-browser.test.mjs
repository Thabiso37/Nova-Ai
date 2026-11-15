import test, {after} from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import {createServer} from "node:http";
import {chromium} from "playwright";

const server=createServer((req,res)=>{
 const pathname=new URL(req.url,"http://127.0.0.1").pathname;
 const target=pathname==="/novaai-storefront.js"?"novaai-storefront.js":pathname==="/store-page.html"?"store-page.html":null;
 if(!target){res.writeHead(404);res.end("Not found");return;}
 res.setHeader("Content-Type",target.endsWith(".js")?"application/javascript":"text/html");
 res.end(fs.readFileSync(path.resolve(target)));
});
await new Promise(resolve=>server.listen(0,"127.0.0.1",resolve));
const file="http://127.0.0.1:"+server.address().port+"/store-page.html?store=raider-retail";
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
  "order:async()=>({data:result(table,this.filters),error:null})," +
  "maybeSingle:async()=>({data:table==='seller_stores'?store:(this.filters.customer_id===userId&&(table==='seller_store_likes'?likes.has(userId):follows.has(userId))?{store_user_id:'seller-1'}:null),error:null})," +
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
 await page.addInitScript(mockScript(userId));
 await page.route(/supabase-js/,route=>route.fulfill({status:200,contentType:"application/javascript",body:"window.supabase={createClient:()=>window.__client};"}));
 await page.route("https://nxplffvklkopwfjaqexo.supabase.co/**",route=>route.abort());
 await page.goto(file,{waitUntil:"domcontentloaded"});
 try{
  await page.waitForSelector(".nova-store-identity h1",{timeout:8000});
  await page.waitForSelector("#novaStoreProducts .nova-store-product",{timeout:8000});
 }catch(error){
  const state=await page.locator("#novaStorePage").textContent().catch(()=>"<missing store root>");
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
