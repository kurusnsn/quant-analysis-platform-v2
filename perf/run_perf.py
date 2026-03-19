#!/usr/bin/env python3
import argparse
import json
import math
import os
import threading
import time
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timezone
from typing import Any, Dict, List, Tuple
from urllib.parse import urljoin

import requests


def _load_json(path: str) -> Dict[str, Any]:
    with open(path, "r", encoding="utf-8") as handle:
        return json.load(handle)


def _write_json(path: str, payload: Dict[str, Any]) -> None:
    with open(path, "w", encoding="utf-8") as handle:
        json.dump(payload, handle, indent=2, sort_keys=True)


def _utc_now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def _percentile(values: List[float], pct: float) -> float:
    if not values:
        return 0.0
    values_sorted = sorted(values)
    k = int(math.ceil((pct / 100.0) * len(values_sorted))) - 1
    k = max(0, min(k, len(values_sorted) - 1))
    return values_sorted[k]


def _resolve_headers(config: Dict[str, Any]) -> Dict[str, str]:
    headers: Dict[str, str] = {}
    headers.update(config.get("headers", {}))
    auth = config.get("auth")
    if not auth:
        return headers

    auth_type = auth.get("type")
    token_env = auth.get("token_env")
    if auth_type == "bearer" and token_env:
        token = os.getenv(token_env)
        if not token:
            raise RuntimeError(f"Missing auth token in env var {token_env}")
        headers["Authorization"] = f"Bearer {token}"
    elif auth_type == "header":
        header_name = auth.get("header")
        if not header_name or not token_env:
            raise RuntimeError("auth.header and auth.token_env are required for header auth")
        token = os.getenv(token_env)
        if not token:
            raise RuntimeError(f"Missing auth token in env var {token_env}")
        headers[header_name] = token
    return headers


def _endpoint_cycle(endpoints: List[Dict[str, Any]]):
    lock = threading.Lock()
    index = {"value": 0}

    def next_endpoint() -> Dict[str, Any]:
        with lock:
            endpoint = endpoints[index["value"]]
            index["value"] = (index["value"] + 1) % len(endpoints)
            return endpoint

    return next_endpoint


def _run_load(
    base_url: str,
    endpoints: List[Dict[str, Any]],
    headers: Dict[str, str],
    concurrency: int,
    duration_s: int,
    timeout_s: int,
) -> Tuple[Dict[str, Any], Dict[str, Any]]:
    stats: Dict[str, Dict[str, Any]] = {
        ep["name"]: {"latencies": [], "count": 0, "errors": 0} for ep in endpoints
    }
    stats_lock = threading.Lock()

    inflight = {"current": 0, "max": 0}
    inflight_lock = threading.Lock()

    next_endpoint = _endpoint_cycle(endpoints)
    stop_time = time.monotonic() + duration_s

    def worker():
        session = requests.Session()
        while time.monotonic() < stop_time:
            endpoint = next_endpoint()
            name = endpoint["name"]
            method = endpoint.get("method", "GET").upper()
            path = endpoint["path"]
            url = urljoin(base_url, path)
            body = endpoint.get("body")
            extra_headers = endpoint.get("headers", {})
            payload_headers = headers.copy()
            payload_headers.update(extra_headers)

            with inflight_lock:
                inflight["current"] += 1
                inflight["max"] = max(inflight["max"], inflight["current"])

            start = time.perf_counter()
            error = False
            try:
                response = session.request(
                    method,
                    url,
                    json=body,
                    headers=payload_headers,
                    timeout=timeout_s,
                )
                if response.status_code >= 500:
                    error = True
            except Exception:
                error = True
            finally:
                latency_ms = (time.perf_counter() - start) * 1000.0
                with stats_lock:
                    stats[name]["latencies"].append(latency_ms)
                    stats[name]["count"] += 1
                    if error:
                        stats[name]["errors"] += 1
                with inflight_lock:
                    inflight["current"] -= 1

    with ThreadPoolExecutor(max_workers=concurrency) as executor:
        for _ in range(concurrency):
            executor.submit(worker)

    results: Dict[str, Any] = {}
    for name, data in stats.items():
        latencies = data["latencies"]
        count = data["count"]
        errors = data["errors"]
        error_rate = errors / count if count else 0.0
        results[name] = {
            "count": count,
            "errors": errors,
            "error_rate": error_rate,
            "latency_ms": {
                "p50": _percentile(latencies, 50),
                "p95": _percentile(latencies, 95),
                "p99": _percentile(latencies, 99),
            },
        }

    return results, {"max_in_flight": inflight["max"]}


