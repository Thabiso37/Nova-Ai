import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";

const root = process.cwd();
const out = path.join(root, "preview-dist");
fs.rmSync(out, { recursive: true, force: true });
fs.mkdirSync(out, { recursive: true });

const IMPLEMENTATION_COMMIT = "7f9d347e053695ebb6b0e2602415c74d87410f3b";
const IMPLEMENTATION_BRANCH = "fix/restore-preview2-home-cards";
const EXPECTED_IMPLEMENTATION_HOME_BLOB = "ae9633e67c0a60c24ac01df628b2c100ed4fe6eb";
const expectedBaselineBlobs = {
 "index.html":"ae9633e67c0a60c24ac01df628b2c100ed4fe6eb",
 "retail.html":"38277fef4c9a9226da1d9f43736ae78a46fd1f6a",
 "seller-motors-houses.html":"79dbca93afd3852471df8f3fa9bf06f83b33b4d7",
 "property-details.html":"4742bb9372941f388aadf4fe3c4280e008ec8462",
 "novaai-product-sharing.js":"db7b7db7fd5d011a15dbf2687b23e162cdc85a76",
 "nearby-search.js":"9b95cb2c9f4c58909c8c00d2100916b904710147",
 "novaai-ad-slots.js":"da652ad2ece5d6ec833b189650c9cc74b84fead5",
 "novaai-share-visits.js":"2e7bb419b3ce0f7d83c7017737bb65bb551c1d59",
 "service-worker.js":"be127a7c2517d47664c220968e9ff1b454809ad3"
};
function gitBlobSha(value) {
 const bytes=Buffer.isBuffer(value)?value:Buffer.from(value,"utf8");
 return crypto.createHash("sha1").update(Buffer.concat([Buffer.from("blob "+bytes.length+"\0"),bytes])).digest("hex");
}
for (const [file,expected] of Object.entries(expectedBaselineBlobs)) {
 const actual=gitBlobSha(fs.readFileSync(path.join(root,file)));
 if(actual!==expected) throw new Error("Approved baseline source hash mismatch for "+file+": "+actual);
}
const branchHomeIndex = fs.readFileSync(path.join(root,"index.html"),"utf8");
const branchHomeBlob = gitBlobSha(branchHomeIndex);
if(branchHomeBlob!==EXPECTED_IMPLEMENTATION_HOME_BLOB) throw new Error("Accepted branch Home source hash mismatch: "+branchHomeBlob);
if(!branchHomeIndex.includes("The Future is <em>Here</em>")||!branchHomeIndex.includes("Great finds. Local businesses.")||!branchHomeIndex.includes("Your products deserve a marketplace.")) throw new Error("Accepted branch promotional carousel content is incomplete.");
if(!branchHomeIndex.includes('data-home-category-tile="retail"')||!branchHomeIndex.includes('data-home-category-tile="motors"')||!branchHomeIndex.includes('data-home-category-tile="property"')||!branchHomeIndex.includes('data-home-category-tile="more"')) throw new Error("Accepted branch Home navigation tiles are incomplete.");
if(!branchHomeIndex.includes("title:'Premium Properties'")||!branchHomeIndex.includes("title:'Featured Products'")) throw new Error("Accepted branch Home category groups are incomplete.");
const previewHomeIndex=branchHomeIndex;
fs.writeFileSync(path.join(out,".source-manifest.json"),JSON.stringify({
 source:"restored-preview2-branch-index",
 implementationCommit:IMPLEMENTATION_COMMIT,
 implementationBranch:IMPLEMENTATION_BRANCH,
 implementationHomeBlob:branchHomeBlob,
 files:{...expectedBaselineBlobs,"index.html@restored-preview2-branch":branchHomeBlob}
},null,2)+"\n");

