NOVAAI Seller Storefront Branding Migration Review

Status: PROPOSED — NOT EXECUTED
Review date: 16 November 2026
Repository: "Thabiso37/Nova-Ai"
Branch reviewed: "main"

Decision Summary

Decision: NOT READY FOR DATABASE VALIDATION OR PRODUCTION EXECUTION.

The review confirms that:

- The review document exists on "main".
- The existing SQL file on "main" is an older 238-line candidate.
- The strengthened 2,240-line SQL candidate has not been verified in the checked repository.
- The original 2,119-line candidate's preservation location remains unverified.
- The previously recorded candidate SHA-256 values have not been verified against GitHub files.
- The static validation total remains unverified because the available preparation records conflict.
- PostgreSQL execution, database permissions, RLS, Storage behaviour and frontend integration remain untested.

Permitted next activity: Continue repository-level inspection and prepare the proposed files for review.

Not permitted: Replacing SQL files, committing, pushing, creating pull requests, merging, accessing Supabase, executing SQL, changing Storage configuration or deploying without separate explicit approval.

The existing 238-line SQL migration must not be applied as a substitute for the strengthened candidate.

1. Purpose

This document records the review status, intended scope, security requirements, prerequisites and validation limitations for the NOVAAI Seller Storefront Branding database migration.

The migration supports seller branding and customer engagement on public seller Store Pages.

This document is intended to accompany:

"docs/sql/20261115-seller-storefront-branding.sql"

The migration is a proposal only. Its presence in the repository does not mean that it has been executed or approved for production.

Important repository finding: The strengthened 2,240-line SQL candidate described in earlier preparation records is not currently present at the documented path in the checked GitHub repository. The SQL file currently present on "main" is an older, materially different 238-line candidate.

It must not be represented as the strengthened candidate.

2. Candidate Identity and Preservation

2.1 Strengthened candidate — not present in checked repository

The strengthened candidate has the following previously reported identity:

Property| Previously reported value
Intended file path| "docs/sql/20261115-seller-storefront-branding.sql"
Lines| 2,240
Bytes| 141,158
Recorded SHA-256| "10d496c05493126cf677d318b69e6bc1e4112d90e13b1a12b621fbcd5bb68301"

Verification status: This candidate was not found at the documented path in the checked GitHub repository. Its recorded SHA-256, line count and byte count have not been verified against a GitHub copy.

These values must be treated as previously reported local candidate details, not verified repository evidence.

2.2 Existing older candidate on "main"

The file currently present at the intended path on "main" was observed as follows:

Property| Observed value
File| "docs/sql/20261115-seller-storefront-branding.sql"
Lines| 238
Bytes| 10,142
GitHub blob SHA| "9666c42aded263ceda72dad27edaf6af2d9d74fa"

This is the existing older candidate. It is not the strengthened 2,240-line candidate.

The 238-line file contains material differences from the security requirements recorded in this review. For example, it writes directly to "storage.buckets", creates a public "SELECT" policy on "storage.objects", and its seller upload policies do not enforce the complete approved seller-and-marketplace relationship described in this document.

It must not be treated as though it satisfies the strengthened migration's security requirements.

2.3 Original candidate — preservation location unverified

The original candidate has the following previously reported identity:

Property| Previously reported value
Lines| 2,119
Bytes| 135,366
Recorded SHA-256| "ffa15427c3aced15e907b3c38c6e124f2396acc537856bf2c6e2393bffd4d9ce"
Preservation location| Not verified

The original candidate's preservation location remains unverified. No repository path should be invented or assumed.

The original must remain available for comparison and historical reference. It must not be overwritten by the strengthened candidate.

Neither previously recorded candidate SHA-256 value has been verified against a corresponding file in the checked GitHub repository.

3. Intended Scope

The proposed migration concerns:

- Seller store logo and banner URL fields.
- Seller Store Page likes and follows.
- Customer engagement records.
- Row-level security and database privileges.
- Validation of seller branding URLs and Storage object paths.
- A public engagement-count function.
- Seller-authorisation checks for branding changes.
- Storage policy controls for branding objects.

The intended Storage bucket is:

"novaai-store-branding"

The intended supported image formats are JPEG, PNG and WebP, with a maximum object size of 5 MiB.

4. Seller Authorisation Requirements

The migration must respect NOVAAI's existing seller approval model.

A seller is authorised only when:

- "seller_stores.status = 'approved'".
- "seller_stores.primary_marketplace" identifies the seller's selected marketplace.
- "seller_marketplace_permissions" contains the matching seller user, marketplace and approved status.

The migration must not grant sellers automatic access to all marketplaces.

