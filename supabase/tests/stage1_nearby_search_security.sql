-- NOVAAI Stage 1 security regression checks.
-- Run only after the Stage 1 migration has been applied to an isolated PostgreSQL 17 database.
-- The fixture bootstrap is supabase/tests/stage1_nearby_search_test_bootstrap.sql.
-- All test data and role switching are transaction-local and rolled back.

BEGIN;

DO $tests$
DECLARE
  v_executor oid;
  v_search_oid oid;
  v_area_oid oid;
  v_expected text[];
  v_actual text[];
  v_col record;
  v_acl record;
  v_result text;
  v_definition text;
BEGIN
  SELECT oid INTO v_executor FROM pg_catalog.pg_roles
  WHERE rolname = 'novaai_nearby_search_executor';
  IF v_executor IS NULL THEN RAISE EXCEPTION 'FAIL: executor role missing'; END IF;

  IF EXISTS (SELECT 1 FROM pg_catalog.pg_auth_members WHERE member=v_executor OR roleid=v_executor) THEN
    RAISE EXCEPTION 'FAIL: executor has a membership edge in either direction';
  END IF;

  IF EXISTS (
    SELECT 1 FROM pg_catalog.pg_roles
    WHERE rolname='novaai_nearby_search_executor'
      AND (rolcanlogin OR rolinherit OR rolsuper OR rolcreatedb OR rolcreaterole OR rolreplication OR rolbypassrls)
  ) THEN RAISE EXCEPTION 'FAIL: executor role attributes are unsafe'; END IF;

  v_expected := ARRAY['category','created_at','description','id','image_url','images','name','price','seller_id','status'];
  SELECT array_agg(a.attname ORDER BY a.attname) INTO v_actual
  FROM pg_catalog.pg_attribute a
  WHERE a.attrelid='public."Products"'::regclass AND a.attnum>0 AND NOT a.attisdropped
    AND has_column_privilege(v_executor,a.attrelid,a.attname,'SELECT');
  IF v_actual IS DISTINCT FROM v_expected THEN
    RAISE EXCEPTION 'FAIL: Products SELECT allowlist mismatch. expected %, actual %',v_expected,v_actual;
  END IF;

  v_expected := ARRAY['approval_status','city','latitude','longitude','province','public_location_enabled','suburb','user_id'];
  SELECT array_agg(a.attname ORDER BY a.attname) INTO v_actual
  FROM pg_catalog.pg_attribute a
  WHERE a.attrelid='public.seller_public_locations'::regclass AND a.attnum>0 AND NOT a.attisdropped
    AND has_column_privilege(v_executor,a.attrelid,a.attname,'SELECT');
  IF v_actual IS DISTINCT FROM v_expected THEN
    RAISE EXCEPTION 'FAIL: location SELECT allowlist mismatch. expected %, actual %',v_expected,v_actual;
  END IF;

  v_expected := ARRAY['status','store_name','user_id'];
  SELECT array_agg(a.attname ORDER BY a.attname) INTO v_actual
  FROM pg_catalog.pg_attribute a
  WHERE a.attrelid='public.seller_stores'::regclass AND a.attnum>0 AND NOT a.attisdropped
    AND has_column_privilege(v_executor,a.attrelid,a.attname,'SELECT');
  IF v_actual IS DISTINCT FROM v_expected THEN
    RAISE EXCEPTION 'FAIL: store SELECT allowlist mismatch. expected %, actual %',v_expected,v_actual;
  END IF;

  SELECT array_agg(a.attname ORDER BY a.attname) INTO v_actual
  FROM pg_catalog.pg_attribute a
  WHERE a.attrelid='public.seller_marketplace_permissions'::regclass
    AND a.attnum>0 AND NOT a.attisdropped
    AND has_column_privilege(v_executor,a.attrelid,a.attname,'SELECT');
  IF v_actual IS NOT NULL THEN
    RAISE EXCEPTION 'FAIL: executor has unexpected permission-table column grants: %',v_actual;
  END IF;

  IF has_table_privilege(v_executor,'public.seller_marketplace_permissions','SELECT')
     OR has_column_privilege(v_executor,'public.seller_marketplace_permissions','user_id','SELECT')
     OR has_column_privilege(v_executor,'public.seller_stores','phone','SELECT')
     OR has_column_privilege(v_executor,'public.seller_public_locations','user_id','UPDATE')
     OR has_table_privilege(v_executor,'public."Products"','INSERT')
     OR has_table_privilege(v_executor,'public."Products"','UPDATE')
     OR has_table_privilege(v_executor,'public."Products"','DELETE')
     OR has_table_privilege(v_executor,'public.seller_public_locations','INSERT')
     OR has_table_privilege(v_executor,'public.seller_public_locations','UPDATE')
     OR has_table_privilege(v_executor,'public.seller_stores','INSERT')
     OR has_table_privilege(v_executor,'public.seller_stores','UPDATE')
     OR has_schema_privilege(v_executor,'public','CREATE') THEN
    RAISE EXCEPTION 'FAIL: executor has an explicitly prohibited privilege';
  END IF;

  IF NOT has_function_privilege(v_executor,'private.product_marketplace_access_allowed(uuid,text)','EXECUTE') THEN
    RAISE EXCEPTION 'FAIL: existing eligibility helper EXECUTE missing';
  END IF;

  IF NOT (SELECT relrowsecurity FROM pg_class WHERE oid='public."Products"'::regclass)
     OR NOT (SELECT relrowsecurity FROM pg_class WHERE oid='public.seller_public_locations'::regclass)
     OR NOT (SELECT relrowsecurity FROM pg_class WHERE oid='public.seller_stores'::regclass) THEN
    RAISE EXCEPTION 'FAIL: RLS is not enabled on all source tables';
  END IF;

  IF (SELECT count(*) FROM pg_policies WHERE schemaname='public' AND policyname IN (
    'Nearby executor reads eligible approved products',
    'Nearby executor reads consented approved locations',
    'Nearby executor reads approved store display names'
  )) <> 3 THEN RAISE EXCEPTION 'FAIL: expected executor policies are missing'; END IF;

  SELECT p.oid INTO v_search_oid
  FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
  WHERE n.nspname='public' AND p.proname='search_nearby_listings';
  SELECT p.oid INTO v_area_oid
  FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
  WHERE n.nspname='public' AND p.proname='get_property_seller_area';
  IF v_search_oid IS NULL OR v_area_oid IS NULL THEN RAISE EXCEPTION 'FAIL: RPC missing'; END IF;

  IF EXISTS (
    SELECT 1 FROM pg_proc WHERE oid IN (v_search_oid,v_area_oid)
      AND (proowner<>v_executor OR NOT prosecdef
        OR NOT (proconfig @> ARRAY['search_path=pg_catalog, public, private','row_security=on'])))
  THEN RAISE EXCEPTION 'FAIL: RPC owner, SECURITY DEFINER, search_path or row_security mismatch'; END IF;

  -- The ACL must contain only the owner implicit grant and explicit service_role grant.
  FOR v_acl IN
    SELECT p.oid, x.grantee, x.privilege_type
    FROM pg_proc p
    CROSS JOIN LATERAL aclexplode(coalesce(p.proacl,acldefault('f',p.proowner))) x
    WHERE p.oid IN (v_search_oid,v_area_oid) AND x.privilege_type='EXECUTE'
  LOOP
    IF v_acl.grantee NOT IN (
      (SELECT oid FROM pg_roles WHERE rolname='novaai_nearby_search_executor'),
      (SELECT oid FROM pg_roles WHERE rolname='service_role')
    ) THEN RAISE EXCEPTION 'FAIL: unexpected explicit EXECUTE grantee % on function %',v_acl.grantee,v_acl.oid; END IF;
  END LOOP;

  IF NOT has_function_privilege('service_role',v_search_oid,'EXECUTE')
     OR NOT has_function_privilege('service_role',v_area_oid,'EXECUTE')
     OR has_function_privilege('anon',v_search_oid,'EXECUTE')
     OR has_function_privilege('authenticated',v_search_oid,'EXECUTE')
     OR has_function_privilege('anon',v_area_oid,'EXECUTE')
     OR has_function_privilege('authenticated',v_area_oid,'EXECUTE')
     OR EXISTS (
       SELECT 1 FROM pg_proc p CROSS JOIN LATERAL aclexplode(coalesce(p.proacl,acldefault('f',p.proowner))) x
       WHERE p.oid IN (v_search_oid,v_area_oid) AND x.grantee=0 AND x.privilege_type='EXECUTE'
     ) THEN RAISE EXCEPTION 'FAIL: RPC EXECUTE permissions are not service_role-only'; END IF;

  v_result := pg_get_function_result(v_search_oid)||' '||pg_get_function_result(v_area_oid);
  IF v_result ~* '(seller_id|user_id|phone|latitude|longitude|coordinate)' THEN
    RAISE EXCEPTION 'FAIL: prohibited field in RPC result signature';
  END IF;
  v_definition := pg_get_functiondef(v_search_oid)||pg_get_functiondef(v_area_oid);
  IF v_definition ~* 'public[.]products' THEN RAISE EXCEPTION 'FAIL: legacy lowercase products reference'; END IF;

  IF EXISTS (SELECT 1 FROM pg_class WHERE oid IN (
    'public."Products"'::regclass,'public.seller_public_locations'::regclass,
    'public.seller_stores'::regclass,'public.seller_marketplace_permissions'::regclass
  ) AND relowner=v_executor) THEN RAISE EXCEPTION 'FAIL: executor owns a protected source table'; END IF;
