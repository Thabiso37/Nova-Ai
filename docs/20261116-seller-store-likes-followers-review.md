# NOVAAI MARKET — Store Likes & Followers SQL Review

**Status:** Proposed review candidate — not executed — not production approved  
**Date:** 16 November 2026  
**Repository:** `Thabiso37/Nova-Ai`  
**Suggested branch:** `seller-store-likes-followers`  
**Suggested SQL path:** `docs/sql/20261116-seller-store-likes-followers.sql`

## Scope

This candidate is restricted to:

- `public.seller_store_likes`
- `public.seller_store_follows`
- Their primary keys, foreign keys and checks (the composite primary keys also provide the store/customer lookup indexes)
- `public.novaai_is_approved_store_for_engagement(uuid)` as an approval-check helper
- `public.get_seller_store_engagement(p_store_user_id uuid)`

It matches the recorded frontend contract:

- Engagement columns: `store_user_id`, `customer_id`
- RPC name and argument: `get_seller_store_engagement(p_store_user_id)`
- Return fields: `likes_count`, `followers_count`, `liked`, `following`

## Explicit exclusions

The SQL does not create or modify seller branding columns, Storage buckets or Storage policies. It does not modify products, product images, product videos, Immigration, seller/customer profiles, seller approvals, orders, fulfilments, frontend files, or existing `seller_stores` policies.

## Security design

- One row per store/customer pair is enforced by each table's composite primary key.
- Foreign keys point to `auth.users(id)` and cascade if an auth user is deleted.
- Self-like and self-follow rows are rejected.
- RLS is enabled on both engagement tables.
- Authenticated customers can select and delete only their own engagement rows.
- Inserts require the authenticated customer's own ID and an approved seller whose primary marketplace has a matching approved permission.
- No direct anonymous table access is granted.
- The SECURITY DEFINER RPC returns aggregate counts and caller-specific flags only for an approved store.
- Function search paths are fixed to `pg_catalog`; application relations and `auth.uid()` are schema-qualified.
- The migration is transactional and includes fail-closed preflight and postflight checks.

## Important limitations / required review

1. **Live database schema has not been inspected.** The preflight checks the expected seller and marketplace-permission columns and types, but cannot prove that those live columns, role grants, RLS policies or PostgREST configuration match.
2. **No PostgreSQL parser or execution test has been run.** This file is a review candidate, not a validated migration.
3. **No Supabase RLS tests have been run** using anonymous, authenticated customer, approved seller, pending seller or administrator identities.
4. **No frontend runtime test has been run.** The RPC contract matches the supplied repository review document, but the live frontend call and button behavior remain unverified.
5. The approval helper is in the `public` schema and is executable by authenticated users because the RLS insert policies call it. It returns only a boolean, but this does expose whether a supplied store user ID currently satisfies the approval relationship. Review whether the project prefers a non-exposed private schema before production.
6. The candidate assumes the existing status values are the text literal `approved`, and that `seller_stores.primary_marketplace` matches `seller_marketplace_permissions.marketplace`.
7. The migration intentionally aborts if either engagement table or either function already exists. If any such object exists, inspect it and prepare a separately reviewed reconciliation migration; do not overwrite it.
8. The RPC returns no row for a missing or unapproved store. Confirm that the existing frontend handles an empty RPC result as intended.

## Required tests before production approval

- PostgreSQL parse and transaction test in a disposable, approved, no-cost test environment.
- Verify the preflight against the actual schema.
- Anonymous RPC: aggregate counts visible for an approved store; `liked` and `following` false.
- Authenticated customer RPC: accurate personal flags.
- Customer can like/follow an approved store.
- Duplicate like/follow is rejected by the primary key.
- Customer can remove only their own like/follow.
- Customer cannot insert for another customer, self-like, self-follow, or engage with a pending/rejected/unapproved store.
- Unapproved and nonexistent stores return no RPC row.
- Existing six `seller_stores` policies remain unchanged.
- Existing product, Immigration, Storage, seller, customer, order and fulfilment data and behavior remain unchanged.
- Confirm PostgREST exposes the RPC as expected.

## Approval boundary

Creating or reviewing this file does not authorize a repository commit, push, pull request, merge, Supabase access, SQL execution, Storage configuration change or deployment. Those actions require separate explicit approval.

**Final status: PROPOSED — NOT EXECUTED — NOT PRODUCTION APPROVED.**