const pages = ["index.html", "retail.html", "seller-motors-houses.html", "property-details.html"];
const required = [...pages, "novaai-product-sharing.js"];
for (const file of required) {
  if (!fs.existsSync(path.join(root, file))) throw new Error("Missing required PR asset: " + file);
}
const snapshotPath=path.join(root,"scripts/preview/marketplace-listings.json");
const snapshot=JSON.parse(fs.readFileSync(snapshotPath,"utf8"));
if(!Array.isArray(snapshot.products)||snapshot.products.length===0) throw new Error("Actual approved marketplace listing snapshot is empty.");
if(!snapshot.products.every(p=>p.status==="approved"&&p.seller_id&&p.name&&Number(p.price)>0)) throw new Error("Snapshot contains a listing that is not an eligible approved marketplace product.");
if(!Array.isArray(snapshot.stores)||!snapshot.stores.length) throw new Error("Actual approved seller-store snapshot is empty.");
const fixture = [
`(() => {
"use strict";
const snapshot = `,
JSON.stringify(snapshot),
`;
const products=snapshot.products;
const sellers=snapshot.stores;
const locations=snapshot.locations||[];
const tables={Products:products,seller_stores:sellers,seller_public_locations:locations};
function fail(message){return {data:null,error:{message,code:"PREVIEW_DISABLED"}}}
class Query{
 constructor(table){this.table=table;this.filters=[];this.max=Infinity;this.one=false;this.columns="*";this.sort=null}
 select(columns){this.columns=columns||"*";return this}
 eq(k,v){this.filters.push(x=>String(x[k])===String(v));return this}
 neq(k,v){this.filters.push(x=>String(x[k])!==String(v));return this}
 in(k,vs){this.filters.push(x=>(vs||[]).map(String).includes(String(x[k])));return this}
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
 order(k,opts){this.sort={key:k,ascending:opts?.ascending!==false};return this}
 range(a,b){this.max=Math.max(0,Number(b)-Number(a)+1);this.offset=Math.max(0,Number(a));return this}
 limit(n){this.max=Number(n);return this}
 maybeSingle(){this.one=true;return this.run()}
 single(){this.one=true;return this.run()}
 then(resolve,reject){return this.run().then(resolve,reject)}
 async run(){
  if(!tables[this.table])return fail("Table is not available in actual-data preview fixture: "+this.table);
  let rows=tables[this.table].filter(row=>this.filters.every(f=>f(row)));
  if(this.sort){const {key,ascending}=this.sort;rows=rows.slice().sort((a,b)=>{const x=a[key],y=b[key];return (x===y?0:x>y?1:-1)*(ascending?1:-1);});}
  rows=rows.slice(this.offset||0,Number.isFinite(this.max)?(this.offset||0)+this.max:undefined);
  if(this.one)return {data:rows[0]||null,error:null};
  return {data:rows,error:null};
 }
 insert(){return Promise.resolve(fail("Writes are disabled in preview."))}
 update(){return Promise.resolve(fail("Writes are disabled in preview."))}
 delete(){return Promise.resolve(fail("Writes are disabled in preview."))}
 upsert(){return Promise.resolve(fail("Writes are disabled in preview."))}
}
const auth={
 getUser:async()=>({data:{user:null},error:null}),
 getSession:async()=>({data:{session:null},error:null}),
 onAuthStateChange:()=>({data:{subscription:{unsubscribe(){}}}}),
 signInWithPassword:async()=>fail("Authentication is disabled in preview."),
 signUp:async()=>fail("Authentication is disabled in preview."),
 signOut:async()=>({error:null}),
 resetPasswordForEmail:async()=>fail("Authentication is disabled in preview."),
 updateUser:async()=>fail("Authentication is disabled in preview.")
};
const client={from:table=>new Query(table),rpc:async()=>fail("RPC and order operations are disabled in preview."),auth,storage:{from:()=>({upload:async()=>fail("Storage is disabled in preview."),remove:async()=>fail("Storage is disabled in preview."),getPublicUrl:()=>({data:{publicUrl:""}})})}};
window.__NOVAAI_PREVIEW__=true;
window.supabase={createClient:()=>client};
window.NOVAAI_SUPABASE_CLIENT=client;
window.__NOVAAI_PREVIEW_FIXTURES__={products,sellers,locations,snapshotAt:snapshot.snapshotAt,source:snapshot.source};
})();`
].join("");
fs.writeFileSync(path.join(out,"preview-fixtures.js"),fixture);

for (const page of pages) {
 let html=page==="index.html"?previewHomeIndex:fs.readFileSync(path.join(root,page),"utf8");
 html=html.replace(/<script[^>]+supabase-js[^>]*><\/script>/gi,'<script src="./preview-fixtures.js"></script>');

  if(page==="index.html"){
    html=html.replace('<html lang="en" class="nova-ads-pending">','<html lang="en">');
    // Preserve the accepted branch's three hero slides without substitution.
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
 html=html.replace(/<body([^>]*)>/i,'<body$1><div id="novaai-preview-banner" role="status" style="position:sticky;top:0;z-index:99999;padding:8px;text-align:center;background:#fff1b8;color:#10284b;font:700 12px Arial">ISOLATED PREVIEW — READ-ONLY ACTUAL LISTING SNAPSHOT — AUTH, ORDERS AND ANALYTICS DISABLED</div>');
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
