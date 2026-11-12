/* NOVAAI Shared Advertisement Visit Tracking
 * Records one attributed landing-page load. This is not a unique-person metric.
 */
(function () {
  "use strict";

  const params = new URLSearchParams(window.location.search);
  if (params.get("nova_share") !== "1") return;

  const campaignCode = (params.get("nova_campaign") || "").trim();
  const boardId = (params.get("nova_board") || "").trim();

  const allowedBoards = new Set([
    "home_hero",
    "shop_tv",
    "cart_banner",
    "wishlist_banner",
    "motors_banner",
    "property_banner",
    "shop_footer",
    "motors_footer",
    "property_footer"
  ]);

  if (!/^[A-Za-z0-9_-]{1,150}$/.test(campaignCode)) return;
  if (!allowedBoards.has(boardId)) return;
  if (!window.crypto || typeof window.crypto.randomUUID !== "function") return;

  // Reuse the already-initialized public Supabase client on each destination page.
  const trackingClient =
    typeof sb !== "undefined" && sb
      ? sb
      : typeof client !== "undefined" && client
        ? client
        : null;

  if (
    !trackingClient ||
    !trackingClient.supabaseUrl ||
    !trackingClient.supabaseKey
  ) {
    console.error("NOVAAI visit tracking is unavailable: Supabase client not found.");
    return;
  }

  const eventId = window.crypto.randomUUID();

  async function recordVisit() {
    try {
      const response = await fetch(
        trackingClient.supabaseUrl.replace(/\/$/, "") +
          "/functions/v1/record-novaai-ad-visit",
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "apikey": trackingClient.supabaseKey
          },
          body: JSON.stringify({
            event_id: eventId,
            campaign_code: campaignCode,
            board_id: boardId,
            landing_path: window.location.pathname
          }),
          keepalive: true
        }
      );

      if (!response.ok) {
        console.error("NOVAAI visit tracking failed:", response.status);
      }
    } catch (error) {
      console.error("NOVAAI visit tracking error:", error);
    }
  }

  recordVisit();
})();
