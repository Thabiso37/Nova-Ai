import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { execFileSync } from "node:child_process";

const root = process.cwd();
const out = path.join(root, "preview-dist");
fs.rmSync(out, { recursive: true, force: true });
fs.mkdirSync(out, { recursive: true });

const APPROVED_BASELINE_COMMIT = "ae424b41f73ef6bd704b7f4018ab69c70a38e0aa";
const HISTORICAL_HOME_VISUAL_COMMIT = "0851cf99f7ecfe78b381340b3a2d7317b9dbb2fd";
const EXPECTED_HISTORICAL_HOME_BLOB = "b76c6014c1264548e600fe4961210c2c8e5a611b";
const expectedBaselineBlobs = {
 "index.html":"bd54ed3e3322bc1262589e66f30d65f5050eb363",
 "retail.html":"38277fef4c9a9226da1d9f43736ae78a46fd1f6a",
 "seller-motors-houses.html":"79dbca93afd3852471df8f3fa9bf06f83b33b4d7",
 "property-details.html":"4742bb9372941f388aadf4fe3c4280e008ec8462",
 "novaai-product-sharing.js":"daed2fbbe87344753f23f89635608475063f8742",
 "nearby-search.js":"9b95cb2c9f4c58909c8c00d2100916b904710147",
 "novaai-ad-slots.js":"da652ad2ece5d6ec833b189650c9cc74b84fead5",
 "novaai-share-visits.js":"2e7bb419b3ce0f7d83c7017737bb65bb551c1d59",
 "service-worker.js":"be127a7c2517d47664c220968e9ff1b454809ad3"
};
function gitBlobSha(value) {
 const bytes=Buffer.isBuffer(value)?value:Buffer.from(value,"utf8");
 return crypto.createHash("sha1").update(Buffer.concat([Buffer.from("blob "+bytes.length+"\0"),bytes])).digest("hex");
}
const EXPECTED_PR_COMMIT = "49bad87f8f3d67937db4e962372987787865e6fc";
const expectedPrBlobs = {
 "index.html":"26f0f1a173a63dbbd69d25e5cfd0ae8af6deef91",
 "retail.html":"38277fef4c9a9226da1d9f43736ae78a46fd1f6a",
 "seller-motors-houses.html":"79dbca93afd3852471df8f3fa9bf06f83b33b4d7",
 "property-details.html":"4742bb9372941f388aadf4fe3c4280e008ec8462",
 "novaai-product-sharing.js":"db7b7db7fd5d011a15dbf2687b23e162cdc85a76",
 "nearby-search.js":"9b95cb2c9f4c58909c8c00d2100916b904710147",
 "novaai-ad-slots.js":"da652ad2ece5d6ec833b189650c9cc74b84fead5",
 "novaai-share-visits.js":"2e7bb419b3ce0f7d83c7017737bb65bb551c1d59",
 "service-worker.js":"be127a7c2517d47664c220968e9ff1b454809ad3"
};
const intentionalPrSourceChanges = {
 "index.html": {baselineBlob:"bd54ed3e3322bc1262589e66f30d65f5050eb363",prBlob:"26f0f1a173a63dbbd69d25e5cfd0ae8af6deef91",publishedSource:"historical-approved-preview2-home"},
 "novaai-product-sharing.js": {baselineBlob:"daed2fbbe87344753f23f89635608475063f8742",prBlob:"db7b7db7fd5d011a15dbf2687b23e162cdc85a76",publishedSource:"final-pr-source-with-preview-only-sanitization"}
};
for (const [file,expected] of Object.entries(expectedPrBlobs)) {
 const actual=gitBlobSha(fs.readFileSync(path.join(root,file)));
 if(actual!==expected) throw new Error("Final PR source hash mismatch for "+file+": expected "+expected+" but received "+actual);
 const baseline=expectedBaselineBlobs[file];
 const intentional=intentionalPrSourceChanges[file];
 if(baseline!==expected && (!intentional || intentional.baselineBlob!==baseline || intentional.prBlob!==expected)) {
  throw new Error("Unreviewed baseline-to-PR source difference for "+file+": baseline "+baseline+", PR "+expected);
 }
 if(baseline===expected && actual!==baseline) throw new Error("Unchanged approved baseline source hash mismatch for "+file+": "+actual);
}
const differingFiles=Object.keys(expectedPrBlobs).filter(file=>expectedBaselineBlobs[file]!==expectedPrBlobs[file]).sort();
const approvedDifferenceFiles=Object.keys(intentionalPrSourceChanges).sort();
if(JSON.stringify(differingFiles)!==JSON.stringify(approvedDifferenceFiles)) throw new Error("The set of baseline-to-PR source differences changed: "+differingFiles.join(", "));
const historicalHomeIndex = execFileSync("curl",["-fsSL","https://raw.githubusercontent.com/Thabiso37/Nova-Ai/"+HISTORICAL_HOME_VISUAL_COMMIT+"/index.html"],{encoding:"utf8",maxBuffer:8*1024*1024});
/* Actual rendered Preview 2 is the Home visual authority. Use its complete source,
   not a newer design index that merely shares selected CSS fragments. */
