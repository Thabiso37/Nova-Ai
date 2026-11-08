-- Fail-closed preflight for the connected export role.
-- Run with psql -X -v ON_ERROR_STOP=1 -f this file.
DO $preflight$
DECLARE
  r record;
  bad text[] := ARRAY[]::text[];
  role_oid oid := (SELECT oid FROM pg_roles WHERE rolname = current_user);
BEGIN
  IF role_oid IS NULL THEN
    RAISE EXCEPTION 'Cannot identify connected database role';
  END IF;

  SELECT * INTO r FROM pg_roles WHERE oid = role_oid;
  IF r.rolsuper OR r.rolcreatedb OR r.rolcreaterole OR r.rolreplication OR r.rolbypassrls THEN
    bad := array_append(bad, 'administrative role attributes');
  END IF;

  -- Deliberately reject every direct or transitive role membership.
  IF EXISTS (
    WITH RECURSIVE memberships(roleid) AS (
      SELECT roleid FROM pg_auth_members WHERE member = role_oid
      UNION
      SELECT m.roleid FROM pg_auth_members m JOIN memberships x ON m.member = x.roleid
    )
    SELECT 1 FROM memberships
  ) THEN
    bad := array_append(bad, 'direct or inherited role memberships');
  END IF;

  IF has_database_privilege(current_user,current_database(),'CREATE')
     OR has_database_privilege(current_user,current_database(),'TEMP') THEN
    bad := array_append(bad, 'database CREATE or TEMP privilege');
  END IF;

  IF EXISTS (
    SELECT 1 FROM pg_namespace n
    WHERE n.nspname IN ('public','private','storage')
      AND has_schema_privilege(current_user, n.oid, 'CREATE')
  ) THEN
    bad := array_append(bad, 'schema CREATE privilege');
  END IF;

  IF EXISTS (
    SELECT 1
    FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname IN ('public','private','storage')
      AND c.relkind IN ('r','p','v','m','f')
      AND (
        has_table_privilege(current_user,c.oid,'INSERT')
        OR has_table_privilege(current_user,c.oid,'UPDATE')
        OR has_table_privilege(current_user,c.oid,'DELETE')
        OR has_table_privilege(current_user,c.oid,'TRUNCATE')
        OR has_table_privilege(current_user,c.oid,'TRIGGER')
        OR has_table_privilege(current_user,c.oid,'REFERENCES')
      )
  ) THEN
    bad := array_append(bad, 'effective table write or DDL-related privileges');
  END IF;

  IF EXISTS (
    SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
    WHERE n.nspname IN ('public','private','storage') AND c.relkind='S'
      AND (has_sequence_privilege(current_user,c.oid,'USAGE')
        OR has_sequence_privilege(current_user,c.oid,'UPDATE'))
  ) THEN
    bad := array_append(bad, 'effective sequence usage/update privileges');
  END IF;

  -- No user-defined function execution is accepted. Volatility metadata is
  -- self-declared and cannot prove that arbitrary function code has no side effects.
  IF EXISTS (
    SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
    WHERE n.nspname IN ('public','private','storage')
      AND has_function_privilege(current_user,p.oid,'EXECUTE')
      AND true
  ) THEN
    bad := array_append(bad, 'EXECUTE on user-defined functions');
  END IF;

  IF cardinality(bad) > 0 THEN
    RAISE EXCEPTION 'Read-only preflight rejected role %: %', current_user, array_to_string(bad, ', ');
  END IF;
END
$preflight$;

-- Require visibility of all metadata required by the export; any query error
-- or missing Storage metadata relations is a hard failure.
SELECT
  current_user AS verified_role,
  current_setting('server_version_num')::integer AS server_version_num,
  count(*) FILTER (WHERE nspname IN ('public','private','storage')) AS visible_required_schemas
FROM pg_namespace
WHERE nspname IN ('public','private','storage')
HAVING count(*) FILTER (WHERE nspname IN ('public','private','storage')) = 3;
