#!/usr/bin/env python3
"""Fail-closed synthetic canary and secret-pattern scan for generated artifacts."""
import json, re, sys
from pathlib import Path

CANARIES = ("CANARY_CUSTOMER_7f3c2a91", "CANARY_SELLER_8b1d4e62", "CANARY_RLS_DISABLED_91aa73")
PATTERNS = [
    re.compile(r"""(?i)(password|passwd|secret|api[_-]?key|access[_-]?token)\s*[:=]\s*['"][^'"]+"""),
    re.compile(r"""(?i)(postgres|postgresql|mysql)://[^\s'"]+"""),
    re.compile(r"-----BEGIN (RSA |EC |OPENSSH )?PRIVATE KEY-----"),
    re.compile(r"(?i)sb_secret_[A-Za-z0-9_-]{12,}"),
]
failed = False
for arg in sys.argv[1:]:
    p = Path(arg)
    if not p.exists():
        print(json.dumps({"file": str(p), "status": "FAIL", "finding": "missing_artifact"}))
        failed = True
        continue
    data = p.read_text(errors="replace")
    if any(x in data for x in CANARIES):
        print(json.dumps({"file": str(p), "status": "FAIL", "finding": "synthetic_canary"}))
        failed = True
    if any(rx.search(data) for rx in PATTERNS):
        print(json.dumps({"file": str(p), "status": "FAIL", "finding": "sensitive_pattern"}))
        failed = True
if failed:
    sys.exit(1)
print(json.dumps({"status": "PASS", "scanned_files": sys.argv[1:]}))
