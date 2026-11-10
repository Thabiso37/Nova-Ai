-- Isolated PostgreSQL 17.11 compatibility harness.
-- Models only the interfaces used by the proposed migration; it is not a Supabase emulator.
CREATE ROLE anon NOLOGIN;
CREATE ROLE authenticated NOLOGIN;
CREATE ROLE service_role NOLOGIN BYPASSRLS;
CREATE SCHEMA private;
CREATE SCHEMA auth;

CREATE TABLE public."Products" (
 id bigint PRIMARY KEY, created_at timestamptz NOT NULL DEFAULT now(), name text NOT NULL,
 description text, price numeric, category text, image_url text, images jsonb,
 seller_id uuid, status text
);
CREATE TABLE public.seller_public_locations (
 user_id uuid PRIMARY KEY, province text, city text, suburb text,
 latitude numeric, longitude numeric, public_location_enabled boolean, approval_status text
);
CREATE TABLE public.seller_stores (
 user_id uuid PRIMARY KEY, store_name text, status text, phone text
);
CREATE TABLE public.seller_marketplace_permissions (
 user_id uuid, marketplace text, status text, PRIMARY KEY(user_id,marketplace)
);

ALTER TABLE public."Products" ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.seller_public_locations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.seller_stores ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.seller_marketplace_permissions ENABLE ROW LEVEL SECURITY;

CREATE FUNCTION private.product_marketplace_access_allowed(uuid,text)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER
SET search_path=pg_catalog,public,private
AS $helper$
 SELECT EXISTS (
   SELECT 1 FROM public.seller_marketplace_permissions mp
   JOIN public.seller_stores ss ON ss.user_id=mp.user_id
   WHERE mp.user_id=$1 AND mp.status='approved' AND ss.status='approved'
     AND mp.marketplace=CASE
       WHEN $2=ANY(ARRAY['Auto','Motors & Vehicles']::text[]) THEN 'motors'
       WHEN $2=ANY(ARRAY['Property For Sale','Property To Rent']::text[]) THEN 'property'
       ELSE 'retail' END
 )
$helper$;

-- Minimal baseline grants for fixture owner/service role. The migration itself adds executor grants.
GRANT USAGE ON SCHEMA public,private TO service_role;
GRANT SELECT ON ALL TABLES IN SCHEMA public TO service_role;
GRANT EXECUTE ON FUNCTION private.product_marketplace_access_allowed(uuid,text) TO service_role;
GRANT USAGE ON SCHEMA public,private TO anon,authenticated;
GRANT SELECT ON public."Products",public.seller_public_locations,public.seller_stores TO anon,authenticated;

-- RLS is enabled but these baseline roles have no permissive policies in this harness.
-- The helper is owned by the bootstrap superuser, matching the existing live helper ownership pattern.
