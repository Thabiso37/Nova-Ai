-- Store banner URLs are public presentation metadata for approved stores.
-- Keep seller contact phone private; do not grant anon access to phone.
-- The existing seller_stores RLS policy continues to limit public rows to approved stores.
GRANT SELECT (store_banner_url) ON TABLE public.seller_stores TO anon;
