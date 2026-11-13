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
async function auditHomeSections(page,label){
 const sections=await page.locator("[data-home-category]").evaluateAll(nodes=>nodes.map(section=>{const carousel=section.querySelector(".home-carousel"),cards=carousel?[...carousel.querySelectorAll(".home-product-card")]:[];return {id:section.dataset.homeCategory,hasCarousel:!!carousel,count:cards.length,overflow:carousel?getComputedStyle(carousel).overflowX:null,scrollWidth:carousel?carousel.scrollWidth:0,clientWidth:carousel?carousel.clientWidth:0};}));
 assert.equal(sections.length,9,label+" must contain all nine Home marketplace sections");
 for(const item of sections){
  if(!item.hasCarousel){assert.equal(item.count,0,label+" empty section unexpectedly contains cards: "+item.id);continue;}
  assert.equal(item.overflow,"auto",label+" section does not preserve horizontal scrolling: "+item.id);
  if(item.count>1&&item.scrollWidth>item.clientWidth){
   const moved=await page.locator('[data-home-category="'+item.id+'"] .home-carousel').evaluate(el=>{el.scrollLeft=el.scrollWidth;const moved=el.scrollLeft;el.scrollLeft=0;return moved;});
   assert(moved>0,label+" carousel could not move horizontally: "+item.id);
  }
 }
 console.log("PASS "+label+" all nine sections and horizontal carousel overflow/scroll behavior");
}
let browser;
try{
 browser=await chromium.launch({headless:true});
 const context=await browser.newContext();
 await context.route("**/*",async route=>{
  const url=route.request().url();
  if(productionPattern(url)){attempts.add(url);await route.abort("blockedbyclient");return}
  const parsed=new URL(url);
  if(parsed.origin!==origin&&parsed.hostname!=="images.unsplash.com"){await route.abort("blockedbyclient");return}
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
 assert.equal(await homePage.locator(".home-category-tile").count(),4,"Home must retain the four approved category shortcuts");
 const categoryLabels=await homePage.locator(".home-category-tile .home-category-label").allTextContents();
 assert.deepEqual(categoryLabels.map(x=>x.trim()),["Property","Cars","Retail","More"],"Approved category labels/order changed");
 const requiredSections=[
  ["retail-featured","Featured Retail Products"],["retail-nearby","Nearby Retail Products"],["retail-new","New Retail Arrivals"],
  ["motors-featured","Featured Cars and Vehicles"],["motors-nearby","Nearby Motors Listings"],["motors-new","Recently Added Vehicles"],
  ["property-sale","Featured Properties for Sale"],["property-rent","Featured Properties for Rent"],["property-nearby","Nearby Properties"]
 ];
 assert.equal(await homePage.locator('[data-home-category="property-sale"]').count(),1,"Canonical Property sale selector must be property-sale");
 assert.equal(await homePage.locator('[data-home-category="premium-properties"]').count(),0,"Stale premium-properties selector must not be used");
 for(const [id,title] of requiredSections){
  const section=homePage.locator('[data-home-category="'+id+'"]');
  assert.equal(await section.count(),1,"Missing Home marketplace section: "+title);
  assert.equal((await section.locator(".section-kicker h2").innerText()).trim(),title,"Incorrect section heading: "+title);
 }
 assert.equal(await homePage.locator('[data-home-category="retail-featured"] .home-product-card').count(),4,"Retail featured cards must use synthetic Retail records");
 assert.equal(await homePage.locator('[data-home-category="motors-featured"] .home-product-card').count(),1,"Motors featured cards must use synthetic vehicle records");
 assert.equal(await homePage.locator('[data-home-category="property-sale"] .home-product-card').count(),2,"Property sale cards must use synthetic sale records");
 assert.equal(await homePage.locator('[data-home-category="property-rent"] .home-product-card').count(),1,"Property rental cards must use synthetic rental records");
 for(const id of ["retail-nearby","motors-nearby","property-nearby"]){
  assert.equal(await homePage.locator('[data-home-category="'+id+'"] .home-nearby-action').count(),1,"Nearby section missing location action: "+id);
  assert.equal(await homePage.locator('[data-home-category="'+id+'"] .home-product-card').count(),0,"Nearby section must not invent listings before location lookup: "+id);
 }
 const productCard=homePage.locator('[data-home-category="retail-featured"] .home-product-card').first();
 assert.equal(await productCard.locator(".home-product-heading h3").count(),1,"Product name missing");
 assert.equal(await productCard.locator(".home-product-seller-block").count(),1,"Seller information missing");
 assert.equal(await productCard.locator(".home-product-buy-row .home-product-price").count(),1,"Product price missing");
 assert.equal(await productCard.locator(".home-product-share[data-nova-product-share]").count(),1,"Existing share hook missing");
 assert.equal(await productCard.locator(".home-add-cart[data-add-product]").count(),1,"Existing cart hook missing");
 assert.equal(await productCard.locator(".home-wishlist-toggle[data-home-wishlist]").count(),1,"Existing wishlist hook missing");
 const overlayGeometry=await productCard.evaluate(el=>{
  const card=el.getBoundingClientRect(),photo=el.querySelector(".home-product-photo"),info=el.querySelector(".home-product-info"),img=photo.getBoundingClientRect(),ir=info.getBoundingClientRect();
  return {width:card.width,height:card.height,photoPosition:getComputedStyle(photo).position,photoWidth:img.width,photoHeight:img.height,infoPosition:getComputedStyle(info).position,infoBottom:ir.bottom,cardBottom:card.bottom,imageFit:photo.querySelector("img")?getComputedStyle(photo.querySelector("img")).objectFit:"fixture-placeholder"};
 });
 assert.equal(overlayGeometry.photoPosition,"absolute","Product photo must cover the card surface");
 assert.equal(overlayGeometry.infoPosition,"absolute","Product information must overlay the photo");
 assert(Math.abs(overlayGeometry.photoWidth-overlayGeometry.width)<=2&&Math.abs(overlayGeometry.photoHeight-overlayGeometry.height)<=2,"Photo background must fill the full card");
 assert(Math.abs(overlayGeometry.infoBottom-overlayGeometry.cardBottom)<=2,"Product information overlay must sit inside the photo at the card bottom");
 assert(["cover","fixture-placeholder"].includes(overlayGeometry.imageFit),"Product photo or honest synthetic placeholder must fill the photo region");
 const approvedDimensions=await homePage.locator(".home-category-tile").first().evaluate(el=>{const r=el.getBoundingClientRect();return {width:r.width,height:r.height}});
 assert(Math.abs(overlayGeometry.width-approvedDimensions.width)<=4,"Product card width must retain the approved category-tile match");
 assert(Math.abs(overlayGeometry.height/approvedDimensions.height-1.2)<=.04,"Product card height must retain the approved approximately 20% extension");

 const brandColors=await homePage.locator(".brand-novaai").first().evaluate(el=>({nova:getComputedStyle(el.querySelector("span:first-child")).color,ai:getComputedStyle(el.querySelector("span:last-child")).color}));
 assert.notEqual(brandColors.nova,brandColors.ai,"NOVA blue and final AI yellow brand treatment must remain distinct");
 await auditHomeSections(homePage,"Desktop");
 const desktopStyle=await homePage.locator(".home-carousel").first().evaluate(el=>({overflow:getComputedStyle(el).overflowX,snap:getComputedStyle(el).scrollSnapType,scrollbar:getComputedStyle(el).scrollbarWidth}));
 assert.equal(desktopStyle.overflow,"auto","Product sections must preserve horizontal scrolling");
 assert.match(desktopStyle.snap,/x/,"Product sections must retain horizontal snap behaviour");
 assert.equal(desktopStyle.scrollbar,"none","Product carousels must hide traditional scrollbars");
 const adControls=await homePage.evaluate(()=>({prev:getComputedStyle(document.querySelector("#novaHeroPrev")).display,next:getComputedStyle(document.querySelector("#novaHeroNext")).display,dots:document.querySelectorAll(".nova-hero-dots button").length,slides:document.querySelectorAll(".nova-hero-slide").length}));
 assert.equal(adControls.prev,"none","Only the advertising board arrows should be hidden");
 assert.equal(adControls.next,"none","Only the advertising board arrows should be hidden");
 assert(adControls.dots>=2&&adControls.slides>=2,"Advertising carousel campaigns/dots must remain");
 const adSource=fs.readFileSync(path.resolve("novaai-ad-slots.js"),"utf8");
 const legacyCarousel=adSource.match(/function initHomeCarousel\(\)\{[\s\S]*?\n  \}/);
 assert(legacyCarousel,"Existing advertising carousel initializer must remain available in the approved ad script");
 await homePage.addScriptTag({content:"const liveImages={home_hero:[]};\n"+legacyCarousel[0]+"\nwindow.__novaaiPreviewInitHomeCarousel=initHomeCarousel;"});
 await homePage.evaluate(()=>window.__novaaiPreviewInitHomeCarousel());
 await homePage.locator('[data-hero-slide="1"]').click();
 assert.equal(await homePage.locator(".nova-hero-slide.active").count(),1,"Advertising carousel must keep exactly one active campaign slide");
 assert.equal(await homePage.locator(".nova-hero-slide").nth(1).evaluate(el=>el.classList.contains("active")),true,"Advertising campaign dot must switch to its slide");
 await homePage.locator('[data-hero-slide="0"]').click();
 await homePage.waitForFunction(()=>document.querySelectorAll(".nova-hero-slide.active").length===1&&document.querySelectorAll(".nova-hero-slide")[1]?.classList.contains("active"),null,{timeout:7000});
 assert.equal(await homePage.locator("#novaHeroPrev").evaluate(el=>getComputedStyle(el).display),"none","Previous advertising arrow must remain hidden while carousel is active");
 assert.equal(await homePage.locator("#novaHeroNext").evaluate(el=>getComputedStyle(el).display),"none","Next advertising arrow must remain hidden while carousel is active");
 console.log("PASS advertising carousel dot navigation + automatic rotation with arrows hidden");
 console.log("PASS 2080 Home structure, Trust Shield, brand hierarchy and horizontal carousel styling");
 fs.mkdirSync("preview-screenshots",{recursive:true});
 await homePage.locator(".home-product-card .home-product-photo img").evaluateAll(imgs=>imgs.forEach(img=>{img.loading="eager";}));
 await homePage.waitForFunction(()=>[...document.querySelectorAll(".home-product-card .home-product-photo img")].length>0&&[...document.querySelectorAll(".home-product-card .home-product-photo img")].every(img=>img.complete&&img.naturalWidth>0),null,{timeout:20000});
 const desktopPhotoChecks=await homePage.locator(".home-product-card").evaluateAll(cards=>cards.map(card=>{const img=card.querySelector(".home-product-photo img");if(!img)return null;const p=card.querySelector(".home-product-photo").getBoundingClientRect(),c=card.getBoundingClientRect();return {loaded:img.complete&&img.naturalWidth>0,fit:getComputedStyle(img).objectFit,photoWidth:p.width,photoHeight:p.height,cardWidth:c.width,cardHeight:c.height}}).filter(Boolean));
 assert(desktopPhotoChecks.length>0&&desktopPhotoChecks.every(x=>x.loaded&&x.fit==="cover"&&Math.abs(x.photoWidth-x.cardWidth)<=2&&Math.abs(x.photoHeight-x.cardHeight)<=2),"Desktop synthetic photographs must load, cover the full card and use cover cropping");
 const desktopTrust=await homePage.locator(".home-trust-label").first().evaluate(el=>parseFloat(getComputedStyle(el).fontSize));
 assert(desktopTrust>=9,"Desktop Trust Shield label must remain readable; measured "+desktopTrust+"px");
 const desktopShot=await homePage.screenshot({path:"preview-screenshots/home-desktop.png",fullPage:true});
 const mobileContext=await browser.newContext({viewport:{width:390,height:844},deviceScaleFactor:1,isMobile:true,hasTouch:true});
 const mobilePage=await mobileContext.newPage();
 mobilePage.on("request",req=>{if(productionPattern(req.url()))attempts.add(req.url())});
 mobilePage.on("pageerror",err=>failures.push("mobile Home: "+err.message));
 await mobilePage.goto(origin+"/index.html",{waitUntil:"domcontentloaded",timeout:15000});
 await mobilePage.waitForFunction(()=>document.readyState==="complete"&&!!document.querySelector('[data-home-category="property-sale"] .home-property-card'),null,{timeout:10000});
 await auditHomeSections(mobilePage,"Phone");
 const mobilePeek=await mobilePage.locator('[data-home-category="property-sale"] .home-carousel').evaluate(el=>{
  const cards=[...el.querySelectorAll(".home-product-card")],box=el.getBoundingClientRect(),a=cards[0]?.getBoundingClientRect();
  const tile=document.querySelector(".home-category-tile")?.getBoundingClientRect();
  return {width:box.width,overflow:getComputedStyle(el).overflowX,scrollable:el.scrollWidth>el.clientWidth,firstFits:!!a&&a.left>=box.left&&a.right<=box.right,cardWidth:a?.width,cardHeight:a?.height,tileWidth:tile?.width,tileHeight:tile?.height};
 });
 assert.equal(mobilePeek.overflow,"auto","Android product carousel must remain touch-scrollable");
 assert.equal(mobilePeek.firstFits,true,"First property card must fit within the mobile carousel");
 assert.equal(mobilePeek.scrollable,true,"Android product carousel must retain horizontal overflow scrolling");
 assert(Math.abs(mobilePeek.cardWidth-mobilePeek.tileWidth)<=4,"Android product-card width must match category-tile width");
 assert(mobilePeek.cardHeight>mobilePeek.tileHeight,"Android product card must preserve the approved taller-than-tile proportion");
 await mobilePage.locator(".home-product-card .home-product-photo img").evaluateAll(imgs=>imgs.forEach(img=>{img.loading="eager";}));
 await mobilePage.waitForFunction(()=>[...document.querySelectorAll(".home-product-card .home-product-photo img")].length>0&&[...document.querySelectorAll(".home-product-card .home-product-photo img")].every(img=>img.complete&&img.naturalWidth>0),null,{timeout:20000});
 const mobileTrust=await mobilePage.locator(".home-trust-label").first().evaluate(el=>({fontSize:parseFloat(getComputedStyle(el).fontSize),text:el.innerText.trim()}));
 assert(mobileTrust.fontSize>=10,"Android Trust Shield must be at least 10px; measured "+mobileTrust.fontSize+"px");
 const photoChecks=await mobilePage.locator(".home-product-card").evaluateAll(cards=>cards.map(card=>{const img=card.querySelector(".home-product-photo img");if(!img)return null;const p=card.querySelector(".home-product-photo").getBoundingClientRect(),c=card.getBoundingClientRect();return {loaded:img.complete&&img.naturalWidth>0,naturalWidth:img.naturalWidth,naturalHeight:img.naturalHeight,fit:getComputedStyle(img).objectFit,photoWidth:p.width,photoHeight:p.height,cardWidth:c.width,cardHeight:c.height}}).filter(Boolean));
 assert(photoChecks.length>0,"Synthetic preview photographs must be present");
 assert(photoChecks.every(x=>x.loaded&&x.fit==="cover"),"Synthetic preview photos must load and use object-fit:cover");
 assert(photoChecks.every(x=>Math.abs(x.photoWidth-x.cardWidth)<=2&&Math.abs(x.photoHeight-x.cardHeight)<=2),"Synthetic preview photo layer must cover the full card");
 await mobilePage.screenshot({path:"preview-screenshots/home-android.png",fullPage:true});
 const tabletContext=await browser.newContext({viewport:{width:820,height:1180},deviceScaleFactor:1});
 const tabletPage=await tabletContext.newPage();
 tabletPage.on("request",req=>{if(productionPattern(req.url()))attempts.add(req.url())});
 await tabletPage.goto(origin+"/index.html",{waitUntil:"domcontentloaded",timeout:15000});
 await tabletPage.waitForFunction(()=>document.readyState==="complete"&&!!document.querySelector(".home-category-tile"),null,{timeout:10000});
 await auditHomeSections(tabletPage,"Tablet");
 await tabletPage.locator(".home-product-card .home-product-photo img").evaluateAll(imgs=>imgs.forEach(img=>{img.loading="eager";}));
 await tabletPage.waitForFunction(()=>[...document.querySelectorAll(".home-product-card .home-product-photo img")].length>0&&[...document.querySelectorAll(".home-product-card .home-product-photo img")].every(img=>img.complete&&img.naturalWidth>0),null,{timeout:20000});
 const tabletPhotoChecks=await tabletPage.locator(".home-product-card").evaluateAll(cards=>cards.map(card=>{const img=card.querySelector(".home-product-photo img");if(!img)return null;const p=card.querySelector(".home-product-photo").getBoundingClientRect(),c=card.getBoundingClientRect();return {loaded:img.complete&&img.naturalWidth>0,fit:getComputedStyle(img).objectFit,photoWidth:p.width,photoHeight:p.height,cardWidth:c.width,cardHeight:c.height}}).filter(Boolean));
 assert(tabletPhotoChecks.length>0&&tabletPhotoChecks.every(x=>x.loaded&&x.fit==="cover"&&Math.abs(x.photoWidth-x.cardWidth)<=2&&Math.abs(x.photoHeight-x.cardHeight)<=2),"Tablet synthetic photographs must load, cover the full card and use cover cropping");
 const tabletTrust=await tabletPage.locator(".home-trust-label").first().evaluate(el=>parseFloat(getComputedStyle(el).fontSize));
 assert(tabletTrust>=9,"Tablet Trust Shield label must remain readable; measured "+tabletTrust+"px");
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
