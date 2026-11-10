# Phase 2 — Governance and Reproducibility Review

**Version:** 1.0.0  
**Reviewed baseline:** `6506a966d39c41e7240186a3c392af9cd6eb423d`  
**Source execution:** [run 42800792137](https://github.com/Thabiso37/Nova-Ai/actions/runs/42800792137)  
**Scope:** Read-only assessment; no repository settings, workflow permissions or branch protections changed.

## 1. Mandatory acceptance requirements vs optional hardening

This review separates Phase 2 acceptance criteria from defence-in-depth recommendations. The recommendations below are not new Phase 2 acceptance requirements and must not be applied without separate authorization.

## 2. Main branch governance

### Observed state

- GitHub branch metadata reports `main` as unprotected (`protected: false`).
- The repository rulesets endpoint returned an empty list at the time of inspection.
- The detailed branch-protection endpoint was not available to the connected integration (HTTP 403), so detailed settings could not be independently enumerated.

### Optional recommendations

Subject to owner approval and available plan/features:

- Require pull requests for changes to `main`.
- Require successful relevant CI checks before merge.
- Disable force pushes and branch deletion.
- Restrict direct pushes and administrative bypass where practical.
- Keep trusted scanner permissions read-only and preserve the fixed approved scanner commit.

**No setting was changed.** No independent-review rule is recommended as a pretend safeguard for a single-owner repository; owner approval is not independent security review.

## 3. PostgreSQL image provenance

The source workflow uses `postgres:17.11` and confirms the server, `psql` and `pg_dump` versions as PostgreSQL 17.11. The workflow binds the synthetic database port to `127.0.0.1:5432:5432`.

A version tag is not an immutable image identity. The run evidence inspected here does not record the resolved OCI image digest. Therefore exact image-byte reproducibility is **UNVERIFIED**.

### Optional recommendation

In a separately approved workflow change, resolve the official PostgreSQL 17.11 image for the runner architecture, independently verify its provenance, and pin `docker run` to the immutable `sha256:` digest. Preserve an explicit version check and record the digest in the run evidence. Do not silently substitute a different image or update the existing workflow as part of this docs-only closeout.

## 4. Reproducibility and evidence integrity

### Verified

- Source run: `42800792137`, branch `main`, commit `6506a966d39c41e7240186a3c392af9cd6eb423d`, conclusion `success`.
- Source workflow: manual `workflow_dispatch`; job restricted to main.
- PostgreSQL 17.11 server and client versions were checked in the run.
- The source run produced artifact `13756530949`, `phase2-metadata-inventory-report`.
- Original artifact digest: `99920e7263f5654922f901418dbf693c3b8313e4d93a203b882c9047bdd4fb7c`; independently downloaded ZIP digest matched in the preceding read-only audit.
- Comparison outputs have now been retained as separate JSON files under this closeout evidence directory. They were extracted from the exact comparator stdout in source job `129777441548`; the original artifact and source log were not modified.
- F-02 scanner run `42800891197` and its accepted evidence remain untouched.

### Limitations

- The original inventory artifact contains 16 files; comparator result JSON was not among them. The separately committed copies are traceable extractions from the original Actions log, not files retroactively inserted into the artifact.
- GitHub Actions logs remain the source record for those comparator outputs.
- Pattern-based sensitive-data screening is defence in depth. It cannot prove absence of arbitrary encoded, fragmented or obfuscated secrets.
- The artifact digest proves byte identity of the downloaded ZIP relative to the recorded digest; it does not prove the semantic correctness of every file.
- The prototype is synthetic only and does not establish production or Supabase compatibility.

## 5. Sensitive-data screening

The source run reports `SCAN PASS`. The scanner checks synthetic canaries and common credential/secret patterns in the specified evidence files and captured command output. The report explicitly disclaims exhaustive detection of arbitrary or obfuscated secrets.

The scanner also does not establish that every GitHub platform-generated log line is covered by the local evidence scan. F-02 provides a separate trusted workflow log scan, and remains CLOSED — ACCEPTED.

## 6. Classification

| Item | Classification | Acceptance impact |
|---|---|---|
| Main branch protection | UNVERIFIED/weak governance state | Optional hardening; not a technical Phase 2 prototype gate in the recovered approval |
| Rulesets | No rulesets observed | Optional hardening |
| PostgreSQL immutable image digest | UNVERIFIED | Optional reproducibility hardening |
| PostgreSQL 17.11 version checks | COMPLETE | Satisfies version requirement |
| Original artifact integrity | COMPLETE | Original digest independently matched |
| Separate comparator JSON evidence | COMPLETE | Extracted and preserved in closeout |
| Pattern screening | COMPLETE with documented limitation | Does not guarantee all possible secrets absent |
| F-02 scanner | COMPLETE — CLOSED — ACCEPTED | Immutable; not reopened |

## 7. Safety statement

This review made no production Supabase connection, did not use or request credentials, did not change workflow permissions, did not change GitHub settings, did not dispatch workflows, did not modify database objects, and did not deploy.
