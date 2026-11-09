#!/usr/bin/env python3
"""Assert that selected unsupported families are detected and fail closed."""
import json, sys
from pathlib import Path

if len(sys.argv) != 2:
    raise SystemExit("usage: assert_unsupported_probe.py unsupported-probe.json")
payload = json.loads(Path(sys.argv[1]).read_text())
expected = {"extended_statistics", "rule", "unsupported_type_family"}
found = {item.get("family") for item in payload.get("unsupported_objects", [])}
visibility = payload.get("catalogue_visibility_failures", [])
missing = sorted(expected - found)
ok = payload.get("status") == "FAIL" and not visibility and not missing
print(json.dumps({
    "status": "PASS" if ok else "FAIL",
    "expected_families": sorted(expected),
    "detected_families": sorted(expected & found),
    "missing_families": missing,
    "visibility_failure_count": len(visibility)
}, sort_keys=True))
if not ok:
    sys.exit(1)
