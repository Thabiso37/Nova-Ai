import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
const root=process.cwd();
const page=fs.readFileSync(path.join(root,"store-page.html"),"utf8");
const js=fs.readFileSync(path.join(root,"novaai-storefront.js"),"utf8");
const sql=fs.readFileSync(path.join(root,"docs/sql/20261115-seller-storefront-branding.sql"),"utf8");
test("store page is a dedicated page and has no directory route",()=>{
 assert.match(page,/id="novaStorePage"/);
 assert.match(js,/store-page\.html\?store=/);
 assert.doesNotMatch(js,/store-directory|all-stores/i);
});
test("storefront only queries approved stores and approved seller products",()=>{
 assert.match(js,/eq\("status","approved"\)/);
 assert.match(js,/eq\("seller_id",store\.user_id\)\.eq\("status","approved"\)/);
});
test("product cards use existing public detail routes",()=>{
 assert.match(js,/property-details\.html\?id=/);
 assert.match(js,/index\.html\?product=/);
});
test("like/follow persistence is unique and customer-scoped",()=>{
 assert.match(sql,/primary key \(store_user_id, customer_id\)/i);
 assert.match(sql,/customer_id = \(select auth\.uid\(\)\)/i);
 assert.match(sql,/for delete to authenticated using \(customer_id = \(select auth\.uid\(\)\)\)/i);
 assert.match(sql,/get_seller_store_engagement/i);
 assert.match(sql,/returns table\(likes_count bigint, followers_count bigint, liked boolean, following boolean\)/i);
 assert.match(sql,/customers can view own store likes/i);
 assert.doesNotMatch(sql,/for select to anon, authenticated using \(true\)/i);
});
test("branding Storage is constrained to the authenticated seller folder",()=>{
 assert.match(sql,/\(storage\.foldername\(name\)\)\[1\] = \(select auth\.uid\(\)\)::text/i);
 assert.match(sql,/file_size_limit[\s\S]*5242880/);
});
test("Store Page exposes no store description or private seller address",()=>{
 assert.doesNotMatch(page,/store\.description|store_description|delivery_address|street_address/i);
 assert.match(page,/Public contact:/);
 assert.match(js,/eq\("status","approved"\)/);
});
test("no existing commerce tables are altered",()=>{
 assert.doesNotMatch(sql,/alter\s+table\s+public\.(products|orders|order_items|seller_fulfillments)/i);
});
