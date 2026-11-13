import fs from "node:fs";
import path from "node:path";
import assert from "node:assert/strict";
const dir=path.resolve("preview-dist");
const forbidden=[/nxplffvklkopwfjaqexo\\.supabase\\.co/i,/sb_publishable_[A-Za-z0-9_-]+/i,/\\/rest\\/v1\\//i,/\\/auth\\/v1\\//i,/\\/functions\\/v1\\//i];
const files=fs.readdirSync(dir).filter(f=>/\\.(html|js|json|webmanifest)$/.test(f));
assert(files.includes("novaai-product-sharing.js"),"Actual sharing implementation copy missing");
for(const f of files){const s=fs.readFileSync(path.join(dir,f),"utf8");for(const re of forbidden)assert(!re.test(s),f+" contains forbidden production endpoint material: "+re);if(f.endsWith(".html")){assert(s.includes("preview-fixtures.js"),f+" is missing fixture adapter");assert(s.includes("connect-src 'self'"),f+" is missing restrictive CSP");}}
const sharing=fs.readFileSync(path.join(dir,"novaai-product-sharing.js"),"utf8");
assert(sharing.includes("navigator.share"),"Native share implementation was not preserved");
assert(sharing.includes("navigator.clipboard"),"Clipboard fallback was not preserved");
assert(/function record\\(\\)\\{\\/\\* Intentionally disabled/.test(sharing),"Analytics recorder is not explicitly disabled");
console.log("PASS: static preview isolation scan; native share and clipboard code retained; analytics disabled.");
