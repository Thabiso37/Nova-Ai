#!/usr/bin/env python3
"""Assert provider-backed object and shared security-label probes without reading labels."""
import json,sys
from pathlib import Path

if len(sys.argv)!=2:
    raise SystemExit("usage: assert_security_label_probe.py security-label-provider-probe.json")
report=json.loads(Path(sys.argv[1]).read_text())
ok=(report.get("provider_ddl_executed") is True
    and report.get("object_label_rows")==1
    and report.get("shared_label_rows")==1
    and report.get("label_values_read") is False)
print(json.dumps({
 "status":"PASS" if ok else "FAIL",
 "provider_ddl_executed":report.get("provider_ddl_executed"),
 "object_label_rows":report.get("object_label_rows"),
 "shared_label_rows":report.get("shared_label_rows"),
 "label_values_read":report.get("label_values_read")
},sort_keys=True))
if not ok:
    sys.exit(1)
