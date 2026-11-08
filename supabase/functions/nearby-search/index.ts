const SITE_ORIGIN = "https://thabiso37.github.io";
const ALLOWED_DISTANCE_BANDS = new Set(["0-5 km", "5-15 km", "15-30 km", "30+ km"]);

type SearchEnvironment = {
  SUPABASE_URL: string;
  SUPABASE_SERVICE_ROLE_KEY: string;
};

type RpcRow = Record<string, unknown>;

function cors(origin: string | null) {
  const headers = new Headers({
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store, private",
    "Referrer-Policy": "no-referrer",
    "Vary": "Origin",
  });
  if (origin === SITE_ORIGIN) {
    headers.set("Access-Control-Allow-Origin", SITE_ORIGIN);
    headers.set("Access-Control-Allow-Headers", "authorization, x-client-info, apikey, content-type");
    headers.set("Access-Control-Allow-Methods", "POST, OPTIONS");
  }
  return headers;
}

function jsonResponse(status: number, body: Record<string, unknown>, headers: Headers) {
  return new Response(JSON.stringify(body), { status, headers });
}

function cleanText(value: unknown, maxLength: number): string | null {
  if (value == null) return null;
  if (typeof value !== "string") return null;
  const clean = value.replace(/[\\u0000-\\u001F\\u007F]/g, " ").replace(/\\s+/g, " ").trim();
  if (clean.length > maxLength) throw new Error("A search filter is too long.");
  return clean || null;
}

function safeHttpUrl(value: unknown): string | null {
  if (typeof value !== "string") return null;
  try {
    const url = new URL(value);
    return url.protocol === "http:" || url.protocol === "https:" ? url.href : null;
  } catch {
    return null;
  }
}

function safeImages(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.map((entry) => {
    if (typeof entry === "string") return safeHttpUrl(entry);
    if (entry && typeof entry === "object" && "url" in entry) return safeHttpUrl((entry as { url?: unknown }).url);
    return null;
  }).filter((entry): entry is string => entry !== null).slice(0, 20);
}

function safeRow(row: RpcRow) {
  const distance = typeof row.distance_band === "string" && ALLOWED_DISTANCE_BANDS.has(row.distance_band)
    ? row.distance_band
    : null;
  const price = row.price == null ? null : Number(row.price);
  return {
    listing_id: Number.isSafeInteger(Number(row.listing_id)) ? Number(row.listing_id) : null,
    listing_name: typeof row.listing_name === "string" ? row.listing_name.slice(0, 240) : "",
    price: price !== null && Number.isFinite(price) ? price : null,
    category: typeof row.category === "string" ? row.category.slice(0, 120) : "",
    image_url: safeHttpUrl(row.image_url),
    images: safeImages(row.images),
    seller_display_name: typeof row.seller_display_name === "string" ? row.seller_display_name.slice(0, 120) : "",
    public_suburb: typeof row.public_suburb === "string" ? row.public_suburb.slice(0, 100) : null,
    public_city: typeof row.public_city === "string" ? row.public_city.slice(0, 100) : null,
    public_province: typeof row.public_province === "string" ? row.public_province.slice(0, 100) : null,
    distance_band: distance,
    listing_created_at: typeof row.listing_created_at === "string" ? row.listing_created_at : null,
  };
}

