-- NOVAAI Stage 1 security regression checks.
-- Run only after the Stage 1 migration has been applied to an isolated development database.
-- This script is read-only apart from transaction-local role switching; it rolls back.

BEGIN;

DO $tests$
DECLARE
  v_role record;
  v_search_oid oid;
  v_area_oid oid;
  v_result text;
  v_definition text;
BEGIN
  SELECT * INTO v_role
  FROM pg_catalog.pg_roles
  WHERE rolname = 'novaai_nearby_search_executor';

  IF NOT FOUND THEN
    RAISE EXCEPTION 'FAIL: restricted executor role is missing';
  END IF;
  IF v_role.rolcanlogin OR v_role.rolinherit OR v_role.rolsuper
     OR v_role.rolcreatedb OR v_role.rolcreaterole OR v_role.rolreplication
     OR v_role.rolbypassrls THEN
    RAISE EXCEPTION 'FAIL: restricted executor role has unsafe role attributes';
  END IF;

  IF NOT has_column_privilege('novaai_nearby_search_executor', 'public."Products"', 'seller_id', 'SELECT')
     OR NOT has_column_privilege('novaai_nearby_search_executor', 'public."Products"', 'status', 'SELECT')
     OR NOT has_column_privilege('novaai_nearby_search_executor', 'public.seller_public_locations', 'latitude', 'SELECT')
     OR NOT has_column_privilege('novaai_nearby_search_executor', 'public.seller_public_locations', 'approval_status', 'SELECT')
     OR NOT has_column_privilege('novaai_nearby_search_executor', 'public.seller_stores', 'store_name', 'SELECT') THEN
    RAISE EXCEPTION 'FAIL: required minimum column grants are missing';
  END IF;

  IF has_column_privilege('novaai_nearby_search_executor', 'public.seller_stores', 'phone', 'SELECT')
     OR has_table_privilege('novaai_nearby_search_executor', 'public.seller_marketplace_permissions', 'SELECT') THEN
    RAISE EXCEPTION 'FAIL: executor has excess contact or permission-table access';
  END IF;

  IF NOT has_function_privilege('novaai_nearby_search_executor',
      'private.product_marketplace_access_allowed(uuid,text)', 'EXECUTE') THEN
    RAISE EXCEPTION 'FAIL: existing marketplace eligibility helper is not executable by the restricted role';
  END IF;

  IF NOT (SELECT relrowsecurity FROM pg_class WHERE oid = 'public."Products"'::regclass)
     OR NOT (SELECT relrowsecurity FROM pg_class WHERE oid = 'public.seller_public_locations'::regclass)
     OR NOT (SELECT relrowsecurity FROM pg_class WHERE oid = 'public.seller_stores'::regclass) THEN
    RAISE EXCEPTION 'FAIL: RLS is not enabled on every source table';
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_policies
    WHERE schemaname='public' AND tablename='Products'
      AND policyname='Nearby executor reads eligible approved products'
      AND 'novaai_nearby_search_executor' = ANY(roles))
     OR NOT EXISTS (SELECT 1 FROM pg_policies
    WHERE schemaname='public' AND tablename='seller_public_locations'
      AND policyname='Nearby executor reads consented approved locations'
      AND 'novaai_nearby_search_executor' = ANY(roles))
     OR NOT EXISTS (SELECT 1 FROM pg_policies
    WHERE schemaname='public' AND tablename='seller_stores'
      AND policyname='Nearby executor reads approved store display names'
      AND 'novaai_nearby_search_executor' = ANY(roles)) THEN
    RAISE EXCEPTION 'FAIL: one or more narrowly scoped executor RLS policies are missing';
  END IF;

  SELECT p.oid INTO v_search_oid
  FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
  WHERE n.nspname='public' AND p.proname='search_nearby_listings';

  SELECT p.oid INTO v_area_oid
  FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
  WHERE n.nspname='public' AND p.proname='get_property_seller_area';

  IF v_search_oid IS NULL OR v_area_oid IS NULL THEN
    RAISE EXCEPTION 'FAIL: one or both RPCs are missing';
  END IF;

  IF (SELECT pg_get_userbyid(proowner) FROM pg_proc WHERE oid=v_search_oid) <> 'novaai_nearby_search_executor'
     OR (SELECT pg_get_userbyid(proowner) FROM pg_proc WHERE oid=v_area_oid) <> 'novaai_nearby_search_executor'
     OR NOT (SELECT prosecdef FROM pg_proc WHERE oid=v_search_oid)
     OR NOT (SELECT prosecdef FROM pg_proc WHERE oid=v_area_oid) THEN
    RAISE EXCEPTION 'FAIL: RPC ownership or SECURITY DEFINER configuration is incorrect';
  END IF;

  IF NOT has_function_privilege('service_role', v_search_oid, 'EXECUTE')
     OR NOT has_function_privilege('service_role', v_area_oid, 'EXECUTE')
     OR has_function_privilege('anon', v_search_oid, 'EXECUTE')
     OR has_function_privilege('authenticated', v_search_oid, 'EXECUTE')
     OR has_function_privilege('anon', v_area_oid, 'EXECUTE')
     OR has_function_privilege('authenticated', v_area_oid, 'EXECUTE') THEN
    RAISE EXCEPTION 'FAIL: RPC EXECUTE grants are not restricted to the server-side caller';
  END IF;

  v_result := pg_get_function_result(v_search_oid) || ' ' || pg_get_function_result(v_area_oid);
  IF v_result ILIKE '%seller_id%'
     OR v_result ILIKE '%user_id%'
     OR v_result ILIKE '%phone%'
     OR v_result ILIKE '%latitude%'
     OR v_result ILIKE '%longitude%'
     OR v_result ILIKE '%coordinate%' THEN
    RAISE EXCEPTION 'FAIL: an RPC result signature contains a prohibited field';
  END IF;

  v_definition := pg_get_functiondef(v_search_oid) || pg_get_functiondef(v_area_oid);
  IF position('public.products' IN v_definition) > 0 THEN
    RAISE EXCEPTION 'FAIL: an RPC references the legacy lowercase products table';
  END IF;

  IF NOT has_schema_privilege('novaai_nearby_search_executor', 'public', 'USAGE')
     OR has_schema_privilege('novaai_nearby_search_executor', 'public', 'CREATE') THEN
    RAISE EXCEPTION 'FAIL: executor schema privileges are not least-privilege';
  END IF;
END;
$tests$;

-- Smoke-test the server-only call path without returning listing details.
SET LOCAL ROLE service_role;
DO $smoke$
DECLARE
  v_count integer;
  v_property_id bigint;
BEGIN
  SELECT count(*) INTO v_count
  FROM public.search_nearby_listings('retail', NULL, NULL, 50, NULL, NULL, NULL, NULL, 1);

  IF v_count > 1 THEN
    RAISE EXCEPTION 'FAIL: search limit was not enforced';
  END IF;

  SELECT p.id INTO v_property_id
  FROM public."Products" AS p
  WHERE p.status='approved'
    AND p.category = ANY (ARRAY['Property For Sale','Property To Rent']::text[])
    AND private.product_marketplace_access_allowed(p.seller_id,p.category)
  ORDER BY p.id
  LIMIT 1;

  IF v_property_id IS NOT NULL THEN
    PERFORM 1 FROM public.get_property_seller_area(v_property_id);
  END IF;
END;
$smoke$;

ROLLBACK;
