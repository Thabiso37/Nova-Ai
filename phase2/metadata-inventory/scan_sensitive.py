#!/usr/bin/env python3
"""Shared pattern-based scan for evidence artifacts and captured workflow logs."""
import sys
from pathlib import Path
from secret_patterns import CANARIES, PATTERNS

bad=[]
for arg in sys.argv[1:]:
    path=Path(arg)
    if not path.is_file():
        bad.append((arg,"missing_file"))
        continue
    data=path.read_text(errors="replace")
    if any(canary in data for canary in CANARIES):
        bad.append((arg,"synthetic_canary"))
    for name,pattern in PATTERNS:
        if pattern.search(data):
            bad.append((arg,name))
print("SCAN FAIL" if bad else "SCAN PASS")
for path,kind in bad:
    print(path+": "+kind)
print("Limitation: shared pattern-based screening is defence in depth; it cannot prove arbitrary or obfuscated secrets absent.")
if bad:
    sys.exit(1)