END;
$tests$;

-- Fixture rows: one eligible approved+consented listing and three excluded cases.
INSERT INTO public.seller_stores(user_id,store_name,status,phone) VALUES
 ('00000000-0000-0000-0000-000000000001','Eligible fixture store','approved','do-not-return'),
 ('00000000-0000-0000-0000-000000000002','Unapproved store','pending','do-not-return'),
 ('00000000-0000-0000-0000-000000000003','Non-consenting store','approved','do-not-return'),
 ('00000000-0000-0000-0000-000000000004','Unapproved seller permission','approved','do-not-return'),
 ('00000000-0000-0000-0000-000000000005','Eligible motors fixture store','approved','do-not-return');

INSERT INTO public.seller_marketplace_permissions(user_id,marketplace,status) VALUES
 ('00000000-0000-0000-0000-000000000001','retail','approved'),
 ('00000000-0000-0000-0000-000000000002','retail','approved'),
 ('00000000-0000-0000-0000-000000000003','retail','approved'),
 ('00000000-0000-0000-0000-000000000004','retail','pending'),
 ('00000000-0000-0000-0000-000000000005','motors','approved');

INSERT INTO public.seller_public_locations(user_id,province,city,suburb,latitude,longitude,public_location_enabled,approval_status) VALUES
 ('00000000-0000-0000-0000-000000000001','Gauteng','Pretoria','Central',-25.75,28.19,true,'approved'),
 ('00000000-0000-0000-0000-000000000002','Gauteng','Pretoria','North',-25.74,28.20,true,'approved'),
 ('00000000-0000-0000-0000-000000000003','Gauteng','Pretoria','East',-25.73,28.21,false,'approved'),
 ('00000000-0000-0000-0000-000000000004','Gauteng','Pretoria','West',-25.72,28.22,true,'approved'),
 ('00000000-0000-0000-0000-000000000005','Gauteng','Pretoria','South',-25.76,28.18,true,'approved');