const historicalHomeVisualBlob=gitBlobSha(historicalHomeIndex);
if(historicalHomeVisualBlob!==EXPECTED_HISTORICAL_HOME_BLOB) throw new Error("Historical Preview 2 source hash mismatch: "+historicalHomeVisualBlob);
if(!historicalHomeIndex.includes(".home-product-info{display:flex;flex:1;flex-direction:column")) throw new Error("Historical Preview 2 information-panel source could not be verified.");
if(!historicalHomeIndex.includes('data-home-category-tile="retail"')||!historicalHomeIndex.includes('data-home-category-tile="motors"')||!historicalHomeIndex.includes('data-home-category-tile="property"')) throw new Error("Historical Preview 2 marketplace category tiles are incomplete.");
const previewHomeIndex=historicalHomeIndex;
fs.writeFileSync(path.join(out,".source-manifest.json"),JSON.stringify({
 source:"actual-rendered-preview2",
 baselineCommit:APPROVED_BASELINE_COMMIT,
  historicalHomeVisualCommit:HISTORICAL_HOME_VISUAL_COMMIT,
 historicalHomeVisualBlob,
 prCommit:EXPECTED_PR_COMMIT,
 downloadedFiles:{...expectedPrBlobs},
 intentionalPrSourceChanges,
 publishedSources:{
  "index.html":{commit:HISTORICAL_HOME_VISUAL_COMMIT,blob:historicalHomeVisualBlob,reason:"Exact approved historical Preview 2 Home visual source; deliberately retained unchanged."},
  "retail.html":{commit:EXPECTED_PR_COMMIT,blob:expectedPrBlobs["retail.html"],reason:"Final PR source, adapted only for isolated fixtures and CSP."},
  "seller-motors-houses.html":{commit:EXPECTED_PR_COMMIT,blob:expectedPrBlobs["seller-motors-houses.html"],reason:"Final PR source, adapted only for isolated fixtures and CSP."},
  "property-details.html":{commit:EXPECTED_PR_COMMIT,blob:expectedPrBlobs["property-details.html"],reason:"Final PR source, adapted only for isolated fixtures and CSP."},
  "novaai-product-sharing.js":{commit:EXPECTED_PR_COMMIT,blob:expectedPrBlobs["novaai-product-sharing.js"],reason:"Final PR source, with production analytics endpoint removed for preview isolation."},
  "nearby-search.js":{commit:EXPECTED_PR_COMMIT,blob:expectedPrBlobs["nearby-search.js"],published:false,reason:"Script reference removed from generated HTML for preview isolation."},
  "novaai-ad-slots.js":{commit:EXPECTED_PR_COMMIT,blob:expectedPrBlobs["novaai-ad-slots.js"],published:false,reason:"Script reference removed from generated HTML for preview isolation."},
  "novaai-share-visits.js":{commit:EXPECTED_PR_COMMIT,blob:expectedPrBlobs["novaai-share-visits.js"],published:false,reason:"Analytics script reference removed from generated HTML for preview isolation."},
  "service-worker.js":{commit:EXPECTED_PR_COMMIT,blob:expectedPrBlobs["service-worker.js"],published:false,reason:"Service worker registration and script reference removed from preview."}
 },
 files:{...expectedBaselineBlobs,"index.html@actual-preview2":historicalHomeVisualBlob}
},null,2)+"\n");

