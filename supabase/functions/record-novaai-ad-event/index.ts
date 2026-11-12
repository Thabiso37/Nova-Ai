import { createClient } from "npm:@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "https://thabiso37.github.io",
  "Access-Control-Allow-Headers": "apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Content-Type": "application/json",
};

function jsonResponse(status: number, body: Record<string, unknown>) {
  return new Response(JSON.stringify(body), { status, headers: corsHeaders });
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

const allowedOrigin = "https://thabiso37.github.io";
const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

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
  const eventType = body.event_type;

  if (eventType !== "share") {
    return jsonResponse(400, { error: "Only share events are accepted by this endpoint" });
  }
  if (!uuidPattern.test(eventId)) {
    return jsonResponse(400, { error: "A valid share event UUID is required" });
  }
  if (!campaignCode || campaignCode.length > 120) {
    return jsonResponse(400, { error: "A valid campaign code is required" });
  }

  const now = new Date().toISOString();
  const { data: campaign, error: campaignError } = await supabaseAdmin
    .from("novaai_ad_campaigns")
    .select("campaign_code")
    .eq("campaign_code", campaignCode)
    .eq("status", "active")
    .or(`starts_at.is.null,starts_at.lte.${now}`)
    .or(`ends_at.is.null,ends_at.gt.${now}`)
    .maybeSingle();

  if (campaignError) {
    console.error("Share campaign validation failed:", campaignError.message);
    return jsonResponse(500, { error: "Campaign validation failed" });
  }
  if (!campaign) {
    return jsonResponse(400, { error: "Campaign is not active" });
  }

  const { data: recorded, error: recordError } = await supabaseAdmin.rpc(
    "record_novaai_ad_share_v1",
    {
      p_event_id: eventId,
      p_campaign_code: campaign.campaign_code,
    },
  );

  if (recordError) {
    console.error("Share event recording failed:", recordError.message);
    return jsonResponse(500, { error: "Share event could not be recorded" });
  }

  return jsonResponse(200, {
    ok: true,
    duplicate: recorded === false,
  });
});
