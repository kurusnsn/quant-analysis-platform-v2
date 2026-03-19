FROM python:3.12-slim

RUN apt-get update && apt-get install -y --no-install-recommends cron \
    && rm -rf /var/lib/apt/lists/*

RUN pip install --no-cache-dir yfinance requests

# Scripts live at /app/scripts so relative paths (../ui/public/) resolve to /app/ui/public/
WORKDIR /app
COPY scripts/ /app/scripts/

# Seed data: initial static files the scripts read as input (universe, logos)
# and initial output files so nginx has something to serve immediately
COPY ui/public/stock-universe.json \
     ui/public/stock-logos.json \
     ui/public/stock-metadata.json \
     ui/public/stock-prices.json \
     ui/public/index-quotes.json \
     /app/seed-data/

COPY infra/cron/entrypoint.sh /entrypoint.sh
COPY infra/cron/crontab /etc/cron.d/stock-updater

RUN chmod +x /entrypoint.sh \
    && chmod 0644 /etc/cron.d/stock-updater \
    && touch /var/log/cron.log

ENTRYPOINT ["/entrypoint.sh"]
