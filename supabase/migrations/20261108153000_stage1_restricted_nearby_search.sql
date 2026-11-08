-- NOVAAI Step 1 / Cycle 2 / Stage 1
-- Restricted, server-only Nearby Search database boundary.
-- This migration is for an isolated development database only.
-- It intentionally does not alter existing seller/admin policies or public coordinate grants.

DO $role$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_catalog.pg_roles WHERE rolname = 'novaai_nearby_search_executor') THEN
    EXECUTE 'CREATE ROLE novaai_nearby_search_executor';
  END IF;
END
$role$;

ALTER ROLE novaai_nearby_search_executor
  WITH NOLOGIN NOINHERIT NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS;
ALTER ROLE novaai_nearby_search_executor SET row_security = on;

GRANT USAGE ON SCHEMA public, private TO novaai_nearby_search_executor;
GRANT CREATE ON SCHEMA public TO novaai_nearby_search_executor;

-- Remove any prior grants to this dedicated role before applying the exact allowlist.
REVOKE ALL PRIVILEGES ON TABLE public."Products" FROM novaai_nearby_search_executor;
REVOKE ALL PRIVILEGES ON TABLE public.seller_public_locations FROM novaai_nearby_search_executor;
REVOKE ALL PRIVILEGES ON TABLE public.seller_stores FROM novaai_nearby_search_executor;
REVOKE ALL PRIVILEGES ON TABLE public.seller_marketplace_permissions FROM novaai_nearby_search_executor;

GRANT SELECT (
  id, created_at, name, description, price, category, image_url, images, seller_id, status
) ON TABLE public."Products" TO novaai_nearby_search_executor;

GRANT SELECT (
  user_id, province, city, suburb, latitude, longitude,
  public_location_enabled, approval_status
) ON TABLE public.seller_public_locations TO novaai_nearby_search_executor;

GRANT SELECT (user_id, store_name, status)
  ON TABLE public.seller_stores TO novaai_nearby_search_executor;

-- The existing helper is SECURITY DEFINER and remains owned by postgres.
-- The restricted role may invoke it but receives no direct permission-table access.
GRANT EXECUTE ON FUNCTION private.product_marketplace_access_allowed(uuid, text)
  TO novaai_nearby_search_executor;

-- These policies apply only to the non-login executor role.
-- Existing seller, administrator and public policies are deliberately untouched.
DROP POLICY IF EXISTS "Nearby executor reads eligible approved products" ON public."Products";
CREATE POLICY "Nearby executor reads eligible approved products"
  ON public."Products"
  FOR SELECT
  TO novaai_nearby_search_executor
  USING (
    status = 'approved'
    AND private.product_marketplace_access_allowed(seller_id, category)
  );

DROP POLICY IF EXISTS "Nearby executor reads consented approved locations" ON public.seller_public_locations;
CREATE POLICY "Nearby executor reads consented approved locations"
  ON public.seller_public_locations
  FOR SELECT
  TO novaai_nearby_search_executor
  USING (
    public_location_enabled IS TRUE
    AND approval_status = 'approved'
    AND EXISTS (
      SELECT 1
      FROM public.seller_stores AS ss
      WHERE ss.user_id = seller_public_locations.user_id
        AND ss.status = 'approved'
    )
  );

DROP POLICY IF EXISTS "Nearby executor reads approved store display names" ON public.seller_stores;
CREATE POLICY "Nearby executor reads approved store display names"
  ON public.seller_stores
  FOR SELECT
  TO novaai_nearby_search_executor
  USING (status = 'approved');

-- Create both functions as the restricted role so SECURITY DEFINER executes
-- with this role's narrow grants and RLS policies, not with postgres/service_role.
SET ROLE novaai_nearby_search_executor;

