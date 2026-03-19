#!/usr/bin/env python3
"""
Cloudflare DNS bootstrap for this repo.

What it does:
- Enables Cloudflare proxy (orange cloud) on all *proxiable* existing records.
- Ensures A records exist for:
  - grafana.<DOMAIN>
  - argocd.<DOMAIN>

Auth:
- Preferred: CLOUDFLARE_API_TOKEN (API Token) -> Authorization: Bearer ...
- Also supported: CLOUDFLARE_AUTH_EMAIL + CLOUDFLARE_AUTH_KEY (Global API Key)

Config:
- DOMAIN (required)
- CLOUDFLARE_ZONE_ID (required)
- CLOUDFLARE_ORIGIN_IP (optional; otherwise inferred from an existing A record)
"""

from __future__ import annotations

import json
import os
import ssl
import sys
import urllib.error
import urllib.parse
import urllib.request
from pathlib import Path


CF_API = "https://api.cloudflare.com/client/v4"
TIMEOUT_SECS = 20
ctx = ssl.create_default_context()


def load_dotenv(dotenv_path: Path) -> None:
    """Minimal .env loader (no interpolation). Does not override existing env."""
    if not dotenv_path.exists():
        return
    for raw in dotenv_path.read_text(encoding="utf-8").splitlines():
        line = raw.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        k, v = line.split("=", 1)
        k = k.strip()
        v = v.strip().strip("'").strip('"')
        if k and k not in os.environ:
            os.environ[k] = v


def _http_request(url: str, headers: dict[str, str], method: str = "GET", data: dict | None = None) -> dict:
    body = json.dumps(data).encode("utf-8") if data is not None else None
    req = urllib.request.Request(url, data=body, headers=headers, method=method)
    try:
        with urllib.request.urlopen(req, timeout=TIMEOUT_SECS, context=ctx) as resp:
            return json.loads(resp.read())
    except urllib.error.HTTPError as e:
        try:
            return json.loads(e.read())
        except Exception:
            return {"success": False, "errors": [{"message": f"HTTP {e.code} {e.reason}"}]}
    except Exception as e:
        return {"success": False, "errors": [{"message": str(e)}]}


def _first_error(result: dict) -> str:
    errs = result.get("errors") or []
    if isinstance(errs, list) and errs:
        return errs[0].get("message") or "unknown error"
    return "unknown error"


def build_auth_headers() -> dict[str, str]:
    token = (os.getenv("CLOUDFLARE_API_TOKEN") or "").strip()
    email = (os.getenv("CLOUDFLARE_AUTH_EMAIL") or "").strip()
    key = (os.getenv("CLOUDFLARE_AUTH_KEY") or "").strip()

    base = {"Content-Type": "application/json"}

    # Prefer API token if it verifies.
    if token:
        verify = _http_request(f"{CF_API}/user/tokens/verify", {**base, "Authorization": f"Bearer {token}"})
        if verify.get("success"):
            return {**base, "Authorization": f"Bearer {token}"}

        # If token auth fails, fall back to Global API key auth if configured.
        if email and (key or token):
            return {**base, "X-Auth-Email": email, "X-Auth-Key": (key or token)}

        raise SystemExit(
            "Cloudflare auth failed.\n"
            "- If you are using an API Token: set CLOUDFLARE_API_TOKEN to a valid token with DNS edit permissions.\n"
            "- If you are using a Global API Key: set CLOUDFLARE_AUTH_EMAIL and CLOUDFLARE_AUTH_KEY.\n"
            f"Token verify error: {_first_error(verify)}"
        )

    if email and key:
        return {**base, "X-Auth-Email": email, "X-Auth-Key": key}

    raise SystemExit(
        "Missing Cloudflare credentials.\n"
        "Set CLOUDFLARE_API_TOKEN (preferred) or CLOUDFLARE_AUTH_EMAIL + CLOUDFLARE_AUTH_KEY."
    )


def list_all_dns_records(zone_id: str, headers: dict[str, str]) -> list[dict]:
    records: list[dict] = []
    page = 1
    per_page = 100
    while True:
        qs = urllib.parse.urlencode({"page": page, "per_page": per_page})
        res = _http_request(f"{CF_API}/zones/{zone_id}/dns_records?{qs}", headers)
        if not res.get("success"):
            raise SystemExit(f"Failed to list DNS records: {_first_error(res)}")
        batch = res.get("result") or []
        records.extend(batch)
        info = res.get("result_info") or {}
        total_pages = int(info.get("total_pages") or 1)
        if page >= total_pages:
            return records
        page += 1


def patch_record(zone_id: str, record_id: str, headers: dict[str, str], data: dict) -> dict:
    return _http_request(f"{CF_API}/zones/{zone_id}/dns_records/{record_id}", headers, method="PATCH", data=data)


