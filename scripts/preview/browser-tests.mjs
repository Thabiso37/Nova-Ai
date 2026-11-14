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
const address=server.address(),origin="http://127.0.0.1:"+address.port;

const allowedPublicStorageImage=request=>{
 let u;try{u=new URL(request.url())}catch{return false}
 return request.method()==="GET"&&u.hostname==="nxplffvklkopwfjaqexo.supabase.co"&&u.pathname.startsWith("/storage/v1/object/public/Nova%20AI/");
};
const productionPattern=(url,method="GET")=>{
 let u;try{u=new URL(url)}catch{return false}
 const publicImage=method==="GET"&&u.hostname==="nxplffvklkopwfjaqexo.supabase.co"&&u.pathname.startsWith("/storage/v1/object/public/Nova%20AI/");
 return !publicImage&&(/nxplffvklkopwfjaqexo/i.test(u.href)||/(^|\.)supabase\.(co|com)$/i.test(u.hostname)||/\/(rest|auth|functions|realtime)\/v1(?:\/|$)/i.test(u.pathname)||/record-novaai-product-share|product[-_/]?share[-_/]?analytics/i.test(u.href));
};
const attempts=new Set(),failures=[];
let browser;
try{
 browser=await chromium.launch({headless:true,executablePath:process.env.NOVAAI_CHROMIUM_PATH||undefined});
 const context=await browser.newContext({viewport:{width:1280,height:900},deviceScaleFactor:1});
 await context.route("**/*",async route=>{
  const url=route.request().url();
  if(productionPattern(url,route.request().method())){attempts.add(url);await route.abort("blockedbyclient");return}
  const parsed=new URL(url);
  if(parsed.origin!==origin&&!allowedPublicStorageImage(route.request())){await route.abort("blockedbyclient");return}
  await route.continue();
 });
 context.routeWebSocket("**/*",socketRoute=>{
  const url=socketRoute.url();if(productionPattern(url,"GET"))attempts.add(url);socketRoute.close();
 });
 await context.addInitScript(()=>{
  window.__nativeShareCalls=[];window.__clipboardWrites=[];
  Object.defineProperty(navigator,"share",{configurable:true,writable:true,value:async payload=>{window.__nativeShareCalls.push(payload)}});
  Object.defineProperty(navigator,"clipboard",{configurable:true,value:{writeText:async value=>{window.__clipboardWrites.push(String(value))}}});
 });
 const cases=[
  {file:"index.html",query:""},
  {file:"retail.html",query:""},
  {file:"seller-motors-houses.html",query:"?market=motors"},
  {file:"seller-motors-houses.html",query:"?market=property"},
  {file:"property-details.html",query:"?id=61"}
 ];
 const pages=[];
 for(const item of cases){
  const page=await context.newPage();
  page.on("request",req=>{if(productionPattern(req.url(),req.method()))attempts.add(req.url())});
  page.on("pageerror",err=>failures.push(item.file+": "+err.message));
  const response=await page.goto(origin+"/"+item.file+item.query,{waitUntil:"domcontentloaded",timeout:20000});
  assert(response&&response.ok(),item.file+" did not return HTTP success");
  await page.waitForFunction(()=>document.readyState==="complete",null,{timeout:15000});
  await page.waitForFunction(()=>window.__NOVAAI_PREVIEW__===true&&!!window.supabase,null,{timeout:10000});
  await page.waitForFunction(()=>!!window.NOVAAIProductShare,null,{timeout:10000});
  assert.equal(await page.locator("#novaai-preview-banner").count(),1,item.file+" missing isolated-preview warning");
  assert.equal(new URL(page.url()).origin,origin,"Page escaped the isolated preview origin");
  const guarded=await page.evaluate(async()=>{
   const c=window.supabase.createClient();
   const values=[
    await c.from("Products").insert({name:"blocked"}),await c.from("Products").update({name:"blocked"}),
    await c.from("Products").delete(),await c.from("Products").upsert({name:"blocked"}),
    await c.rpc("place_order"),await c.auth.signInWithPassword({email:"x",password:"x"}),
    await c.auth.signUp({email:"x",password:"x"}),await c.auth.updateUser({email:"x"}),
    await c.auth.resetPasswordForEmail("x"),await c.storage.from("listing-images").upload("x",new Blob(["x"])),
    await c.storage.from("listing-images").remove(["x"])
   ];
   return values.map(v=>v?.error?.code);
  });
  assert.equal(guarded.length,11,item.file+" did not exercise every blocked mutation");
  assert(guarded.every(code=>code==="PREVIEW_DISABLED"),item.file+" exposed a mutation/auth/storage path");
  pages.push({page,...item});
  console.log("PASS isolated page + actual listing snapshot + 11 mutation/auth/storage denials: "+item.file+item.query);
 }

 const home=pages.find(x=>x.file==="index.html").page;
 const reference=await browser.newPage({viewport:{width:1280,height:900}});
 const referenceResponse=await reference.goto("https://novaai-home-0851cf9-preview.onrender.com/",{waitUntil:"domcontentloaded",timeout:30000});
 assert(referenceResponse&&referenceResponse.ok(),"Live approved Preview 2 reference could not be loaded for currency comparison");
 await reference.waitForSelector(".home-product-card",{timeout:20000});
 const referencePrices=await reference.locator(".home-product-card").allInnerTexts();
 console.log("LIVE APPROVED REFERENCE CARD TEXT: "+referencePrices.join(" || "));
 fs.mkdirSync("preview-screenshots",{recursive:true});
 const captureSection=async(page,selector,name)=>{
  const el=page.locator(selector);
  await el.waitFor({state:"visible",timeout:15000});
  await el.evaluate(async section=>{
   const images=[...section.querySelectorAll(".home-product-photo img")];
   images.forEach(img=>{img.loading="eager";});
   await Promise.all(images.map(async img=>{
    if(!img.complete) await new Promise(resolve=>{img.addEventListener("load",resolve,{once:true});img.addEventListener("error",resolve,{once:true});setTimeout(resolve,12000);});
    if(img.complete&&img.naturalWidth>0) await img.decode().catch(()=>{});
   }));
  });
  await el.screenshot({path:"preview-screenshots/"+name+".png"});
  return el.evaluate(section=>{
   const card=section.querySelector(".home-product-card");
   const photo=card?.querySelector(".home-product-photo");
   const info=card?.querySelector(".home-product-info");
   const rect=e=>{if(!e)return null;const r=e.getBoundingClientRect();return {x:r.x,y:r.y,width:r.width,height:r.height}};
   const style=e=>e?{fontFamily:getComputedStyle(e).fontFamily,fontSize:getComputedStyle(e).fontSize,fontWeight:getComputedStyle(e).fontWeight,lineHeight:getComputedStyle(e).lineHeight,color:getComputedStyle(e).color,background:getComputedStyle(e).backgroundColor}:null;
   return {sectionText:section.innerText,section:rect(section),card:rect(card),photo:rect(photo),info:rect(info),cardStyle:style(card),nameStyle:style(card?.querySelector(".home-product-name")),priceStyle:style(card?.querySelector(".home-product-price")),images:[...section.querySelectorAll(".home-product-card")].map(c=>({id:c.getAttribute("data-open-home-product"),name:c.querySelector(".home-product-name")?.textContent?.trim(),price:c.querySelector(".home-product-price")?.textContent?.trim(),src:c.querySelector(".home-product-photo img")?.currentSrc||"",srcAttribute:c.querySelector(".home-product-photo img")?.getAttribute("src")||"",loading:c.querySelector(".home-product-photo img")?.loading||"",naturalWidth:c.querySelector(".home-product-photo img")?.naturalWidth||0,naturalHeight:c.querySelector(".home-product-photo img")?.naturalHeight||0,complete:c.querySelector(".home-product-photo img")?.complete??false}))};
  });
 };
 const refPremium=await captureSection(reference,'[data-home-category="premium-properties"]',"reference-premium-properties");
 const refFeatured=await captureSection(reference,'[data-home-category="featured-products"]',"reference-featured-products");
 console.log("VISUAL METRICS LIVE REFERENCE PREMIUM: "+JSON.stringify(refPremium));
 console.log("VISUAL METRICS LIVE REFERENCE FEATURED: "+JSON.stringify(refFeatured));
 const restoredPremium=await captureSection(home,'[data-home-category="premium-properties"]',"restoration-premium-properties");
 const restoredFeatured=await captureSection(home,'[data-home-category="featured-products"]',"restoration-featured-products");
 console.log("VISUAL METRICS RESTORATION PREMIUM: "+JSON.stringify(restoredPremium));
 console.log("VISUAL METRICS RESTORATION FEATURED: "+JSON.stringify(restoredFeatured));
 const compareImageSources=(referenceSection,restoredSection,ids)=>{
  for(const id of ids){
   const original=referenceSection.images.find(image=>image.id===id);
   const restored=restoredSection.images.find(image=>image.id===id);
   assert(original&&restored,"Approved reference/restoration listing image record missing for listing "+id);
   assert.equal(restored.srcAttribute,original.srcAttribute,"Listing "+id+" image URL differs from approved Preview 2: reference="+original.srcAttribute+" restoration="+restored.srcAttribute);
   if(original.srcAttribute){
    assert(original.naturalWidth>0&&original.naturalHeight>0,"Approved Preview 2 reference image did not load for listing "+id+": "+JSON.stringify(original));
    assert(restored.naturalWidth>0&&restored.naturalHeight>0,"Restoration image did not load for listing "+id+": "+JSON.stringify(restored));
   }
  }
 };
 console.log("APPROVED REFERENCE IMAGE SOURCES PREMIUM: "+JSON.stringify(refPremium.images));
 console.log("APPROVED REFERENCE IMAGE SOURCES FEATURED: "+JSON.stringify(refFeatured.images));
 console.log("RESTORATION IMAGE SOURCES PREMIUM: "+JSON.stringify(restoredPremium.images));
 console.log("RESTORATION IMAGE SOURCES FEATURED: "+JSON.stringify(restoredFeatured.images));
 compareImageSources(refPremium,restoredPremium,["61"]);
 compareImageSources(refFeatured,restoredFeatured,["40"]);
 for(const section of ["premium-properties","featured-products"]){
  const locator=reference.locator('[data-home-category="'+section+'"]');
  console.log("LIVE APPROVED REFERENCE SECTION "+section+" COUNT: "+await locator.count());
  if(await locator.count())console.log("LIVE APPROVED REFERENCE SECTION "+section+" TEXT: "+await locator.first().innerText());
 }
 const referencePriceTokens=referencePrices.join("\n").match(/R\s*[\d,]+\.\d{2}/g)||[];
 assert(referencePriceTokens.length>=5,"Approved Preview 2 reference did not expose the expected decimal-point South African listing prices");
 assert(referencePriceTokens.includes("R 185.00")&&referencePriceTokens.includes("R 500.00")&&referencePriceTokens.includes("R 200.00")&&referencePriceTokens.includes("R 50.00")&&referencePriceTokens.includes("R 7.00"),"Approved Preview 2 reference prices differ from the reviewed listing values: "+referencePriceTokens.join(", "));
 console.log("PASS approved Preview 2 reference currency: decimal point; rendered examples: "+referencePriceTokens.slice(0,5).join(", "));
 const restoredPrices=await home.locator(".home-product-card").allInnerTexts();
 const restoredPriceTokens=restoredPrices.join("\n").match(/R\s*[\d,]+\.\d{2}/g)||[];
 assert.deepEqual(restoredPriceTokens,referencePriceTokens,"Restoration listing prices/formatting must exactly match the original approved Preview 2 reference");
 await reference.close();
 await home.waitForSelector(".home-product-card .home-product-share",{timeout:15000});
 const labels=(await home.locator(".home-category-tile .home-category-label").allTextContents()).map(x=>x.trim());
 assert.deepEqual(labels,["Retail","Motors","Property","More"],"Actual Preview 2 category order must be Retail, Motors, Property, More");
 const hero=home.locator(".nova-hero-carousel");
 const heroState=await hero.evaluate(el=>({visibility:getComputedStyle(el).visibility,display:getComputedStyle(el).display,width:el.getBoundingClientRect().width,height:el.getBoundingClientRect().height,text:el.textContent}));
 assert.notEqual(heroState.visibility,"hidden","Preview 2 Home promotional hero is still hidden");
 assert.notEqual(heroState.display,"none","Preview 2 Home promotional hero is not rendered");
 assert(heroState.width>500&&heroState.height>100,"Preview 2 Home promotional hero has no visible layout area");
 assert(heroState.text.includes("The Future is Here"),"First accepted Home hero message is missing");
 assert(heroState.text.includes("Great finds. Local businesses."),"Second accepted Home hero message is missing");
 assert(heroState.text.includes("Your products deserve a marketplace."),"Third accepted Home hero message is missing");
 assert.equal(await hero.locator(".nova-hero-slide").count(),3,"Home must render all three accepted promotional slides");
 assert.equal(await home.locator("#homeUseLocation").count(),1,"Header Near Me control missing");
 assert.equal(await home.locator(".home-seller-banner").count(),1,"Become a NOVAAI Seller banner missing");
 assert.equal(await home.locator("footer").count(),1,"Home footer missing");
 assert.equal(await home.locator(".nova-bottom-nav").count(),1,"Footer navigation missing");
 const forbiddenHomeTitles=["Nearby Retail Products","New Retail Arrivals","Nearby Motors Listings","Recently Added Vehicles","Featured Cars and Vehicles","Nearby Properties","Featured Properties for Sale","Featured Properties for Rent","Motors & Vehicles","Parts & Accessories"];
 const renderedHomeText=await home.locator("body").innerText();
 for(const title of forbiddenHomeTitles)assert(!renderedHomeText.includes(title),"Forbidden Home section is visible: "+title);
 const sectionTitles=await home.locator("[data-home-category] .section-kicker h2").allTextContents();
 assert.deepEqual(sectionTitles.slice(0,2).map(x=>x.trim()),["Premium Properties","Featured Products"],"Home section order must match actual Preview 2");
 const firstCard=home.locator(".home-product-card").first();
 assert.equal(await firstCard.locator(".home-product-share[data-nova-product-share]").count(),1,"Home product Share control is missing");
 assert.equal(await firstCard.locator(".home-add-cart[data-add-product]").count(),1,"Existing Home Add to Cart control is missing");
 assert.equal(await firstCard.locator(".home-wishlist-toggle[data-home-wishlist]").count(),1,"Existing Home wishlist control is missing");

 const desktopImageCount=await home.evaluate(async()=>{
  const images=[...document.querySelectorAll(".home-category-image img,.home-product-photo img")];
  images.forEach(img=>img.loading="eager");
  await Promise.all(images.map(img=>img.decode().catch(()=>{})));
  return images.filter(img=>img.naturalWidth>0&&img.naturalHeight>0).length;
 });
 assert(desktopImageCount>=3,"Desktop Preview 2 did not load the actual marketplace product images");
 const propertyCard=home.locator('[data-home-category="premium-properties"] .home-product-card').first();
 const retailCard=home.locator('[data-home-category="featured-products"] .home-product-card').first();
 const measure=async card=>card.evaluate(el=>{
  const c=el.getBoundingClientRect(),p=el.querySelector(".home-product-photo").getBoundingClientRect(),i=el.querySelector(".home-product-info").getBoundingClientRect();
  return {width:c.width,height:c.height,photoWidth:p.width,photoHeight:p.height,infoHeight:i.height,photoPosition:getComputedStyle(el.querySelector(".home-product-photo")).position,infoPosition:getComputedStyle(el.querySelector(".home-product-info")).position,photoBottom:p.bottom,infoTop:i.top};
 });
 const propertyGeometry=await measure(propertyCard),retailGeometry=await measure(retailCard);
 const retailHeights=await home.locator('[data-home-category="featured-products"] .home-product-card').evaluateAll(cards=>cards.map(el=>el.getBoundingClientRect().height));
 assert(Math.max(...retailHeights)-Math.min(...retailHeights)<=1,"Featured Products cards must have consistent heights");

 assert(Math.abs(propertyGeometry.width-225)<=2&&Math.abs(retailGeometry.width-225)<=2,"Desktop card widths do not match original Preview 2 dimensions");
 assert.equal(await propertyCard.locator(".home-add-cart").evaluate(el=>el.getBoundingClientRect().width),40,"Desktop cart control must retain the original 40px size");
 assert(Math.abs(propertyGeometry.photoHeight/propertyGeometry.photoWidth-1)<.015,"Premium Properties image ratio must match the original square photo");
 assert(Math.abs(propertyGeometry.height-415.84)<=2&&Math.abs(propertyGeometry.infoHeight-190.84)<=2,"Desktop Premium Properties card height/panel differs from Preview 2");
 assert(Math.abs(retailGeometry.photoHeight/retailGeometry.photoWidth-1)<.015,"Featured Products image ratio must match the original square photo");
 assert(Math.abs(retailGeometry.height-433.84)<=2&&Math.abs(retailGeometry.infoHeight-208.84)<=2,"Desktop Featured Products card height/panel differs from Preview 2");
 for(const g of [propertyGeometry,retailGeometry]){
  assert(g.photoPosition==="relative"&&g.infoPosition==="static","Preview 2 photo and information must remain separate normal-flow panels");
  assert(g.infoTop>=g.photoBottom-2&&g.infoHeight>=150,"Preview 2 information panel must remain below the image");
 }
 const propertyText=await propertyCard.innerText();
 const propertyExpected=["Property","PROPERTY","TRUST SHIELD","R 185.00"];
 const propertyMissing=propertyExpected.filter(value=>!propertyText.includes(value));
 const propertyFixture=await home.evaluate(()=>({product:window.__NOVAAI_PREVIEW_FIXTURES__?.products?.find(p=>String(p.id)==="61"),seller:window.__NOVAAI_PREVIEW_FIXTURES__?.sellers?.find(s=>s.user_id==="25e830fe-f387-4525-934e-af45fc6ac10f")}));
 assert.equal(propertyMissing.length,0,"Actual Premium Properties card is missing expected fields: "+JSON.stringify(propertyMissing)+". Rendered card text: "+JSON.stringify(propertyText)+". Snapshot records: "+JSON.stringify(propertyFixture));
 const retailText=await retailCard.innerText();
 assert(retailText.includes("test phone a12")&&retailText.includes("ACCESSORIES")&&retailText.includes("Alaska store")&&retailText.includes("TRUST SHIELD")&&retailText.includes("R 500.00"),"Actual Featured Products name/category/seller/Trust Shield/price are missing");
 const shareUrl=await firstCard.locator("[data-nova-product-share]").getAttribute("data-share-url");
 assert(shareUrl&&new URL(shareUrl).origin===origin,"Home product Share URL must remain inside isolated preview");
 const native=await home.evaluate(async url=>{
  const ok=await window.NOVAAIProductShare.share({title:"Preview product",price:"R1,250,000",url,productId:"61",marketplace:"property",shareLocation:"product_card"});
  return {ok,calls:window.__nativeShareCalls,clipboard:window.__clipboardWrites};
 },shareUrl);
 assert.equal(native.ok,true,"Native Web Share mock did not succeed");
 assert.equal(native.calls.length,1,"Native Web Share should be called exactly once");
 assert.equal(native.calls[0].url,shareUrl,"Native share did not use the isolated preview URL");
 assert.equal(native.clipboard.length,0,"Clipboard should not run after native share success");
 const clipboard=await home.evaluate(async url=>{
  navigator.share=async()=>{throw new Error("Native share unavailable")};
  const ok=await window.NOVAAIProductShare.share({title:"Preview product",price:"R1,250,000",url,productId:"61",marketplace:"property",shareLocation:"product_card"});
  return {ok,writes:window.__clipboardWrites};
 },shareUrl);
 assert.equal(clipboard.ok,true,"Clipboard fallback did not succeed");
 assert.equal(clipboard.writes.length,1,"Clipboard fallback should write exactly once");
 assert(clipboard.writes[0].includes(shareUrl),"Clipboard text did not include the isolated preview URL");
 const cancel=await home.evaluate(async url=>{
  navigator.share=async()=>{const e=new Error("Cancelled");e.name="AbortError";throw e};
  const before=window.__clipboardWrites.length;
  const ok=await window.NOVAAIProductShare.share({title:"Preview product",url,productId:"61",marketplace:"property",shareLocation:"product_card"});
  return {ok,before,after:window.__clipboardWrites.length};
 },shareUrl);
 assert.equal(cancel.ok,false,"Native share cancellation must not be recorded as success");
 assert.equal(cancel.after,cancel.before,"Clipboard must not run after a user cancellation");

 const wishlist=firstCard.locator(".home-wishlist-toggle");
 await wishlist.click();
 assert.equal(await wishlist.getAttribute("aria-pressed"),"true","Home wishlist action did not save the listing");
 assert((await home.evaluate(()=>JSON.parse(localStorage.getItem("novaWishlist")||"[]"))).includes("61"),"Wishlist did not persist the selected product");
 const cart=firstCard.locator(".home-add-cart");
 await cart.click();
 const cartData=await home.evaluate(()=>JSON.parse(localStorage.getItem("novaMarketplaceCartV1")||"[]"));
 assert(cartData.length>0,"Home Add to Cart did not persist the selected product");
 console.log("PASS original Preview 2 Home hero, real listing names/categories/sellers/Trust Shield/prices, square 225px desktop / 163.8px mobile cards, native sharing, clipboard fallback, cancellation, cart and wishlist");

 const retail=pages.find(x=>x.file==="retail.html").page;
 await retail.waitForFunction(()=>!!document.querySelector("#products .product-open-card .actions .nova-product-share-card"),null,{timeout:15000});
 const retailShare=retail.locator("#products .product-open-card .actions .nova-product-share-card").first();
 assert.equal(await retailShare.count(),1,"Retail listing-card Share control missing");
 const motors=pages.find(x=>x.file==="seller-motors-houses.html"&&x.query.includes("motors")).page;
 const motorCards=await motors.locator(".vehicle-card").count();
 if(motorCards===0){
  const motorBody=await motors.locator("body").innerText();
  assert(motorBody.includes("0 vehicles")&&motorBody.includes("There are no complete vehicle listings available in this category yet."),"Motors must accurately show the empty state when approved Auto records lack complete vehicle details");
  const motorShare=await motors.evaluate(async()=>{
   const url=new URL("./seller-motors-houses.html?market=motors&product=49",location.href).toString();
   const ok=await window.NOVAAIProductShare.share({title:"Car Dashboard Phone Mount",price:"R 755,00",url,productId:"49",marketplace:"motors",shareLocation:"product_card"});
   return {ok,calls:window.__nativeShareCalls};
  });
  assert.equal(motorShare.ok,true,"PR #35 share helper did not work with the actual approved Auto listing");
  assert.equal(motorShare.calls.length,1,"Motors share helper should call native sharing once");
  assert.equal(motorShare.calls[0].url,new URL("./seller-motors-houses.html?market=motors&product=49",motors.url()).toString(),"Motors share helper did not use the actual listing URL");
  console.log("PASS Motors: actual approved Auto records are incomplete, correct empty state shown; PR #35 share helper tested with actual listing ID 49");
 }else{
  await motors.waitForFunction(()=>!!document.querySelector(".vehicle-card .motor-gallery .nova-product-share-card"),null,{timeout:15000});
  console.log("PASS Motors listing-card Share control");
 }
 const property=pages.find(x=>x.file==="seller-motors-houses.html"&&x.query.includes("property")).page;
 await property.waitForFunction(()=>!!document.querySelector(".property-card .property-card-gallery .nova-product-share-card"),null,{timeout:15000});
 const detail=pages.find(x=>x.file==="property-details.html").page;
 await detail.waitForFunction(()=>typeof window.propertyDetailShareButton==="function"&&window.propertyDetailShareButton().length>0,null,{timeout:15000});
 console.log("PASS Retail and Property rendered Share controls; Property detail Share control; Motors share helper tested with actual Auto listing 49 (no complete vehicle card to render)");

 const mobileContext=await browser.newContext({viewport:{width:390,height:844},deviceScaleFactor:1,isMobile:true,hasTouch:true});
 await mobileContext.route("**/*",async route=>{
  const url=route.request().url();
  if(productionPattern(url,route.request().method())){attempts.add(url);await route.abort("blockedbyclient");return}
  const parsed=new URL(url);
  if(parsed.origin!==origin&&!allowedPublicStorageImage(route.request())){await route.abort("blockedbyclient");return}
  await route.continue();
 });
 const mobile=await mobileContext.newPage();
 mobile.on("pageerror",err=>failures.push("mobile Home: "+err.message));
 await mobile.goto(origin+"/index.html",{waitUntil:"domcontentloaded",timeout:20000});
 await mobile.waitForSelector(".home-product-card .home-product-share",{timeout:15000});
 const mobileImageCount=await mobile.evaluate(async()=>{
  const images=[...document.querySelectorAll(".home-category-image img,.home-product-photo img")];
  images.forEach(img=>img.loading="eager");
  await Promise.all(images.map(img=>img.decode().catch(()=>{})));
  return images.filter(img=>img.naturalWidth>0&&img.naturalHeight>0).length;
 });
 assert(mobileImageCount>=3,"Android Preview 2 did not load the actual marketplace product images");

 const mobileHero=await mobile.locator(".nova-hero-carousel").evaluate(el=>({display:getComputedStyle(el).display,visibility:getComputedStyle(el).visibility,height:el.getBoundingClientRect().height}));

 const mobileProperty=mobile.locator('[data-home-category="premium-properties"] .home-product-card').first();
 const mobileRetail=mobile.locator('[data-home-category="featured-products"] .home-product-card').first();
 const mobilePropertyGeometry=await measure(mobileProperty),mobileRetailGeometry=await measure(mobileRetail);
 const mobileRetailHeights=await mobile.locator('[data-home-category="featured-products"] .home-product-card').evaluateAll(cards=>cards.map(el=>el.getBoundingClientRect().height));
 assert(Math.max(...mobileRetailHeights)-Math.min(...mobileRetailHeights)<=1,"Android Featured Products cards must have consistent heights");

 assert(Math.abs(mobilePropertyGeometry.width-163.8)<=2&&Math.abs(mobileRetailGeometry.width-163.8)<=2,"Android card widths do not match original Preview 2 dimensions");
 assert.equal(await mobileProperty.locator(".home-add-cart").evaluate(el=>el.getBoundingClientRect().width),34,"Android cart control must retain the original 34px size");
 assert(Math.abs(mobilePropertyGeometry.photoHeight/mobilePropertyGeometry.photoWidth-1)<.02,"Android Premium Properties image ratio must be square");
 assert(Math.abs(mobilePropertyGeometry.height-361.58)<=2&&Math.abs(mobilePropertyGeometry.infoHeight-197.78)<=2,"Android Premium Properties card height/panel differs from Preview 2");
 assert(Math.abs(mobileRetailGeometry.photoHeight/mobileRetailGeometry.photoWidth-1)<.02,"Android Featured Products image ratio must be square");
 assert(Math.abs(mobileRetailGeometry.height-392.73)<=2&&Math.abs(mobileRetailGeometry.infoHeight-228.94)<=2,"Android Featured Products card height/panel differs from Preview 2");
 for(const g of [mobilePropertyGeometry,mobileRetailGeometry])assert(g.infoTop>=g.photoBottom-2&&g.infoHeight>=150,"Android information panel is not separate below its image");
 fs.mkdirSync("preview-screenshots",{recursive:true});
 await mobile.evaluate(()=>window.scrollTo(0,0));
 await home.evaluate(()=>window.scrollTo(0,0));
 await mobile.locator('[data-home-category="premium-properties"]').screenshot({path:"preview-screenshots/mobile-premium-properties-390.png"});
 await mobile.locator('[data-home-category="featured-products"]').screenshot({path:"preview-screenshots/mobile-featured-products-390.png"});
 await mobile.screenshot({path:"preview-screenshots/home-android-390.png",fullPage:true});
 await home.screenshot({path:"preview-screenshots/home-desktop-1280.png",fullPage:true});
 const mobileCardChecks=await mobile.evaluate(()=>[...document.querySelectorAll(".home-product-card")].map(card=>({id:card.dataset.openHomeProduct,price:card.querySelector(".home-product-price")?.textContent?.trim(),seller:(card.querySelector(".home-card-seller")?.textContent?.trim()||"").replace(/^✓\\s*/,""),image:card.querySelector(".home-product-photo img")?{src:card.querySelector(".home-product-photo img").currentSrc,width:card.querySelector(".home-product-photo img").naturalWidth,height:card.querySelector(".home-product-photo img").naturalHeight}:null,share:!!card.querySelector(".home-product-share"),wishlist:!!card.querySelector(".home-wishlist-toggle"),cart:!!card.querySelector(".home-add-cart")})));
 assert(mobileCardChecks.some(c=>c.id==="61"&&c.price==="R 185.00"&&c.seller==="Property"&&c.image?.width>0&&c.share&&c.wishlist&&c.cart),"Android Premium Properties image/price/seller/share/wishlist/cart validation failed: "+JSON.stringify(mobileCardChecks));
 assert(mobileCardChecks.some(c=>c.id==="63"&&c.price==="R 500.00"&&c.seller==="Alaska store"&&c.image?.width>0&&c.share&&c.wishlist&&c.cart),"Android Featured Products image/price/seller/share/wishlist/cart validation failed: "+JSON.stringify(mobileCardChecks));
 assert(mobileCardChecks.some(c=>c.id==="40"&&c.price==="R 200.00"&&c.seller==="Raider Retail"&&c.image?.width===720&&c.image?.height===1600),"Android second Featured Product image/price/seller validation failed: "+JSON.stringify(mobileCardChecks));
 const mobileWishlist=mobile.locator('[data-open-home-product="61"] .home-wishlist-toggle');
 await mobileWishlist.click();
 assert.equal(await mobileWishlist.getAttribute("aria-pressed"),"true","Android Wishlist control did not save the Premium Properties listing");
 assert((await mobile.evaluate(()=>JSON.parse(localStorage.getItem("novaWishlist")||"[]"))).includes("61"),"Android Wishlist did not persist the Premium Properties listing");
 const mobileCart=mobile.locator('[data-open-home-product="61"] .home-add-cart');
 await mobileCart.click();
 assert((await mobile.evaluate(()=>JSON.parse(localStorage.getItem("novaMarketplaceCartV1")||"[]"))).some(item=>String(item.product_id||item.id)==="61"),"Android Cart control did not persist the Premium Properties listing");
 console.log("ANDROID HOME CARD CHECKS: "+JSON.stringify(mobileCardChecks));
 console.log("PASS Android touch Wishlist and Cart interactions for approved listing 61");
 await mobileContext.close();
 assert.equal(attempts.size,0,"Production Supabase/analytics network attempts detected: "+[...attempts].join(", "));
 assert.deepEqual(failures,[],"Browser page JavaScript errors: "+failures.join(" | "));
 console.log("PASS rendered Preview 2 desktop/mobile comparison + 5-page browser isolation; zero production API/analytics requests; read-only public listing images only.");
}finally{
 if(browser)await browser.close();
 await new Promise(resolve=>server.close(resolve));
}