Seller branding changes must be restricted to the authenticated owner of the relevant approved seller store.

Customer engagement records must be associated with the authenticated customer and the correct seller store.

5. Security Requirements

The migration must preserve the following security boundaries.

5.1 Database access

- Enable and correctly enforce row-level security on engagement tables.
- Restrict customer engagement operations to the appropriate authenticated customer.
- Do not grant customers permission to modify other customers' records.
- Avoid unnecessary table-level or column-level privileges.
- Account for effective privileges inherited through role memberships and PUBLIC grants.
- Restrict privileged functions to the intended execution roles.
- Use fixed and safe function search paths.
- Keep private helper functions outside publicly exposed API schemas.

5.2 Seller branding

- Validate branding URLs against the expected NOVAAI Storage bucket and object path.
- Reject invalid branding types and malformed object paths.
- Prevent sellers from changing another seller's branding.
- Require the approved seller and marketplace relationship.

5.3 Storage

- Do not grant public users permission to list Storage objects through "storage.objects".
- Public access should allow retrieval of intended public branding assets without exposing unrestricted object metadata.
- Restrict uploads, replacements and deletions to authorised sellers and their own object paths.
- Validate the expected object filename and folder structure.
- Do not weaken existing Storage protections to make the migration pass.

5.4 Engagement function

The public function:

"get_seller_store_engagement(p_store_user_id)"

must preserve its expected four-field result:

- "likes_count"
- "followers_count"
- "liked"
- "following"

Personal engagement flags must reflect the verified caller identity, not an arbitrary customer ID supplied by another user.

6. Frontend Compatibility

The recorded frontend compatibility baseline is the default branch at:

"ceeb106e344ddfbb3091228154ebab1f3a2d270f"

Recorded source files:

- "novaai-store-branding.js"
- "novaai-storefront.js"

The candidate was previously reported as prepared to match the existing frontend contract, including:

- Bucket name "novaai-store-branding".
- UUID-based seller folders.
- Timestamped logo and banner filenames.
- JPEG, PNG and WebP uploads.
- Maximum upload size of 5 MiB.
- Non-upsert uploads.
- Branding URL updates and old-object removal.
- Engagement inserts containing "store_user_id" and "customer_id".
- The existing engagement RPC name, argument and four output fields.

These are previously reported static compatibility findings, not proof of successful live integration.

The existing NOVAAI frontend must not be redesigned as part of this database migration review.

7. Required Prerequisites Before Execution

Before any database execution is considered, the target environment must be confirmed and reviewed.

Required checks include:

- Confirm the exact Supabase project and environment.
- Confirm the existing seller tables and marketplace permission schema.
- Inspect current table owners, role memberships and effective privileges.
- Inspect existing RLS policies and policy expressions.
- Inspect existing indexes, foreign keys and constraints.
- Confirm compatibility with the existing "auth.users" relationship.
- Confirm the existing Storage schema and helper functions.
- Confirm the PostgREST schema exposure configuration.
- Confirm that private helper schemas are not publicly exposed.
- Confirm the required bucket configuration and existing object state.
- Establish an appropriate backup and recovery plan.
- Obtain separate explicit approval for the proposed database operation.

No prerequisite should be bypassed by weakening a security check.

8. Validation Status and Limitations

8.1 Static validation count

Earlier preparation records contain conflicting static-check totals: one record reports 18 of 18, while another reports 19 of 19.

The exact count is unverified until the underlying checklist and validation output are available for inspection.

Neither count should be represented as independently confirmed in this review.

Previously reported categories of checks include:

- Candidate file identity and SHA-256 verification.
- Preservation of the original candidate.
- Transaction structure.
- Non-destructive migration scope.
- Marketplace allowlist checks.
- JWT identity checks.
- Branding validation checks.
- Storage filename and path checks.
- Engagement RPC contract checks.
- Function search-path checks.
- Separation from the Retail product-video migration.

These reported checks do not establish that the strengthened candidate is present in GitHub.

8.2 Validation limitations

The strengthened candidate has not been validated by executing it against PostgreSQL.

The following remain unverified:

- Actual PostgreSQL parsing and execution.
- Real database ownership and effective privilege behaviour.
- RLS behaviour using real authenticated identities.
- Storage upload, replacement and deletion operations.
- Public asset retrieval and object-listing restrictions.
- Actual Storage API operation contexts.
- PostgREST exposure and RPC accessibility.
- End-to-end Seller Portal and Store Page behaviour in Android Chrome.

Static checks must not be represented as PostgreSQL execution or production validation.

8.3 Evidence classification

For clarity, findings are separated into two categories.

Verified repository findings from the supplied Copilot inspection:

