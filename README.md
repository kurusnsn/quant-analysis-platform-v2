# Quant Platform

[Svensk version](README-sv.md)

A system that generates structured watchlists with quantitative risk metrics, scenario simulations, and SEC filing analysis.

**Note:** This repository is a structural snapshot for hiring visibility. Proprietary models, weighting logic, and heuristics are replaced with stubs.

---

## System Architecture

The platform separates orchestration from compute-heavy analytics:

```mermaid
graph TD
    Browser["Browser / UI\n(Next.js 16)"]
    CF["Cloudflare\n(WAF + DNS)"]
    Nginx["Nginx\n(reverse proxy + TLS)"]
    GW["C# Gateway\n(.NET 8)"]
    AI["Python AI Engine\n(FastAPI + Uvicorn)"]
    PG["PostgreSQL 15"]
    S3["Hetzner Object Storage\n(S3-compatible)"]
    EDGAR["SEC EDGAR API\n(public)"]
    YF["yfinance / Yahoo Finance"]
    Groq["Groq LLM API\n(llama-3.3-70b-versatile)"]
    VDB["LlamaIndex Vector Store\n(filesystem, BGE 384-dim)"]
    OTEL["OpenTelemetry Collector"]
    Prom["Prometheus"]
    Loki["Loki"]
    Jaeger["Jaeger"]
    Grafana["Grafana"]
    AM["AlertManager\n(Slack)"]

    Browser --> CF --> Nginx --> GW
    GW --> AI
    GW --> PG
    GW --> S3
    AI --> EDGAR
    AI --> YF
    AI --> Groq
    AI --> VDB
    GW --> OTEL
    AI --> OTEL
    OTEL --> Prom
    OTEL --> Loki
    OTEL --> Jaeger
    Prom --> Grafana
    Loki --> Grafana
    Jaeger --> Grafana
    Prom --> AM
```

---

## Engineering Highlights

- **Dual-service architecture** separating web orchestration (.NET) from ML workloads (Python)
- **Stateless AI engine** horizontally scalable behind Nginx load balancing
- **End-to-end observability** using OpenTelemetry, Prometheus, Jaeger, and Loki
- **Fault-tolerant LLM pipeline** with provider fallback and deterministic fallbacks
- **CI/CD pipeline** with security scanning (Trivy) and automated deployments

---

## Core Components

### Quantitative Risk Engine
- Monte Carlo simulations (5000 paths, 30-day horizon)
- VaR / CVaR calculations
- Gaussian HMM for market regime detection

### Watchlist Generation Pipeline

```mermaid
flowchart TD
    A["User prompt\n(sanitized, max 500 chars)"]
    B["Step 1 — Intent extraction\nLLM → StrategyIntent"]
    C["Step 2 — Candidate generation\nLLM → 10–15 tickers"]
    D["Step 3 — Ticker validation\nyfinance price + metadata check"]
    E["Step 4 — Quality filter\nmin_market_cap=$100M\nmin_avg_volume=100K\nmax_tickers=8"]
    F["Step 5 — Quant analysis\nquant_models.py\nvol / Sharpe / VaR95 / CVaR95\nMonte Carlo 5000 paths"]
    G["Step 6 — Results composition\ncalculate_risk_score()\nfinancials + EDGAR filings + FinBERT"]
    H["Step 7 — RAG context\n(deep_research=True only)"]
    I["Step 8 — Narrative generation\nBatch LLM rationale per ticker"]
    J["Response\n{tickers, narrative, reasoning,\nexplanations, citations, meta}"]

    A --> B --> C --> D --> E --> F --> G --> H --> I --> J
```

### RAG Filing Analysis
- SEC EDGAR ingestion pipeline
- Hierarchical chunking + auto-merging retrieval
- Grounded Q&A over financial documents

### Gateway Service (.NET 8)
- Handles auth, billing, rate limiting, and orchestration
- Async request handling to prevent blocking during ML inference

---

## Design Trade-offs

- **Service separation:** isolates ML dependencies from the web layer at the cost of inter-service latency  
- **Synchronous pipeline:** simplifies flow but introduces thread pressure under high latency  

---

## Performance & Scalability

### Request flow

`client → gateway (.NET) → AI engine (Python) → external APIs (Groq LLM, SEC EDGAR, yfinance/news)`

Each hop emits OpenTelemetry spans so trace IDs can be followed end-to-end across services in Jaeger.

### Latency & Observability

- End-to-end latency is traced with OpenTelemetry across the gateway, AI engine, and external data/LLM calls.
- A custom perf harness (`perf/run_perf.py`) supports `1`, `10`, and `50` concurrent-user baselines and records `p50`, `p95`, throughput, and failure rate per endpoint.
- Production alert thresholds are set at **gateway p95 > 1.5s** and **AI engine p95 > 2.0s**.
- The main latency drivers are **LLM inference** and **external SEC / market / news fetches**.

### Scaling strategy

- **Horizontal scaling:** run multiple AI engine replicas behind the gateway/load balancer.
- **Caching:** use Redis + TTL caches for repeated market/news/analysis fetches and precomputed watchlist artifacts.

---

## Architectural Self-Critique

- **Thread pool pressure:** long-running LLM calls can saturate gateway threads  
  → V2: move to event-driven architecture (Kafka / RabbitMQ)

- **Data ingestion fragility:** tightly coupled to external financial APIs  
  → V2: introduce schema validation and ingestion layer

---

## Running Locally

```bash
cd infra && docker compose up -d
```

| Service | URL |
|---|---|
| Gateway | http://localhost:8000 |
| AI Engine | http://localhost:5000 |
| UI | http://localhost:3000 |

---

## Repository Structure

- `/services/gateway`: .NET 8 API (auth, billing, orchestration)
- `/services/ai-engine`: Python service (quant models, RAG)
- `/ui`: Next.js frontend
- `/infra`: Docker Compose + Nginx
