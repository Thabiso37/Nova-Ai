#!/usr/bin/env python3
"""Independent structured PostgreSQL 17 catalogue baseline; no application row reads."""
import json,os,re,sys
import psycopg2
from psycopg2.extras import RealDictCursor
dsn=os.environ.get("BASELINE_DSN")
if not dsn:raise SystemExit("BASELINE_DSN required")
schemas=json.load(open("phase2/metadata-inventory/scope.json"))["schemas"]
try:
    conn=psycopg2.connect(dsn);out={"sections":{},"objects":[]}
    try:
     conn.set_session(isolation_level="REPEATABLE READ",readonly=True,autocommit=False)
     with conn.cursor(cursor_factory=RealDictCursor) as c:
      sid=os.environ.get("CATALOGUE_SNAPSHOT_ID")
      if sid:
       if not re.fullmatch(r"[0-9A-Fa-f-]+",sid):raise RuntimeError("Invalid snapshot identifier")
       c.execute("SET TRANSACTION SNAPSHOT '"+sid+"'")
      else:c.execute("SELECT pg_export_snapshot()");sid=c.fetchone()["pg_export_snapshot"]
      c.execute("SELECT current_setting('server_version_num') version,current_database() database")
      meta=dict(c.fetchone());out.update(meta);out["snapshot_id"]=sid
      if not str(meta["version"]).startswith("170"):raise RuntimeError("PostgreSQL 17 required")
      queries={
       "columns":"""SELECT n.nspname schema,c.relname relation,a.attnum ordinal,a.attname name,
        format_type(a.atttypid,a.atttypmod) data_type,a.attnotnull not_null,
        pg_get_expr(d.adbin,d.adrelid) default_expression,a.attidentity identity_kind,
        a.attgenerated generated_kind,COALESCE(coll.collname,'') collation,
        a.attstorage storage_kind,a.attcompression compression_kind,a.attstattarget statistics_target,
        a.attoptions column_options
        FROM pg_attribute a JOIN pg_class c ON c.oid=a.attrelid JOIN pg_namespace n ON n.oid=c.relnamespace
        LEFT JOIN pg_attrdef d ON d.adrelid=c.oid AND d.adnum=a.attnum
        LEFT JOIN pg_collation coll ON coll.oid=a.attcollation
        WHERE a.attnum>0 AND NOT a.attisdropped AND c.relkind IN ('r','p','v','m','f') AND n.nspname=ANY(%s) ORDER BY 1,2,3""",
       "sequences":"""SELECT n.nspname schema,c.relname name,format_type(s.seqtypid,NULL) data_type,
        s.seqstart start_value,s.seqincrement increment_by,s.seqmax max_value,s.seqmin min_value,
        s.seqcache cache_size,s.seqcycle cycle,pg_get_userbyid(c.relowner) owner,
        dep.refobjid::regclass::text owned_by_relation,dep.refobjsubid owned_by_attnum
        FROM pg_sequence s JOIN pg_class c ON c.oid=s.seqrelid JOIN pg_namespace n ON n.oid=c.relnamespace
        LEFT JOIN pg_depend dep ON dep.classid='pg_class'::regclass AND dep.objid=c.oid
          AND dep.refclassid='pg_class'::regclass AND dep.deptype IN ('a','i')
        WHERE n.nspname=ANY(%s) ORDER BY 1,2""",
       "constraints":"""SELECT n.nspname schema,c.relname relation,con.conname name,con.contype kind,
        con.convalidated validated,con.condeferrable deferrable,con.condeferred initially_deferred,
        pg_get_constraintdef(con.oid,true) definition,t.typname domain_name,
        pg_get_userbyid(COALESCE(c.relowner,t.typowner)) owner
        FROM pg_constraint con LEFT JOIN pg_class c ON c.oid=con.conrelid
        LEFT JOIN pg_namespace n ON n.oid=COALESCE(c.relnamespace,(SELECT typnamespace FROM pg_type WHERE oid=con.contypid))
        LEFT JOIN pg_type t ON t.oid=con.contypid WHERE n.nspname=ANY(%s) ORDER BY 1,2,3""",
       "indexes":"""SELECT n.nspname schema,t.relname table_name,i.relname index_name,pg_get_indexdef(i.oid) definition,ix.indisunique is_unique,ix.indisvalid is_valid,
        ix.indisprimary is_primary,ix.indisexclusion is_exclusion,ix.indisready is_ready,ix.indislive is_live,
        ix.indisreplident is_replica_identity,ix.indisclustered is_clustered,ix.indnullsnotdistinct nulls_not_distinct,
        ix.indnkeyatts key_attribute_count,ix.indnatts attribute_count,pg_get_expr(ix.indpred,ix.indrelid,true) predicate,
        pg_get_expr(ix.indexprs,ix.indrelid,true) expressions,pg_get_userbyid(i.relowner) owner
        FROM pg_index ix JOIN pg_class t ON t.oid=ix.indrelid JOIN pg_class i ON i.oid=ix.indexrelid
        JOIN pg_namespace n ON n.oid=t.relnamespace WHERE n.nspname=ANY(%s) ORDER BY 1,2,3""",
       "routines":"""SELECT n.nspname schema,p.proname name,p.prokind kind,
        pg_get_function_identity_arguments(p.oid) identity_arguments,pg_get_function_result(p.oid) result_type,
        p.provolatile volatility,p.prosecdef security_definer,p.proleakproof leakproof,p.proparallel parallel,
        p.proisstrict strict,p.proretset returns_set,p.proconfig configuration,p.procost cost,p.prorows estimated_rows,
        pg_get_functiondef(p.oid) definition,pg_get_userbyid(p.proowner) owner,l.lanname language
        FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace JOIN pg_language l ON l.oid=p.prolang
        WHERE n.nspname=ANY(%s) ORDER BY 1,2,4""",
       "triggers":"""SELECT n.nspname schema,c.relname relation,t.tgname name,pg_get_triggerdef(t.oid,true) definition,
        t.tgenabled enabled,pg_get_userbyid(c.relowner) owner FROM pg_trigger t JOIN pg_class c ON c.oid=t.tgrelid
        JOIN pg_namespace n ON n.oid=c.relnamespace WHERE NOT t.tgisinternal AND n.nspname=ANY(%s) ORDER BY 1,2,3""",
       "types":"""SELECT n.nspname schema,t.typname name,t.typtype kind,format_type(t.typbasetype,t.typtypmod) base_type,t.typcategory category,t.typisdefined is_defined,
        t.typnotnull not_null,t.typlen length,t.typbyval by_value,t.typalign alignment,t.typstorage storage,
        t.typdefault default_expression,CASE WHEN t.typcollation=0 THEN NULL ELSE t.typcollation::regcollation::text END collation,
        pg_get_userbyid(t.typowner) owner FROM pg_type t JOIN pg_namespace n ON n.oid=t.typnamespace
        WHERE n.nspname=ANY(%s) AND t.typrelid=0 AND t.typelem=0 ORDER BY 1,2""",
       "enums":"""SELECT n.nspname schema,t.typname type_name,e.enumlabel label,e.enumsortorder sort_order
        FROM pg_enum e JOIN pg_type t ON t.oid=e.enumtypid JOIN pg_namespace n ON n.oid=t.typnamespace
        WHERE n.nspname=ANY(%s) ORDER BY 1,2,4""",
       "policies":"""SELECT n.nspname schema,c.relname relation,p.polname name,p.polcmd command,p.polpermissive permissive,
        ARRAY(SELECT CASE WHEN role_oid=0 THEN 'PUBLIC' ELSE r.rolname END FROM unnest(p.polroles) AS u(role_oid)
        LEFT JOIN pg_roles r ON r.oid=u.role_oid ORDER BY 1) roles,pg_get_expr(p.polqual,p.polrelid) using_expression,
        pg_get_expr(p.polwithcheck,p.polrelid) check_expression,pg_get_userbyid(c.relowner) owner
        FROM pg_policy p JOIN pg_class c ON c.oid=p.polrelid JOIN pg_namespace n ON n.oid=c.relnamespace
        WHERE n.nspname=ANY(%s) ORDER BY 1,2,3""",
       "partitions":"""SELECT pn.nspname parent_schema,pc.relname parent_name,cn.nspname child_schema,cc.relname child_name,
        pg_get_expr(cc.relpartbound,cc.oid,true) partition_bound FROM pg_inherits h JOIN pg_class pc ON pc.oid=h.inhparent
        JOIN pg_namespace pn ON pn.oid=pc.relnamespace JOIN pg_class cc ON cc.oid=h.inhrelid
        JOIN pg_namespace cn ON cn.oid=cc.relnamespace WHERE pn.nspname=ANY(%s) OR cn.nspname=ANY(%s) ORDER BY 1,2,3,4""",
       "extensions":"""SELECT e.extname name,e.extversion version,n.nspname schema,e.extrelocatable relocatable,
        e.extconfig config_relations,e.extcondition config_conditions,pg_get_userbyid(e.extowner) owner
        FROM pg_extension e JOIN pg_namespace n ON n.oid=e.extnamespace ORDER BY 1""",
       "relation_acl":"""SELECT n.nspname schema,c.relname relation,pg_get_userbyid(c.relowner) owner,c.relacl::text acl
        FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname=ANY(%s) ORDER BY 1,2""",
       "default_privileges":"""SELECT n.nspname schema,pg_get_userbyid(d.defaclrole) owner,d.defaclobjtype object_type,d.defaclacl::text acl
        FROM pg_default_acl d LEFT JOIN pg_namespace n ON n.oid=d.defaclnamespace
        WHERE d.defaclnamespace=0 OR n.nspname=ANY(%s)""",
       "schema_acl":"""SELECT n.nspname schema,pg_get_userbyid(n.nspowner) owner,n.nspacl::text acl
        FROM pg_namespace n WHERE n.nspname=ANY(%s) ORDER BY 1""",
       "routine_acl":"""SELECT n.nspname schema,p.proname name,pg_get_function_identity_arguments(p.oid) identity_arguments,
        pg_get_userbyid(p.proowner) owner,p.proacl::text acl FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
        WHERE n.nspname=ANY(%s) ORDER BY 1,2,3""",
       "type_acl":"""SELECT n.nspname schema,t.typname name,pg_get_userbyid(t.typowner) owner,t.typacl::text acl
        FROM pg_type t JOIN pg_namespace n ON n.oid=t.typnamespace WHERE n.nspname=ANY(%s) AND t.typelem=0 ORDER BY 1,2""",
       "column_acl":"""SELECT n.nspname schema,c.relname relation,a.attname column_name,a.attacl::text acl
        FROM pg_attribute a JOIN pg_class c ON c.oid=a.attrelid JOIN pg_namespace n ON n.oid=c.relnamespace
        WHERE a.attnum>0 AND NOT a.attisdropped AND a.attacl IS NOT NULL AND n.nspname=ANY(%s) ORDER BY 1,2,3"""
      }
      for name,sql in queries.items():
       params=(schemas,schemas) if name=="partitions" else (schemas,)
       c.execute(sql,params);out["sections"][name]=[dict(x) for x in c.fetchall()]
      c.execute("""SELECT n.nspname schema,c.relname name,c.relkind,c.relpersistence,pg_get_userbyid(c.relowner) owner,
       c.relispartition,c.relrowsecurity,c.relforcerowsecurity,
       CASE c.relkind WHEN 'r' THEN 'table' WHEN 'p' THEN 'partitioned_table' WHEN 'v' THEN 'view'
        WHEN 'm' THEN 'materialized_view' WHEN 'S' THEN 'sequence' WHEN 'i' THEN 'index' WHEN 'I' THEN 'index'
        ELSE 'relation' END object_type,
       CASE WHEN c.relkind IN ('v','m') THEN pg_get_viewdef(c.oid,true) END view_definition,c.reloptions
       FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname=ANY(%s) ORDER BY 1,2""",(schemas,))
      out["objects"]=[dict(x) for x in c.fetchall()]
     conn.commit()
    finally:conn.close()
    
except Exception as exc:
    print("CATALOGUE BASELINE FAILED CLOSED: " + type(exc).__name__, file=sys.stderr)
    sys.exit(1)
print(json.dumps(out,sort_keys=True,default=str))
