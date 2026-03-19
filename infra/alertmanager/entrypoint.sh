#!/bin/sh
set -eu

CONFIG_PATH="/tmp/alertmanager.yml"
GROUP_WAIT="${ALERT_GROUP_WAIT:-30s}"
GROUP_INTERVAL="${ALERT_GROUP_INTERVAL:-5m}"
REPEAT_INTERVAL="${ALERT_REPEAT_INTERVAL:-4h}"
SLACK_CHANNEL_LINE=""

if [ -n "${ALERT_SLACK_CHANNEL:-}" ]; then
  SLACK_CHANNEL_LINE="        channel: \"${ALERT_SLACK_CHANNEL}\""
fi

if [ -n "${ALERT_SLACK_WEBHOOK_URL:-}" ]; then
  RECEIVER_NAME="slack"
  RECEIVERS_BLOCK=$(cat <<EOF
  - name: slack
    slack_configs:
      - api_url: "${ALERT_SLACK_WEBHOOK_URL}"
        send_resolved: true
${SLACK_CHANNEL_LINE}
        title: '[{{ .Status | toUpper }}] {{ .CommonLabels.alertname }}'
        text: >-
          {{ range .Alerts -}}
          *{{ .Annotations.summary }}*
          {{ .Annotations.description }}
          Labels: {{ .Labels }}
          {{ end -}}
EOF
)
  echo "Alertmanager: Slack notifications enabled." >&2
elif [ -n "${ALERT_WEBHOOK_URL:-}" ]; then
  RECEIVER_NAME="webhook"
  RECEIVERS_BLOCK=$(cat <<EOF
  - name: webhook
    webhook_configs:
      - url: "${ALERT_WEBHOOK_URL}"
        send_resolved: true
EOF
)
  echo "Alertmanager: generic webhook notifications enabled." >&2
else
  RECEIVER_NAME="inbox-only"
  RECEIVERS_BLOCK=$(cat <<'EOF'
  - name: inbox-only
EOF
)
  echo "Alertmanager: no notification endpoint configured; alerts are visible in Alertmanager/Grafana only." >&2
fi

cat >"${CONFIG_PATH}" <<EOF
global:
  resolve_timeout: 5m

route:
  receiver: ${RECEIVER_NAME}
  group_by: ['alertname', 'severity']
  group_wait: ${GROUP_WAIT}
  group_interval: ${GROUP_INTERVAL}
  repeat_interval: ${REPEAT_INTERVAL}

receivers:
${RECEIVERS_BLOCK}
EOF

exec /bin/alertmanager --config.file="${CONFIG_PATH}" --storage.path=/alertmanager
