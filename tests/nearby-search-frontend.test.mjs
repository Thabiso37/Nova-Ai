import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const source = readFileSync(new URL("../nearby-search.js", import.meta.url), "utf8");

test("Nearby Search does not query seller location/store tables or calculate seller distances in the browser", () => {
  assert.doesNotMatch(source, /\.from\s*\(\s*["']seller_public_locations["']/);
  assert.doesNotMatch(source, /\.from\s*\(\s*["']seller_stores["']/);
  assert.doesNotMatch(source, /seller_id|\.phone\b|function\s+km\s*\(/);
  assert.doesNotMatch(source, /SUPABASE_SERVICE_ROLE_KEY|service_role/i);
  assert.doesNotMatch(source, /Authorization|Bearer\s*\+?\s*KEY/);
  assert.doesNotMatch(source, /p\._distance|l\.latitude|l\.longitude/);
  assert.match(source, /functions\/v1\/nearby-search/);
});

test("Nearby Search preserves all marketplaces, filters, locality, and server distance bands", () => {
  for (const market of ["all", "retail", "motors", "property"]) assert.ok(source.includes(market));
  for (const filter of ["p_search_text", "p_city", "p_suburb", "p_province", "p_radius_km", "distance_band"]) {
    assert.ok(source.includes(filter), "missing filter/result field: " + filter);
  }
});

test("seller call and WhatsApp actions still use property-contact-action", () => {
  assert.match(source, /functions\/v1\/property-contact-action/);
  assert.match(source, /contactUrl\(id,"call"\)/);
  assert.match(source, /contactUrl\(id,"whatsapp"\)/);
  assert.doesNotMatch(source, /wa\.me\//);
});

test("all existing marketplace pages load the updated Nearby Search script", () => {
  for (const file of ["index.html", "retail.html", "seller-motors-houses.html"]) {
    const html = readFileSync(new URL("../" + file, import.meta.url), "utf8");
    assert.match(html, /nearby-search\.js\?v=20261108-server-search-1/);
  }
});
