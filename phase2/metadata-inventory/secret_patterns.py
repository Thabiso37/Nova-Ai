#!/usr/bin/env python3
"""Single shared pattern policy for inventory field checks and evidence scanning."""
import re

PATTERNS = [
    ("credential_assignment", re.compile(r"""(?i)\b(password|passwd|secret|api[_-]?key|access[_-]?token|client[_-]?secret|private[_-]?key|aws_secret_access_key|aws_session_token|accountkey|sharedaccesssignature)\b\s*[:=]\s*['"]?[^'"\s,;]{8,}""")),
    ("bearer_token", re.compile(r"(?i)\bBearer\s+[A-Za-z0-9._~+/=-]{16,}")),
    ("basic_auth", re.compile(r"(?i)\bAuthorization\s*:\s*Basic\s+[A-Za-z0-9+/=]{16,}")),
    ("jwt", re.compile(r"\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\b")),
    ("aws_access_key", re.compile(r"\b(?:AKIA|ASIA|AIDA|AROA)[0-9A-Z]{16}\b")),
    ("github_token", re.compile(r"\b(?:gh[pousr]_[A-Za-z0-9]{20,}|github_pat_[A-Za-z0-9_]{20,})\b")),
    ("gitlab_token", re.compile(r"\b(?:glpat-|gldt-|glrt-)[A-Za-z0-9_-]{20,}\b")),
    ("google_api_key", re.compile(r"\bAIza[0-9A-Za-z_-]{30,}\b")),
    ("slack_token", re.compile(r"\bxox[baprs]-[A-Za-z0-9-]{10,}\b")),
    ("discord_token", re.compile(r"\b(?:mfa\.)?[A-Za-z0-9_-]{24}\.[A-Za-z0-9_-]{6}\.[A-Za-z0-9_-]{25,}\b")),
    ("npm_token", re.compile(r"\bnpm_[A-Za-z0-9]{30,}\b")),
    ("pypi_token", re.compile(r"\bpypi-[A-Za-z0-9_-]{40,}\b")),
    ("openai_or_stripe_secret", re.compile(r"\b(?:sk-(?:proj-)?[A-Za-z0-9_-]{20,}|(?:sk|rk)_live_[A-Za-z0-9]{16,})\b")),
    ("digitalocean_token", re.compile(r"\b(?:dop_v1_|doo_v1_|dbaas-)[A-Za-z0-9_-]{20,}\b")),
    ("azure_sas_signature", re.compile(r"(?i)(?:[?&])sig=[A-Za-z0-9%+/=]{20,}")),
    ("database_uri", re.compile(r"(?i)\b(?:postgres|postgresql|mysql|mongodb(?:\+srv)?|redis|rediss|amqps?)://[^\s'\"<>]+")),
    ("credentialed_uri", re.compile(r"[A-Za-z][A-Za-z0-9+.-]*://[^/\s:@]+:[^/\s@]+@")),
    ("private_key", re.compile(r"-----BEGIN (?:RSA |EC |OPENSSH |DSA |ENCRYPTED )?PRIVATE KEY-----")),
    ("supabase_secret", re.compile(r"(?i)\bsb_secret_[A-Za-z0-9_-]{12,}")),
    ("cloud_provider_token", re.compile(r"(?i)\b(?:cloudflare|azure|aws|gcp|google_cloud|digitalocean)[_-]?(?:api[_-]?key|token|secret)\b\s*[:=]\s*['\"]?[^'\"\s,;]{12,}")),
    ("credentialed_connection_string", re.compile(r"(?i)\b(host|user|username)\s*=\s*[^\s]+\s+password\s*=\s*[^\s]+")),
]

CANARIES = (
    "CANARY_CUSTOMER_7f3c2a91",
    "CANARY_SELLER_8b1d4e62",
    "CANARY_RLS_DISABLED_91aa73",
)
