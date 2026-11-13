import fs from "node:fs";
import path from "node:path";
import assert from "node:assert/strict";

const dir=path.resolve("preview-dist");
const manifest=JSON.parse(fs.readFileSync(path.join(dir,".source-manifest.json"),"utf8"));
assert.equal(manifest.source,"accepted-branch-index","Validation build must use the accepted branch index, not historical Preview 2 source");
assert.equal(manifest.implementationCommit,"b8328d4fb43018452725132e64d859e45d82af57","Accepted implementation commit mismatch");
assert.equal(manifest.implementationBranch,"fix/approved-preview2-home-layout","Accepted implementation branch mismatch");
assert.equal(manifest.implementationHomeBlob,"82380f7172f0cd1699ea5da113de9f4945276cd7","Accepted branch index blob mismatch");
assert.equal(manifest.files["index.html@accepted-branch"],manifest.implementationHomeBlob,"Generated Home is not sourced from the accepted branch index");

const html=fs.readFileSync(path.join(dir,"index.html"),"utf8");
assert(html.includes("The Future is <em>Here</em>"),"First accepted hero message missing");
assert(html.includes("Great finds. Local businesses."),"Second accepted hero message missing");
assert(html.includes("Your products deserve a marketplace."),"Third accepted hero message missing");
assert.equal((html.match(/class="nova-hero-slide(?: active)?"/g)||[]).length,3,"Home must retain exactly three promotional hero slides");
assert(html.includes('id="homeUseLocation"')&&html.includes("Near Me"),"Header Near Me control missing");
const tileOrder=["retail","motors","property","more"].map(k=>html.indexOf('data-home-category-tile="'+k+'"'));
assert(tileOrder.every((v,i)=>v>=0&&(i===0||v>tileOrder[i-1])),"Home tile order must be Retail, Motors, Property, More");
assert(html.includes("title:'Premium Properties'")&&html.includes("title:'Featured Products'"),"Approved Home category sections missing");
assert(html.includes('aria-label="Become a NOVAAI seller"'),"Become a NOVAAI Seller banner missing");
assert(html.includes("<footer>")&&html.includes('aria-label="Main navigation"'),"Footer or footer navigation missing");
const forbidden=[
 "Nearby Retail Products","New Retail Arrivals","Nearby Motors Listings","Recently Added Vehicles",
 "Featured Cars and Vehicles","Nearby Properties","Featured Properties for Sale","Featured Properties for Rent",
 "Parts & Accessories"
];
for(const phrase of forbidden)assert(!html.includes(phrase),"Forbidden Home content found: "+phrase);
assert(!html.includes("retail-nearby")&&!html.includes("motors-nearby")&&!html.includes("property-nearby"),"Nearby Home section handlers remain");
assert(html.includes("home-product-share")&&html.includes("home-add-cart")&&html.includes("home-wishlist-toggle"),"Home share/cart/wishlist controls missing");
assert(html.includes("novaai-product-sharing.js?v=3"),"Product sharing helper import missing");

const forbiddenNetwork=[
 /nxplffvklkopwfjaqexo/i,/(?:[a-z0-9-]+\\.)?supabase\\.(?:co|com)/i,
 /sb_(?:publishable|secret)_[A-Za-z0-9_-]+/i,/eyJ[A-Za-z0-9_-]{20,}\\.[A-Za-z0-9_-]{20,}\\.[A-Za-z0-9_-]{10,}/i,
 /\\/(?:rest|auth|storage|functions|realtime)\\/v1\\//i
];
for(const name of fs.readdirSync(dir).filter(n=>fs.statSync(path.join(dir,n)).isFile())){
 const source=fs.readFileSync(path.join(dir,name),"utf8");
 for(const re of forbiddenNetwork)assert(!re.test(source),name+" contains production endpoint or credentials: "+re);
 if(name.endsWith(".html")){
  assert(source.includes("preview-fixtures.js"),name+" missing synthetic fixture adapter");
  assert(source.includes("connect-src 'self'"),name+" missing restrictive preview CSP");
  assert(source.includes("novaai-preview-banner"),name+" missing isolated-preview warning");
 }
}
const sharing=fs.readFileSync(path.join(dir,"novaai-product-sharing.js"),"utf8");
assert(sharing.includes("navigator.share")&&sharing.includes("navigator.clipboard"),"Native share or clipboard fallback missing");
assert(!/nxplffvklkopwfjaqexo\\.supabase\\.co|record-novaai-product-share|product-share-analytics/i.test(sharing),"Share analytics or production Supabase integration must not execute in preview");
for(const name of ["index.html","retail.html","seller-motors-houses.html","property-details.html","preview-fixtures.js","novaai-product-sharing.js"])
 assert(fs.existsSync(path.join(dir,name)),"Missing generated validation asset: "+name);
console.log("PASS accepted branch source hash; exact three-slide Home; Near Me; tile and content order; seller banner/footer; prohibited sections absent; PR #35 controls; preview CSP and production endpoint/credential isolation.");
