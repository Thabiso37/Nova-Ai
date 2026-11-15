import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";

const root=process.cwd();
const sourcePath=path.join(root,"scripts/preview/build.mjs");
let source=fs.readFileSync(sourcePath,"utf8");
const start=source.indexOf("const IMPLEMENTATION_COMMIT =");
const marker="const previewHomeIndex=branchHomeIndex;";
const end=source.indexOf(marker,start);
if(start<0||end<0)throw new Error("PR #39 preview builder baseline section changed; refusing an unverified build.");
const head=process.env.RENDER_GIT_COMMIT||process.env.GIT_COMMIT||"";
if(!/^[0-9a-f]{40}$/i.test(head))throw new Error("Render did not provide a verifiable source commit.");
source=source.slice(0,start)+`const IMPLEMENTATION_COMMIT = "${head}";
const IMPLEMENTATION_BRANCH = "feature/seller-storefront-branding";
const branchHomeIndex = fs.readFileSync(path.join(root,"index.html"),"utf8");
const previewHomeIndex = branchHomeIndex;
`+source.slice(end+marker.length);
source=source.replace('const pages = ["index.html", "retail.html", "seller-motors-houses.html", "property-details.html"];','const pages = ["index.html","retail.html","seller-motors-houses.html","property-details.html","seller.html","store-page.html"];');
source=source.replace('const required = [...pages, "novaai-product-sharing.js"];','const required = [...pages,"novaai-product-sharing.js","novaai-storefront.js","novaai-store-branding.js"];');
source=source.replace('const snapshot=JSON.parse(fs.readFileSync(snapshotPath,"utf8"));','const clean=(v)=>{if(typeof v==="string"&&v.includes("nxplffvklkopwfjaqexo.supabase.co"))return "";if(Array.isArray(v))return v.map(clean);if(v&&typeof v==="object"){for(const k of Object.keys(v))v[k]=clean(v[k]);}return v;};\nconst snapshot=clean(JSON.parse(fs.readFileSync(snapshotPath,"utf8")));');
source=source.replaceAll("img-src \\'self\\' data: blob: https:; font-src \\'self\\' data: https:;","img-src \\'self\\' data: blob:; font-src \\'self\\' data:;");
const shareMarker='fs.writeFileSync(path.join(out,"novaai-product-sharing.js"),share);';
if(!source.includes(shareMarker))throw new Error("Sharing script output marker missing.");
const copyCode=`
for(const page of pages){
 const html=fs.readFileSync(path.join(out,page),"utf8");
 const refs=[...html.matchAll(/(?:src|href)=["']\\.\\/([^"'?#]+)(?:\\?[^"']*)?["']/g)].map(m=>m[1]);
 for(const rel of refs){
  if(["preview-fixtures.js","nearby-search.js","novaai-ad-slots.js","novaai-share-visits.js","service-worker.js"].includes(rel))continue;
  const from=path.join(root,rel),to=path.join(out,rel);
  if(!fs.existsSync(from)||fs.statSync(from).isDirectory()||fs.existsSync(to))continue;
  fs.mkdirSync(path.dirname(to),{recursive:true});
  let content=fs.readFileSync(from);
  if(/\\.(js|css|html)$/i.test(rel)){
   let text=content.toString("utf8").replaceAll("https://nxplffvklkopwfjaqexo.supabase.co","https://blocked.invalid").replace(/sb_(?:publishable|secret)_[A-Za-z0-9_-]+/g,"PREVIEW_NO_KEY").replace(/eyJ[A-Za-z0-9_-]{20,}\\.[A-Za-z0-9_-]{20,}\\.[A-Za-z0-9_-]{10,}/g,"PREVIEW_NO_KEY");
   if(/nxplffvklkopwfjaqexo\\.supabase\\.co|sb_publishable_|sb_secret_/i.test(text))throw new Error("Production Supabase endpoint/key remains in preview asset "+rel);
   content=Buffer.from(text);
  }
  fs.writeFileSync(to,content);
 }
}
`;
source=source.replace(shareMarker,shareMarker+copyCode);
source=source.replaceAll("img-src 'self' data: blob: https:; font-src 'self' data: https:;","img-src 'self' data: blob:; font-src 'self' data:;");
source=source.replace('console.log("Generated isolated preview files in preview-dist/");',`
for(const file of fs.readdirSync(out)){if(!/\\.(html|js|json|css)$/i.test(file))continue;const t=fs.readFileSync(path.join(out,file),"utf8");if(/nxplffvklkopwfjaqexo\\.supabase\\.co|sb_publishable_|sb_secret_/i.test(t))throw new Error("Production Supabase endpoint or credential remains in "+file);}
console.log("Generated isolated PR #39 preview. Production Supabase endpoints and remote image URLs removed; auth, writes, Storage, RPC, orders and analytics disabled.");
`);
const temp=path.join(root,".pr39-preview-build.tmp.mjs");
fs.writeFileSync(temp,source);
const result=spawnSync(process.execPath,[temp],{cwd:root,stdio:"inherit",env:process.env});
if(result.status!==0)process.exit(result.status||1);
