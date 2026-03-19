#!/usr/bin/env bash
#===============================================================================
# pre-flight.sh - Pre-deployment Validation Script
#===============================================================================
# Runs validation checks before deploying QuantPlatform stack.
#
# Checks:
#   1. Docker daemon is running
#   2. docker-compose.yml is valid
#   3. Security scans pass (unless SKIP_SECURITY_SCAN=1)
#
# Usage:
#   ./pre-flight.sh
#
# Environment Variables:
#   SKIP_SECURITY_SCAN - Skip Trivy scanning if set to 1
#===============================================================================

set -euo pipefail

# Configuration
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
INFRA_DIR="$(dirname "$SCRIPT_DIR")"
PROJECT_ROOT="$(dirname "$INFRA_DIR")"

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

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

log_step() {
    echo -e "${BLUE}[STEP]${NC} $1"
}

print_header() {
    echo "==============================================================================="
    echo "  QuantPlatform Pre-Flight Checks"
    echo "==============================================================================="
    echo ""
}

check_docker_daemon() {
    log_step "Checking Docker daemon..."

    if ! docker info &> /dev/null; then
        log_error "Docker daemon is not running"
        log_info "Start Docker and try again"
        return 1
    fi

    log_info "✓ Docker daemon is running"

    # Show Docker version
    docker_version=$(docker version --format '{{.Server.Version}}' 2>/dev/null || echo "unknown")
    log_info "  Docker version: $docker_version"

    return 0
}

check_docker_compose_version() {
    log_step "Checking Docker Compose..."

    if ! docker compose version &> /dev/null; then
        log_error "Docker Compose is not available"
        log_info "Install Docker Compose plugin and try again"
        return 1
    fi

    compose_version=$(docker compose version --short 2>/dev/null || echo "unknown")
    log_info "✓ Docker Compose available"
    log_info "  Version: $compose_version"

    return 0
}

validate_compose_file() {
    log_step "Validating docker-compose.yml..."

    local compose_file="$INFRA_DIR/docker-compose.yml"

    if [ ! -f "$compose_file" ]; then
        log_error "docker-compose.yml not found at: $compose_file"
        return 1
    fi

    # Validate syntax
    if ! docker compose -f "$compose_file" config > /dev/null 2>&1; then
        log_error "docker-compose.yml has syntax errors"
        docker compose -f "$compose_file" config 2>&1 | head -n 20
        return 1
    fi

    log_info "✓ docker-compose.yml is valid"

    # Count services
    service_count=$(docker compose -f "$compose_file" config --services | wc -l | tr -d ' ')
    log_info "  Services defined: $service_count"

    return 0
}

run_security_scan() {
    log_step "Running security scans..."

    if [ "${SKIP_SECURITY_SCAN:-0}" = "1" ]; then
        log_warn "Security scanning skipped (SKIP_SECURITY_SCAN=1)"
        return 0
    fi

    local scan_script="$SCRIPT_DIR/trivy-scan.sh"

    if [ ! -f "$scan_script" ]; then
        log_warn "Trivy scan script not found at: $scan_script"
        log_warn "Skipping security scan"
        return 0
    fi

    if ! command -v trivy &> /dev/null; then
        log_warn "Trivy not installed. Skipping security scan"
        log_info "Install Trivy for vulnerability scanning: https://aquasecurity.github.io/trivy/"
        return 0
    fi

    # Run Trivy scan
    if ! bash "$scan_script" all; then
        log_error "Security scan failed"
        log_info "Fix vulnerabilities or set SKIP_SECURITY_SCAN=1 to bypass (not recommended)"
        return 1
    fi

    log_info "✓ Security scan passed"
    return 0
}

check_disk_space() {
    log_step "Checking disk space..."

    # Get available disk space in GB
    local available_gb
    if [[ "$OSTYPE" == "darwin"* ]]; then
        # macOS
        available_gb=$(df -g . | awk 'NR==2 {print $4}')
    else
        # Linux
        available_gb=$(df -BG . | awk 'NR==2 {print $4}' | sed 's/G//')
    fi

    local min_required_gb=5

    if [ "$available_gb" -lt "$min_required_gb" ]; then
        log_warn "Low disk space: ${available_gb}GB available (${min_required_gb}GB recommended)"
    else
        log_info "✓ Sufficient disk space: ${available_gb}GB available"
    fi

    return 0
}

#===============================================================================
# Main
#===============================================================================

main() {
    local failed=0

    print_header

    # Run all checks
    check_docker_daemon || ((failed++))
    echo ""

    check_docker_compose_version || ((failed++))
    echo ""

    validate_compose_file || ((failed++))
    echo ""

    check_disk_space || ((failed++))
    echo ""

    run_security_scan || ((failed++))
    echo ""

    # Summary
    echo "==============================================================================="
    if [ $failed -eq 0 ]; then
        log_info "All pre-flight checks passed ✓"
        echo "==============================================================================="
        echo ""
        log_info "Ready to deploy! Run:"
        echo "  cd $INFRA_DIR"
        echo "  docker compose up -d"
        echo ""
        exit 0
    else
        log_error "Pre-flight checks failed: $failed check(s) failed"
        echo "==============================================================================="
        echo ""
        log_error "Fix the issues above before deploying"
        exit 1
    fi
}

main "$@"
