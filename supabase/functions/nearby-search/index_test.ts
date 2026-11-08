import { handleNearbySearch } from "./index.ts";

const ENV = {
  SUPABASE_URL: "https://test-project.supabase.co",
  SUPABASE_SERVICE_ROLE_KEY: "server-only-service-role-secret",
  SUPABASE_PUBLISHABLE_KEYS: JSON.stringify({ default: "sb_publishable_test_key" }),
};
const ORIGIN = "https://thabiso37.github.io";
const BASE_BODY = {
  p_marketplace: "retail",
  p_lat: -25.75,
  p_lon: 28.19,
  p_radius_km: 25,
  p_search_text: "shoes",
  p_city: "Pretoria",
  p_suburb: "Central",
  p_province: "Gauteng",
  p_limit: 50,
};
function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}
function request(body: unknown = BASE_BODY, extraHeaders: Record<string, string> = {}) {
  return new Request("https://test-project.functions.supabase.co/nearby-search", {
    method: "POST",
    headers: {
      "origin": ORIGIN,
      "apikey": "sb_publishable_test_key",
      "content-type": "application/json",
      ...extraHeaders,
    },
    body: JSON.stringify(body),
  });
}

Deno.test("Edge Function sends the restricted RPC request with the server-only service role", async () => {
  let called = false;
  const response = await handleNearbySearch(request(), ENV, async (input, init) => {
    called = true;
    assert(String(input) === "https://test-project.supabase.co/rest/v1/rpc/search_nearby_listings", "wrong RPC URL");
    const headers = new Headers(init?.headers);
    assert(headers.get("apikey") === ENV.SUPABASE_SERVICE_ROLE_KEY, "service role key was not used for RPC");
    assert(headers.get("Authorization") === "Bearer " + ENV.SUPABASE_SERVICE_ROLE_KEY, "service role bearer header missing");
    const sent = JSON.parse(String(init?.body));
    assert(sent.p_marketplace === "retail" && sent.p_city === "Pretoria", "search filters were not forwarded");
    return new Response(JSON.stringify([{
      listing_id: 81,
      listing_name: "Test listing",
      price: "125",
      category: "Clothing",
      image_url: "https://images.example.test/a.jpg",
      images: ["https://images.example.test/b.jpg", "javascript:alert(1)"],
      seller_display_name: "Approved shop",
      public_suburb: "Central",
      public_city: "Pretoria",
      public_province: "Gauteng",
      distance_band: "5-15 km",
      listing_created_at: "2026-11-08T10:00:00Z",
      seller_id: "private-seller-id",
      user_id: "private-user-id",
      phone: "private-phone",
      latitude: -25.75,
      longitude: 28.19,
      approval_status: "approved",
      public_location_enabled: true,
    }]), { status: 200, headers: { "content-type": "application/json" } });
  });
  assert(called, "RPC was not called");
  assert(response.status === 200, "expected HTTP 200");
  const body = await response.json();
  assert(body.listings.length === 1, "expected one listing");
  const row = body.listings[0];
  const expected = ["listing_id","listing_name","price","category","image_url","images","seller_display_name","public_suburb","public_city","public_province","distance_band","listing_created_at"].sort();
  assert(JSON.stringify(Object.keys(row).sort()) === JSON.stringify(expected), "response did not match the strict safe-field allowlist");
  assert(!("seller_id" in row) && !("user_id" in row) && !("phone" in row), "private seller data leaked");
  assert(!("latitude" in row) && !("longitude" in row), "coordinates leaked");
  assert(!("approval_status" in row) && !("public_location_enabled" in row), "approval/consent metadata leaked");
  assert(row.images.length === 1, "unsafe image URL was not filtered");
  assert(row.distance_band === "5-15 km", "distance band was not preserved");
});

Deno.test("forwards each marketplace selector without rewriting it", async () => {
  for (const marketplace of ["all", "retail", "motors", "property"]) {
    const sent: Record<string, unknown>[] = [];
    const response = await handleNearbySearch(request({ ...BASE_BODY, p_marketplace: marketplace }), ENV, async (_input, init) => {
      sent.push(JSON.parse(String(init?.body)));
      return new Response("[]", { status: 200 });
    });
    assert(response.status === 200, "marketplace request failed: " + marketplace);
    assert(sent[0].p_marketplace === marketplace, "marketplace selector changed: " + marketplace);
  }
});

Deno.test("manual locality search forwards null device coordinates and locality filters", async () => {
  const sent: Record<string, unknown>[] = [];
  const body = { ...BASE_BODY, p_lat: null, p_lon: null, p_city: "Cape Town", p_suburb: null, p_province: "Western Cape" };
  const response = await handleNearbySearch(request(body), ENV, async (_input, init) => {
    sent.push(JSON.parse(String(init?.body)));
    return new Response("[]", { status: 200 });
  });
  assert(response.status === 200, "manual search failed");
  assert(sent[0].p_lat === null && sent[0].p_lon === null, "manual search unexpectedly included device coordinates");
  assert(sent[0].p_city === "Cape Town" && sent[0].p_province === "Western Cape", "locality filters were not preserved");
});

Deno.test("rejects incomplete or invalid coordinates before contacting the database", async () => {
  let called = false;
  const response = await handleNearbySearch(request({ ...BASE_BODY, p_lon: null }), ENV, async () => {
    called = true;
    return new Response("[]");
  });
  assert(response.status === 400 && !called, "invalid coordinate pair was not rejected");
});

Deno.test("rejects unknown browser origins", async () => {
  const response = await handleNearbySearch(request(BASE_BODY, { origin: "https://attacker.example" }), ENV, async () => {
    throw new Error("RPC should not run for an unapproved origin");
  });
  assert(response.status === 403, "unknown origin was not rejected");
});

Deno.test("requires the public project API key header and only accepts POST", async () => {
  const missingKey = new Request("https://test-project.functions.supabase.co/nearby-search", {
    method: "POST",
    headers: { "origin": ORIGIN, "content-type": "application/json" },
    body: JSON.stringify(BASE_BODY),
  });
  const denied = await handleNearbySearch(missingKey, ENV, async () => new Response("[]"));
  assert(denied.status === 401, "missing apikey was not rejected");
  const get = await handleNearbySearch(new Request("https://test-project.functions.supabase.co/nearby-search", {
    method: "GET",
    headers: { "origin": ORIGIN, "apikey": "sb_publishable_test_key" },
  }), ENV);
  assert(get.status === 405, "GET was not rejected");
});

Deno.test("rejects an unrecognized public API key", async () => {
  const response = await handleNearbySearch(request(BASE_BODY, { apikey: "sb_publishable_wrong_key" }), ENV, async () => {
    throw new Error("RPC should not run with an invalid public API key");
  });
  assert(response.status === 401, "invalid public API key was not rejected");
});

Deno.test("does not return database error details to the browser", async () => {
  const response = await handleNearbySearch(request(), ENV, async () => new Response("sensitive database error text", { status: 500 }));
  assert(response.status === 502, "RPC failure did not produce a generic gateway error");
  const body = await response.text();
  assert(!body.includes("sensitive database error text"), "database error details leaked");
});

Deno.test("supports CORS preflight for the NOVAAI Pages origin", async () => {
  const response = await handleNearbySearch(new Request("https://test-project.functions.supabase.co/nearby-search", {
    method: "OPTIONS",
    headers: { "origin": ORIGIN },
  }), ENV);
  assert(response.status === 204, "preflight did not succeed");
  assert(response.headers.get("Access-Control-Allow-Origin") === ORIGIN, "CORS origin missing");
});
