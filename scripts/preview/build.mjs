import fs from "node:fs";
import path from "node:path";

const root = process.cwd();
const out = path.join(root, "preview-dist");
fs.rmSync(out, { recursive: true, force: true });
fs.mkdirSync(out, { recursive: true });

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
 {id:910001,name:"Preview Cotton T-Shirt",description:"Synthetic Retail listing for sharing tests.",price:249,category:"Clothing",image_url:"",images:[],seller_name:"Cape Town Everyday",seller_id:"fixture-retail",status:"approved",created_at:"2026-11-13T00:00:00Z"},
 {id:910002,name:"Preview City Hatchback",description:"Synthetic Motors listing for sharing tests.",price:89500,category:"Auto",image_url:"",images:[],seller_name:"Demo Motors",seller_id:"fixture-motors",status:"approved",created_at:"2026-11-13T00:00:00Z"},
 {id:910003,name:"Preview Family Home",description:"Synthetic Property listing for sharing tests.\\nProperty type: House\\nBedrooms: 3",price:1250000,category:"Property For Sale",image_url:"",images:[],seller_name:"Sample Homes",seller_id:"fixture-property",status:"approved",created_at:"2026-11-13T00:00:00Z",location:"Pretoria"}
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
 let html=fs.readFileSync(path.join(root,page),"utf8");
 html=html.replace(/<script[^>]+supabase-js[^>]*><\/script>/gi,'<script src="./preview-fixtures.js"></script>');
 html=html.replace(/<script[^>]+novaai-ad-slots\.js[^>]*><\/script>/gi,"");
 html=html.replace(/<script[^>]+novaai-share-visits\.js[^>]*><\/script>/gi,"");
 html=html.replace(/<script[^>]+nearby-search\.js[^>]*><\/script>/gi,"");
 html=html.replace(/<script[^>]+service-worker\.js[^>]*><\/script>/gi,"");
 html=html.replace(/navigator\.serviceWorker\.register\(["']\.\/service-worker\.js["']\)/g,'Promise.reject(new Error("Service workers are disabled in preview"))');
 html=html.replace(/https:\/\/nxplffvklkopwfjaqexo\.supabase\.co\/functions\/v1\/property-contact-action/g,"#preview-contact-disabled");
 html=html.replace(/https:\/\/nxplffvklkopwfjaqexo\.supabase\.co/g,"https://blocked.invalid");
 html=html.replace(/sb_publishable_[A-Za-z0-9_-]+/g,"PREVIEW_NO_KEY");
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