INSERT INTO public."Products"(id,created_at,name,description,price,category,image_url,images,seller_id,status) VALUES
 (910001,now(),'Eligible retail fixture','fixture description',100,'Clothing','https://example.test/eligible.jpg','["https://example.test/gallery.jpg"]','00000000-0000-0000-0000-000000000001','approved'),
 (910002,now(),'Unapproved store fixture','fixture description',200,'Clothing','https://example.test/unapproved-store.jpg','[]','00000000-0000-0000-0000-000000000002','approved'),
 (910003,now(),'Non-consented location fixture','fixture description',300,'Clothing','https://example.test/non-consented.jpg','[]','00000000-0000-0000-0000-000000000003','approved'),
 (910004,now(),'Unapproved permission fixture','fixture description',400,'Clothing','https://example.test/pending-permission.jpg','[]','00000000-0000-0000-0000-000000000004','approved'),
 (910005,now(),'Unapproved listing fixture','fixture description',500,'Clothing','https://example.test/unapproved-listing.jpg','[]','00000000-0000-0000-0000-000000000001','pending'),
 (910006,now(),'Eligible motors fixture','fixture description',600,'Auto','https://example.test/motors.jpg','[]','00000000-0000-0000-0000-000000000005','approved');

-- Direct executor-context checks prove RLS filters source rows; no direct phone or permission table access.
SET LOCAL ROLE novaai_nearby_search_executor;
DO $rls$
DECLARE v_count integer;
BEGIN
  SELECT count(id) INTO v_count FROM public."Products";
  IF v_count <> 3 THEN RAISE EXCEPTION 'FAIL: Products RLS expected 3 approved+eligible Retail/Motors rows before location join, got %',v_count; END IF;
  SELECT count(user_id) INTO v_count FROM public.seller_public_locations;
  IF v_count <> 3 THEN RAISE EXCEPTION 'FAIL: location RLS expected 3 opted-in locations with approved stores, got %',v_count; END IF;
  SELECT count(user_id) INTO v_count FROM public.seller_stores;
  IF v_count <> 4 THEN RAISE EXCEPTION 'FAIL: store RLS expected 4 approved stores, got %',v_count; END IF;
  IF has_table_privilege(current_user,'public.seller_marketplace_permissions','SELECT')
     OR has_column_privilege(current_user,'public.seller_stores','phone','SELECT') THEN
    RAISE EXCEPTION 'FAIL: restricted executor can access phone or marketplace permission table';
  END IF;