export async function handleNearbySearch(
  req: Request,
  env: SearchEnvironment,
  fetcher: typeof fetch = fetch,
): Promise<Response> {
  const origin = req.headers.get("origin");
  const headers = cors(origin);

  if (origin && origin !== SITE_ORIGIN) {
    return jsonResponse(403, { error: "This origin is not allowed." }, headers);
  }
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers });
  if (req.method !== "POST") return jsonResponse(405, { error: "Use POST for Nearby Search." }, headers);
  if (!req.headers.get("apikey")) return jsonResponse(401, { error: "A valid project API key is required." }, headers);

  if (!env.SUPABASE_URL || !env.SUPABASE_SERVICE_ROLE_KEY) {
    return jsonResponse(503, { error: "Nearby Search is temporarily unavailable." }, headers);
  }

  let body: Record<string, unknown>;
  try {
    const parsed: unknown = await req.json();
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error("Invalid request body.");
    body = parsed as Record<string, unknown>;
  } catch {
    return jsonResponse(400, { error: "Invalid Nearby Search request." }, headers);
  }

  const marketplace = body.p_marketplace;
  if (typeof marketplace !== "string" || !["all", "retail", "motors", "property"].includes(marketplace)) {
    return jsonResponse(400, { error: "Choose a valid marketplace." }, headers);
  }

  const lat = body.p_lat;
  const lon = body.p_lon;
  if ((lat == null) !== (lon == null)) {
    return jsonResponse(400, { error: "Latitude and longitude must be supplied together." }, headers);
  }
  if (lat != null && (typeof lat !== "number" || !Number.isFinite(lat) || lat < -90 || lat > 90)) {
    return jsonResponse(400, { error: "The device location is invalid." }, headers);
  }
  if (lon != null && (typeof lon !== "number" || !Number.isFinite(lon) || lon < -180 || lon > 180)) {
    return jsonResponse(400, { error: "The device location is invalid." }, headers);
  }

  const radius = body.p_radius_km == null ? 25 : Number(body.p_radius_km);
  if (!Number.isFinite(radius) || radius <= 0 || radius > 200) {
    return jsonResponse(400, { error: "Choose a search radius from 1 to 200 km." }, headers);
  }

  const limit = body.p_limit == null ? 50 : Number(body.p_limit);
  if (!Number.isInteger(limit) || limit < 1 || limit > 100) {
    return jsonResponse(400, { error: "The result limit is invalid." }, headers);
  }

  let searchText: string | null;
  let city: string | null;
  let suburb: string | null;
  let province: string | null;
  try {
    searchText = cleanText(body.p_search_text, 120);
    city = cleanText(body.p_city, 100);
    suburb = cleanText(body.p_suburb, 100);
    province = cleanText(body.p_province, 100);
  } catch {
    return jsonResponse(400, { error: "A search filter is too long." }, headers);
  }

  const rpcArguments = {
    p_marketplace: marketplace,
    p_lat: lat == null ? null : lat,
    p_lon: lon == null ? null : lon,
    p_radius_km: radius,
    p_search_text: searchText,
    p_city: city,
    p_suburb: suburb,
    p_province: province,
    p_limit: limit,
  };

  try {
    const rpcUrl = new URL("/rest/v1/rpc/search_nearby_listings", env.SUPABASE_URL).toString();
    const rpcResponse = await fetcher(rpcUrl, {
      method: "POST",
      headers: {
        "apikey": env.SUPABASE_SERVICE_ROLE_KEY,
        "Authorization": "Bearer " + env.SUPABASE_SERVICE_ROLE_KEY,
        "Content-Type": "application/json",
        "Accept": "application/json",
      },
      body: JSON.stringify(rpcArguments),
    });
    if (!rpcResponse.ok) {
      console.error("Nearby Search RPC failed with HTTP status", rpcResponse.status);
      return jsonResponse(502, { error: "Nearby Search is temporarily unavailable." }, headers);
    }
    const result: unknown = await rpcResponse.json();
    if (!Array.isArray(result)) {
      return jsonResponse(502, { error: "Nearby Search returned an invalid result." }, headers);
    }
    const safeResults = result.slice(0, limit).map((row) => safeRow(row as RpcRow));
    return jsonResponse(200, { listings: safeResults }, headers);
  } catch (error) {
    console.error("Nearby Search request failed:", error instanceof Error ? error.message : "unknown error");
    return jsonResponse(502, { error: "Nearby Search is temporarily unavailable." }, headers);
  }
}

if (import.meta.main) {
  Deno.serve((req: Request) => handleNearbySearch(req, {
    SUPABASE_URL: Deno.env.get("SUPABASE_URL") ?? "",
    SUPABASE_SERVICE_ROLE_KEY: Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "",
  }));
}
