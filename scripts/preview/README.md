# NOVAAI isolated preview validation

This preview-only workflow creates fixture-backed copies of the approved application
baseline on an ephemeral GitHub Actions runner. It validates the generated
`preview-dist/` directory; it is not a deployment or publishing workflow.

## Browser isolation gate

The workflow pins Playwright 1.56.1 and installs Chromium on the runner. The
Playwright suite starts a loopback-only static server for the generated output,
loads all four pages, and intercepts browser HTTP requests and WebSocket attempts.
Production Supabase project hosts, REST, Auth, Storage, Functions, Realtime and
product-share analytics endpoints are blocked and any attempted contact fails
the test. Other non-local network resources are also aborted by the test router.

The suite verifies the preview output has no production project reference,
Supabase endpoint or publishable credential; fixture operations reject database
writes, RPC, authentication and storage mutations; product-share URLs are
resolved against the preview origin; and native Web Share and clipboard fallback
work with browser mocks. Analytics recording remains disabled in the generated
sharing helper.

The builder removes production-connected ad, visit, nearby-search and service
worker scripts and substitutes the synthetic fixture adapter. CSP is additional
defence, not a replacement for browser request interception.

## Safety boundaries

- The nine application source files are restored from and hash-checked against
  approved baseline `10de8ec63bf77ec08e0252592251542ad6ad142a`.
- The workflow checks out and verifies the exact tooling revision that triggered
  the run; the application baseline remains independently pinned.
- No Supabase credentials are used by the workflow.
- No artifact is uploaded, no preview URL or tunnel is created, and GitHub Pages
  is not deployed.
- No production database, Edge Function, authentication or analytics endpoint
  is contacted by the browser tests.
