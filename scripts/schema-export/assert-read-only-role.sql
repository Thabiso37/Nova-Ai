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
    WHERE n.nspname NOT IN ('pg_catalog','information_schema')
      AND n.nspname !~ '^pg_'
      AND (n.nspowner = role_oid OR has_schema_privilege(current_user,n.oid,'CREATE'))
  ) THEN
    bad := array_append(bad, 'schema ownership or CREATE privilege');
  END IF;

  IF EXISTS (
    SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
    WHERE n.nspname NOT IN ('pg_catalog','information_schema')
      AND n.nspname !~ '^pg_'
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
    WHERE n.nspname NOT IN ('pg_catalog','information_schema')
      AND n.nspname !~ '^pg_'
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
    WHERE n.nspname NOT IN ('pg_catalog','information_schema') AND n.nspname !~ '^pg_' AND c.relkind='S'
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
    WHERE n.nspname NOT IN ('pg_catalog','information_schema')
      AND n.nspname !~ '^pg_'
      AND (p.proowner=role_oid OR has_function_privilege(current_user,p.oid,'EXECUTE'))
  ) THEN
    bad := array_append(bad, 'function ownership or EXECUTE on user-defined routines');
  END IF;

  -- PUBLIC is an implicit grantee (OID 0). Check both its explicit ACL entry and
  -- PostgreSQL's effective privilege result; do not rely on role defaults.
  -- Large-object routines are special: they mutate large objects or server files
  -- without granting table INSERT/UPDATE/DELETE. Match schema + identity arguments
  -- and verify the actual PUBLIC EXECUTE path, not just routine names.
  IF EXISTS (
    WITH dangerous_large_object_routines(schema_name, routine_name, identity_arg_types) AS (
      VALUES
        ('pg_catalog','lo_create','oid'),
        ('pg_catalog','lo_from_bytea','oid, bytea'),
        ('pg_catalog','lo_put','oid, bigint, bytea'),
        ('pg_catalog','lo_unlink','oid'),
        ('pg_catalog','lo_import','text'),
        ('pg_catalog','lo_import','text, oid'),
        ('pg_catalog','lo_export','oid, text'),
        ('pg_catalog','lo_open','oid, integer'),
        ('pg_catalog','lowrite','integer, bytea'),
        ('pg_catalog','lo_truncate','integer, integer'),
        ('pg_catalog','lo_truncate64','integer, bigint')
    )
    SELECT 1
    FROM dangerous_large_object_routines d
    JOIN pg_namespace n ON n.nspname=d.schema_name
    JOIN pg_proc p ON p.pronamespace=n.oid
      AND p.proname=d.routine_name
      AND oidvectortypes(p.proargtypes)=d.identity_arg_types
    WHERE has_function_privilege(current_user,p.oid,'EXECUTE')
  ) THEN
    bad := array_append(bad, 'effective EXECUTE on write-capable pg_catalog large-object routines');
  END IF;

  -- A SECURITY DEFINER routine executes with its owner's privileges. Reject any
  -- effective PUBLIC-executable SECURITY DEFINER routine, including extension
  -- schemas such as net; the user-defined routine check above remains in force.
  IF EXISTS (
    SELECT 1
    FROM pg_proc p
    WHERE p.prosecdef
      AND has_function_privilege(current_user,p.oid,'EXECUTE')

  ) THEN
    bad := array_append(bad, 'effective EXECUTE on SECURITY DEFINER routines');
  END IF;

  -- Extension-owned VOLATILE routines can perform database or external side
  -- effects. PostgreSQL has no catalogue flag proving a function body harmless,
  -- so fail closed whenever the export login has effective EXECUTE on such extension routines.
  -- Stable/immutable extension helpers remain usable when otherwise permitted.
  IF EXISTS (
    SELECT 1
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid=p.pronamespace
    JOIN pg_depend dep ON dep.classid='pg_proc'::regclass
      AND dep.objid=p.oid AND dep.refclassid='pg_extension'::regclass
      AND dep.deptype='e'
    WHERE n.nspname NOT IN ('pg_catalog','information_schema')
      AND n.nspname !~ '^pg_'
      AND p.provolatile='v'
      AND has_function_privilege(current_user,p.oid,'EXECUTE')
  ) THEN
    bad := array_append(bad, 'effective EXECUTE on VOLATILE extension routines');
  END IF;

  IF EXISTS (
    SELECT 1 FROM pg_type t JOIN pg_namespace n ON n.oid=t.typnamespace
    WHERE n.nspname NOT IN ('pg_catalog','information_schema') AND n.nspname !~ '^pg_' AND t.typowner=role_oid
  ) THEN
    bad := array_append(bad, 'type ownership in exported schemas');
  END IF;

  -- Large-object ACL UPDATE is a write path independent of table ACLs.
  IF EXISTS (
    SELECT 1
    FROM pg_largeobject_metadata lom
    CROSS JOIN LATERAL aclexplode(coalesce(lom.lomacl,acldefault('L',lom.lomowner))) x
    WHERE (lom.lomowner=role_oid OR x.grantee IN (role_oid,0))
      AND x.privilege_type='UPDATE'
  ) THEN
    bad := array_append(bad, 'large-object ownership or effective UPDATE privilege');
  END IF;

  IF EXISTS (
    SELECT 1 FROM pg_parameter_acl pa
    WHERE has_parameter_privilege(current_user,pa.parname,'ALTER SYSTEM')
  ) THEN
    bad := array_append(bad, 'ALTER SYSTEM parameter privilege');
  END IF;

  IF EXISTS (
    SELECT 1 FROM pg_tablespace t
    WHERE has_tablespace_privilege(current_user,t.oid,'CREATE')
  ) THEN
    bad := array_append(bad, 'tablespace CREATE privilege');
  END IF;

  -- Membership in predefined server-side capability roles is prohibited. The
  -- general membership check above is intentionally broader and catches future roles.
  IF EXISTS (
    SELECT 1 FROM pg_roles
    WHERE rolname IN ('pg_read_server_files','pg_write_server_files',
                      'pg_execute_server_program','pg_signal_backend',
                      'pg_write_all_data','pg_read_all_data',
                      'pg_read_all_settings','pg_read_all_stats',
                      'pg_monitor','pg_stat_scan_tables')
      AND pg_has_role(current_user, oid, 'MEMBER')
  ) THEN
    bad := array_append(bad, 'membership in privileged server-operation roles');
  END IF;

  IF cardinality(bad)>0 THEN
    RAISE EXCEPTION 'Read-only preflight rejected role %: %',current_user,array_to_string(bad,', ');
  END IF;