- The review document exists on "main".
- Its recorded GitHub blob SHA is "327b4a8636a43cb2995462c08c8c41d67ab3a014".
- All 13 numbered sections were present in the inspected document.
- The "main" SQL file was reported as 238 lines and 10,142 bytes.
- Its recorded GitHub blob SHA is "9666c42aded263ceda72dad27edaf6af2d9d74fa".
- The strengthened 2,240-line candidate was not found at the documented path in the repository versions checked.
- The Retail video migration's recorded blob SHA matches the checked "main" file.

Previously reported or unverified preparation details:

- The strengthened candidate's 2,240-line count, byte count and SHA-256.
- The original candidate's 2,119-line count, byte count and SHA-256.
- The original candidate's preservation location.
- The 18/18 or 19/19 static validation totals.
- Previously reported frontend compatibility checks.

These details must not be described as independently verified repository findings until the corresponding files and evidence are available.

9. Required Post-Execution Verification

If separately approved and eventually executed in an authorised test environment, verification must include:

- Expected seller branding columns and types.
- Expected engagement tables, constraints and indexes.
- Correct RLS policies and effective privileges.
- Correct function ownership, execution permissions and search path.
- Approved seller branding updates.
- Rejection of unauthorised seller updates.
- Customer-only like and follow operations.
- Correct engagement counts and personal flags.
- Successful authorised branding uploads.
- Successful authorised replacement and deletion.
- Public branding asset retrieval.
- Denial of public Storage object listing.
- Correct PostgREST exposure.

A failed security or compatibility check must stop the process.

10. Rollback and Containment

Before a transaction commits, an execution failure should result in transaction rollback where supported.

After a successful commit, any necessary recovery must use a separately reviewed and approved forward-fix or containment procedure.

Do not:

- Drop existing application tables.
- Truncate existing records.
- Delete seller or customer data.
- Delete existing Storage objects as an improvised rollback.
- Restore insecure public object-listing permissions.
- Disable security policies simply to make application functionality work.

Storage API operations and database transactions must be treated as separate concerns.

11. Explicit Exclusions

This proposal does not authorise:

- Execution against production Supabase.
- Execution against any other Supabase project.
- Storage Dashboard or bucket configuration changes.
- Changes to existing seller or customer data.
- Changes to the NOVAAI frontend.
- Changes to the separate Retail product-video migration.
- Commits, pushes, pull requests or merges.
- Deployment or public release.
- Paid services, paid staging branches or subscriptions.

The separate migration:

"docs/sql/20261115-retail-product-videos.sql"

is outside this proposal and must remain unchanged.

Its recorded baseline:

Property| Recorded value
Commit| "ceeb106e344ddfbb3091228154ebab1f3a2d270f"
GitHub blob SHA| "6639c42a9a20450ee905673cf1179b1611f41efa"
Lines| 25

The checked "main" file was reported to match the recorded blob SHA.

This migration must remain separate and must not be embedded in or changed as part of the seller storefront branding migration.

12. Approval Requirements

Approval is divided into three separate stages.

Stage A — Repository proposal and review

The documentation and strengthened SQL candidate may be prepared and presented for inspection.

Presentation for review does not authorise a repository write.

Any addition, replacement or modification of repository files requires separate explicit approval before committing or pushing.

Before the strengthened SQL candidate can be presented as a repository file:

- Its actual source file must be located.
- Its contents must be inspected.
- Its line count, byte count and SHA-256 must be independently verified.
- Its identity must be compared with the previously reported candidate details.
- The existing 238-line SQL file must not be silently treated as or substituted for the strengthened candidate.
- The original candidate must not be overwritten.

The review document itself does not grant permission to make these changes.

Stage B — Database validation

Any test-environment database validation requires separate explicit approval and confirmation that the environment can be used without cost.

No database access or execution is authorised merely because the repository proposal is reviewed or accepted.

Stage C — Production execution

Production access, SQL execution, Storage configuration and deployment each require separate explicit approval.

Approval of this document does not constitute approval for any database operation.

13. Final Status

The strengthened SQL candidate remains a proposed migration awaiting further validation.

Its previously reported 2,240-line version is not currently present at the documented path in the checked GitHub repository.

The 238-line SQL file currently on "main" is an older candidate and must not be represented as the strengthened version.

The original 2,119-line candidate's preservation location remains unverified.

The previously recorded candidate SHA-256 values have not been verified against GitHub.

The static-check total remains unverified pending the underlying evidence.

The Retail product-video migration is excluded and must remain untouched.

No database execution, production access, Storage configuration change or deployment is authorised by this document.

Current status: PROPOSED — NOT EXECUTED — NOT PRODUCTION APPROVED.
