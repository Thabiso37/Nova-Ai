# NOVAAI Seller Storefront & Branding

## Implementation status

The frontend and integration code is prepared in this branch. The SQL in
`docs/sql/20261115-seller-storefront-branding.sql` is a review artifact only and
has **not** been applied to Supabase.

## Existing application integration

- Seller branding controls mount inside the existing Seller Portal 2080 **My Store** view.
- Existing `seller_stores.store_name`, `phone`, and `status` are displayed from the
  authenticated seller's own row. No store description or private address is displayed.
- Approved store cards link to `store-page.html?store=<store_slug>`.
- Retail's existing seller-store action navigates to the dedicated Store Page.
- Store Page product links reuse the current Retail/Motors public product-detail route
  (`index.html?product=<id>`) and the existing Property detail route
  (`property-details.html?id=<id>`).
- Only approved stores and approved products are queried for public display.
- Seller identity and marketplace restrictions remain enforced by existing auth/RLS
  and the existing Products policy.

## Database additions requiring explicit approval

The prepared SQL proposes:

1. Two nullable columns on `public.seller_stores`: `store_logo_url` and
   `store_banner_url`.
2. `public.seller_store_likes` and `public.seller_store_follows`, each with a
   composite primary key preventing duplicate customer/store relationships.
3. Customer-id indexes on both engagement tables for customer-scoped reads/deletes.
4. RLS policies allowing customers to read and remove only their own relationship
   rows, and insert only their own relationship against an approved store. Self-likes
   and self-follows are rejected.
5. An aggregate-only RPC returning counts and the signed-in customer's own
   like/follow state. Customer identities are never exposed for public counting.
6. A dedicated public-read Storage bucket with:
   - JPEG, PNG and WebP only;
   - 5 MiB maximum object size;
   - public reads for rendering the approved store branding assets;
   - INSERT, UPDATE (including replacement/upsert) and DELETE limited to an
     authenticated user who owns an existing `seller_stores` row and uses their
     own `auth.uid()` folder.
   Ordinary customer accounts without a seller-store row cannot manage bucket files.

### Safe bucket creation

The SQL uses `ON CONFLICT (id) DO NOTHING`. It never updates an existing bucket.
A validation block checks the existing bucket's name, public-read setting, size
limit and MIME allowlist against the expected configuration. If any value differs,
the script raises an exception and rolls back rather than silently overwriting it.

## Preservation and security boundaries

- No existing seller identity, store name, public phone, approval status or marketplace
  permission is changed.
- No existing product, order, order-item, fulfilment or payment record is changed.
- Existing Storage buckets are not reconfigured.
- Approved-store checks remain in the engagement insert policies and aggregate RPC.
- Customer identity privacy is preserved: users see only their own relationship rows;
  the public RPC returns aggregate counts and the caller's own booleans only.
- Product visibility continues to be enforced by the existing Products RLS policy.

**Do not apply the SQL until the user explicitly approves it.** No SQL has been
executed against Supabase, and no production Storage configuration has been changed.

## Validation

The PR runs JavaScript syntax checks, HTML parsing, duplicate-ID checks, static SQL
security assertions, focused Node regression tests, and isolated Playwright browser
tests. These tests do not claim live Supabase end-to-end validation. The SQL must
still receive a separate human review before production approval.
