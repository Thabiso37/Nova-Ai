# NOVAAI Phase 1 — Approved metadata-only security architecture

Specification version: 1.0  
Status: versioned transcription of previously approved requirements; exact-source reconciliation is required if the original approval record is available.  
Scope: security and architecture requirements only; no production connection or export authorization.

This document transcribes the approved Phase 1 requirements retained in the project history and does not intentionally relax them. It is not represented as a byte-for-byte copy of an earlier signed specification. If an authoritative earlier approved specification is later supplied and differs, reconcile the discrepancy explicitly; do not silently edit this baseline.

## 1. Security boundary

The inventory principal is a dedicated, non-owner, non-superuser, non-inheriting login with no role memberships, no role escalation, no database/schema creation, no temporary-object creation, and no application-data access. Inventory runs in a read-only, repeatable-read transaction. Administrative comparison is isolated to disposable synthetic environments and shares the inventory snapshot.

## 2. Protected data classes

Protected data includes customer, seller, order, payment, fulfilment, address, phone, precise location, authentication, storage, token, credential, secret, private-key, foreign-user-mapping options, foreign-data-wrapper/server/table options, subscription connection strings, security-label values, large-object content, and arbitrary application row values. The inventory may not select or emit these values.

## 3. Permitted metadata access

Only metadata needed to describe schema structure and security configuration is permitted: object identities, types, owners, definitions, defaults, constraints, indexes, dependencies, RLS configuration and policies, grants/ACLs, role attributes/settings, extension metadata, sequence configuration, and supported catalogue metadata. Foreign-user-mapping, FDW, server, subscription, and security-label identity columns may be inspected only where explicitly granted; umoptions, FDW/server/table options, subconninfo, security-label values, large-object contents, and connection strings remain forbidden.

## 4. Forbidden privileges and access paths

The inspector must not have effective SELECT on application tables, views, materialized views, protected columns, Auth/Storage data, or protected row data, regardless of RLS state. It must not own protected objects or inherit/SET ROLE into privileged roles. It must not have database/schema CREATE, TEMP, sequence USAGE/UPDATE, user-defined type USAGE, executable application routines, executable non-approved SECURITY DEFINER routines, large-object API EXECUTE, or access to foreign mapping options, FDW/server/table options, subscription connection strings, security-label values, or large-object contents. PUBLIC-inherited privileges count as effective privileges. Unsafe search paths and writable schemas are forbidden.

## 5. Provenance classifications

Every in-scope object must have an exact family and identity and evidence-backed classification: NOVAAI_OWNED, SUPABASE_MANAGED, EXTENSION_OWNED, CLUSTER_GLOBAL, or ENVIRONMENT_SPECIFIC. Schema names and owners alone are not provenance. Synthetic fixture provenance must be explicitly distinguished from production provenance. Missing, changed, ambiguous, or duplicate migration evidence fails closed.

## 6. Dependency rules

Dependencies must be discovered from PostgreSQL catalogue metadata, resolved to exact identities, and classified as in-scope, derived, approved external prerequisite, or explicit approved exclusion. Unknown dependency types, unresolved endpoints, and unapproved external dependencies fail closed. Cycles must be reported and handled explicitly, not silently discarded.

## 7. Unsupported-object handling

The support matrix is explicit and PostgreSQL-version-specific. Unsupported object families must be detected through catalogue queries and positive synthetic probes where the server supports their creation. Any unsupported object or uninspectable family blocks a clean result. Provider-dependent families that cannot be positively tested must be reported as unverified and block acceptance.

## 8. Catalogue visibility

For every required catalogue family, evidence must distinguish query execution, catalogue relation visibility/permission, expected-object discoverability, and classification completeness. A successful empty query alone is not proof of complete visibility. Unknown visibility fails closed. Both pg_seclabel and pg_shseclabel are in scope; label contents must not be emitted.

## 9. Snapshot consistency

Inventory, dependency comparison, and structured administrative baseline must describe one exported PostgreSQL snapshot. The coordinator keeps the exporting transaction open until all importing transactions finish. A concurrent-catalogue-change test demonstrates snapshot isolation.

## 10. Secret handling

Sensitive row values, credentials, connection strings, user-mapping options, subscription connection strings, security-label contents, and exception diagnostics must not be emitted. All evidence artifacts and captured workflow output are scanned using a shared pattern policy. Pattern scanning is defence in depth, not proof of absolute secret absence.

## 11. Acceptance criteria

Acceptance requires verified restricted-role security and runtime denials; explicit search-path/configuration audit; complete required catalogue visibility evidence; exact-identity provenance for the synthetic fixture; dependency resolution from one snapshot; positive unsupported-object probes and a clean post-removal scan; structured comparison of every required supported property; pinned PostgreSQL 17 client and 17.11 server; successful artifact/log scanning; and a reproducible PostgreSQL 17.11 workflow. Passing CI alone does not establish production security, Supabase compatibility, restoration equivalence, or authorization for Phase 3.
