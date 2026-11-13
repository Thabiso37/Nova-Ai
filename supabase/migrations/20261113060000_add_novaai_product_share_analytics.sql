-- NOVAAI product share analytics. Independent from advertisement event ledgers.
CREATE SCHEMA IF NOT EXISTS private;
CREATE TABLE private.novaai_product_share_events (
 event_id UUID PRIMARY KEY, product_id BIGINT NOT NULL CHECK(product_id>0),
 marketplace TEXT NOT NULL CHECK(marketplace IN ('retail','motors','property')),
 share_location TEXT NOT NULL CHECK(share_location IN ('product_card','detail_page')),
 created_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp()
);
CREATE INDEX novaai_product_share_product_created_idx ON private.novaai_product_share_events(product_id,created_at DESC);
CREATE INDEX novaai_product_share_marketplace_created_idx ON private.novaai_product_share_events(marketplace,created_at DESC);
ALTER TABLE private.novaai_product_share_events ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE private.novaai_product_share_events FROM PUBLIC,anon,authenticated,service_role;
-- Only HMAC fingerprints are persisted; raw IP addresses are never stored.
CREATE TABLE private.novaai_product_share_rate_limits (
 client_fingerprint TEXT PRIMARY KEY CHECK(client_fingerprint ~ '^[0-9a-f]{64}$'),
 minute_bucket TIMESTAMPTZ NOT NULL,minute_count INTEGER NOT NULL CHECK(minute_count>=1),
 hour_bucket TIMESTAMPTZ NOT NULL,hour_count INTEGER NOT NULL CHECK(hour_count>=1),
 updated_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp()
);
ALTER TABLE private.novaai_product_share_rate_limits ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE private.novaai_product_share_rate_limits FROM PUBLIC,anon,authenticated,service_role;
CREATE INDEX novaai_product_share_rate_limits_updated_idx ON private.novaai_product_share_rate_limits(updated_at);
CREATE OR REPLACE FUNCTION public.consume_novaai_product_share_rate_limit_v1(p_client_fingerprint TEXT)
RETURNS BOOLEAN LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,private AS $function$
DECLARE minute_window TIMESTAMPTZ:=date_trunc('minute',clock_timestamp());hour_window TIMESTAMPTZ:=date_trunc('hour',clock_timestamp());allowed BOOLEAN:=FALSE;
BEGIN
 IF p_client_fingerprint IS NULL OR p_client_fingerprint !~ '^[0-9a-f]{64}$' THEN RAISE EXCEPTION 'Invalid product share rate-limit fingerprint'; END IF;
 DELETE FROM private.novaai_product_share_rate_limits WHERE updated_at<clock_timestamp()-INTERVAL '24 hours';
 INSERT INTO private.novaai_product_share_rate_limits AS current_limit(client_fingerprint,minute_bucket,minute_count,hour_bucket,hour_count,updated_at)
 VALUES(p_client_fingerprint,minute_window,1,hour_window,1,clock_timestamp())
 ON CONFLICT(client_fingerprint) DO UPDATE SET
 minute_bucket=CASE WHEN current_limit.minute_bucket<minute_window THEN minute_window ELSE current_limit.minute_bucket END,
 minute_count=CASE WHEN current_limit.minute_bucket<minute_window THEN 1 ELSE current_limit.minute_count+1 END,
 hour_bucket=CASE WHEN current_limit.hour_bucket<hour_window THEN hour_window ELSE current_limit.hour_bucket END,
 hour_count=CASE WHEN current_limit.hour_bucket<hour_window THEN 1 ELSE current_limit.hour_count+1 END,
 updated_at=clock_timestamp()
 WHERE (current_limit.minute_bucket<minute_window OR current_limit.minute_count<20)
 AND (current_limit.hour_bucket<hour_window OR current_limit.hour_count<300)
 RETURNING TRUE INTO allowed;
 RETURN COALESCE(allowed,FALSE);
