#!/usr/bin/env bash
#===============================================================================
# test-network-isolation.sh - Network Isolation Testing
#===============================================================================
# Tests QuantPlatform's Docker network segmentation to verify isolation rules.
#
# Network Zones:
#   - quant-platform-frontend: Public-facing services (nginx, ui, gateway, grafana)
#   - quant-platform-backend: Internal services (postgres, gateway, ai-engine)
#   - quant-platform-observability: Monitoring stack (all observability tools)
#
# Usage:
#   ./test-network-isolation.sh
#
# Exit Codes:
#   0 - All tests passed
#   1 - One or more tests failed
#===============================================================================

set -euo pipefail

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Counters
PASSED=0
FAILED=0

#===============================================================================
# Functions
#===============================================================================

log_info() {
    echo -e "${GREEN}[INFO]${NC} $1"
}

log_warn() {
    echo -e "${YELLOW}[WARN]${NC} $1"
}

log_error() {
    echo -e "${RED}[ERROR]${NC} $1"
}

log_test() {
    echo -e "${BLUE}[TEST]${NC} $1"
}

check_container_running() {
    local container=$1
    if ! docker ps --format '{{.Names}}' | grep -q "^${container}$"; then
        log_error "Container '${container}' is not running"
        log_info "Start the stack with: docker compose up -d"
        exit 1
    fi
}

test_connectivity() {
    local from=$1
    local to=$2
    local port=$3
    local should_succeed=$4
    local description=$5

    log_test "${description}"

    # Try to connect (timeout after 2 seconds)
    local result=0
    docker exec "$from" timeout 2 nc -zv "$to" "$port" &> /dev/null || result=$?

    if [ "$should_succeed" = "true" ]; then
        # Should connect successfully
        if [ $result -eq 0 ]; then
            echo -e "  ${GREEN}✓ PASS${NC} - Connection allowed as expected"
            ((PASSED++))
            return 0
        else
            echo -e "  ${RED}✗ FAIL${NC} - Connection blocked (should be allowed)"
            ((FAILED++))
            return 1
        fi
    else
        # Should NOT connect (timeout or connection refused)
        if [ $result -ne 0 ]; then
            echo -e "  ${GREEN}✓ PASS${NC} - Connection blocked as expected"
            ((PASSED++))
            return 0
        else
            echo -e "  ${RED}✗ FAIL${NC} - Connection allowed (should be blocked)"
            ((FAILED++))
            return 1
        fi
    fi
}

check_prerequisites() {
    log_info "Checking prerequisites..."

    # Check if nc (netcat) is available in test containers
    if ! docker exec quant-platform-nginx which nc &> /dev/null; then
        log_warn "Installing netcat in test containers..."
        docker exec quant-platform-nginx apk add --no-cache netcat-openbsd &> /dev/null || true
    fi

    log_info "Prerequisites OK"
    echo ""
}

#===============================================================================
# Main
#===============================================================================

main() {
    echo "==============================================================================="
    echo "  QuantPlatform Network Isolation Tests"
    echo "==============================================================================="
    echo ""

    # Verify all containers are running
    log_info "Verifying containers are running..."
    check_container_running "quant-platform-nginx"
    check_container_running "quant-platform-ui"
    check_container_running "quant-platform-gateway"
    check_container_running "quant-platform-ai"
    check_container_running "quant-platform-postgres"
    check_container_running "quant-platform-grafana"
    echo ""

    check_prerequisites

    # =========================================================================
    # ALLOWED CONNECTIONS
    # =========================================================================

    echo "==============================================================================="
    echo "Testing ALLOWED Connections"
    echo "==============================================================================="
    echo ""

    # Frontend network
    test_connectivity "quant-platform-nginx" "quant-platform-ui" "3000" "true" \
        "nginx → ui (frontend network)"

    test_connectivity "quant-platform-nginx" "quant-platform-gateway" "8000" "true" \
        "nginx → gateway (frontend network)"

    test_connectivity "quant-platform-nginx" "quant-platform-grafana" "3000" "true" \
        "nginx → grafana (frontend/observability network)"

    # Backend network
    test_connectivity "quant-platform-gateway" "quant-platform-postgres" "5432" "true" \
        "gateway → postgres (backend network)"

    test_connectivity "quant-platform-gateway" "quant-platform-ai" "5000" "true" \
        "gateway → ai-engine (backend network)"

    # Observability network
    test_connectivity "quant-platform-gateway" "quant-platform-otel-collector" "4317" "true" \
        "gateway → otel-collector (observability network)"

    test_connectivity "quant-platform-ai" "quant-platform-otel-collector" "4317" "true" \
        "ai-engine → otel-collector (observability network)"

    echo ""

    # =========================================================================
    # BLOCKED CONNECTIONS
    # =========================================================================

    echo "==============================================================================="
    echo "Testing BLOCKED Connections"
    echo "==============================================================================="
    echo ""

    # UI should NOT reach backend services
    test_connectivity "quant-platform-ui" "quant-platform-postgres" "5432" "false" \
        "ui ✗ postgres (isolated: frontend vs backend)"

    test_connectivity "quant-platform-ui" "quant-platform-ai" "5000" "false" \
        "ui ✗ ai-engine (isolated: frontend vs backend)"

    # Nginx should NOT reach backend services directly
    test_connectivity "quant-platform-nginx" "quant-platform-postgres" "5432" "false" \
        "nginx ✗ postgres (isolated: frontend vs backend)"

    test_connectivity "quant-platform-nginx" "quant-platform-ai" "5000" "false" \
        "nginx ✗ ai-engine (isolated: frontend vs backend)"

    # AI Engine should NOT reach postgres directly
    # (only gateway should access the database)
    test_connectivity "quant-platform-ai" "quant-platform-postgres" "5432" "false" \
        "ai-engine ✗ postgres (isolated: zero-trust backend)"

    # Frontend should NOT reach observability internals
    test_connectivity "quant-platform-ui" "quant-platform-otel-collector" "4317" "false" \
        "ui ✗ otel-collector (isolated: frontend vs observability)"

    test_connectivity "quant-platform-ui" "quant-platform-jaeger" "14268" "false" \
        "ui ✗ jaeger (isolated: frontend vs observability)"

    echo ""

    # =========================================================================
    # SUMMARY
    # =========================================================================

    echo "==============================================================================="
    echo "Test Summary"
    echo "==============================================================================="
    echo ""
    echo "  Total tests: $((PASSED + FAILED))"
    echo -e "  ${GREEN}Passed: $PASSED${NC}"
    echo -e "  ${RED}Failed: $FAILED${NC}"
    echo ""

    if [ $FAILED -eq 0 ]; then
        echo -e "${GREEN}✓ All network isolation tests passed${NC}"
        echo ""
        log_info "Network segmentation is working correctly:"
        echo "  - Frontend network: nginx, ui, gateway, grafana"
        echo "  - Backend network: postgres, gateway, ai-engine"
        echo "  - Observability network: otel-collector, jaeger, loki, prometheus, grafana"
        echo ""
        exit 0
    else
        echo -e "${RED}✗ Network isolation tests failed${NC}"
        echo ""
        log_error "Security issue detected!"
        log_info "Review docker-compose.yml network assignments"
        echo ""
        exit 1
    fi
}

main "$@"
