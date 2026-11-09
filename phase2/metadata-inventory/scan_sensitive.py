#!/usr/bin/env python3
"""Shared pattern-based scan for artifacts and captured workflow output."""
import re,sys
from pathlib import Path
patterns=[
("credential_assignment",r"""(?i)\b(password|passwd|secret|api[_-]?key|access[_-]?token|client_secret)\b\s*[:=]\s*['"]?[^'"\s,;]{8,}"""),
("bearer_token",r"(?i)\bBearer\s+[A-Za-z0-9._~+/=-]{16,}"),
("jwt",r"\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\b"),
("aws_access_key",r"\bAKIA[0-9A-Z]{16}\b"),
("github_token",r"\b(gh[pousr]_[A-Za-z0-9]{20,}|github_pat_[A-Za-z0-9_]{20,})\b"),
("google_api_key",r"\bAIza[0-9A-Za-z_-]{30,}\b"),
("slack_token",r"\bxox[baprs]-[A-Za-z0-9-]{10,}\b"),
("database_uri",r"(?i)\b(postgres|postgresql|mysql)://[^\s'\"<>]+"),
("private_key",r"-----BEGIN (?:RSA |EC |OPENSSH |DSA )?PRIVATE KEY-----"),
("supabase_secret",r"(?i)\bsb_secret_[A-Za-z0-9_-]{12,}"),
("credentialed_connection_string",r"(?i)\b(host|user|username)\s*=\s*[^\s]+\s+password\s*=\s*[^\s]+")]
canaries=("CANARY_CUSTOMER_7f3c2a91","CANARY_SELLER_8b1d4e62","CANARY_RLS_DISABLED_91aa73")
bad=[]
for arg in sys.argv[1:]:
 p=Path(arg)
 if not p.is_file():bad.append((arg,"missing_file"));continue
 data=p.read_text(errors="replace")
 if any(x in data for x in canaries):bad.append((arg,"synthetic_canary"))
 for name,rx in patterns:
  if re.search(rx,data):bad.append((arg,name))
print("SCAN FAIL" if bad else "SCAN PASS")
for path,kind in bad:print(path+": "+kind)
print("Limitation: pattern-based screening is defence in depth and cannot prove arbitrary secrets absent.")
if bad:sys.exit(1)
