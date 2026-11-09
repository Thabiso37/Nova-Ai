-- Remove all disposable unsupported-object probes before clean inventory.


DROP TRANSFORM IF EXISTS FOR novaai_app.unsupported_range_probe LANGUAGE plpgsql;
DROP FUNCTION IF EXISTS novaai_app.phase2_transform_from_sql(internal);
DROP FUNCTION IF EXISTS novaai_app.phase2_transform_to_sql(internal);

-- Remove labels through the same provider API; no label values are read or emitted.
SELECT pg_catalog.pg_stat_file('/tmp/phase2_dummy_seclabel.so', true) IS NOT NULL AS phase2_provider_available \gset
\if :phase2_provider_available
LOAD '/tmp/phase2_dummy_seclabel.so';
SECURITY LABEL FOR phase2_dummy ON TABLE novaai_app.orders IS NULL;
SECURITY LABEL FOR phase2_dummy ON DATABASE inventory_test IS NULL;
\endif

SELECT lo_unlink(424242) WHERE EXISTS (SELECT 1 FROM pg_largeobject_metadata WHERE oid=424242);
DROP SUBSCRIPTION IF EXISTS phase2_probe_subscription;
DROP PUBLICATION IF EXISTS phase2_probe_publication;
DROP EVENT TRIGGER IF EXISTS phase2_probe_event_trigger;
DROP USER MAPPING IF EXISTS FOR novaai_inventory_inspector SERVER phase2_probe_server;
DROP FOREIGN TABLE IF EXISTS novaai_app.unsupported_foreign_table_probe;
DROP SERVER IF EXISTS phase2_probe_server CASCADE;
DROP EXTENSION IF EXISTS postgres_fdw;
DROP CAST IF EXISTS (integer AS novaai_app.unsupported_range_probe);
DROP FUNCTION IF EXISTS novaai_app.phase2_int_to_range(integer);
DROP OPERATOR CLASS IF EXISTS novaai_app.phase2_probe_int4_ops USING btree;
DROP OPERATOR FAMILY IF EXISTS novaai_app.phase2_probe_family USING btree;
DROP OPERATOR IF EXISTS novaai_app.=== (integer,integer);
DROP FUNCTION IF EXISTS novaai_app.phase2_probe_eq(integer,integer);
DROP FUNCTION IF EXISTS novaai_app.phase2_event_trigger_fn();
DROP AGGREGATE IF EXISTS novaai_app.phase2_probe_sum(integer);
DROP COLLATION IF EXISTS novaai_app.phase2_probe_collation;
DROP TEXT SEARCH DICTIONARY IF EXISTS novaai_app.phase2_probe_tsd;
DROP TEXT SEARCH TEMPLATE IF EXISTS novaai_app.phase2_probe_template;
DROP TEXT SEARCH PARSER IF EXISTS novaai_app.phase2_probe_parser;
DROP CONVERSION IF EXISTS novaai_app.phase2_probe_conversion;
DROP LANGUAGE IF EXISTS phase2_probe_plpgsql;
DROP TEXT SEARCH CONFIGURATION IF EXISTS novaai_app.phase2_probe_tsc;
DROP RULE IF EXISTS unsupported_probe_rule ON novaai_app.orders;
DROP STATISTICS IF EXISTS novaai_app.unsupported_probe_stats;
DROP TYPE IF EXISTS novaai_app.unsupported_range_probe CASCADE;
