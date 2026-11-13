import fs from "node:fs";
import path from "node:path";
import assert from "node:assert/strict";
import vm from "node:vm";
import crypto from "node:crypto";

const expectedManifest={
 source:"mixed-approved-preview2",
 baselineCommit:"ae424b41f73ef6bd704b7f4018ab69c70a38e0aa",
 designIndexCommit:"6fb64689a2413f775344d78464bc7c8497152adb",
 designIndexBlob:"d433f51904aa2350f4b2d35cba3a934340f341e4",
 historicalHomeVisualCommit:"0851cf99f7ecfe78b381340b3a2d7317b9dbb2fd",
 historicalHomeVisualBlob:"b76c6014c1264548e600fe4961210c2c8e5a611b"
};
const manifest=JSON.parse(fs.readFileSync(path.resolve("preview-dist/.source-manifest.json"),"utf8"));
assert.equal(manifest.source,expectedManifest.source,"Unexpected preview source mode");
assert.equal(manifest.baselineCommit,expectedManifest.baselineCommit,"Preview baseline commit mismatch");
assert.equal(manifest.designIndexCommit,expectedManifest.designIndexCommit,"Home redesign commit mismatch");
assert.equal(manifest.files["index.html@design"],expectedManifest.designIndexBlob,"Preview 2-restored Home source blob mismatch");
assert.equal(manifest.historicalHomeVisualCommit,expectedManifest.historicalHomeVisualCommit,"Historical Preview 2 visual authority commit mismatch");
assert.equal(manifest.historicalHomeVisualBlob,expectedManifest.historicalHomeVisualBlob,"Historical Preview 2 visual authority blob mismatch");
assert.equal(manifest.files["index.html@historical-visual"],expectedManifest.historicalHomeVisualBlob,"Historical Preview 2 visual source blob mismatch");
assert.equal(manifest.files["retail.html"],"38277fef4c9a9226da1d9f43736ae78a46fd1f6a","Retail source baseline mismatch");
assert.equal(manifest.files["seller-motors-houses.html"],"79dbca93afd3852471df8f3fa9bf06f83b33b4d7","Motors/Property source baseline mismatch");
assert.equal(manifest.files["property-details.html"],"4742bb9372941f388aadf4fe3c4280e008ec8462","Property detail source baseline mismatch");
const generatedIndex=fs.readFileSync(path.resolve("preview-dist/index.html"),"utf8");
assert(generatedIndex.includes("2080")||generatedIndex.includes("nova-home-2080"),"Generated Home page does not contain the approved redesign marker");
const panelRestore=generatedIndex.match(/<style id="nova-home-preview2-panel-restoration">([\s\S]*?)<\/style>/);
assert(panelRestore,"Generated Home page is missing the Preview 2 panel restoration stylesheet");
assert(panelRestore[1].includes(".home-product-photo")&&panelRestore[1].includes("position:relative!important"),"Preview 2 must place the product photograph at the top of the card");
assert(panelRestore[1].includes(".home-product-info")&&panelRestore[1].includes("flex:1 1 52%!important"),"Preview 2 must restore the separate information panel beneath the photo");
assert(!/\.home-product-info\s*\{[^}]*position:absolute/i.test(panelRestore[1]),"Preview 2 information panel must not overlay the product photo");
const dir=path.resolve("preview-dist");
const forbidden=[
 /nxplffvklkopwfjaqexo/i,
 /(?:[a-z0-9-]+\.)?supabase\.co/i,
 /(?:[a-z0-9-]+\.)?supabase\.com/i,
 /sb_(?:publishable|secret)_[A-Za-z0-9_-]+/i,
 /eyJ[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{10,}/i,
 /\/rest\/v1\//i,/\/auth\/v1\//i,/\/storage\/v1\//i,
 /\/functions\/v1\//i,/\/realtime\/v1\//i
];
const required=["index.html","retail.html","seller-motors-houses.html","property-details.html","preview-fixtures.js","novaai-product-sharing.js"];
for(const name of required)assert(fs.existsSync(path.join(dir,name)),"Generated preview file missing: "+name);
const files=fs.readdirSync(dir).filter(f=>fs.statSync(path.join(dir,f)).isFile());
assert(files.includes("novaai-product-sharing.js"),"Actual sharing implementation copy missing");
for(const f of files){
 const s=fs.readFileSync(path.join(dir,f),"utf8");
 for(const re of forbidden)assert(!re.test(s),f+" contains forbidden production endpoint or credential material: "+re);
 if(f.endsWith(".html")){
  assert(s.includes("preview-fixtures.js"),f+" is missing fixture adapter");
  assert(s.includes("connect-src 'self'"),f+" is missing restrictive CSP");
  assert(s.includes("novaai-preview-banner"),f+" is missing preview warning banner");
 }
}
const sharing=fs.readFileSync(path.join(dir,"novaai-product-sharing.js"),"utf8");
assert(sharing.includes("navigator.share"),"Native share implementation was not preserved");
assert(sharing.includes("navigator.clipboard"),"Clipboard fallback was not preserved");
assert(/function record\(\)\{\/\* Intentionally disabled/.test(sharing),"Analytics recorder is not explicitly disabled");
const fixtureSource=fs.readFileSync(path.join(dir,"preview-fixtures.js"),"utf8");
const sandbox={window:{}};
vm.runInNewContext(fixtureSource,sandbox);
const mock=sandbox.window.supabase.createClient();
const retail=await mock.from("Products").select("*").eq("id",910001).maybeSingle();
assert.equal(retail.data.name,"Preview Cotton T-Shirt","Synthetic fixture query failed");
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
])assert.equal(result.error.code,"PREVIEW_DISABLED","A production-capable mutation/auth method was not rejected");
assert.equal((await mock.auth.getSession()).data.session,null,"Preview unexpectedly has an authenticated session");
console.log("PASS: generated-file credential/endpoint scan; four-page fixture/CSP checks; synthetic query; database writes, RPC, storage and authentication rejection; native share and clipboard code retained; analytics disabled.");