CREATE OR REPLACE FUNCTION public.search_nearby_listings(
  p_marketplace text,
  p_lat numeric DEFAULT NULL,
  p_lon numeric DEFAULT NULL,
  p_radius_km numeric DEFAULT 50,
  p_search_text text DEFAULT NULL,
  p_city text DEFAULT NULL,
  p_suburb text DEFAULT NULL,
  p_province text DEFAULT NULL,
  p_limit integer DEFAULT 50
)
RETURNS TABLE (
  listing_id bigint,
  listing_name text,
  price numeric,
  category text,
  image_url text,
  images jsonb,
  seller_display_name text,
  public_suburb text,
  public_city text,
  public_province text,
  distance_band text,
  listing_created_at timestamptz
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, public, private
SET row_security = on
AS $function$
BEGIN
  IF p_marketplace IS NULL OR p_marketplace NOT IN ('all', 'retail', 'motors', 'property') THEN
    RAISE EXCEPTION 'Invalid marketplace' USING ERRCODE = '22023';
  END IF;

  IF (p_lat IS NULL) <> (p_lon IS NULL) THEN
    RAISE EXCEPTION 'Latitude and longitude must be supplied together' USING ERRCODE = '22023';
  END IF;

  IF p_lat IS NOT NULL AND (p_lat < -90 OR p_lat > 90 OR p_lon < -180 OR p_lon > 180) THEN
    RAISE EXCEPTION 'Invalid search origin' USING ERRCODE = '22023';
  END IF;

  IF p_radius_km IS NULL OR p_radius_km <= 0 OR p_radius_km > 200 THEN
    RAISE EXCEPTION 'Radius must be greater than zero and no more than 200 km' USING ERRCODE = '22023';
  END IF;

  IF p_limit IS NULL OR p_limit < 1 OR p_limit > 100 THEN
    RAISE EXCEPTION 'Limit must be between 1 and 100' USING ERRCODE = '22023';
  END IF;

  IF length(coalesce(p_search_text, '')) > 120
     OR length(coalesce(p_city, '')) > 100
     OR length(coalesce(p_suburb, '')) > 100
     OR length(coalesce(p_province, '')) > 100 THEN
    RAISE EXCEPTION 'Search filter is too long' USING ERRCODE = '22023';
  END IF;

  RETURN QUERY
  WITH candidates AS (
    SELECT
      p.id,
      p.name,
      p.price,
      p.category,
      p.image_url,
      CASE
        WHEN jsonb_typeof(p.images) = 'array' THEN p.images
        ELSE '[]'::jsonb
      END AS listing_images,
      ss.store_name,
      l.suburb,
      l.city,
      l.province,
      p.created_at,
      CASE
        WHEN p_lat IS NULL THEN NULL::double precision
        ELSE
          2.0 * 6371.0088 * asin(
            sqrt(
              least(
                1.0,
                greatest(
                  0.0,
                  power(sin(radians((l.latitude::double precision - p_lat::double precision) / 2.0)), 2)
                  + cos(radians(p_lat::double precision))
                  * cos(radians(l.latitude::double precision))
                  * power(sin(radians((l.longitude::double precision - p_lon::double precision) / 2.0)), 2)
                )
              )
            )
          )
      END AS distance_km
    FROM public."Products" AS p
    JOIN public.seller_public_locations AS l
      ON l.user_id = p.seller_id
    JOIN public.seller_stores AS ss
      ON ss.user_id = p.seller_id
     AND ss.status = 'approved'
    WHERE p.status = 'approved'
      AND private.product_marketplace_access_allowed(p.seller_id, p.category)
      AND CASE
        WHEN p.category = ANY (ARRAY['Auto', 'Motors & Vehicles']::text[]) THEN 'motors'
        WHEN p.category = ANY (ARRAY['Property For Sale', 'Property To Rent']::text[]) THEN 'property'
        ELSE 'retail'
      END = p_marketplace OR p_marketplace = 'all'
      AND l.public_location_enabled IS TRUE
      AND l.approval_status = 'approved'
      AND (nullif(btrim(p_search_text), '') IS NULL
        OR p.name ILIKE '%' || btrim(p_search_text) || '%'
        OR p.category ILIKE '%' || btrim(p_search_text) || '%'
        OR p.description ILIKE '%' || btrim(p_search_text) || '%'
        OR ss.store_name ILIKE '%' || btrim(p_search_text) || '%')
      AND (nullif(btrim(p_city), '') IS NULL OR lower(concat_ws(' ', l.city, l.suburb, l.province)) LIKE '%' || lower(btrim(p_city)) || '%')
      AND (nullif(btrim(p_suburb), '') IS NULL OR lower(l.suburb) = lower(btrim(p_suburb)))
      AND (nullif(btrim(p_province), '') IS NULL OR lower(l.province) = lower(btrim(p_province)))
  )
  SELECT
    c.id,
    c.name,
    c.price,
    c.category,
    c.image_url,
    c.listing_images,
    c.store_name,
    c.suburb,
    c.city,
    c.province,
    CASE
      WHEN c.distance_km IS NULL THEN NULL
      WHEN c.distance_km < 5 THEN '0-5 km'
      WHEN c.distance_km < 15 THEN '5-15 km'
      WHEN c.distance_km < 30 THEN '15-30 km'
      ELSE '30+ km'
    END,
    c.created_at
  FROM candidates AS c
  WHERE p_lat IS NULL OR c.distance_km <= p_radius_km::double precision
  ORDER BY c.distance_km ASC NULLS LAST, c.created_at DESC
  LIMIT p_limit;
END;
$function$;

CREATE OR REPLACE FUNCTION public.get_property_seller_area(
  p_listing_id bigint
)
RETURNS TABLE (
  public_suburb text,
  public_city text,
  public_province text
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, public, private
SET row_security = on
AS $function$
  SELECT
    l.suburb,
    l.city,
    l.province
  FROM public."Products" AS p
  JOIN public.seller_public_locations AS l
    ON l.user_id = p.seller_id
  WHERE p.id = p_listing_id
    AND p.status = 'approved'
    AND p.category = ANY (ARRAY['Property For Sale', 'Property To Rent']::text[])
    AND private.product_marketplace_access_allowed(p.seller_id, p.category)
    AND l.public_location_enabled IS TRUE
    AND l.approval_status = 'approved';
$function$;

RESET ROLE;

-- Remove temporary schema-creation capability. The role retains only schema USAGE.
REVOKE CREATE ON SCHEMA public FROM novaai_nearby_search_executor;

-- Public Data API callers cannot invoke either function directly.
REVOKE ALL ON FUNCTION public.search_nearby_listings(text, numeric, numeric, numeric, text, text, text, text, integer)
  FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.get_property_seller_area(bigint)
  FROM PUBLIC, anon, authenticated, service_role;

-- The server-side Edge Function will use service_role. The function body then
-- executes under novaai_nearby_search_executor and remains subject to its RLS.
GRANT EXECUTE ON FUNCTION public.search_nearby_listings(text, numeric, numeric, numeric, text, text, text, text, integer)
  TO service_role;
GRANT EXECUTE ON FUNCTION public.get_property_seller_area(bigint)
  TO service_role;

COMMENT ON ROLE novaai_nearby_search_executor IS
  'Non-login, non-inheriting, non-BYPASSRLS owner for restricted NOVAAI Nearby Search RPCs.';
COMMENT ON FUNCTION public.search_nearby_listings(text, numeric, numeric, numeric, text, text, text, text, integer) IS
  'Server-only Nearby Search. Returns approved listings and coarse distance bands; never returns seller/user IDs, coordinates or phone numbers.';
COMMENT ON FUNCTION public.get_property_seller_area(bigint) IS
  'Server-only locality lookup for approved, consented Property listings; never returns coordinates or seller/user IDs.';
