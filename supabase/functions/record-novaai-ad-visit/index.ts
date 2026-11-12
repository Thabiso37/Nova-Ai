import { createClient } from "npm:@supabase/supabase-js@2";

const allowedOrigin = "https://thabiso37.github.io";
const allowedBoards = new Set([
  "home_hero",
  "shop_tv",
  "cart_banner",
  "wishlist_banner",
  "motors_banner",
  "property_banner",
  "shop_footer",
  "motors_footer",
  "property_footer",
]);

const corsHeaders = {
  "Access-Control-Allow-Origin": allowedOrigin,
  "Access-Control-Allow-Headers": "apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Content-Type": "application/json",
  "Vary": "Origin",
};

function jsonResponse(status: number, body: Record<string, unknown>, extraHeaders: Record<string, string> = {}) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, ...extraHeaders },
  });
}

function getDefaultKey(raw: string | undefined): string | null {
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw);
    return typeof parsed.default === "string" ? parsed.default : null;
  } catch {
    return null;
  }
}

const supabaseUrl = Deno.env.get("SUPABASE_URL");
const secretKey =
  getDefaultKey(Deno.env.get("SUPABASE_SECRET_KEYS")) ??
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
const publishableKey =
  getDefaultKey(Deno.env.get("SUPABASE_PUBLISHABLE_KEYS")) ??
  Deno.env.get("SUPABASE_ANON_KEY");

if (!supabaseUrl || !secretKey || !publishableKey) {
  throw new Error("Required Supabase Edge Function environment configuration is missing");
}

const supabaseAdmin = createClient(supabaseUrl, secretKey, {
  auth: { persistSession: false, autoRefreshToken: false },
});

const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const campaignPattern = /^[A-Za-z0-9_-]{1,150}$/;

function getClientIp(req: Request): string | null {
  const direct = req.headers.get("cf-connecting-ip") ??
    req.headers.get("x-real-ip");
  const forwarded = req.headers.get("x-forwarded-for");
  const candidate = (direct || (forwarded ? forwarded.split(",")[0] : "")).trim();
  if (!candidate || candidate.length > 64 || !/^[0-9a-fA-F:.]+$/.test(candidate)) {
    return null;
  }
  return candidate;
}

async function fingerprintClientIp(ip: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secretKey!),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const signature = await crypto.subtle.sign(
    "HMAC",
    key,
    new TextEncoder().encode(ip),
  );
  return Array.from(new Uint8Array(signature), byte =>
    byte.toString(16).padStart(2, "0")
  ).join("");
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    if (req.headers.get("origin") !== allowedOrigin) {
      return jsonResponse(403, { error: "Origin not allowed" });
    }
    return new Response("ok", { status: 200, headers: corsHeaders });
  }

  if (req.method !== "POST") {
    return jsonResponse(405, { error: "Method not allowed" });
  }

  if (req.headers.get("origin") !== allowedOrigin) {
    return jsonResponse(403, { error: "Origin not allowed" });
  }

  if (req.headers.get("apikey") !== publishableKey) {
    return jsonResponse(401, { error: "Invalid API key" });
  }

  const contentLength = Number(req.headers.get("content-length") || 0);
  if (contentLength > 4096) {
    return jsonResponse(413, { error: "Request body is too large" });
  }

  let payload: unknown;
  try {
    payload = await req.json();
  } catch {
    return jsonResponse(400, { error: "Invalid JSON body" });
  }

  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    return jsonResponse(400, { error: "Invalid request body" });
  }

  const body = payload as Record<string, unknown>;
  const eventId = typeof body.event_id === "string" ? body.event_id.trim() : "";
  const campaignCode = typeof body.campaign_code === "string"
    ? body.campaign_code.trim()
    : "";
  const boardId = typeof body.board_id === "string" ? body.board_id.trim() : "";
  const landingPath = typeof body.landing_path === "string"
    ? body.landing_path
    : "/";

  if (!uuidPattern.test(eventId)) {
    return jsonResponse(400, { error: "A valid visit event UUID is required" });
  }
  if (!campaignPattern.test(campaignCode)) {
    return jsonResponse(400, { error: "A valid campaign code is required" });
  }
  if (!allowedBoards.has(boardId)) {
    return jsonResponse(400, { error: "Unknown advertising board" });
  }
  if (
    landingPath.length > 500 ||
    !landingPath.startsWith("/") ||
    landingPath.startsWith("//") ||
    /[\u0000-\u001f\u007f]/.test(landingPath)
  ) {
    return jsonResponse(400, { error: "Invalid landing path" });
  }

  // Supabase's edge gateway supplies the client address in its forwarding headers.
  // Only an HMAC fingerprint reaches Postgres; the raw address is not persisted.
  const clientIp = getClientIp(req);
  if (!clientIp) {
    return jsonResponse(503, { error: "Visit tracking is temporarily unavailable" });
  }

  let fingerprint: string;
  try {
    fingerprint = await fingerprintClientIp(clientIp);
  } catch (error) {
    console.error("Visit rate-limit fingerprint failed:", error);
    return jsonResponse(503, { error: "Visit tracking is temporarily unavailable" });
  }

  const { data: allowed, error: limitError } = await supabaseAdmin.rpc(
    "consume_novaai_ad_visit_rate_limit_v1",
    { p_client_fingerprint: fingerprint },
  );

  if (limitError) {
    console.error("Visit rate-limit check failed:", limitError.message);
    return jsonResponse(503, { error: "Visit tracking is temporarily unavailable" });
  }
  if (allowed !== true) {
    return jsonResponse(
      429,
      { error: "Visit tracking rate limit exceeded" },
      { "Retry-After": "60" },
    );
  }

  const { data: recorded, error: recordError } = await supabaseAdmin.rpc(
    "record_novaai_ad_visit_v1",
    {
      p_event_id: eventId,
      p_campaign_code: campaignCode,
      p_board_id: boardId,
      p_landing_path: landingPath,
    },
  );

  if (recordError) {
    console.error("Visit event recording failed:", recordError.message);
    if (recordError.message.includes("Unknown campaign")) {
      return jsonResponse(400, { error: "Unknown campaign" });
    }
    return jsonResponse(500, { error: "Visit event could not be recorded" });
  }

  return jsonResponse(200, {
    ok: true,
    recorded: recorded === true,
    duplicate: recorded === false,
  });
});
