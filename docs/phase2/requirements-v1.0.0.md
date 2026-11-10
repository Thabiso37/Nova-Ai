# NOVAAI Phase 2 — Canonical Requirements Baseline

**Document ID:** NOVAAI-PHASE2-REQ  
**Version:** 1.0.0  
**Status:** Canonical closeout transcription — owner-confirmed 2026-11-10  
**Baseline commit:** `6506a966d39c41e7240186a3c392af9cd6eb423d`  
**Prepared:** 2026-11-10

## 1. Authority and provenance

This document consolidates the user's Phase 2 approvals and scope decisions recorded in the NOVAAI project conversation on 2026-11-09, together with the contemporaneous Phase 2 implementation specification and workflow on the baseline commit above.

**Source limitation:** a verbatim, signed/original approval document was not found in the repository. The original approval is recoverable as conversation approval records and project decisions, but this document is a controlled transcription, not a claim that the original wording has been recovered byte-for-byte. **The owner confirmed on 2026-11-10 that this transcription accurately represents the original approved Phase 2 scope.** That confirmation resolves the transcription-confirmation item; it does not itself constitute formal Phase 2 acceptance. No requirement has been added merely because a later phase roadmap mentions it.

## 2. Phase 2 purpose

Deliver a metadata-inventory prototype using **synthetic PostgreSQL 17.11 only**, preserving the approved Phase 1 strict metadata-only security boundary. Phase 2 is a prototype and verification milestone; it is not production schema migration or restoration.

## 3. Approved Phase 2 boundaries

- Use a disposable PostgreSQL 17.11 database and synthetic fixture objects only.
- Do not connect to production Supabase or use production credentials, URLs or database secrets.
- Do not read customer, seller, marketplace, Auth or Storage application rows; do not rely on RLS as a substitute for privilege restrictions.
- Preserve the Phase 1 security architecture and fail-closed treatment of unsupported or unobservable metadata.
- Do not reconstruct production DDL, modify production database objects, deploy, or begin Phase 3 work under Phase 2 authorization.
- The fixture schemas `novaai_app`, `novaai_private`, `supabase_managed_fixture` and `environment_specific_fixture` are synthetic. The latter two do not establish actual Supabase compatibility. The `auth`, `storage`, `realtime` and `vault` schemas are not present in the fixture.

## 4. Phase 2 requirements

| ID | Approved requirement | Acceptance evidence |
|---|---|---|
| P2-01 | Build and run the prototype on disposable PostgreSQL 17.11 using synthetic fixtures only. | Source workflow, server/client version output, synthetic schema fixture and successful run. |
| P2-02 | Inventory supported metadata and classify objects/provenance without accessing application rows. | Inventory JSON, explicit scope, provenance registry/verifier and restricted inspector tests. |
| P2-03 | Preserve strict inspector privilege boundaries; deny data access, writes, privilege escalation and sensitive metadata/options. Do not rely on RLS for the boundary. | Security audit JSON and runtime negative-security results; denial assertions use SQLSTATE 42501. |
| P2-04 | Discover dependencies and report unresolved dependencies/cycles rather than silently omitting them. | Dependency baseline and comparator results from the same exported snapshot. |
| P2-05 | Detect catalogue visibility failures and unsupported object families; positively exercise probes where feasible and fail closed on partial/unverified detection. | Visibility report, positive probe evidence and clean-state unsupported-object report. |
| P2-06 | Generate inventory and baselines from one exported PostgreSQL snapshot and demonstrate snapshot consistency under concurrent DDL. | Snapshot coordinator metadata and snapshot consistency test output. |
| P2-07 | Compare structured catalogue metadata against the administrative baseline for supported metadata properties. | Structured catalogue comparator output and matching snapshot/server identity. |
| P2-09 | Screen generated evidence and captured command output for sensitive-data patterns; retain the stated limits of pattern-based screening. | Sensitive-scan report and documented limitations. |
| P2-10 | Produce traceable evidence tied to the source run and commit; preserve original uploaded evidence. | GitHub run metadata, artifact ID/digest and independently verified downloaded artifact digest. |

The structured catalogue comparison is part of the implemented metadata-inventory validation and passed in the live Phase 2 run. The separate `pg_dump` comparison also passed, but is recorded as supplemental corroborating evidence only; this closeout does not assert that the recovered Phase 2 approval made it a standalone acceptance gate. The broader roadmap places independent comparison work in a later separately approved phase.

### Additional implementation check (not a separate Phase 2 approval gate)

A schema-only `pg_dump` baseline and supplemental comparison were run and passed. Their exact output is preserved under `docs/phase2/evidence/source-run-42800792137/`. This is recorded as a completed additional check, not an extra mandatory Phase 2 requirement.

## 5. Separate cross-milestone status — F-02

F-02 — Trusted Workflow Log Scanner is **CLOSED — ACCEPTED** as a separate cross-milestone. It is not a Phase 2 metadata-inventory requirement or acceptance gate. Its implementation and accepted historical evidence remain unchanged by this closeout.

## 6. Phase roadmap boundary — not Phase 2 gates

The user's earlier roadmap separated later work into separately authorized phases. The following are **not required to close Phase 2** and must not be started under this Phase 2 closeout authorization:

- **Phase 3:** scoped DDL reconstruction.
- **Phase 4:** dependency-aware restoration / clean-database restore.
- **Phase 5:** post-restoration normalized catalogue equivalence, extended independent comparison/security testing, and encryption/ciphertext-only evidence controls where specified by that phase's approval.
- **Phase 6:** Supabase non-production compatibility.
- **Phase 7:** independent security review.

These are later-phase roadmap items, not retroactive Phase 2 acceptance criteria. Each requires its own approval and scope. Production Supabase access remains excluded.

## 7. Status vocabulary

- **COMPLETE:** implementation and supporting evidence are available and passed.
- **INCOMPLETE:** an approved Phase 2 deliverable or required closeout record is missing or inaccurate.
- **BLOCKED:** cannot proceed without an external prerequisite or separate authorization.
- **UNVERIFIED:** available evidence is insufficient to establish the claim.
- **NOT REQUIRED:** outside approved Phase 2 scope or explicitly deferred to a later phase.

## 8. Acceptance boundary

A Phase 2 acceptance decision must be made against this requirements baseline and its evidence mapping. Successful implementation or CI alone does not constitute formal acceptance. The source workflow's own comparator reports explicitly disclaim DDL reconstruction, restore validation, production provenance and restoration equivalence.

The owner-confirmed requirements transcription resolves the requirements-provenance confirmation item. **Phase 2 is not declared accepted by this document or by that confirmation.** A separate formal acceptance decision remains outstanding.
