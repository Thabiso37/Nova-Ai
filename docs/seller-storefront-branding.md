# NOVAAI Seller Storefront & Branding

## Implementation status

The frontend and integration code is prepared in this branch. The database SQL in
\`docs/sql/20261115-seller-storefront-branding.sql\` is a review artifact only and
has **not** been applied to Supabase.

## Existing application integration

- Seller branding controls mount inside the existing Seller Portal 2080 **My Store** view.
- Existing \`seller_stores.store_name\`, \`phone\`, and \`status\` are displayed from the
  authenticated seller's own row. No store description or private address is displayed.
- Approved store cards link to \`store-page.html?store=<store_slug>\`.
- Retail's existing seller-store action now navigates to the dedicated Store Page.
- Store Page product links reuse the current Retail/Motors public product-detail route
  (\`index.html?product=<id>\`) and the existing Property detail route
  (\`property-details.html?id=<id>\`).
- Only approved stores and approved products are queried for public display.
- Seller identity and marketplace restrictions remain enforced by existing auth/RLS
  and the existing Products policy.

## Database additions requiring explicit approval

The prepared SQL proposes:

1. Two nullable columns on \`public.seller_stores\`: \`store_logo_url\` and
   \`store_banner_url\`.
2. \`public.seller_store_likes\` and \`public.seller_store_follows\`, each with a
   composite primary key preventing duplicate customer/store relationships.
3. RLS policies allowing customers to read and remove only their own relationship
   rows, and insert only their own relationship against an approved store.
4. An aggregate-only RPC returning counts and the signed-in customer's own
   like/follow state. Customer identities are never exposed for public counting.
5. A dedicated public-read Storage bucket with seller writes/deletes restricted to
   the authenticated seller's own \`auth.uid()\` folder, PNG/JPEG/WebP only, 5 MiB max.

No existing product, order, order-item, fulfilment, seller, or marketplace permission
rows are altered by the prepared SQL. Existing store approval and primary-marketplace
guards remain in force.

**Do not apply the SQL until the user explicitly approves it.** The frontend fails
closed for likes/follows and reports branding setup as pending while the schema is
not present.

## Validation

The pull request runs:
- JavaScript syntax checks for changed scripts.
- HTML parsing and duplicate-ID checks via the repository's existing PR validation.
- Focused Node regression tests for approved-only display, product-detail routing,
  duplicate prevention, customer scoping, aggregate-only counts, Storage folder
  ownership, and commerce-table preservation.

These tests are static/mock-based. They do not claim live Supabase end-to-end
validation until the separately approved SQL is applied in an approved environment.
