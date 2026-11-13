import fs from "node:fs";
import path from "node:path";
import assert from "node:assert/strict";

const dir=path.resolve("preview-dist");
const manifest=JSON.parse(fs.readFileSync(path.join(dir,".source-manifest.json"),"utf8"));
assert.equal(manifest.source,"restored-preview2-branch-index","Validation build must use the restored Preview 2 branch index");
assert.equal(manifest.implementationCommit,"fce28c817442bc9c58976ff4a643e5cb5cf2bb6d","Restored Home implementation commit mismatch");
assert.equal(manifest.implementationBranch,"fix/restore-preview2-home-cards","Restored Home branch mismatch");
assert.equal(manifest.implementationHomeBlob,"7584c8a0974e19e138fdd2712c16ba7b3ce5de11","Restored Home index blob mismatch");
assert.equal(manifest.files["index.html@restored-preview2-branch"],manifest.implementationHomeBlob,"Generated Home is not sourced from the accepted branch index");

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
 /eyJ[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{10,}/i,
 /\/(?:rest|auth|functions|realtime)\/v1\//i
];
for(const name of fs.readdirSync(dir).filter(n=>fs.statSync(path.join(dir,n)).isFile())){
 const source=fs.readFileSync(path.join(dir,name),"utf8");
 for(const re of forbiddenNetwork)assert(!re.test(source),name+" contains production endpoint or credentials: "+re);
 if(name.endsWith(".html")){
  assert(source.includes("preview-fixtures.js"),name+" missing actual-data preview adapter");
  assert(source.includes("connect-src 'self'"),name+" missing restrictive preview CSP");
  assert(source.includes("novaai-preview-banner"),name+" missing isolated-preview warning");
 }
}
const sharing=fs.readFileSync(path.join(dir,"novaai-product-sharing.js"),"utf8");
assert(sharing.includes("navigator.share")&&sharing.includes("navigator.clipboard"),"Native share or clipboard fallback missing");
assert(!/nxplffvklkopwfjaqexo\.supabase\.co|record-novaai-product-share|product-share-analytics/i.test(sharing),"Share analytics or production Supabase integration must not execute in preview");
for(const name of ["index.html","retail.html","seller-motors-houses.html","property-details.html","preview-fixtures.js","novaai-product-sharing.js"])
 assert(fs.existsSync(path.join(dir,name)),"Missing generated validation asset: "+name);
const snapshot=JSON.parse(fs.readFileSync('scripts/preview/marketplace-listings.json','utf8'));
assert(snapshot.products.length>=2,'Actual approved marketplace snapshot is empty or incomplete');
assert(snapshot.products.every(p=>p.status==='approved'&&p.seller_id&&p.name&&Number(p.price)>0),'Snapshot includes non-approved or incomplete listings');
assert(snapshot.products.some(p=>p.id===61&&p.category==='Property For Sale'),'Actual approved property listing is missing');
assert(snapshot.products.some(p=>p.id===63&&p.category==='Accessories'),'Actual approved retail listing is missing');
const fixture=fs.readFileSync(path.join(dir,'preview-fixtures.js'),'utf8');
assert(fixture.includes('test phone a12')&&fixture.includes('Alaska store')&&fixture.includes('Property'),'Preview fixture is not sourced from actual marketplace records');
assert(!/Preview Cotton T-Shirt|Preview City Car Hatchback|Synthetic Retail listing/i.test(fixture),'Synthetic sample listings remain in the preview');
assert(/storage\/v1\/object\/public\/Nova%20AI\//i.test(fixture),'Actual public marketplace product images are missing');
assert(html.includes('nova-home-preview2-card-authority'),'Original Preview 2 card presentation override missing');
console.log('PASS restored Preview 2 card authority; actual approved listing snapshot; three-slide Home; Near Me; tile/content order; seller banner/footer; no extra Home sections; PR #35 controls; no write/auth/RPC paths.');
