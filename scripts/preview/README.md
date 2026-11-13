# NOVAAI isolated preview preparation

This directory contains a preview-only build generator and static isolation gate.
It is not a deployment workflow. The workflow is manually dispatched, checks out
an exact SHA, generates `preview-dist/` on the ephemeral runner, and audits it.
It does not upload artifacts, create a URL, open a tunnel, deploy Pages, or call
Supabase.

The fixture adapter supplies synthetic records and rejects writes, RPC, storage
and authentication. Product sharing retains `navigator.share()` and clipboard
fallback; analytics are disabled. Ad, visit, nearby-search and service-worker
scripts are omitted from the generated copy.

Before any future publishing step is approved, the generated output must receive
a full browser automation audit covering every route and every network API.
The CSP is defense-in-depth, not a substitute for the runtime request audit.
