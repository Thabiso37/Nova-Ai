-- Client roles must never have table-wide maintenance or structural privileges.
-- TRUNCATE bypasses RLS; REFERENCES/TRIGGER/MAINTAIN are not needed by browser clients.
REVOKE TRUNCATE, REFERENCES, TRIGGER, MAINTAIN
ON ALL TABLES IN SCHEMA public
FROM PUBLIC, anon, authenticated;

-- Orders and fulfilments are signed-in workflows only. Remove unnecessary
-- anonymous table-level SELECT grants; authenticated access remains RLS-scoped.
REVOKE SELECT ON TABLE public.orders, public.order_items, public.seller_fulfillments
FROM anon;
