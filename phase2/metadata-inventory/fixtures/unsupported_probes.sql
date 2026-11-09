-- Positive unsupported-object probes; disposable PostgreSQL 17.11 only.
CREATE STATISTICS novaai_app.unsupported_probe_stats (ndistinct) ON customer_id,state FROM novaai_app.orders;
CREATE RULE unsupported_probe_rule AS ON UPDATE TO novaai_app.orders DO INSTEAD NOTHING;
CREATE TYPE novaai_app.unsupported_range_probe AS RANGE (subtype=integer);
CREATE EXTENSION IF NOT EXISTS postgres_fdw;
CREATE SERVER phase2_probe_server FOREIGN DATA WRAPPER postgres_fdw;
GRANT USAGE ON FOREIGN SERVER phase2_probe_server TO novaai_inventory_owner;
GRANT USAGE ON FOREIGN DATA WRAPPER postgres_fdw TO novaai_inventory_owner;
SET ROLE novaai_inventory_owner;
CREATE FOREIGN TABLE novaai_app.unsupported_foreign_table_probe(id integer)
 SERVER phase2_probe_server OPTIONS (schema_name 'synthetic',table_name 'probe');
CREATE FUNCTION novaai_app.phase2_probe_eq(integer,integer) RETURNS boolean LANGUAGE sql IMMUTABLE AS 'SELECT $1 = $2';
CREATE OPERATOR novaai_app.=== (LEFTARG=integer,RIGHTARG=integer,FUNCTION=novaai_app.phase2_probe_eq);
CREATE AGGREGATE novaai_app.phase2_probe_sum(integer)
 (SFUNC=pg_catalog.int4pl,STYPE=integer,INITCOND='0');
CREATE COLLATION novaai_app.phase2_probe_collation (provider=libc,locale='C');
CREATE TEXT SEARCH CONFIGURATION novaai_app.phase2_probe_tsc (COPY=pg_catalog.simple);
CREATE TEXT SEARCH DICTIONARY novaai_app.phase2_probe_tsd (TEMPLATE=pg_catalog.simple);
CREATE FUNCTION novaai_app.phase2_int_to_range(integer) RETURNS novaai_app.unsupported_range_probe
 LANGUAGE sql IMMUTABLE AS 'SELECT novaai_app.unsupported_range_probe($1,$1+1)';
CREATE CAST (integer AS novaai_app.unsupported_range_probe)
 WITH FUNCTION novaai_app.phase2_int_to_range(integer) AS ASSIGNMENT;
CREATE FUNCTION novaai_app.phase2_event_trigger_fn() RETURNS event_trigger
 LANGUAGE plpgsql AS 'BEGIN RETURN; END;';
RESET ROLE;
CREATE OPERATOR FAMILY novaai_app.phase2_probe_family USING btree;
CREATE OPERATOR CLASS novaai_app.phase2_probe_int4_ops FOR TYPE integer USING btree
 FAMILY novaai_app.phase2_probe_family AS OPERATOR 1 pg_catalog.<, FUNCTION 1 pg_catalog.btint4cmp(integer,integer);
CREATE EVENT TRIGGER phase2_probe_event_trigger ON ddl_command_start
 EXECUTE FUNCTION novaai_app.phase2_event_trigger_fn();
CREATE USER MAPPING FOR novaai_inventory_inspector SERVER phase2_probe_server OPTIONS (user 'synthetic');
CREATE PUBLICATION phase2_probe_publication FOR TABLE novaai_app.orders;
CREATE SUBSCRIPTION phase2_probe_subscription
 CONNECTION 'host=127.0.0.1 port=1 dbname=synthetic user=synthetic'
 PUBLICATION phase2_probe_publication WITH (connect=false,enabled=false,create_slot=false);
SELECT lo_create(424242);
