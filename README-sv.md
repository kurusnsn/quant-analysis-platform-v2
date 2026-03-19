# Quant Platform

[Engelsk version](README.md)

En finansiell signalplattform i produktionsklass som genererar strukturerade bevakningslistor med kvantitativa riskmått, scenariesimuleringar och analys av SEC-dokumentation.

**Notera:** Detta repositorium är en strukturell snapshot för synlighet i jobbsökande sammanhang. Proprietära modeller, viktlogik och heuristik har ersatts med stubbar.

---

## Systemarkitektur

Plattformen separerar orkestrering från beräkningsintensiv analys:

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

- **Dual-service arkitektur** som separerar webborkestrering (.NET) från ML-belastningar (Python)
- **Statslös AI-motor** som är horisontellt skalbar bakom Nginx load balancing
- **End-to-end observability** med OpenTelemetry, Prometheus, Jaeger och Loki
- **Feltolerant LLM-pipeline** med fallback-leverantörer och deterministiska fallbacks
- **CI/CD-pipeline** med säkerhetsscanning (Trivy) och automatiserade releaser

---

## Kärnkomponenter

### Kvantitativ riskmotor
- Monte Carlo-simuleringar (5000 stigar, 30-dagars horisont)
- VaR- / CVaR-beräkningar
- Gaussisk HMM för detektering av marknadsregimer

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

### RAG-analys av dokumentation
- SEC EDGAR-pipelinen för datainhämtning
- Hierarkisk chunking + auto-merging hämtning
- Grundad Q&A över finansiella dokument

### Gateway-tjänst (.NET 8)
- Hanterar auth, fakturering, rate limiting och orkestrering
- Asynkron hantering av förfrågningar för att förhindra lagg under ML-inferens

---

## Designval och avvägningar

- **Separering av tjänster:** isolerar ML-beroenden från webblagret på bekostnad av latens mellan tjänster
- **Synkron pipeline:** förenklar flödet men introducerar tråd-tryck vid hög latens

---

## Prestanda och skalbarhet

### Förfrågningsflöde

`klient → gateway (.NET) → AI engine (Python) → externa API:er (Groq LLM, SEC EDGAR, yfinance/news)`

Varje hop spåras med OpenTelemetry så att trace IDs kan följas end-to-end i Jaeger.

### Latens och observerbarhet

- End-to-end-latens spåras över gateway, AI engine och externa data-/LLM-anrop.
- En egen prestandaharness (`perf/run_perf.py`) stödjer baslinjer för `1`, `10` och `50` samtidiga användare och loggar `p50`, `p95`, genomströmning och felfrekvens per endpoint.
- Produktionslarm är satta till **gateway p95 > 1,5 s** och **AI engine p95 > 2,0 s**.
- De största latensdrivarna är **LLM-inferens** och **externa SEC-/marknads-/nyhetsanrop**.

### Skalningsstrategi

- **Horisontell skalning:** kör flera AI engine-replikor bakom gateway/load balancer.
- **Caching:** använd Redis + TTL-cachar för återkommande marknads-/nyhets-/analysanrop och förberäknade watchlist-artefakter.

---

## Arkitektonisk självkritik

- **Trådpool-mättnad:** långsamma LLM-anrop kan mätta gateway-trådar
  → V2: flytta till händelsestyrd arkitektur (Kafka / RabbitMQ)

- **Sårbar datainhämtning:** hårt kopplad till externa finansiella API:er
  → V2: inför schemavalidering och ett extra lager för inhämtning

---

## Köra lokalt

```bash
cd infra && docker compose up -d
```

| Tjänst | URL |
|---|---|
| Gateway | http://localhost:8000 |
| AI Engine | http://localhost:5000 |
| UI | http://localhost:3000 |

---

## Repositorystruktur

- `/services/gateway`: .NET 8 API (auth, fakturering, orkestrering)
- `/services/ai-engine`: Python-tjänst (kvantitativa modeller, RAG)
- `/ui`: Next.js-frontend
- `/infra`: Docker Compose + Nginx
