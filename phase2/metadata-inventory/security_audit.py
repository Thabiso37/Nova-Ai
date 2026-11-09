#!/usr/bin/env python3
"""Fail-closed role, search_path, SECURITY DEFINER and large-object audit."""
import json, os, sys
import psycopg2
DSN = os.environ.get("INVENTORY_DSN")
if not DSN: raise SystemExit("INVENTORY_DSN is required")
LO_REQUIRED = {"lo_get":2,"lo_from_bytea":1,"lo_put":1,"lo_unlink":1,"lo_create":1,"lo_creat":1,"lo_import":2,"lo_export":1,"lowrite":1,"loread":1,"lo_open":1,"lo_truncate":1,"lo_truncate64":1,"lo_close":1,"lo_lseek":1,"lo_lseek64":1,"lo_tell":1,"lo_tell64":1}
APPROVED_SYSTEM_DEFINERS = set()  # No system SECURITY DEFINER routine is implicitly trusted.
DANGEROUS = {"pg_read_file","pg_read_binary_file","pg_ls_dir","pg_stat_file","pg_ls_logdir","pg_ls_waldir","pg_ls_archive_statusdir","pg_write_file","pg_write_binary_file","pg_reload_conf","pg_terminate_backend","pg_cancel_backend","pg_log_backend_memory_contexts"}
r={"status":"FAIL","violations":[],"security_definer_routines":[],"large_object_api":{"required":sorted(LO_REQUIRED),"found":[],"missing":[],"executable":[]}}
try:
 conn=psycopg2.connect(DSN)
 try:
  conn.set_session(readonly=True,autocommit=False)
  with conn.cursor() as c:
   c.execute("SELECT oid,rolname,rolsuper,rolinherit,rolcreaterole,rolcreatedb,rolreplication,rolbypassrls,rolcanlogin,rolconfig FROM pg_roles WHERE rolname=current_user")
   row=c.fetchone()
   if not row: raise RuntimeError("Current role missing")
   oid,name,superuser,inherit,cr,cd,repl,bypass,login,config=row
   r["role"]={"name":name,"superuser":superuser,"inherit":inherit,"create_role":cr,"create_db":cd,"replication":repl,"bypass_rls":bypass,"can_login":login,"setting_names":sorted(x.split("=",1)[0] for x in (config or []))}
   if superuser or inherit or cr or cd or repl or bypass or not login:r["violations"].append("restricted_role_attributes")
   c.execute("SELECT parent.rolname FROM pg_auth_members m JOIN pg_roles child ON child.oid=m.member JOIN pg_roles parent ON parent.oid=m.roleid WHERE child.oid=%s",(oid,))
   memberships=[x[0] for x in c.fetchall()];r["role"]["memberships"]=memberships
   if memberships:r["violations"].append("role_membership")
   c.execute("SELECT oid FROM pg_database WHERE datname=current_database()");dbid=c.fetchone()[0]
   c.execute("SELECT setdatabase,setrole,setconfig FROM pg_db_role_setting WHERE setrole IN (0,%s) AND setdatabase IN (0,%s) ORDER BY 1,2",(oid,dbid))
   settings=[]; paths=[]
   for db,role,cfg in c.fetchall():
    settings.append({"scope":"database" if db else "global","role_specific":bool(role),"setting_names":sorted(x.split("=",1)[0] for x in (cfg or []))})
    paths.extend(x.split("=",1)[1] for x in (cfg or []) if x.split("=",1)[0]=="search_path")
   c.execute("SELECT current_setting('search_path'),current_schemas(false),current_schemas(true)")
   raw,explicit,effective=c.fetchone()
   r["role_settings"]={"entries":settings,"search_path_values":paths}
   r["search_path"]={"configured":raw,"explicit_schemas":explicit,"effective_schemas":effective}
   if raw.strip()!="pg_catalog" or explicit!=["pg_catalog"] or effective!=["pg_catalog"]:r["violations"].append("unsafe_effective_search_path")
   c.execute("""SELECT n.nspname,p.proname,pg_get_function_identity_arguments(p.oid),has_function_privilege(current_user,p.oid,'EXECUTE'),
     EXISTS(SELECT 1 FROM aclexplode(COALESCE(p.proacl,acldefault('f',p.proowner))) a WHERE a.grantee=0 AND a.privilege_type='EXECUTE')
     FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE p.prosecdef ORDER BY 1,2,3""")
   for schema,name,args,execute,public_exec in c.fetchall():
    r["security_definer_routines"].append({"schema":schema,"name":name,"identity_arguments":args,"effective_execute":execute,"public_execute":public_exec})
    if execute and schema!="pg_catalog":r["violations"].append("executable_non_catalog_security_definer")
    if execute and schema=="pg_catalog" and (name in DANGEROUS or name not in APPROVED_SYSTEM_DEFINERS):r["violations"].append("executable_unapproved_system_security_definer")
   c.execute("SELECT p.proname,p.pronargs,has_function_privilege(current_user,p.oid,'EXECUTE') FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='pg_catalog' AND p.proname=ANY(%s) ORDER BY 1,2",(list(LO_REQUIRED),))
   found={}
   for name,nargs,execute in c.fetchall():
    found[name]=found.get(name,0)+1;r["large_object_api"]["found"].append({"name":name,"argument_count":nargs,"effective_execute":execute})
    if execute:r["large_object_api"]["executable"].append(name)
   r["large_object_api"]["missing"]=sorted(x for x,n in LO_REQUIRED.items() if found.get(x,0)<n)
   if r["large_object_api"]["missing"]:r["violations"].append("large_object_api_catalogue_incomplete")
   if r["large_object_api"]["executable"]:r["violations"].append("large_object_api_execute_granted")
   c.execute("SELECT has_column_privilege(current_user,'pg_catalog.pg_user_mapping','umuser','SELECT'),has_column_privilege(current_user,'pg_catalog.pg_user_mapping','umserver','SELECT'),has_column_privilege(current_user,'pg_catalog.pg_user_mapping','umoptions','SELECT')")
   u,s,o=c.fetchone();r["foreign_user_mapping"]={"identity_columns_visible":bool(u and s),"options_visible":bool(o)}
   if not u or not s or o:r["violations"].append("foreign_user_mapping_column_boundary")
   c.execute("SELECT has_column_privilege(current_user,'pg_catalog.pg_seclabel','classoid','SELECT') AND has_column_privilege(current_user,'pg_catalog.pg_seclabel','objoid','SELECT') AND has_column_privilege(current_user,'pg_catalog.pg_seclabel','objsubid','SELECT'),has_column_privilege(current_user,'pg_catalog.pg_seclabel','label','SELECT'),has_column_privilege(current_user,'pg_catalog.pg_shseclabel','classoid','SELECT') AND has_column_privilege(current_user,'pg_catalog.pg_shseclabel','objoid','SELECT'),has_column_privilege(current_user,'pg_catalog.pg_shseclabel','label','SELECT')")
   sl,sv,sh,shv=c.fetchone()
   r["security_label_columns"]={"identity_columns_visible":bool(sl and sh),"label_values_visible":bool(sv or shv)}
   if not sl or not sh or sv or shv:r["violations"].append("security_label_column_boundary")
   c.execute("SELECT has_column_privilege(current_user,'pg_catalog.pg_largeobject_metadata','oid','SELECT'),has_column_privilege(current_user,'pg_catalog.pg_largeobject_metadata','lomowner','SELECT'),has_column_privilege(current_user,'pg_catalog.pg_largeobject_metadata','lomacl','SELECT'),has_table_privilege(current_user,'pg_catalog.pg_largeobject','SELECT')")
   loid,loowner,loacl,locontent=c.fetchone()
   r["large_object_metadata_columns"]={"oid_visible":bool(loid),"owner_visible":bool(loowner),"acl_visible":bool(loacl),"contents_table_visible":bool(locontent)}
   if not loid or loowner or loacl or locontent:r["violations"].append("large_object_metadata_column_boundary")
   c.execute("SELECT has_column_privilege(current_user,'pg_catalog.pg_foreign_data_wrapper','fdwname','SELECT'),has_column_privilege(current_user,'pg_catalog.pg_foreign_data_wrapper','fdwoptions','SELECT'),has_column_privilege(current_user,'pg_catalog.pg_foreign_server','srvname','SELECT'),has_column_privilege(current_user,'pg_catalog.pg_foreign_server','srvoptions','SELECT'),has_column_privilege(current_user,'pg_catalog.pg_foreign_table','ftoptions','SELECT'),has_column_privilege(current_user,'pg_catalog.pg_subscription','subname','SELECT'),has_column_privilege(current_user,'pg_catalog.pg_subscription','subconninfo','SELECT')")
   fdwn,fdwo,srvn,srvo,fto,subn,subc=c.fetchone()
   r["foreign_metadata_columns"]={"fdw_name_visible":bool(fdwn),"fdw_options_visible":bool(fdwo),"server_name_visible":bool(srvn),"server_options_visible":bool(srvo),"foreign_table_options_visible":bool(fto),"subscription_name_visible":bool(subn),"subscription_connection_visible":bool(subc)}
   if not fdwn or fdwo or not srvn or srvo or fto or not subn or subc:r["violations"].append("foreign_metadata_column_boundary")
  conn.commit()
 finally:conn.close()
 
except Exception as exc:
 print("SECURITY AUDIT FAILED CLOSED: "+type(exc).__name__,file=sys.stderr)
 sys.exit(1)
r["status"]="FAIL" if r["violations"] else "PASS"
print(json.dumps(r,sort_keys=True))
if r["status"]!="PASS":sys.exit(1)