def _query_prometheus(base_url: str, query: str) -> float:
    resp = requests.get(f"{base_url.rstrip('/')}/api/v1/query", params={"query": query}, timeout=10)
    resp.raise_for_status()
    payload = resp.json()
    if payload.get("status") != "success":
        raise RuntimeError(f"Prometheus query failed: {payload}")
    result = payload.get("data", {}).get("result", [])
    if not result:
        return 0.0
    if len(result) > 1:
        raise RuntimeError(f"Prometheus query returned multiple series: {query}")
    value = result[0].get("value", [None, "0"])[1]
    return float(value)


def _collect_prometheus_metrics(config: Dict[str, Any]) -> Dict[str, float]:
    prom = config.get("prometheus")
    if not prom:
        return {}

    base_url = prom.get("base_url")
    if not base_url:
        raise RuntimeError("prometheus.base_url is required when prometheus is configured")

    metrics: Dict[str, float] = {}
    for name, query_def in prom.get("queries", {}).items():
        query = query_def.get("query") if isinstance(query_def, dict) else query_def
        metrics[name] = _query_prometheus(base_url, query)
    return metrics


def _query_jaeger_traces(base_url: str, service: str, start_us: int, end_us: int, limit: int) -> List[Dict[str, Any]]:
    params = {
        "service": service,
        "start": start_us,
        "end": end_us,
        "limit": limit,
    }
    resp = requests.get(f"{base_url.rstrip('/')}/api/traces", params=params, timeout=10)
    resp.raise_for_status()
    payload = resp.json()
    return payload.get("data", [])


def _trace_matches_route(trace: Dict[str, Any], route: str) -> bool:
    for span in trace.get("spans", []):
        for tag in span.get("tags", []):
            if tag.get("key") == "http.route" and tag.get("value") == route:
                return True
    return False


def _extract_overlap_pairs(trace: Dict[str, Any], span_names: List[str]) -> List[str]:
    spans = [
        span for span in trace.get("spans", [])
        if span.get("operationName") in span_names
    ]
    intervals = []
    for span in spans:
        start_us = span.get("startTime", 0)
        duration_us = span.get("duration", 0)
        end_us = start_us + duration_us
        intervals.append((span.get("operationName", "unknown"), start_us, end_us))

    overlaps = set()
    for i in range(len(intervals)):
        name_a, start_a, end_a = intervals[i]
        for j in range(i + 1, len(intervals)):
            name_b, start_b, end_b = intervals[j]
            if start_a < end_b and start_b < end_a:
                pair = "|".join(sorted([name_a, name_b]))
                overlaps.add(pair)
    return sorted(overlaps)


def _collect_jaeger_traces(config: Dict[str, Any], start_time: float, end_time: float) -> Dict[str, Any]:
    jaeger = config.get("jaeger")
    if not jaeger:
        return {}

    base_url = jaeger.get("base_url")
    service = jaeger.get("service")
    if not base_url or not service:
        raise RuntimeError("jaeger.base_url and jaeger.service are required when jaeger is configured")

    limit = int(jaeger.get("limit", 20))
    span_names = jaeger.get("concurrency_span_names", ["external_api.wait", "db.pool.wait", "db.query"])
    start_us = int(start_time * 1_000_000)
    end_us = int(end_time * 1_000_000)

    trace_data: Dict[str, Any] = {}
    traces = _query_jaeger_traces(base_url, service, start_us, end_us, limit)
    endpoints = config.get("endpoints", [])
    for endpoint in endpoints:
        route = endpoint.get("route") or endpoint.get("path")
        matched = [trace for trace in traces if _trace_matches_route(trace, route)]
        trace_ids = [trace.get("traceID") for trace in matched[:3] if trace.get("traceID")]
        overlap_pairs = set()
        for trace in matched[:3]:
            overlap_pairs.update(_extract_overlap_pairs(trace, span_names))
        trace_data[endpoint["name"]] = {
            "trace_ids": trace_ids,
            "overlap_pairs": sorted(overlap_pairs),
        }

    return trace_data


def _validate_target_environment(config: Dict[str, Any], mode: str) -> None:
    environment = str(config.get("environment", "")).lower()
    allowed = [env.lower() for env in config.get("allowed_environments", ["staging"])]
    if environment not in allowed:
        raise RuntimeError(f"Environment '{environment}' not in allowed_environments {allowed}")

    if mode == "baseline" and environment != "staging":
        raise RuntimeError("Baseline generation is restricted to staging environment")

    allowed_urls = config.get("allowed_base_urls", [])
    base_url = config.get("base_url", "")
    if allowed_urls and base_url not in allowed_urls:
        raise RuntimeError(f"base_url '{base_url}' not in allowed_base_urls")


