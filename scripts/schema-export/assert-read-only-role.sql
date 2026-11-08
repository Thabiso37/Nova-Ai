-- Fail-closed read-only preflight. Run with psql -X -v ON_ERROR_STOP=1.
-- Effective privilege checks intentionally include PUBLIC and inherited ACL grants.
DO $preflight$
DECLARE
  r record;
  bad text[] := ARRAY[]::text[];
  role_oid oid := (SELECT oid FROM pg_roles WHERE rolname = current_user);
BEGIN
  IF role_oid IS NULL THEN
    RAISE EXCEPTION 'Cannot identify connected database role';
  END IF;
  SELECT * INTO STRICT r FROM pg_roles WHERE oid = role_oid;

  IF r.rolsuper OR r.rolbypassrls OR r.rolcreatedb OR r.rolcreaterole OR r.rolreplication THEN
    bad := array_append(bad, 'administrative role attributes');
  END IF;

  -- Reject every direct/transitive membership: this avoids role SET/INHERIT ambiguity.
  IF EXISTS (
    WITH RECURSIVE memberships(roleid) AS (
      SELECT roleid FROM pg_auth_members WHERE member = role_oid
      UNION
      SELECT m.roleid FROM pg_auth_members m JOIN memberships x ON m.member = x.roleid
    ) SELECT 1 FROM memberships
  ) THEN
    bad := array_append(bad, 'direct or inherited role memberships');
  END IF;

  IF EXISTS (
    SELECT 1 FROM pg_database d
    WHERE d.datname = current_database()
      AND (d.datdba = role_oid
        OR has_database_privilege(current_user,d.oid,'CREATE')
        OR has_database_privilege(current_user,d.oid,'TEMP'))
  ) THEN
    bad := array_append(bad, 'database ownership, CREATE, or TEMP privilege');
  END IF;

  IF EXISTS (
    SELECT 1 FROM pg_namespace n
    WHERE n.nspname IN ('public','private','storage')
      AND (n.nspowner = role_oid OR has_schema_privilege(current_user,n.oid,'CREATE'))
  ) THEN
    bad := array_append(bad, 'schema ownership or CREATE privilege');
  END IF;

  IF EXISTS (
    SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
    WHERE n.nspname IN ('public','private','storage')
      AND c.relkind IN ('r','p','v','m','f')
      AND (
        c.relowner = role_oid
        OR has_table_privilege(current_user,c.oid,'INSERT')
        OR has_table_privilege(current_user,c.oid,'UPDATE')
        OR has_table_privilege(current_user,c.oid,'DELETE')
        OR has_table_privilege(current_user,c.oid,'TRUNCATE')
        OR has_table_privilege(current_user,c.oid,'TRIGGER')
        OR has_table_privilege(current_user,c.oid,'REFERENCES')
        OR has_table_privilege(current_user,c.oid,'MAINTAIN')
      )
  ) THEN
    bad := array_append(bad, 'table ownership or effective table write/maintenance privilege');
  END IF;

  -- Column ACLs can grant writes even when no table-level write ACL exists.
  IF EXISTS (
    SELECT 1
    FROM pg_class c
    JOIN pg_namespace n ON n.oid=c.relnamespace
    JOIN pg_attribute a ON a.attrelid=c.oid AND a.attnum > 0 AND NOT a.attisdropped
    WHERE n.nspname IN ('public','private','storage')
      AND c.relkind IN ('r','p','v','m','f')
      AND (
        has_column_privilege(current_user,c.oid,a.attnum,'INSERT')
        OR has_column_privilege(current_user,c.oid,a.attnum,'UPDATE')
        OR has_column_privilege(current_user,c.oid,a.attnum,'REFERENCES')
      )
  ) THEN
    bad := array_append(bad, 'effective column-level INSERT, UPDATE, or REFERENCES privilege');
  END IF;

  IF EXISTS (
    SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
    WHERE n.nspname IN ('public','private','storage') AND c.relkind='S'
      AND (c.relowner=role_oid
        OR has_sequence_privilege(current_user,c.oid,'USAGE')
        OR has_sequence_privilege(current_user,c.oid,'UPDATE'))
  ) THEN
    bad := array_append(bad, 'sequence ownership or effective USAGE/UPDATE privilege');
  END IF;

  -- Refuse ownership of executable objects and all EXECUTE on user-defined routines:
  -- arbitrary routine bodies and SECURITY DEFINER code cannot be proven harmless here.
  IF EXISTS (
    SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
    WHERE n.nspname IN ('public','private','storage')
      AND (p.proowner=role_oid OR has_function_privilege(current_user,p.oid,'EXECUTE'))
  ) THEN
    bad := array_append(bad, 'function ownership or EXECUTE on user-defined routines');
  END IF;

  IF EXISTS (
    SELECT 1 FROM pg_type t JOIN pg_namespace n ON n.oid=t.typnamespace
    WHERE n.nspname IN ('public','private','storage') AND t.typowner=role_oid
  ) THEN
    bad := array_append(bad, 'type ownership in exported schemas');
  END IF;

  -- Large-object ACL UPDATE is a write path independent of table ACLs.
  IF EXISTS (
    SELECT 1 FROM pg_largeobject_metadata lom
    WHERE has_largeobject_privilege(current_user,lom.oid,'UPDATE')
  ) THEN
    bad := array_append(bad, 'effective large-object UPDATE privilege');
  END IF;

  IF cardinality(bad)>0 THEN
    RAISE EXCEPTION 'Read-only preflight rejected role %: %',current_user,array_to_string(bad,', ');
  END IF;
END
$preflight$;

-- Required schema visibility is mandatory; no partial metadata snapshot is accepted.
SELECT current_user AS verified_role,
       current_setting('server_version_num')::integer AS server_version_num,
       count(*) FILTER (WHERE nspname IN ('public','private','storage')) AS visible_required_schemas
FROM pg_namespace
WHERE nspname IN ('public','private','storage')
HAVING count(*) FILTER (WHERE nspname IN ('public','private','storage'))=3;
