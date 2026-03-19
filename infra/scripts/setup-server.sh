#!/bin/bash
# QuantPlatform Server Setup Script
# Run as root on Ubuntu 22.04

set -e

echo "=== Installing Docker ==="
apt-get update
apt-get install -y apt-transport-https ca-certificates curl software-properties-common
curl -fsSL https://download.docker.com/linux/ubuntu/gpg | gpg --dearmor -o /usr/share/keyrings/docker-archive-keyring.gpg
echo "deb [arch=$(dpkg --print-architecture) signed-by=/usr/share/keyrings/docker-archive-keyring.gpg] https://download.docker.com/linux/ubuntu $(lsb_release -cs) stable" | tee /etc/apt/sources.list.d/docker.list > /dev/null
apt-get update
apt-get install -y docker-ce docker-ce-cli containerd.io docker-compose-plugin

echo "=== Installing Fail2Ban ==="
apt-get install -y fail2ban
systemctl enable fail2ban
systemctl start fail2ban

echo "=== Configuring UFW Firewall ==="
ufw default deny incoming
ufw default allow outgoing
ufw allow 22/tcp
ufw allow 80/tcp
ufw allow 443/tcp
ufw --force enable

echo "=== Creating QuantPlatform directories ==="
mkdir -p /opt/quant-platform/{env,data/postgres,data/model_cache,logs}
mkdir -p /opt/quant-platform/env/nginx/ssl

echo "=== Setup Complete ==="
docker --version
ufw status