def _compare_metrics(current: Dict[str, Any], baseline: Dict[str, Any]) -> List[str]:
    failures = []
    for name, metrics in current.items():
        baseline_metric = baseline.get(name)
        if baseline_metric is None:
            continue
        if metrics > baseline_metric:
            failures.append(f"{name} increased from {baseline_metric} to {metrics}")
    return failures


def _compare_overlap(current: Dict[str, Any], baseline: Dict[str, Any]) -> List[str]:
    failures = []
    for name, baseline_info in baseline.items():
        baseline_pairs = set(baseline_info.get("overlap_pairs", []))
        if not baseline_pairs:
            continue
        current_pairs = set(current.get(name, {}).get("overlap_pairs", []))
        missing = baseline_pairs - current_pairs
        if missing:
            failures.append(f"{name} lost overlap pairs: {sorted(missing)}")
    return failures


def main() -> int:
    parser = argparse.ArgumentParser(description="QuantPlatform performance smoke tests")
    parser.add_argument("--config", required=True, help="Path to perf config JSON")
    parser.add_argument("--baseline", default="perf/baseline.json", help="Baseline JSON path")
    parser.add_argument("--mode", choices=["baseline", "compare"], default="compare")
    args = parser.parse_args()

    config = _load_json(args.config)
    _validate_target_environment(config, args.mode)

    base_url = config["base_url"]
    endpoints = config["endpoints"]
    concurrency = int(config.get("concurrency", 4))
    duration_s = int(config.get("duration_seconds", 30))
    warmup_s = int(config.get("warmup_seconds", 5))
    timeout_s = int(config.get("timeout_seconds", 10))

    headers = _resolve_headers(config)

    if warmup_s > 0:
        _run_load(base_url, endpoints, headers, max(1, concurrency // 2), warmup_s, timeout_s)

    start_time = time.time()
    endpoint_results, client_stats = _run_load(
        base_url,
        endpoints,
        headers,
        concurrency,
        duration_s,
        timeout_s,
    )
    end_time = time.time()

    prom_metrics = _collect_prometheus_metrics(config)
    trace_info = _collect_jaeger_traces(config, start_time, end_time)

    run_payload = {
        "generated_at": _utc_now_iso(),
        "environment": config.get("environment"),
        "base_url": base_url,
        "duration_seconds": duration_s,
        "concurrency": concurrency,
        "client": client_stats,
        "endpoints": endpoint_results,
        "prometheus": prom_metrics,
        "traces": trace_info,
    }

    if args.mode == "baseline":
        if os.path.exists(args.baseline):
            existing = _load_json(args.baseline)
            if existing.get("locked", False):
                raise RuntimeError("Baseline is locked. Remove lock to regenerate.")
        run_payload["locked"] = True
        _write_json(args.baseline, run_payload)
        return 0

    baseline = _load_json(args.baseline)
    if not baseline.get("locked", False):
        raise RuntimeError("Baseline is missing or not locked.")

    failures: List[str] = []
    for name, result in endpoint_results.items():
        baseline_result = baseline.get("endpoints", {}).get(name)
        if not baseline_result:
            continue
        baseline_p95 = baseline_result["latency_ms"]["p95"]
        current_p95 = result["latency_ms"]["p95"]
        if current_p95 > baseline_p95 * 1.10:
            failures.append(
                f"{name} p95 latency {current_p95:.2f}ms exceeds baseline {baseline_p95:.2f}ms by >10%"
            )

        baseline_error = baseline_result.get("error_rate", 0.0)
        current_error = result.get("error_rate", 0.0)
        if current_error > baseline_error:
            failures.append(
                f"{name} error rate increased from {baseline_error:.4f} to {current_error:.4f}"
            )

    metric_failures = _compare_metrics(
        run_payload.get("prometheus", {}),
        baseline.get("prometheus", {}),
    )
    failures.extend(metric_failures)

    overlap_failures = _compare_overlap(
        run_payload.get("traces", {}),
        baseline.get("traces", {}),
    )
    failures.extend(overlap_failures)

    if failures:
        for failure in failures:
            print(f"FAIL: {failure}")
        return 1

    print("PASS: no performance regressions detected")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