const pages = ["index.html", "retail.html", "seller-motors-houses.html", "property-details.html"];
const required = [...pages, "novaai-product-sharing.js"];
for (const file of required) {
  if (!fs.existsSync(path.join(root, file))) throw new Error("Missing required PR asset: " + file);
}
const fixture = `(() => {
"use strict";
const sellers = [
 {user_id:"fixture-retail",store_name:"Cape Town Everyday",store_slug:"cape-town-everyday",description:"Synthetic preview seller",status:"approved",phone:""},
 {user_id:"fixture-motors",store_name:"Demo Motors",store_slug:"demo-motors",description:"Synthetic preview seller",status:"approved",phone:""},
 {user_id:"fixture-property",store_name:"Sample Homes",store_slug:"sample-homes",description:"Synthetic preview seller",status:"approved",phone:""}
];
const products = [
 {id:910001,name:"Preview Cotton T-Shirt",description:"Synthetic Retail listing for sharing tests.",price:249,category:"Clothing",image_url:"https://images.unsplash.com/photo-1521572163474-6864f9cf17ab?w=900&auto=format&fit=crop&q=85",images:[],seller_name:"Cape Town Everyday",seller_id:"fixture-retail",status:"approved",created_at:"2026-11-13T00:00:00Z"},
 {id:910002,name:"Preview City Car Hatchback",description:"Synthetic Motors listing for sharing tests.\\nVehicle type: car\\nListing type: vehicle.",price:89500,category:"Auto",image_url:"https://images.unsplash.com/photo-1492144534655-ae79c964c9d7?w=900&auto=format&fit=crop&q=85",images:[],seller_name:"Demo Motors",seller_id:"fixture-motors",status:"approved",created_at:"2026-11-13T00:00:00Z"},
 {id:910003,name:"Preview Family Home",description:"Synthetic Property listing for sharing tests.\\nProperty type: House\\nBedrooms: 3",price:1250000,category:"Property For Sale",image_url:"https://images.unsplash.com/photo-1600596542815-ffad4c1539a9?w=900&auto=format&fit=crop&q=85",images:[],seller_name:"Sample Homes",seller_id:"fixture-property",status:"approved",created_at:"2026-11-13T00:00:00Z",location:"Pretoria"},
 {id:910004,name:"Preview Modern Apartment",description:"Synthetic Property listing for sharing tests.\\nProperty type: Apartment\\nBedrooms: 2",price:18500,category:"Property To Rent",image_url:"https://images.unsplash.com/photo-1522708323590-d24dbb6b0267?w=900&auto=format&fit=crop&q=85",images:[],seller_name:"Sample Homes",seller_id:"fixture-property",status:"approved",created_at:"2026-11-12T00:00:00Z",location:"Cape Town"},
 {id:910005,name:"Preview Executive Estate",description:"Synthetic Property listing for sharing tests.\\nProperty type: House\\nBedrooms: 4",price:6850000,category:"Property For Sale",image_url:"https://images.unsplash.com/photo-1600607687939-ce8a6c25118c?w=900&auto=format&fit=crop&q=85",images:[],seller_name:"Sample Homes",seller_id:"fixture-property",status:"approved",created_at:"2026-11-11T00:00:00Z",location:"Pretoria"},
 {id:910006,name:"Preview Wireless Earbuds",description:"Synthetic Retail listing.",price:2499,category:"Electronics",image_url:"https://images.unsplash.com/photo-1606220945770-b5b6c2c55bf1?w=900&auto=format&fit=crop&q=85",images:[],seller_name:"Cape Town Everyday",seller_id:"fixture-retail",status:"approved",created_at:"2026-11-10T00:00:00Z"},
 {id:910007,name:"Preview Smart Watch",description:"Synthetic Retail listing.",price:3999,category:"Electronics",image_url:"https://images.unsplash.com/photo-1523275335684-37898b6baf30?w=900&auto=format&fit=crop&q=85",images:[],seller_name:"Cape Town Everyday",seller_id:"fixture-retail",status:"approved",created_at:"2026-11-09T00:00:00Z"},
 {id:910008,name:"Preview UltraBook",description:"Synthetic Retail listing.",price:12999,category:"Computers & Laptops",image_url:"https://images.unsplash.com/photo-1496181133206-80ce9b88a853?w=900&auto=format&fit=crop&q=85",images:[],seller_name:"Cape Town Everyday",seller_id:"fixture-retail",status:"approved",created_at:"2026-11-08T00:00:00Z"}
];
const locations = sellers.map(s=>({user_id:s.user_id,province:"Gauteng",city:"Pretoria",suburb:"Preview",latitude:null,longitude:null,public_location_enabled:true,approval_status:"approved"}));
const tables = {Products:products,seller_stores:sellers,seller_public_locations:locations};
function fail(message){return {data:null,error:{message,code:"PREVIEW_DISABLED"}}}
class Query {
 constructor(table){this.table=table;this.filters=[];this.max=Infinity;this.one=false;this.columns="*"}
 select(columns){this.columns=columns||"*";return this}
 eq(k,v){this.filters.push(x=>String(x[k])===String(v));return this}
 neq(k,v){this.filters.push(x=>String(x[k])!==String(v));return this}
 in(k,vs){this.filters.push(x=>vs.map(String).includes(String(x[k])));return this}
 gte(k,v){this.filters.push(x=>x[k]>=v);return this}
 lte(k,v){this.filters.push(x=>x[k]<=v);return this}
 gt(k,v){this.filters.push(x=>x[k]>v);return this}
 lt(k,v){this.filters.push(x=>x[k]<v);return this}
 is(k,v){this.filters.push(x=>x[k]===v);return this}
 match(obj){for(const [k,v] of Object.entries(obj||{}))this.eq(k,v);return this}
 filter(k,op,v){if(op==="eq")return this.eq(k,v);if(op==="neq")return this.neq(k,v);return this}
 contains(k,values){this.filters.push(x=>(Array.isArray(x[k])?x[k]:[]).some(v=>(values||[]).includes(v)));return this}
 or(){return this}
 not(){return this}
 order(){return this}
 range(a,b){this.max=Math.max(0,Number(b)-Number(a)+1);return this}
 limit(n){this.max=Number(n);return this}
 maybeSingle(){this.one=true;return this.run()}
 single(){this.one=true;return this.run()}
 then(resolve,reject){return this.run().then(resolve,reject)}
 async run(){
  if(!tables[this.table])return fail("Table is not available in fixture preview: "+this.table);
  let rows=tables[this.table].filter(row=>this.filters.every(f=>f(row))).slice(0,this.max);
  if(this.one)return {data:rows[0]||null,error:null};
  return {data:rows,error:null};
 }
 insert(){return Promise.resolve(fail("Writes are disabled in preview."))}
 update(){return Promise.resolve(fail("Writes are disabled in preview."))}
 delete(){return Promise.resolve(fail("Writes are disabled in preview."))}
 upsert(){return Promise.resolve(fail("Writes are disabled in preview."))}
}
const auth = {
 getUser:async()=>({data:{user:null},error:null}),
 getSession:async()=>({data:{session:null},error:null}),
 onAuthStateChange:()=>({data:{subscription:{unsubscribe(){}}}}),
 signInWithPassword:async()=>fail("Authentication is disabled in preview."),
 signUp:async()=>fail("Authentication is disabled in preview."),
 signOut:async()=>({error:null}),
 resetPasswordForEmail:async()=>fail("Authentication is disabled in preview."),
 updateUser:async()=>fail("Authentication is disabled in preview.")
};
const client = {
 from:(table)=>new Query(table),
 rpc:async()=>fail("RPC and order operations are disabled in preview."),
 auth,
 storage:{from:()=>({upload:async()=>fail("Storage is disabled in preview."),remove:async()=>fail("Storage is disabled in preview."),getPublicUrl:()=>({data:{publicUrl:""}})})}
};
window.__NOVAAI_PREVIEW__=true;
window.supabase={createClient:()=>client};
window.NOVAAI_SUPABASE_CLIENT=client;
window.__NOVAAI_PREVIEW_FIXTURES__={products,sellers,locations};
})();`;
fs.writeFileSync(path.join(out, "preview-fixtures.js"), fixture);

