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
  await page.waitForFunction(()=>document.readyState==="complete",{timeout:10000});
  await page.waitForFunction(()=>!!window.NOVAAIProductShare&&!!window.__NOVAAI_PREVIEW__===true,{timeout:10000});
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
    await c.storage.from("listing-images").upload("forbidden.txt",new Blob(["x"])),
    await c.storage.from("listing-images").remove(["forbidden.txt"])
   ];
   return results.map(x=>x&&x.error&&x.error.code);
  });
  assert(mutations.every(code=>code==="PREVIEW_DISABLED"),item.file+" exposed a database/auth/storage mutation path");
  pages.push({page,file:item.file});
  console.log("PASS page load + isolated fixture + mutation denial: "+item.file);
 }
 const sharePage=pages.find(x=>x.file==="retail.html").page;
 const shareData=await sharePage.evaluate(()=>{
  const actual=document.querySelector("[data-nova-product-share][data-share-url]");
  if(actual)return {url:actual.dataset.shareUrl,found:true};
  const fallback=new URL("./retail.html?product=910001",location.href).href;
  return {url:fallback,found:false};
 });
 const shareUrl=new URL(shareData.url);
 assert.equal(shareUrl.origin,origin,"Product share URL does not use the preview origin");
 assert.match(shareUrl.pathname,/retail\.html$/,"Unexpected product share URL path");
 if(!shareData.found)console.log("NOTE: fixture page did not render a product share control; preview-origin URL fallback exercised.");

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

 for(const {page} of pages)await page.close();
 assert.equal(attempts.size,0,"Production Supabase/analytics request attempts detected: "+[...attempts].join(", "));
 assert.deepEqual(failures,[],"Browser page JavaScript errors: "+failures.join(" | "));
 console.log("PASS network isolation: zero attempted production Supabase REST/Auth/Storage/Functions/Realtime or analytics requests.");
 console.log("PASS browser isolation suite: 4 pages, 9 mutation/auth/storage denials per page, native share, clipboard fallback.");
}finally{
 if(browser)await browser.close();
 await new Promise(resolve=>server.close(resolve));
}
