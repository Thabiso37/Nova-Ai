NOVAAI Seller Storefront Branding Migration Review
Status: PROPOSED — NOT EXECUTED
Review date: 16 November 2026
Repository: Thabiso37/Nova-Ai
Branch: main
1. Purpose
This document records the review status, intended scope, security requirements, prerequisites and validation limitations for the NOVAAI Seller Storefront Branding database migration.
The migration supports seller branding and customer engagement on public seller Store Pages.
This document accompanies:
docs/sql/20261115-seller-storefront-branding.sql
The migration is a proposal only. Its presence in the repository does not mean that it has been executed or approved for production.
2. Candidate identity and preservation
The strengthened candidate has the following recorded identity:
Property
Value
File
docs/sql/20261115-seller-storefront-branding.sql
Lines
2,240
Bytes
141,158
SHA-256
10d496c05493126cf677d318b69e6bc1e4112d90e13b1a12b621fbcd5bb68301
The original candidate is preserved separately:
Property
Value
Lines
2,119
Bytes
135,366
SHA-256
ffa15427c3aced15e907b3c38c6e124f2396acc537856bf2c6e2393bffd4d9ce
The original must remain available for comparison and historical reference. It must not be overwritten by the strengthened candidate.
3. Intended scope
The proposed migration concerns:
Seller store logo and banner URL fields.
Seller Store Page likes and follows.
Customer engagement records.
Row-level security and database privileges.
Validation of seller branding URLs and Storage object paths.
A public engagement-count function.
Seller-authorisation checks for branding changes.
Storage policy controls for branding objects.
The intended Storage bucket is:
novaai-store-branding
The intended supported image formats are JPEG, PNG and WebP, with a maximum object size of 5 MiB.
4. Seller authorisation requirements
The migration must respect NOVAAI's existing seller approval model.
A seller is authorised only when:
seller_stores.status = 'approved'.
seller_stores.primary_marketplace identifies the seller's selected marketplace.
seller_marketplace_permissions contains the matching seller user, marketplace and approved status.
The migration must not grant sellers automatic access to all marketplaces.
Seller branding changes must be restricted to the authenticated owner of the relevant approved seller store.
Customer engagement records must be associated with the authenticated customer and the correct seller store.
5. Security requirements
The migration must preserve the following security boundaries.
Database access
Enable and correctly enforce row-level security on engagement tables.
Restrict customer engagement operations to the appropriate authenticated customer.
Do not grant customers permission to modify other customers' records.
Avoid unnecessary table-level or column-level privileges.
Account for effective privileges inherited through role memberships and PUBLIC grants.
Restrict privileged functions to the intended execution roles.
Use fixed and safe function search paths.
Keep private helper functions outside publicly exposed API schemas.
Seller branding
Validate branding URLs against the expected NOVAAI Storage bucket and object path.
Reject invalid branding types and malformed object paths.
Prevent sellers from changing another seller's branding.
Require the approved seller and marketplace relationship.
Storage
Do not grant public users permission to list Storage objects through storage.objects.
Public access should allow retrieval of intended public branding assets without exposing unrestricted object metadata.
Restrict uploads, replacements and deletions to authorised sellers and their own object paths.
Validate the expected object filename and folder structure.
Do not weaken existing Storage protections to make the migration pass.
Engagement function
The public function:
get_seller_store_engagement(p_store_user_id)
must preserve its expected four-field result:
likes_count
followers_count
liked
following
Personal engagement flags must reflect the verified caller identity, not an arbitrary customer ID supplied by another user.
6. Frontend compatibility
The recorded frontend compatibility baseline is the default branch at:
ceeb106e344ddfbb3091228154ebab1f3a2d270f
Recorded source files:
novaai-store-branding.js
novaai-storefront.js
The candidate was prepared to match the existing frontend contract, including:
Bucket name novaai-store-branding.
UUID-based seller folders.
Timestamped logo and banner filenames.
JPEG, PNG and WebP uploads.
Maximum upload size of 5 MiB.
Non-upsert uploads.
Branding URL updates and old-object removal.
Engagement inserts containing store_user_id and customer_id.
The existing engagement RPC name, argument and four output fields.
These are recorded static compatibility findings, not proof of successful live integration.
The existing NOVAAI frontend must not be redesigned as part of this database migration review.
7. Required prerequisites before execution
Before any database execution is considered, the target environment must be confirmed and reviewed.
Required checks include:
Confirm the exact Supabase project and environment.
Confirm the existing seller tables and marketplace permission schema.
Inspect current table owners, role memberships and effective privileges.
Inspect existing RLS policies and policy expressions.
Inspect existing indexes, foreign keys and constraints.
Confirm compatibility with the existing auth.users relationship.
Confirm the existing Storage schema and helper functions.
Confirm the PostgREST schema exposure configuration.
Confirm that private helper schemas are not publicly exposed.
Confirm the required bucket configuration and existing object state.
Establish an appropriate backup and recovery plan.
Obtain separate explicit approval for the proposed database operation.
No prerequisite should be bypassed by weakening a security check.
8. Validation status and limitations
The strengthened candidate has been reported as passing 19 of 19 static structural checks.
Additional reported checks include:
Candidate file identity and SHA-256 verification.
Preservation of the original candidate.
Transaction structure.
Non-destructive migration scope.
Marketplace allowlist checks.
JWT identity checks.
Branding validation checks.
Storage filename and path checks.
Engagement RPC contract checks.
Function search-path checks.
Separation from the Retail product-video migration.
However, the candidate has not been validated by executing it against PostgreSQL.
The following remain unverified:
Actual PostgreSQL parsing and execution.
Real database ownership and effective privilege behaviour.
RLS behaviour using real authenticated identities.
Storage upload, replacement and deletion operations.
Public asset retrieval and object-listing restrictions.
Actual Storage API operation contexts.
PostgREST exposure and RPC accessibility.
End-to-end Seller Portal and Store Page behaviour in Android Chrome.
Static checks must not be represented as PostgreSQL execution or production validation.
9. Required post-execution verification
If separately approved and eventually executed in an authorised test environment, verification must include:
Expected seller branding columns and types.
Expected engagement tables, constraints and indexes.
Correct RLS policies and effective privileges.
Correct function ownership, execution permissions and search path.
Approved seller branding updates.
Rejection of unauthorised seller updates.
Customer-only like and follow operations.
Correct engagement counts and personal flags.
Successful authorised branding uploads.
Successful authorised replacement and deletion.
Public branding asset retrieval.
Denial of public Storage object listing.
Correct PostgREST exposure.
A failed security or compatibility check must stop the process.
10. Rollback and containment
Before a transaction commits, an execution failure should result in transaction rollback where supported.
After a successful commit, any necessary recovery must use a separately reviewed and approved forward-fix or containment procedure.
Do not:
Drop existing application tables.
Truncate existing records.
Delete seller or customer data.
Delete existing Storage objects as an improvised rollback.
Restore insecure public object-listing permissions.
Disable security policies simply to make application functionality work.
Storage API operations and database transactions must be treated as separate concerns.
11. Explicit exclusions
This proposal does not authorise:
Execution against production Supabase.
Execution against any other Supabase project.
Storage Dashboard or bucket configuration changes.
Changes to existing seller or customer data.
Changes to the NOVAAI frontend.
Changes to the separate Retail product-video migration.
Commits, pushes, pull requests or merges.
Deployment or public release.
Paid services, paid staging branches or subscriptions.
The separate migration:
docs/sql/20261115-retail-product-videos.sql
is outside this proposal and must remain unchanged.
Its recorded baseline:
Commit: ceeb106e344ddfbb3091228154ebab1f3a2d270f
Blob SHA: 6639c42a9a20450ee905673cf1179b1611f41efa
Lines: 25
12. Approval requirements
Approval is divided into separate stages.
Stage A — Repository proposal
The two proposed documentation and SQL files may be presented for review. Repository changes require explicit approval before committing or pushing.
Stage B — Database validation
Any test-environment database validation requires separate explicit approval and confirmation that the environment can be used without cost.
Stage C — Production execution
Production access, SQL execution, Storage configuration and deployment each require separate explicit approval.
Approval of this document does not constitute approval for any database operation.
13. Final status
The strengthened SQL candidate is a proposed migration awaiting further validation.
The original candidate is preserved.
The Retail product-video migration is excluded and must remain untouched.
No database execution, production access, Storage configuration change or deployment is authorised by this document.
Current status: PROPOSED — NOT EXECUTED — NOT PRODUCTION APPROVED.