END
$preflight$;

-- Required schemas and metadata access are assertions, not zero-row SELECTs.
-- A missing schema or missing USAGE must make psql exit nonzero under ON_ERROR_STOP.
DO $visibility$
DECLARE visible_count integer;
BEGIN
  SELECT count(*) INTO visible_count
  FROM pg_namespace n
  WHERE n.nspname IN ('public','private','storage')
    AND has_schema_privilege(current_user, n.oid, 'USAGE');

  IF visible_count <> 3 THEN
    RAISE EXCEPTION 'Required schema visibility failed: expected public, private, storage with USAGE; found %', visible_count;
  END IF;

  IF to_regclass('public.products') IS NULL
     OR to_regclass('public."Products"') IS NULL
     OR to_regclass('storage.buckets') IS NULL THEN
    RAISE EXCEPTION 'Required relation visibility failed (public.products, public."Products", storage.buckets)';
  END IF;

  -- Explicitly exercise the catalogue sources used by the manifest. These queries
  -- must execute successfully even when their legitimate result is empty.
  PERFORM count(*) FROM pg_auth_members;
  PERFORM count(*) FROM pg_roles;
  PERFORM count(*) FROM pg_extension;
  PERFORM count(*) FROM pg_policy;
  PERFORM count(*) FROM pg_default_acl;
  PERFORM count(*) FROM pg_largeobject_metadata;
  PERFORM count(*) FROM pg_parameter_acl;
  PERFORM count(*) FROM pg_tablespace;
  PERFORM count(*) FROM pg_proc;
  PERFORM count(*) FROM pg_trigger;
  PERFORM count(*) FROM pg_sequences WHERE schemaname IN ('public','private','storage');

  -- The manifest reads bucket metadata, not Storage object rows.
  PERFORM count(*) FROM storage.buckets;
END
$visibility$;

SELECT current_user AS verified_role,
       current_setting('server_version_num')::integer AS server_version_num,
       3 AS visible_required_schemas;