def create_record(zone_id: str, headers: dict[str, str], data: dict) -> dict:
    return _http_request(f"{CF_API}/zones/{zone_id}/dns_records", headers, method="POST", data=data)


def upsert_a_record(
    *,
    zone_id: str,
    headers: dict[str, str],
    existing_by_name: dict[str, list[dict]],
    name: str,
    content: str,
    proxied: bool,
) -> None:
    existing = existing_by_name.get(name) or []
    a_recs = [r for r in existing if r.get("type") == "A"]
    if a_recs:
        r = a_recs[0]
        desired: dict = {}
        if r.get("content") != content:
            desired["content"] = content
        if bool(r.get("proxied")) != bool(proxied) and r.get("proxiable"):
            desired["proxied"] = proxied
        if not desired:
            print(f"   {name:<35} ok (already up to date)")
            return
        res = patch_record(zone_id, r["id"], headers, desired)
        if res.get("success"):
            print(f"   {name:<35} updated ✅")
        else:
            print(f"   {name:<35} update failed ❌ {_first_error(res)}")
        return

    # If a record doesn't exist but other types do, don't guess; create A anyway.
    res = create_record(
        zone_id,
        headers,
        {"type": "A", "name": name, "content": content, "proxied": proxied, "ttl": 1},
    )
    if res.get("success"):
        print(f"   {name:<35} created ✅")
    else:
        print(f"   {name:<35} create failed ❌ {_first_error(res)}")


def main() -> int:
    repo_root = Path(__file__).resolve().parents[1]
    load_dotenv(repo_root / ".env")

    domain = (os.getenv("DOMAIN") or "").strip()
    zone_id = (os.getenv("CLOUDFLARE_ZONE_ID") or "").strip()
    if not domain:
        print("Missing DOMAIN in environment/.env", file=sys.stderr)
        return 2
    if not zone_id:
        print("Missing CLOUDFLARE_ZONE_ID in environment/.env", file=sys.stderr)
        return 2

    headers = build_auth_headers()

    print("📋 Fetching existing DNS records...")
    records = list_all_dns_records(zone_id, headers)
    print(f"   Found {len(records)} records\n")

    # Index for quick lookups.
    existing_by_name: dict[str, list[dict]] = {}
    for r in records:
        existing_by_name.setdefault(r.get("name") or "", []).append(r)

    origin_ip = (os.getenv("CLOUDFLARE_ORIGIN_IP") or "").strip()
    if not origin_ip:
        # Prefer apex A record.
        for r in existing_by_name.get(domain, []):
            if r.get("type") == "A" and r.get("content"):
                origin_ip = r["content"]
                break
    if not origin_ip:
        # Fall back to any A record.
        for r in records:
            if r.get("type") == "A" and r.get("content"):
                origin_ip = r["content"]
                break
    if not origin_ip:
        print(
            "Could not infer origin IP from existing A records.\n"
            "Set CLOUDFLARE_ORIGIN_IP and re-run.",
            file=sys.stderr,
        )
        return 2

    print("☁️  Enabling Cloudflare proxy on existing proxiable records...")
    for r in sorted(records, key=lambda x: x.get("name") or ""):
        if not r.get("proxiable"):
            continue
        if r.get("proxied") is True:
            continue
        name = r.get("name") or "(unknown)"
        res = patch_record(zone_id, r["id"], headers, {"proxied": True})
        if res.get("success"):
            print(f"   {name:<35} proxied ✅")
        else:
            print(f"   {name:<35} proxy failed ❌ {_first_error(res)}")

    print("\n🆕 Ensuring Grafana + ArgoCD records exist...")
    upsert_a_record(
        zone_id=zone_id,
        headers=headers,
        existing_by_name=existing_by_name,
        name=f"grafana.{domain}",
        content=origin_ip,
        proxied=True,
    )
    upsert_a_record(
        zone_id=zone_id,
        headers=headers,
        existing_by_name=existing_by_name,
        name=f"argocd.{domain}",
        content=origin_ip,
        proxied=True,
    )

    print("\n🔍 Final DNS records (names + proxied):")
    records = list_all_dns_records(zone_id, headers)
    for r in sorted(records, key=lambda x: x.get("name") or ""):
        if r.get("type") not in {"A", "AAAA", "CNAME"}:
            continue
        proxied = r.get("proxied")
        proxy_str = "☁️  Yes" if proxied else ("⚪ No" if proxied is False else "-")
        content = r.get("content") or ""
        print(f"   {r.get('name',''):<35} {r.get('type',''):<6} {content:<20} {proxy_str}")

    print("\n✅ Done!")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