END;
$rls$;
RESET ROLE;

-- SECURITY DEFINER RPC calls through service_role must still return only the eligible fixture.
SET LOCAL ROLE service_role;
DO $rpc$
DECLARE
  v_count integer;
  v_ids bigint[];
  v_area_count integer;
  v_distance text;
BEGIN
  SELECT count(*),array_agg(listing_id ORDER BY listing_id) INTO v_count,v_ids
  FROM public.search_nearby_listings('retail',NULL,NULL,50,NULL,NULL,NULL,NULL,100);
  IF v_count<>1 OR v_ids IS DISTINCT FROM ARRAY[910001::bigint] THEN
    RAISE EXCEPTION 'FAIL: Retail Nearby Search fixture result mismatch; count %, ids %',v_count,v_ids;
  END IF;

  SELECT count(*),array_agg(listing_id ORDER BY listing_id) INTO v_count,v_ids
  FROM public.search_nearby_listings('motors',NULL,NULL,50,NULL,NULL,NULL,NULL,100);
  IF v_count<>1 OR v_ids IS DISTINCT FROM ARRAY[910006::bigint] THEN
    RAISE EXCEPTION 'FAIL: Motors Nearby Search fixture result mismatch; count %, ids %',v_count,v_ids;
  END IF;

  SELECT count(*),array_agg(listing_id ORDER BY listing_id) INTO v_count,v_ids
  FROM public.search_nearby_listings('all',NULL,NULL,50,NULL,'Pretoria',NULL,'Gauteng',100);
  IF v_count<>2 OR v_ids IS DISTINCT FROM ARRAY[910001::bigint,910006::bigint] THEN
    RAISE EXCEPTION 'FAIL: all-market manual locality search mismatch; count %, ids %',v_count,v_ids;
  END IF;

  SELECT distance_band INTO v_distance
  FROM public.search_nearby_listings('retail',-25.75,28.19,5,NULL,NULL,NULL,NULL,100)
  WHERE listing_id=910001;
  IF v_distance IS DISTINCT FROM '0-5 km' THEN
    RAISE EXCEPTION 'FAIL: server distance band mismatch; got %',v_distance;
  END IF;

  SELECT count(*) INTO v_area_count FROM public.get_property_seller_area(910001);
  IF v_area_count<>0 THEN RAISE EXCEPTION 'FAIL: non-Property listing exposed property area'; END IF;
