import fs from "node:fs";
import path from "node:path";
import assert from "node:assert/strict";
import vm from "node:vm";

const expectedManifest={
 source:"actual-rendered-preview2",
 baselineCommit:"ae424b41f73ef6bd704b7f4018ab69c70a38e0aa",
 historicalHomeVisualCommit:"0851cf99f7ecfe78b381340b3a2d7317b9dbb2fd",
 historicalHomeVisualBlob:"b76c6014c1264548e600fe4961210c2c8e5a611b"
};
const dir=path.resolve("preview-dist");
const manifest=JSON.parse(fs.readFileSync(path.join(dir,".source-manifest.json"),"utf8"));
assert.equal(manifest.source,expectedManifest.source,"Preview must use the complete actual Preview 2 source");
assert.equal(manifest.baselineCommit,expectedManifest.baselineCommit,"Approved baseline commit mismatch");
assert.equal(manifest.historicalHomeVisualCommit,expectedManifest.historicalHomeVisualCommit,"Actual Preview 2 source commit mismatch");
assert.equal(manifest.historicalHomeVisualBlob,expectedManifest.historicalHomeVisualBlob,"Actual Preview 2 source blob mismatch");
assert.equal(manifest.files["index.html@actual-preview2"],expectedManifest.historicalHomeVisualBlob,"Generated Home source is not the approved Preview 2 blob");
assert.equal(manifest.files["retail.html"],"38277fef4c9a9226da1d9f43736ae78a46fd1f6a","Retail source baseline mismatch");
assert.equal(manifest.files["seller-motors-houses.html"],"79dbca93afd3852471df8f3fa9bf06f83b33b4d7","Motors/Property source baseline mismatch");
assert.equal(manifest.files["property-details.html"],"4742bb9372941f388aadf4fe3c4280e008ec8462","Property detail source baseline mismatch");

const generatedIndex=fs.readFileSync(path.join(dir,"index.html"),"utf8");
assert(!/nova-ads-pending/.test(generatedIndex),"Preview Home must not remain hidden behind the production ad-loading gate");
assert(generatedIndex.includes("Browse fashion, tech and home essentials."),"Preview Home is missing the approved promotional hero copy");
assert(generatedIndex.includes("images.unsplash.com/photo-1483985988355-763728e1935b"),"Preview Home is missing its isolated static hero image");
assert(generatedIndex.includes('data-home-category-tile="retail"')&&generatedIndex.includes('data-home-category-tile="motors"')&&generatedIndex.includes('data-home-category-tile="property"'),"Preview 2 category tiles are incomplete");
const categoryOrder=["retail","motors","property","more"].map(key=>generatedIndex.indexOf('data-home-category-tile="'+key+'"'));
assert(categoryOrder.every((v,i)=>v>=0&&(i===0||v>categoryOrder[i-1])),"Preview 2 category order must be Retail, Motors, Property, More");
assert(generatedIndex.includes(".home-product-photo{position:relative;width:100%;aspect-ratio:1/1"),"Preview 2 product photo must remain a square top image");
assert(generatedIndex.includes(".home-product-info{display:flex;flex:1;flex-direction:column"),"Preview 2 product information must remain a separate lower panel");
assert(generatedIndex.includes("home-product-share")&&generatedIndex.includes("home-add-cart")&&generatedIndex.includes("home-wishlist-toggle"),"Home sharing, cart and wishlist controls must be retained");
assert(generatedIndex.includes("novaai-product-sharing.js?v=3"),"Home product-sharing helper import is missing");

const forbidden=[
 /nxplffvklkopwfjaqexo/i,/(?:[a-z0-9-]+\.)?supabase\.co/i,/(?:[a-z0-9-]+\.)?supabase\.com/i,
 /sb_(?:publishable|secret)_[A-Za-z0-9_-]+/i,/eyJ[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{10,}/i,
 /\/rest\/v1\//i,/\/auth\/v1\//i,/\/storage\/v1\//i,/\/functions\/v1\//i,/\/realtime\/v1\//i
];
const required=["index.html","retail.html","seller-motors-houses.html","property-details.html","preview-fixtures.js","novaai-product-sharing.js"];
for(const name of required)assert(fs.existsSync(path.join(dir,name)),"Generated preview file missing: "+name);
const files=fs.readdirSync(dir).filter(name=>fs.statSync(path.join(dir,name)).isFile());
for(const name of files){
 const source=fs.readFileSync(path.join(dir,name),"utf8");
 for(const re of forbidden)assert(!re.test(source),name+" contains a forbidden production endpoint or credential: "+re);
 if(name.endsWith(".html")){
  assert(source.includes("preview-fixtures.js"),name+" is missing the synthetic fixture adapter");
  assert(source.includes("connect-src 'self'"),name+" is missing the restrictive preview CSP");
  assert(source.includes("novaai-preview-banner"),name+" is missing the isolated-preview warning");
 }
}
const sharing=fs.readFileSync(path.join(dir,"novaai-product-sharing.js"),"utf8");
assert(sharing.includes("navigator.share"),"Native share implementation was not preserved");
assert(sharing.includes("navigator.clipboard"),"Clipboard fallback was not preserved");
assert(/function record\(\)\{\/\* Intentionally disabled/.test(sharing),"Product-share analytics must remain disabled in preview");

const fixtureSource=fs.readFileSync(path.join(dir,"preview-fixtures.js"),"utf8");
const sandbox={window:{}};
vm.runInNewContext(fixtureSource,sandbox);
const mock=sandbox.window.supabase.createClient();
const retail=await mock.from("Products").select("*").eq("id",910001).maybeSingle();
assert.equal(retail.data.name,"Preview Cotton T-Shirt","Synthetic Retail fixture query failed");
const motor=await mock.from("Products").select("*").eq("id",910002).maybeSingle();
assert(motor.data.description.includes("Vehicle type: car"),"Synthetic Motors fixture is missing its approved vehicle-type marker");
for(const result of [
 await mock.from("Products").insert({name:"must not persist"}),
 await mock.from("Products").update({name:"must not persist"}),
 await mock.from("Products").delete(),
 await mock.from("Products").upsert({name:"must not persist"}),
 await mock.rpc("place_order"),
 await mock.auth.signInWithPassword({email:"x",password:"x"}),
 await mock.auth.signUp({email:"x",password:"x"}),
 await mock.auth.updateUser({email:"x"}),
 await mock.auth.resetPasswordForEmail("x"),
 await mock.storage.from("listing-images").upload("x",new Blob(["x"])),
 await mock.storage.from("listing-images").remove(["x"])
])assert.equal(result.error.code,"PREVIEW_DISABLED","A database/auth/storage mutation path was not rejected");
assert.equal((await mock.auth.getSession()).data.session,null,"Preview unexpectedly has an authenticated session");
console.log("PASS: actual Preview 2 source hash, Home visual authority, hero/category order, separate product panels, sharing/cart/wishlist hooks, endpoint/credential scan, fixture queries and all mutation/auth/storage denials.");
