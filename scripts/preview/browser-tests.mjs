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
  if(item.file!=="index.html")await page.waitForFunction(()=>!!window.NOVAAIProductShare,null,{timeout:10000});
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