END;
$rpc$;
RESET ROLE;

-- Explicit negative invocation tests: both untrusted API roles must receive permission denied.
SET LOCAL ROLE anon;
DO $anon_denied$
BEGIN
  BEGIN
    PERFORM 1 FROM public.search_nearby_listings('retail',NULL,NULL,50,NULL,NULL,NULL,NULL,1);
    RAISE EXCEPTION 'FAIL: anon unexpectedly executed search_nearby_listings';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;
  BEGIN
    PERFORM 1 FROM public.get_property_seller_area(910001);
    RAISE EXCEPTION 'FAIL: anon unexpectedly executed get_property_seller_area';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;
END;
$anon_denied$;
RESET ROLE;

SET LOCAL ROLE authenticated;
DO $authenticated_denied$
BEGIN
  BEGIN
    PERFORM 1 FROM public.search_nearby_listings('retail',NULL,NULL,50,NULL,NULL,NULL,NULL,1);
    RAISE EXCEPTION 'FAIL: authenticated unexpectedly executed search_nearby_listings';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;
  BEGIN
    PERFORM 1 FROM public.get_property_seller_area(910001);
    RAISE EXCEPTION 'FAIL: authenticated unexpectedly executed get_property_seller_area';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;
END;
$authenticated_denied$;
RESET ROLE;

-- Property area positive/negative cases use Property category and same approved consent boundary.
UPDATE public."Products" SET category='Property For Sale' WHERE id IN (910001,910003,910004,910005);
UPDATE public.seller_marketplace_permissions SET marketplace='property' WHERE user_id IN (
 '00000000-0000-0000-0000-000000000001','00000000-0000-0000-0000-000000000003','00000000-0000-0000-0000-000000000004'
);
SET LOCAL ROLE service_role;
DO $property$
DECLARE v_count integer;
BEGIN
  SELECT count(*) INTO v_count FROM public.get_property_seller_area(910001);
  IF v_count<>1 THEN RAISE EXCEPTION 'FAIL: eligible consented property area should return one row'; END IF;
  SELECT count(*) INTO v_count FROM public.get_property_seller_area(910003);
  IF v_count<>0 THEN RAISE EXCEPTION 'FAIL: non-consented property area leaked'; END IF;
  SELECT count(*) INTO v_count FROM public.get_property_seller_area(910004);
  IF v_count<>0 THEN RAISE EXCEPTION 'FAIL: pending seller permission property area leaked'; END IF;
  SELECT count(*) INTO v_count FROM public.get_property_seller_area(910005);
  IF v_count<>0 THEN RAISE EXCEPTION 'FAIL: unapproved listing property area leaked'; END IF;

  SELECT count(*),array_agg(listing_id ORDER BY listing_id) INTO v_count,v_ids
  FROM public.search_nearby_listings('property',NULL,NULL,50,NULL,'Pretoria',NULL,'Gauteng',100);
  IF v_count<>1 OR v_ids IS DISTINCT FROM ARRAY[910001::bigint] THEN
    RAISE EXCEPTION 'FAIL: Property Nearby Search fixture result mismatch; count %, ids %',v_count,v_ids;
  END IF;
END;
$property$;
RESET ROLE;

ROLLBACK;
