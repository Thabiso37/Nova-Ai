import assert from "node:assert/strict";
import fs from "node:fs";
import http from "node:http";
import path from "node:path";
import { chromium } from "playwright";

const root=path.resolve("preview-dist");
const requiredPages=["index.html","retail.html","seller-motors-houses.html","property-details.html"];
for(const file of requiredPages)assert(fs.existsSync(path.join(root,file)),"Missing generated page: "+file);
const mime={".html":"text/html; charset=utf-8",".js":"text/javascript; charset=utf-8",".css":"text/css; charset=utf-8",".svg":"image/svg+xml",".json":"application/json"};
const server=http.createServer((req,res)=>{
 let pathname;
 try{pathname=decodeURIComponent(new URL(req.url,"http://127.0.0.1").pathname)}catch{res.writeHead(400).end();return}
 const target=path.resolve(root,"."+pathname);
 if(!target.startsWith(root+path.sep)){res.writeHead(403).end();return}
 fs.readFile(target,(err,data)=>{if(err){res.writeHead(404).end("Not found");return}res.writeHead(200,{"content-type":mime[path.extname(target)]||"application/octet-stream","cache-control":"no-store"});res.end(data)});
});
await new Promise(resolve=>server.listen(0,"127.0.0.1",resolve));
const address=server.address();
const origin="http://127.0.0.1:"+address.port;
const productionPattern=url=>{
 let u;try{u=new URL(url)}catch{return false}
 return /nxplffvklkopwfjaqexo/i.test(u.href) ||
  /(^|\.)supabase\.co$/i.test(u.hostname) ||
  /(^|\.)supabase\.com$/i.test(u.hostname) ||
  /\/(rest|auth|storage|functions|realtime)\/v1(?:\/|$)/i.test(u.pathname) ||
  /record-novaai-product-share|product[-_/]?share[-_/]?analytics/i.test(u.href);
};
const attempts=new Set();
const failures=[];
let browser;
try{
 browser=await chromium.launch({headless:true});
 const context=await browser.newContext();
 await context.route("**/*",async route=>{
  const url=route.request().url();
  if(productionPattern(url)){attempts.add(url);await route.abort("blockedbyclient");return}
  const parsed=new URL(url);
  if(parsed.origin!==origin){await route.abort("blockedbyclient");return}
  await route.continue();
 });
 context.routeWebSocket("**/*",socketRoute=>{
  const url=socketRoute.url();
  if(productionPattern(url))attempts.add(url);
  socketRoute.close();
 });
 await context.addInitScript(()=>{
  window.__nativeShareCalls=[];
  window.__clipboardWrites=[];
  Object.defineProperty(navigator,"share",{configurable:true,writable:true,value:async payload=>{window.__nativeShareCalls.push(payload)}});
  Object.defineProperty(navigator,"clipboard",{configurable:true,value:{writeText:async value=>{window.__clipboardWrites.push(String(value))}}});
 });
 const cases=[
  {file:"index.html",query:""},
  {file:"retail.html",query:""},
  {file:"seller-motors-houses.html",query:"?market=motors"},
  {file:"seller-motors-houses.html",query:"?market=property"},
  {file:"property-details.html",query:"?id=910003"}
 ];
 const pages=[];
 for(const item of cases){
  const page=await context.newPage();
  page.on("request",req=>{if(productionPattern(req.url()))attempts.add(req.url())});
  page.on("pageerror",err=>failures.push(item.file+": "+err.message));
  const response=await page.goto(origin+"/"+item.file+item.query,{waitUntil:"domcontentloaded",timeout:15000});
  assert(response&&response.ok(),item.file+" did not return HTTP success");
  await page.waitForFunction(()=>document.readyState==="complete",null,{timeout:10000});
  await page.waitForFunction(()=>window.__NOVAAI_PREVIEW__===true&&!!window.supabase,null,{timeout:10000});
  await page.waitForFunction(()=>!!window.NOVAAIProductShare,null,{timeout:10000});
  assert.equal(await page.locator("#novaai-preview-banner").count(),1,item.file+" missing isolated preview banner");
  assert.equal(new URL(page.url()).origin,origin,"Page did not use the local preview origin");
  const mutations=await page.evaluate(async()=>{
   const c=window.supabase.createClient();
   const results=[
    await c.from("Products").insert({name:"forbidden"}),
    await c.from("Products").update({name:"forbidden"}),
    await c.from("Products").delete(),
    await c.from("Products").upsert({name:"forbidden"}),
    await c.rpc("place_order"),
    await c.auth.signInWithPassword({email:"test@example.invalid",password:"not-a-real-password"}),
    await c.auth.signUp({email:"test@example.invalid",password:"not-a-real-password"}),
    await c.auth.updateUser({email:"test@example.invalid"}),
    await c.auth.resetPasswordForEmail("test@example.invalid"),
    await c.storage.from("listing-images").upload("forbidden.txt",new Blob(["x"])),
    await c.storage.from("listing-images").remove(["forbidden.txt"])
   ];
   return results.map(x=>x&&x.error&&x.error.code);
  });
  assert.equal(mutations.length,11,item.file+" did not exercise every guarded mutation/auth/storage operation");
  assert(mutations.every(code=>code==="PREVIEW_DISABLED"),item.file+" exposed a database/auth/storage mutation path");
  pages.push({page,file:item.file});
  console.log("PASS page load + isolated fixture + mutation denial: "+item.file);
 }
 const homePage=pages.find(x=>x.file==="index.html").page;
 await homePage.waitForFunction(()=>!!document.querySelector(".home-product-card .home-product-share"),null,{timeout:10000});
 assert.equal(await homePage.locator(".home-category-tile").count(),4,"Home must show the four approved category shortcuts");
 const categoryLabels=await homePage.locator(".home-category-tile .home-category-label").allTextContents();
 assert.deepEqual(categoryLabels.map(x=>x.trim()),["Property","Cars","Retail","More"],"Category destinations must follow the approved order and labels");
 assert.equal(await homePage.locator(".home-category-tile .home-category-image img").count(),4,"Every category destination must retain an image element");
 const categoryGeometry=await homePage.locator(".home-category-tile").first().evaluate(el=>{const r=el.getBoundingClientRect(),ir=el.querySelector("img").getBoundingClientRect();return {width:r.width,height:r.height,imageWidth:ir.width,imageHeight:ir.height}});
 assert(categoryGeometry.width>categoryGeometry.height,"Category destinations must be large landscape image tiles");
 assert(categoryGeometry.imageWidth>=categoryGeometry.width-2&&categoryGeometry.imageHeight>=categoryGeometry.height-2,"Category imagery must fill the complete destination tile");
 assert.equal(await homePage.locator('[data-home-category="premium-properties"] .home-property-card').count(),3,"Home must render three synthetic property cards");
 assert.equal(await homePage.locator('[data-home-category="featured-products"] .home-product-card').count(),4,"Home must render the synthetic retail product cards");
 const productCard=homePage.locator('[data-home-category="featured-products"] .home-product-card').first();
 assert.equal(await productCard.locator(".home-product-heading h3").count(),1,"Product name must use the redesigned heading region");
 assert.equal(await productCard.locator(".home-product-seller-block").count(),1,"Seller information must use the dedicated seller region");
 assert.equal(await productCard.locator(".home-product-buy-row .home-product-price").count(),1,"Product price must remain visible in the action footer");
 assert.equal(await productCard.locator(".home-product-share[data-nova-product-share]").count(),1,"Existing product sharing hook must be preserved");
 assert.equal(await productCard.locator(".home-add-cart[data-add-product]").count(),1,"Existing add-to-cart hook must be preserved");
 assert.equal(await productCard.locator(".home-wishlist-toggle[data-home-wishlist]").count(),1,"Existing wishlist hook must be preserved");
 const cardGeometry=await productCard.evaluate(el=>{const r=el.getBoundingClientRect(),photo=el.querySelector(".home-product-photo").getBoundingClientRect();return {width:r.width,height:r.height,photoWidth:photo.width,photoHeight:photo.height}});
 const categoryReference=await homePage.locator(".home-category-tile").first().evaluate(el=>{const r=el.getBoundingClientRect();return {width:r.width,height:r.height}});
 assert(Math.abs(cardGeometry.width-categoryReference.width)<=4,"Desktop product-card width must match category-tile width");
 assert(Math.abs(cardGeometry.height/categoryReference.height-1.2)<=.035,"Desktop product card must extend category-tile height by approximately 20%");
 assert(cardGeometry.photoWidth>cardGeometry.photoHeight*1.2,"Product photography must remain visually prominent");

 const brandColors=await homePage.locator(".logo .nova-ai").evaluate(el=>({nova:getComputedStyle(el).color,ai:getComputedStyle(el.querySelector("span")).color}));
 assert.notEqual(brandColors.nova,brandColors.ai,"NOVAAI brand letters must use contrasting NOVA and AI colours");
 const desktopStyle=await homePage.locator(".home-carousel").first().evaluate(el=>({overflow:getComputedStyle(el).overflowX,snap:getComputedStyle(el).scrollSnapType,scrollbar:getComputedStyle(el).scrollbarWidth}));
 assert.equal(desktopStyle.overflow,"auto","Product carousels must use natural horizontal scrolling");
 assert.match(desktopStyle.snap,/x mandatory/,"Product carousels must use horizontal snap");
 assert.equal(desktopStyle.scrollbar,"none","Product carousels must hide traditional scrollbars");
 assert.equal(await homePage.locator(".home-carousel .carousel-arrow, .home-carousel .swipe-instruction, .home-carousel .scroll-indicator").count(),0,"Product carousels must not show arrows or swipe instructions");
 console.log("PASS 2080 Home structure, Trust Shield, brand hierarchy and horizontal carousel styling");
 fs.mkdirSync("preview-screenshots",{recursive:true});
 const desktopShot=await homePage.screenshot({path:"preview-screenshots/home-desktop.png",fullPage:true});
 const mobileContext=await browser.newContext({viewport:{width:390,height:844},deviceScaleFactor:1,isMobile:true,hasTouch:true});
 const mobilePage=await mobileContext.newPage();
 mobilePage.on("request",req=>{if(productionPattern(req.url()))attempts.add(req.url())});
 mobilePage.on("pageerror",err=>failures.push("mobile Home: "+err.message));
 await mobilePage.goto(origin+"/index.html",{waitUntil:"domcontentloaded",timeout:15000});
 await mobilePage.waitForFunction(()=>document.readyState==="complete"&&!!document.querySelector('[data-home-category="premium-properties"] .home-property-card'),null,{timeout:10000});
 const mobilePeek=await mobilePage.locator('[data-home-category="premium-properties"] .home-carousel').evaluate(el=>{
  const cards=[...el.querySelectorAll(".home-product-card")],box=el.getBoundingClientRect(),a=cards[0]?.getBoundingClientRect(),c=cards[2]?.getBoundingClientRect();
  const tile=document.querySelector(".home-category-tile")?.getBoundingClientRect();
  return {width:box.width,overflow:getComputedStyle(el).overflowX,firstFits:!!a&&a.left>=box.left&&a.right<=box.right,thirdPeeks:!!c&&c.left<box.right&&c.right>box.right,cardWidth:a?.width,cardHeight:a?.height,tileWidth:tile?.width,tileHeight:tile?.height};
 });
 assert.equal(mobilePeek.overflow,"auto","Android product carousel must remain touch-scrollable");
 assert.equal(mobilePeek.firstFits,true,"First property card must fit within the mobile carousel");
 assert.equal(mobilePeek.thirdPeeks,true,"Next product card must be partially visible after the two category-width cards on Android");
 assert(Math.abs(mobilePeek.cardWidth-mobilePeek.tileWidth)<=4,"Android product-card width must match category-tile width");
 assert(Math.abs(mobilePeek.cardHeight/mobilePeek.tileHeight-1.2)<=.04,"Android product card must extend category-tile height by approximately 20%");
 await mobilePage.screenshot({path:"preview-screenshots/home-android.png",fullPage:true});
 const tabletContext=await browser.newContext({viewport:{width:820,height:1180},deviceScaleFactor:1});
 const tabletPage=await tabletContext.newPage();
 tabletPage.on("request",req=>{if(productionPattern(req.url()))attempts.add(req.url())});
 await tabletPage.goto(origin+"/index.html",{waitUntil:"domcontentloaded",timeout:15000});
 await tabletPage.waitForFunction(()=>document.readyState==="complete"&&!!document.querySelector(".home-category-tile"),null,{timeout:10000});
 await tabletPage.screenshot({path:"preview-screenshots/home-tablet.png",fullPage:true});
 await mobilePage.close();await tabletPage.close();await mobileContext.close();await tabletContext.close();
 const homeLayout=await homePage.evaluate(()=>{
  const share=document.querySelector(".home-product-card .home-product-share");
  const cart=document.querySelector(".home-product-card .home-add-cart");
  if(!share||!cart)return null;
  const a=share.getBoundingClientRect(),b=cart.getBoundingClientRect();
  return {shareBeforeCart:!!(share.compareDocumentPosition(cart)&Node.DOCUMENT_POSITION_FOLLOWING),sameRow:Math.abs(a.top-b.top)<3,shareX:a.left,cartX:b.left};
 });
 assert(homeLayout&&homeLayout.shareBeforeCart&&homeLayout.sameRow&&homeLayout.shareX<homeLayout.cartX,"Home/Retail Share must sit immediately before the unchanged cart control on the same row");
 console.log("PASS Home/Retail card Share is immediately left of Cart");

 const retailCardPage=pages.find(x=>x.file==="retail.html").page;
 await retailCardPage.waitForFunction(()=>!!document.querySelector("#products .product-open-card .actions .nova-product-share-card"),null,{timeout:10000});
 const retailLayout=await retailCardPage.evaluate(()=>{
  const card=document.querySelector("#products .product-open-card"),share=card&&card.querySelector(".actions .nova-product-share-card"),cart=card&&card.querySelector(".actions .shop-card-cart");
  if(!share||!cart)return null;const a=share.getBoundingClientRect(),b=cart.getBoundingClientRect();
  return {shareBeforeCart:!!(share.compareDocumentPosition(cart)&Node.DOCUMENT_POSITION_FOLLOWING),sameRow:Math.abs(a.top-b.top)<3,shareX:a.left,cartX:b.left};
 });
 assert(retailLayout&&retailLayout.shareBeforeCart&&retailLayout.sameRow&&retailLayout.shareX<retailLayout.cartX,"Retail Share must sit immediately left of Cart on the same row");
 console.log("PASS Retail listing-card Share is immediately left of Cart");

 const motorsCardPage=pages.find(x=>x.file==="seller-motors-houses.html"&&x.page.url().includes("market=motors")).page;
 await motorsCardPage.waitForFunction(()=>!!document.querySelector(".vehicle-card .motor-gallery .nova-product-share-card"),null,{timeout:10000});
 const motorsLayout=await motorsCardPage.evaluate(()=>{
  const share=document.querySelector(".vehicle-card .motor-gallery .nova-product-share-card"),gallery=document.querySelector(".vehicle-card .motor-gallery");
  if(!share||!gallery)return null;const s=getComputedStyle(share),r=share.getBoundingClientRect(),g=gallery.getBoundingClientRect();
  return {insidePhoto:gallery.contains(share),absolute:s.position==="absolute",top:Math.round(r.top-g.top),left:Math.round(r.left-g.left)};
 });
 assert(motorsLayout&&motorsLayout.insidePhoto&&motorsLayout.absolute&&motorsLayout.top<=9&&motorsLayout.left<=9,"Motors Share must sit at the top-left inside the listing photo");
 console.log("PASS Motors listing-card Share is at the top-left of the photo");

 const propertyCardPage=pages.find(x=>x.file==="seller-motors-houses.html"&&x.page.url().includes("market=property")).page;
 await propertyCardPage.waitForFunction(()=>!!document.querySelector(".property-card .property-card-gallery .nova-product-share-card"),null,{timeout:10000});
 const propertyLayout=await propertyCardPage.evaluate(()=>{
  const share=document.querySelector(".property-card .property-card-gallery .nova-product-share-card"),gallery=document.querySelector(".property-card .property-card-gallery");
  if(!share||!gallery)return null;const s=getComputedStyle(share),r=share.getBoundingClientRect(),g=gallery.getBoundingClientRect();
  return {insidePhoto:gallery.contains(share),absolute:s.position==="absolute",top:Math.round(r.top-g.top),left:Math.round(r.left-g.left)};
 });
 assert(propertyLayout&&propertyLayout.insidePhoto&&propertyLayout.absolute&&propertyLayout.top<=9&&propertyLayout.left<=9,"Property Share must sit at the top-left inside the listing photo");
 console.log("PASS Property listing-card Share is at the top-left of the photo");

 const sharePage=pages.find(x=>x.file==="retail.html").page;
 const shareData=await sharePage.evaluate(()=>{
  if(typeof window.retailShareButton!=="function")throw new Error("Retail share URL builder is not available");
  const markup=window.retailShareButton({dbId:910001,name:"Preview Cotton T-Shirt",price:249,publicLocation:"Pretoria"});
  const holder=document.createElement("div");holder.innerHTML=markup;
  const button=holder.querySelector("[data-nova-product-share]");
  if(!button||!button.dataset.shareUrl)throw new Error("Retail share URL builder did not produce a share control");
  return button.dataset.shareUrl;
 });
 const shareUrl=new URL(shareData);
 assert.equal(shareUrl.origin,origin,"Retail product share URL does not use the preview origin");
 assert.match(shareUrl.pathname,/retail\.html$/,"Unexpected Retail product share URL path");
 console.log("PASS Retail share URL builder resolves against preview origin");

 const motorsPage=pages.find(x=>x.file==="seller-motors-houses.html").page;
 const marketUrls=await motorsPage.evaluate(()=>{
  if(typeof window.marketShareButton!=="function")throw new Error("Motors/Property share URL builder is not available");
  const make=(market,id)=>{const html=window.marketShareButton({id,name:"Preview listing",price:100,seller_id:"fixture-motors"},market);const holder=document.createElement("div");holder.innerHTML=html;const button=holder.querySelector("[data-nova-product-share]");return button&&button.dataset.shareUrl};
  return {motors:make("motors",910002),property:make("property",910003)};
 });
 for(const [market,url] of Object.entries(marketUrls)){assert(url,"Missing "+market+" share URL");assert.equal(new URL(url).origin,origin,market+" share URL escaped the preview origin");}
 console.log("PASS Motors and Property share URL builders resolve against preview origin");

 const propertyPage=pages.find(x=>x.file==="property-details.html").page;
 await propertyPage.waitForFunction(()=>typeof window.propertyDetailShareButton==="function"&&window.propertyDetailShareButton().length>0,null,{timeout:10000});
 const propertyDetailUrl=await propertyPage.evaluate(()=>{
  if(typeof window.propertyDetailShareButton!=="function")throw new Error("Property detail share URL builder is not available");
  const html=window.propertyDetailShareButton();const holder=document.createElement("div");holder.innerHTML=html;const button=holder.querySelector("[data-nova-product-share]");return button&&button.dataset.shareUrl;
 });
 assert(propertyDetailUrl,"Property detail page did not generate a share URL");
 assert.equal(new URL(propertyDetailUrl).origin,origin,"Property detail share URL escaped the preview origin");
 console.log("PASS Property detail share URL resolves against preview origin");
 const nativeResult=await sharePage.evaluate(async(url)=>{
  const ok=await window.NOVAAIProductShare.share({title:"Preview product",price:"R249",url,productId:"910001",marketplace:"retail",shareLocation:"product_card"});
  return {ok,calls:window.__nativeShareCalls,clipboard:window.__clipboardWrites};
 },shareUrl.href);
 assert.equal(nativeResult.ok,true,"Native Web Share flow did not report success");
 assert.equal(nativeResult.calls.length,1,"Native Web Share mock was not called exactly once");
 assert.equal(nativeResult.calls[0].url,shareUrl.href,"Native share payload did not contain the preview-origin URL");
 assert.equal(nativeResult.clipboard.length,0,"Clipboard should not be used after successful native sharing");
 console.log("PASS native Web Share mock + preview-origin URL");

 const clipboardResult=await sharePage.evaluate(async(url)=>{
  navigator.share=async()=>{throw new Error("Native share unavailable in test")};
  const ok=await window.NOVAAIProductShare.share({title:"Preview product",price:"R249",url,productId:"910001",marketplace:"retail",shareLocation:"product_card"});
  return {ok,writes:window.__clipboardWrites};
 },shareUrl.href);
 assert.equal(clipboardResult.ok,true,"Clipboard fallback did not report success");
 assert.equal(clipboardResult.writes.length,1,"Clipboard fallback did not write exactly once");
 assert(clipboardResult.writes[0].includes(shareUrl.href),"Clipboard message did not include preview-origin URL");
 console.log("PASS clipboard fallback mock + preview-origin URL");

 const cancelResult=await sharePage.evaluate(async(url)=>{
  navigator.share=async()=>{const error=new Error("User cancelled");error.name="AbortError";throw error};
  const before=window.__clipboardWrites.length;
  const ok=await window.NOVAAIProductShare.share({title:"Preview product",price:"R249",url,productId:"910001",marketplace:"retail",shareLocation:"product_card"});
  return {ok,before,after:window.__clipboardWrites.length};
 },shareUrl.href);
 assert.equal(cancelResult.ok,false,"Native share cancellation should not report success");
 assert.equal(cancelResult.after,cancelResult.before,"Clipboard fallback should not run after user cancellation");
 console.log("PASS native share AbortError cancellation");

 for(const {page} of pages)await page.close();
 assert.equal(attempts.size,0,"Production Supabase/analytics request attempts detected: "+[...attempts].join(", "));
 assert.deepEqual(failures,[],"Browser page JavaScript errors: "+failures.join(" | "));
 console.log("PASS network isolation: zero attempted production Supabase REST/Auth/Storage/Functions/Realtime or analytics requests.");
 console.log("PASS browser isolation suite: 4 pages, 11 mutation/auth/storage denials per page, native share, clipboard fallback.");
}finally{
 if(browser)await browser.close();
 await new Promise(resolve=>server.close(resolve));
}
