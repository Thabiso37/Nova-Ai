-- NOVAAI Shared Advertisement Visit Analytics
-- Private visit ledger, server-side rate limiting and administrator-only summaries.
-- A visit is a recorded landing-page load, not a unique person or a purchase.

CREATE SCHEMA IF NOT EXISTS private;

CREATE TABLE IF NOT EXISTS private.novaai_ad_visit_events (
    event_id UUID PRIMARY KEY,
    campaign_code TEXT NOT NULL,
    board_id TEXT NOT NULL,
    landing_path TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS novaai_ad_visit_campaign_idx
ON private.novaai_ad_visit_events(campaign_code);

CREATE INDEX IF NOT EXISTS novaai_ad_visit_board_idx
ON private.novaai_ad_visit_events(board_id);

CREATE INDEX IF NOT EXISTS novaai_ad_visit_created_idx
ON private.novaai_ad_visit_events(created_at);

ALTER TABLE private.novaai_ad_visit_events ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON private.novaai_ad_visit_events
FROM PUBLIC, anon, authenticated, service_role;

-- One row per HMAC-fingerprinted client address; raw IP addresses are never stored.
CREATE TABLE IF NOT EXISTS private.novaai_ad_visit_rate_limits (
    client_fingerprint TEXT PRIMARY KEY
        CHECK (client_fingerprint ~ '^[0-9a-f]{64}$'),
    minute_bucket TIMESTAMPTZ NOT NULL,
    minute_count INTEGER NOT NULL CHECK (minute_count >= 1),
    hour_bucket TIMESTAMPTZ NOT NULL,
    hour_count INTEGER NOT NULL CHECK (hour_count >= 1),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE private.novaai_ad_visit_rate_limits ENABLE ROW LEVEL SECURITY;

CREATE INDEX IF NOT EXISTS novaai_ad_visit_rate_limits_updated_idx
ON private.novaai_ad_visit_rate_limits(updated_at);

REVOKE ALL ON private.novaai_ad_visit_rate_limits
FROM PUBLIC, anon, authenticated, service_role;

-- Fixed-window limits: 20 valid visit submissions per minute and 300 per hour
-- for each HMAC client fingerprint. The upsert is atomic under concurrent requests.
CREATE OR REPLACE FUNCTION public.consume_novaai_ad_visit_rate_limit_v1(
    p_client_fingerprint TEXT
)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, private
AS $$
DECLARE
    minute_window TIMESTAMPTZ := date_trunc('minute', clock_timestamp());
    hour_window TIMESTAMPTZ := date_trunc('hour', clock_timestamp());
    allowed BOOLEAN := FALSE;
BEGIN
    IF p_client_fingerprint IS NULL
       OR p_client_fingerprint !~ '^[0-9a-f]{64} AS current_limit (
        client_fingerprint,
        minute_bucket,
        minute_count,
        hour_bucket,
        hour_count,
        updated_at
    )
    VALUES (
        p_client_fingerprint,
        minute_window,
        1,
        hour_window,
        1,
        clock_timestamp()
    )
    ON CONFLICT (client_fingerprint) DO UPDATE
    SET
        minute_bucket = CASE
            WHEN current_limit.minute_bucket < minute_window
                THEN minute_window
            ELSE current_limit.minute_bucket
        END,
        minute_count = CASE
            WHEN current_limit.minute_bucket < minute_window
                THEN 1
            ELSE current_limit.minute_count + 1
        END,
        hour_bucket = CASE
            WHEN current_limit.hour_bucket < hour_window
                THEN hour_window
            ELSE current_limit.hour_bucket
        END,
        hour_count = CASE
            WHEN current_limit.hour_bucket < hour_window
                THEN 1
            ELSE current_limit.hour_count + 1
        END,
        updated_at = clock_timestamp()
    WHERE
        (current_limit.minute_bucket < minute_window
            OR current_limit.minute_count < 20)
        AND
        (current_limit.hour_bucket < hour_window
            OR current_limit.hour_count < 300)
    RETURNING TRUE INTO allowed;

    RETURN COALESCE(allowed, FALSE);
END;
$$;

REVOKE ALL ON FUNCTION
public.consume_novaai_ad_visit_rate_limit_v1(TEXT)
FROM PUBLIC, anon, authenticated, service_role;

GRANT EXECUTE ON FUNCTION
public.consume_novaai_ad_visit_rate_limit_v1(TEXT)
TO service_role;

-- The Edge Function is the only caller permitted to record visits.
CREATE OR REPLACE FUNCTION public.record_novaai_ad_visit_v1(
    p_event_id UUID,
    p_campaign_code TEXT,
    p_board_id TEXT,
    p_landing_path TEXT
)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, private
AS $$
DECLARE
    inserted_count INTEGER;
BEGIN
    IF p_event_id IS NULL
       OR p_campaign_code IS NULL
       OR p_board_id IS NULL
       OR length(trim(p_campaign_code)) = 0
       OR length(trim(p_campaign_code)) > 150
       OR trim(p_campaign_code) !~ '^[A-Za-z0-9_-]{1,150}$'
       OR length(trim(p_board_id)) = 0
       OR length(trim(p_board_id)) > 100 THEN
        RAISE EXCEPTION 'Invalid visit event';
    END IF;

    IF trim(p_board_id) NOT IN (
        'home_hero',
        'shop_tv',
        'cart_banner',
        'wishlist_banner',
        'motors_banner',
        'property_banner',
        'shop_footer',
        'motors_footer',
        'property_footer'
    ) THEN
        RAISE EXCEPTION 'Unknown advertising board';
    END IF;

    IF NOT EXISTS (
        SELECT 1
        FROM public.novaai_ad_campaigns c
        WHERE c.campaign_code = trim(p_campaign_code)
    ) THEN
        RAISE EXCEPTION 'Unknown campaign';
    END IF;

    INSERT INTO private.novaai_ad_visit_events (
        event_id,
        campaign_code,
        board_id,
        landing_path
    )
    VALUES (
        p_event_id,
        trim(p_campaign_code),
        trim(p_board_id),
        left(coalesce(p_landing_path, '/'), 500)
    )
    ON CONFLICT (event_id) DO NOTHING;

    GET DIAGNOSTICS inserted_count = ROW_COUNT;

    RETURN inserted_count = 1;
END;
$$;

REVOKE ALL ON FUNCTION
public.record_novaai_ad_visit_v1(UUID, TEXT, TEXT, TEXT)
FROM PUBLIC, anon, authenticated, service_role;

GRANT EXECUTE ON FUNCTION
public.record_novaai_ad_visit_v1(UUID, TEXT, TEXT, TEXT)
TO service_role;

-- Admin-only aggregate reporting. The private event ledger is never returned.
CREATE OR REPLACE FUNCTION public.get_novaai_ad_visit_analytics_v1()
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, private, auth
AS $$
DECLARE
    result JSONB;
BEGIN
    IF auth.uid() IS DISTINCT FROM
       '2fc320e9-40b6-407f-9e71-e8a1999956a7'::UUID THEN
        RAISE EXCEPTION 'Administrator access required';
    END IF;

    WITH campaign_visit_counts AS (
        SELECT
            campaign_code,
            COUNT(*)::BIGINT AS visit_count,
            MAX(created_at) AS last_visit_at
        FROM private.novaai_ad_visit_events
        GROUP BY campaign_code
    ),
    campaign_rows AS (
        SELECT
            c.campaign_code,
            c.title,
            COALESCE(s.share_count, 0)::BIGINT AS share_count,
            COALESCE(v.visit_count, 0)::BIGINT AS visit_count,
            v.last_visit_at
        FROM public.novaai_ad_campaigns c
        LEFT JOIN private.novaai_ad_campaign_share_counts s
            ON s.campaign_code = c.campaign_code
        LEFT JOIN campaign_visit_counts v
            ON v.campaign_code = c.campaign_code
    ),
    board_rows AS (
        SELECT
            boards.board_id,
            COUNT(events.event_id)::BIGINT AS visit_count
        FROM unnest(ARRAY[
            'home_hero',
            'shop_tv',
            'cart_banner',
            'wishlist_banner',
            'motors_banner',
            'property_banner',
            'shop_footer',
            'motors_footer',
            'property_footer'
        ]::TEXT[]) AS boards(board_id)
        LEFT JOIN private.novaai_ad_visit_events events
            ON events.board_id = boards.board_id
        GROUP BY boards.board_id
    )
    SELECT jsonb_build_object(
        'total_visits',
            COALESCE((SELECT SUM(visit_count) FROM campaign_visit_counts), 0),
        'campaigns_generating_visits',
            (SELECT COUNT(*) FROM campaign_visit_counts WHERE visit_count > 0),
        'most_visited_campaign',
            (
                SELECT jsonb_build_object(
                    'campaign_code', campaign_code,
                    'title', title,
                    'visit_count', visit_count
                )
                FROM campaign_rows
                WHERE visit_count > 0
                ORDER BY visit_count DESC, campaign_code ASC
                LIMIT 1
            ),
        'best_performing_board',
            (
                SELECT jsonb_build_object(
                    'board_id', board_id,
                    'visit_count', visit_count
                )
                FROM board_rows
                WHERE visit_count > 0
                ORDER BY visit_count DESC, board_id ASC
                LIMIT 1
            ),
        'last_visit_at',
            (SELECT MAX(last_visit_at) FROM campaign_visit_counts),
        'campaigns',
            COALESCE(
                (
                    SELECT jsonb_agg(
                        jsonb_build_object(
                            'campaign_code', campaign_code,
                            'title', title,
                            'share_count', share_count,
                            'visit_count', visit_count,
                            'last_visit_at', last_visit_at
                        )
                        ORDER BY visit_count DESC, campaign_code ASC
                    )
                    FROM campaign_rows
                ),
                '[]'::JSONB
            ),
        'boards',
            COALESCE(
                (
                    SELECT jsonb_agg(
                        jsonb_build_object(
                            'board_id', board_id,
                            'visit_count', visit_count
                        )
                        ORDER BY visit_count DESC, board_id ASC
                    )
                    FROM board_rows
                ),
                '[]'::JSONB
            )
    )
    INTO result;

    RETURN result;
END;
$$;

REVOKE ALL ON FUNCTION
public.get_novaai_ad_visit_analytics_v1()
FROM PUBLIC, anon, authenticated, service_role;

GRANT EXECUTE ON FUNCTION
public.get_novaai_ad_visit_analytics_v1()
TO authenticated;
 THEN
        RAISE EXCEPTION 'Invalid rate-limit fingerprint';
    END IF;

    -- Keep only recently active fingerprints; no raw client addresses are stored.
    DELETE FROM private.novaai_ad_visit_rate_limits
    WHERE updated_at < clock_timestamp() - INTERVAL '24 hours';

    INSERT INTO private.novaai_ad_visit_rate_limits AS current_limit (
        client_fingerprint,
        minute_bucket,
        minute_count,
        hour_bucket,
        hour_count,
        updated_at
    )
    VALUES (
        p_client_fingerprint,
        minute_window,
        1,
        hour_window,
        1,
        clock_timestamp()
    )
    ON CONFLICT (client_fingerprint) DO UPDATE
    SET
        minute_bucket = CASE
            WHEN current_limit.minute_bucket < minute_window
                THEN minute_window
            ELSE current_limit.minute_bucket
        END,
        minute_count = CASE
            WHEN current_limit.minute_bucket < minute_window
                THEN 1
            ELSE current_limit.minute_count + 1
        END,
        hour_bucket = CASE
            WHEN current_limit.hour_bucket < hour_window
                THEN hour_window
            ELSE current_limit.hour_bucket
        END,
        hour_count = CASE
            WHEN current_limit.hour_bucket < hour_window
                THEN 1
            ELSE current_limit.hour_count + 1
        END,
        updated_at = clock_timestamp()
    WHERE
        (current_limit.minute_bucket < minute_window
            OR current_limit.minute_count < 20)
        AND
        (current_limit.hour_bucket < hour_window
            OR current_limit.hour_count < 300)
    RETURNING TRUE INTO allowed;

    RETURN COALESCE(allowed, FALSE);
END;
$$;

REVOKE ALL ON FUNCTION
public.consume_novaai_ad_visit_rate_limit_v1(TEXT)
FROM PUBLIC, anon, authenticated, service_role;

GRANT EXECUTE ON FUNCTION
public.consume_novaai_ad_visit_rate_limit_v1(TEXT)
TO service_role;

-- The Edge Function is the only caller permitted to record visits.
CREATE OR REPLACE FUNCTION public.record_novaai_ad_visit_v1(
    p_event_id UUID,
    p_campaign_code TEXT,
    p_board_id TEXT,
    p_landing_path TEXT
)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, private
AS $$
DECLARE
    inserted_count INTEGER;
BEGIN
    IF p_event_id IS NULL
       OR p_campaign_code IS NULL
       OR p_board_id IS NULL
       OR length(trim(p_campaign_code)) = 0
       OR length(trim(p_campaign_code)) > 150
       OR trim(p_campaign_code) !~ '^[A-Za-z0-9_-]{1,150}$'
       OR length(trim(p_board_id)) = 0
       OR length(trim(p_board_id)) > 100 THEN
        RAISE EXCEPTION 'Invalid visit event';
    END IF;

    IF trim(p_board_id) NOT IN (
        'home_hero',
        'shop_tv',
        'cart_banner',
        'wishlist_banner',
        'motors_banner',
        'property_banner',
        'shop_footer',
        'motors_footer',
        'property_footer'
    ) THEN
        RAISE EXCEPTION 'Unknown advertising board';
    END IF;

    IF NOT EXISTS (
        SELECT 1
        FROM public.novaai_ad_campaigns c
        WHERE c.campaign_code = trim(p_campaign_code)
    ) THEN
        RAISE EXCEPTION 'Unknown campaign';
    END IF;

    INSERT INTO private.novaai_ad_visit_events (
        event_id,
        campaign_code,
        board_id,
        landing_path
    )
    VALUES (
        p_event_id,
        trim(p_campaign_code),
        trim(p_board_id),
        left(coalesce(p_landing_path, '/'), 500)
    )
    ON CONFLICT (event_id) DO NOTHING;

    GET DIAGNOSTICS inserted_count = ROW_COUNT;

    RETURN inserted_count = 1;
END;
$$;

REVOKE ALL ON FUNCTION
public.record_novaai_ad_visit_v1(UUID, TEXT, TEXT, TEXT)
FROM PUBLIC, anon, authenticated, service_role;

GRANT EXECUTE ON FUNCTION
public.record_novaai_ad_visit_v1(UUID, TEXT, TEXT, TEXT)
TO service_role;

-- Admin-only aggregate reporting. The private event ledger is never returned.
CREATE OR REPLACE FUNCTION public.get_novaai_ad_visit_analytics_v1()
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, private, auth
AS $$
DECLARE
    result JSONB;
BEGIN
    IF auth.uid() IS DISTINCT FROM
       '2fc320e9-40b6-407f-9e71-e8a1999956a7'::UUID THEN
        RAISE EXCEPTION 'Administrator access required';
    END IF;

    WITH campaign_visit_counts AS (
        SELECT
            campaign_code,
            COUNT(*)::BIGINT AS visit_count,
            MAX(created_at) AS last_visit_at
        FROM private.novaai_ad_visit_events
        GROUP BY campaign_code
    ),
    campaign_rows AS (
        SELECT
            c.campaign_code,
            c.title,
            COALESCE(s.share_count, 0)::BIGINT AS share_count,
            COALESCE(v.visit_count, 0)::BIGINT AS visit_count,
            v.last_visit_at
        FROM public.novaai_ad_campaigns c
        LEFT JOIN private.novaai_ad_campaign_share_counts s
            ON s.campaign_code = c.campaign_code
        LEFT JOIN campaign_visit_counts v
            ON v.campaign_code = c.campaign_code
    ),
    board_rows AS (
        SELECT
            boards.board_id,
            COUNT(events.event_id)::BIGINT AS visit_count
        FROM unnest(ARRAY[
            'home_hero',
            'shop_tv',
            'cart_banner',
            'wishlist_banner',
            'motors_banner',
            'property_banner',
            'shop_footer',
            'motors_footer',
            'property_footer'
        ]::TEXT[]) AS boards(board_id)
        LEFT JOIN private.novaai_ad_visit_events events
            ON events.board_id = boards.board_id
        GROUP BY boards.board_id
    )
    SELECT jsonb_build_object(
        'total_visits',
            COALESCE((SELECT SUM(visit_count) FROM campaign_visit_counts), 0),
        'campaigns_generating_visits',
            (SELECT COUNT(*) FROM campaign_visit_counts WHERE visit_count > 0),
        'most_visited_campaign',
            (
                SELECT jsonb_build_object(
                    'campaign_code', campaign_code,
                    'title', title,
                    'visit_count', visit_count
                )
                FROM campaign_rows
                WHERE visit_count > 0
                ORDER BY visit_count DESC, campaign_code ASC
                LIMIT 1
            ),
        'best_performing_board',
            (
                SELECT jsonb_build_object(
                    'board_id', board_id,
                    'visit_count', visit_count
                )
                FROM board_rows
                WHERE visit_count > 0
                ORDER BY visit_count DESC, board_id ASC
                LIMIT 1
            ),
        'last_visit_at',
            (SELECT MAX(last_visit_at) FROM campaign_visit_counts),
        'campaigns',
            COALESCE(
                (
                    SELECT jsonb_agg(
                        jsonb_build_object(
                            'campaign_code', campaign_code,
                            'title', title,
                            'share_count', share_count,
                            'visit_count', visit_count,
                            'last_visit_at', last_visit_at
                        )
                        ORDER BY visit_count DESC, campaign_code ASC
                    )
                    FROM campaign_rows
                ),
                '[]'::JSONB
            ),
        'boards',
            COALESCE(
                (
                    SELECT jsonb_agg(
                        jsonb_build_object(
                            'board_id', board_id,
                            'visit_count', visit_count
                        )
                        ORDER BY visit_count DESC, board_id ASC
                    )
                    FROM board_rows
                ),
                '[]'::JSONB
            )
    )
    INTO result;

    RETURN result;
END;
$$;

REVOKE ALL ON FUNCTION
public.get_novaai_ad_visit_analytics_v1()
FROM PUBLIC, anon, authenticated, service_role;

GRANT EXECUTE ON FUNCTION
public.get_novaai_ad_visit_analytics_v1()
TO authenticated;