END;$function$;
REVOKE ALL ON FUNCTION public.consume_novaai_product_share_rate_limit_v1(TEXT) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.consume_novaai_product_share_rate_limit_v1(TEXT) TO service_role;
CREATE OR REPLACE FUNCTION public.record_novaai_product_share_v1(p_event_id UUID,p_product_id BIGINT,p_marketplace TEXT,p_share_location TEXT)
RETURNS BOOLEAN LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public,private AS $function$
DECLARE inserted_count INTEGER;
BEGIN
 IF p_event_id IS NULL OR p_product_id IS NULL OR p_product_id<=0
 OR p_marketplace NOT IN('retail','motors','property')
 OR p_share_location NOT IN('product_card','detail_page') THEN RAISE EXCEPTION 'Invalid product share event'; END IF;
 IF NOT EXISTS(SELECT 1 FROM public."Products" p WHERE p.id=p_product_id AND p.status='approved'
 AND CASE p_marketplace
 WHEN 'retail' THEN COALESCE(p.category,'') NOT IN('Auto','Motors & Vehicles','Property For Sale','Property To Rent')
 WHEN 'motors' THEN COALESCE(p.category,'') IN('Auto','Motors & Vehicles')
 WHEN 'property' THEN COALESCE(p.category,'') IN('Property For Sale','Property To Rent')
 ELSE FALSE END) THEN RAISE EXCEPTION 'Approved product not found in the selected marketplace'; END IF;
 INSERT INTO private.novaai_product_share_events(event_id,product_id,marketplace,share_location,created_at)
 VALUES(p_event_id,p_product_id,p_marketplace,p_share_location,clock_timestamp()) ON CONFLICT(event_id) DO NOTHING;
 GET DIAGNOSTICS inserted_count=ROW_COUNT;RETURN inserted_count=1;
END;$function$;
REVOKE ALL ON FUNCTION public.record_novaai_product_share_v1(UUID,BIGINT,TEXT,TEXT) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.record_novaai_product_share_v1(UUID,BIGINT,TEXT,TEXT) TO service_role;
-- Same explicit administrator UUID gate as the existing advertisement reporting RPCs.
CREATE OR REPLACE FUNCTION public.get_novaai_product_share_analytics_v1()
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public,private,auth AS $function$
DECLARE result JSONB;
BEGIN
 IF auth.uid() IS DISTINCT FROM '2fc320e9-40b6-407f-9e71-e8a1999956a7'::UUID THEN RAISE EXCEPTION 'Administrator access required' USING ERRCODE='42501'; END IF;
 WITH grouped_events AS(SELECT e.product_id,e.marketplace,COUNT(*)::BIGINT share_count,MAX(e.created_at) last_share_at
 FROM private.novaai_product_share_events e GROUP BY e.product_id,e.marketplace),
 product_rows AS(SELECT g.product_id,g.marketplace,p.name product_name,g.share_count,g.last_share_at
 FROM grouped_events g LEFT JOIN public."Products" p ON p.id=g.product_id)
 SELECT jsonb_build_object(
 'total_shares',COALESCE((SELECT SUM(share_count) FROM grouped_events),0),
 'products_shared',(SELECT COUNT(DISTINCT product_id) FROM grouped_events),
 'most_shared_product',(SELECT jsonb_build_object('product_id',product_id,'product_name',product_name,'marketplace',marketplace,'share_count',share_count,'last_share_at',last_share_at)
 FROM product_rows ORDER BY share_count DESC,product_id,marketplace LIMIT 1),
 'last_share_at',(SELECT MAX(created_at) FROM private.novaai_product_share_events),
 'marketplaces',COALESCE((SELECT jsonb_agg(jsonb_build_object('marketplace',marketplace,'share_count',share_count) ORDER BY marketplace)
 FROM(SELECT m.marketplace,COUNT(e.event_id)::BIGINT share_count FROM unnest(ARRAY['retail','motors','property']::TEXT[]) m(marketplace)
 LEFT JOIN private.novaai_product_share_events e ON e.marketplace=m.marketplace GROUP BY m.marketplace) totals),'[]'::JSONB),
 'products',COALESCE((SELECT jsonb_agg(jsonb_build_object('product_id',product_id,'product_name',product_name,'marketplace',marketplace,'share_count',share_count,'last_share_at',last_share_at)
 ORDER BY share_count DESC,product_id,marketplace) FROM product_rows),'[]'::JSONB)
 ) INTO result;
 RETURN result;
END;$function$;
REVOKE ALL ON FUNCTION public.get_novaai_product_share_analytics_v1() FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.get_novaai_product_share_analytics_v1() TO authenticated;
