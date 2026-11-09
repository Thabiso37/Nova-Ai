-- Positive fail-closed detector probes. Run only in the disposable PostgreSQL 17 fixture.
CREATE STATISTICS novaai_app.unsupported_probe_stats (ndistinct)
  ON customer_id, state FROM novaai_app.orders;

CREATE RULE unsupported_probe_rule AS
  ON UPDATE TO novaai_app.orders DO INSTEAD NOTHING;

CREATE TYPE novaai_app.unsupported_range_probe AS RANGE (subtype = integer);