for (const page of pages) {
 let html=page==="index.html"?previewHomeIndex:fs.readFileSync(path.join(root,page),"utf8");
 html=html.replace(/<script[^>]+supabase-js[^>]*><\/script>/gi,'<script src="./preview-fixtures.js"></script>');

  if(page==="index.html"){
    html=html.replace('<html lang="en" class="nova-ads-pending">','<html lang="en">');
    const approvedHero="<div class=\"nova-hero-slide active\"><div class=\"nova-hero-copy\"><span class=\"nova-hero-kicker\"><span class=\"brand-novaai\"><span>NOVA</span><span>AI</span></span> MARKET</span><h1>Browse fashion, tech and home essentials.</h1><p>Discover great finds from South African sellers.</p><a href=\"./retail.html\">Explore Retail <span aria-hidden=\"true\">→</span></a></div><div class=\"nova-hero-art\" style=\"background-image:linear-gradient(90deg,rgba(16,40,75,.08),rgba(16,40,75,.02)),url(https://images.unsplash.com/photo-1483985988355-763728e1935b?auto=format&fit=crop&w=900&q=85);background-size:cover;background-position:center\" aria-hidden=\"true\"></div></div>";
    html=html.replace(new RegExp('<div class="nova-hero-slide active">[\\s\\S]*?</div></div>(?=\\s*<div class="nova-hero-slide">)'),approvedHero);
  }
 html=html.replace(/<script[^>]+novaai-ad-slots\.js[^>]*><\/script>/gi,"");
 html=html.replace(/<script[^>]+novaai-share-visits\.js[^>]*><\/script>/gi,"");
 html=html.replace(/<script[^>]+nearby-search\.js[^>]*><\/script>/gi,"");
 html=html.replace(/<script[^>]+service-worker\.js[^>]*><\/script>/gi,"");
 html=html.replace(/navigator\.serviceWorker\.register\(["']\.\/service-worker\.js["']\)/g,'Promise.reject(new Error("Service workers are disabled in preview"))');
 html=html.replace(/https:\/\/nxplffvklkopwfjaqexo\.supabase\.co\/functions\/v1\/property-contact-action/g,"#preview-contact-disabled");
 html=html.replace(/https:\/\/nxplffvklkopwfjaqexo\.supabase\.co/g,"https://blocked.invalid");
 html=html.replace(/sb_(?:publishable|secret)_[A-Za-z0-9_-]+/g,"PREVIEW_NO_KEY");
 html=html.replace(/eyJ[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{10,}/g,"PREVIEW_NO_KEY");
 html=html.replace(/<head>/i,'<head><meta http-equiv="Content-Security-Policy" content="default-src \'self\'; script-src \'self\' \'unsafe-inline\'; style-src \'self\' \'unsafe-inline\' https:; img-src \'self\' data: blob: https:; font-src \'self\' data: https:; connect-src \'self\'; form-action \'self\'; object-src \'none\'; base-uri \'self\'; frame-src \'none\'; worker-src \'none\'">');
 html=html.replace(/<body([^>]*)>/i,'<body$1><div id="novaai-preview-banner" role="status" style="position:sticky;top:0;z-index:99999;padding:8px;text-align:center;background:#fff1b8;color:#10284b;font:700 12px Arial">ISOLATED PREVIEW — SYNTHETIC DATA — AUTH, ORDERS AND ANALYTICS DISABLED</div>');
 fs.writeFileSync(path.join(out,page),html);
}
let share=fs.readFileSync(path.join(root,"novaai-product-sharing.js"),"utf8");
share=share.replace(/const endpoint="[^"]+",publishableKey="[^"]+";/,'const endpoint="",publishableKey="";');
share=share.replace(/function record\(d\)\{[\s\S]*?\nfunction announce/, 'function record(){/* Intentionally disabled in fixture preview. */}\nfunction announce');
if (/nxplffvklkopwfjaqexo\.supabase\.co|sb_publishable_|functions\/v1/.test(share)) throw new Error("Production endpoint remained in sharing script");
fs.writeFileSync(path.join(out,"novaai-product-sharing.js"),share);
fs.writeFileSync(path.join(out,"_headers"),`/*
  Content-Security-Policy: default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline' https:; img-src 'self' data: blob: https:; font-src 'self' data: https:; connect-src 'self'; form-action 'self'; object-src 'none'; base-uri 'self'; frame-src 'none'; worker-src 'none'
  X-Content-Type-Options: nosniff
  Referrer-Policy: no-referrer
`);
console.log("Generated isolated preview files in preview-dist/");
