#!/usr/bin/env bash
#===============================================================================
# trivy-scan.sh - Docker Image Vulnerability Scanner
#===============================================================================
# Scans QuantPlatform Docker images for vulnerabilities using Trivy.
# Exits with failure if HIGH or CRITICAL vulnerabilities are found.
#
# Usage:
#   ./trivy-scan.sh [image_name|all]
#
# Examples:
#   ./trivy-scan.sh gateway        # Scan only gateway image
#   ./trivy-scan.sh all            # Scan all custom images
#   ./trivy-scan.sh                # Same as 'all'
#
# Environment Variables:
#   TRIVY_SEVERITY - Severity levels to scan for (default: HIGH,CRITICAL)
#   SKIP_SECURITY_SCAN - Skip scanning if set to 1
#===============================================================================

set -euo pipefail

# Configuration
SEVERITY="${TRIVY_SEVERITY:-HIGH,CRITICAL}"
REPORT_DIR="security-reports"
TIMESTAMP=$(date +%Y%m%d_%H%M%S)

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

# Image definitions
declare -A IMAGES=(
    ["gateway"]="quant-platform-gateway:latest"
    ["ai-engine"]="quant-platform-ai:latest"
    ["ui"]="quant-platform-ui:latest"
)

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

check_trivy() {
    if ! command -v trivy &> /dev/null; then
        log_error "Trivy is not installed. Install it from https://aquasecurity.github.io/trivy/"
        exit 1
    fi
}

check_docker() {
    if ! docker info &> /dev/null; then
        log_error "Docker daemon is not running"
        exit 1
    fi
}

create_report_dir() {
    mkdir -p "$REPORT_DIR"
    log_info "Reports will be saved to: $REPORT_DIR/"
}

scan_image() {
    local name=$1
    local image=$2
    local report_file="$REPORT_DIR/trivy-${name}-${TIMESTAMP}.json"
    local html_report="$REPORT_DIR/trivy-${name}-${TIMESTAMP}.html"

    log_info "Scanning ${image}..."

    # Check if image exists
    if ! docker image inspect "$image" &> /dev/null; then
        log_warn "Image ${image} not found. Skipping."
        return 0
    fi

    # Run Trivy scan with both JSON and table output
    local exit_code=0
    trivy image \
        --severity "$SEVERITY" \
        --ignore-unfixed \
        --timeout 10m \
        --format json \
        --output "$report_file" \
        "$image" || exit_code=$?

    # Generate HTML report
    trivy image \
        --severity "$SEVERITY" \
        --ignore-unfixed \
        --timeout 10m \
        --format template \
        --template "@contrib/html.tpl" \
        --output "$html_report" \
        "$image" || true

    # Show summary
    trivy image \
        --severity "$SEVERITY" \
        --ignore-unfixed \
        --timeout 10m \
        "$image" || true

    if [ $exit_code -eq 0 ]; then
        log_info "✓ ${name}: No vulnerabilities found"
    else
        log_error "✗ ${name}: Vulnerabilities detected"
        log_info "  JSON report: $report_file"
        log_info "  HTML report: $html_report"
    fi

    return $exit_code
}

#===============================================================================
# Main
#===============================================================================

main() {
    local target="${1:-all}"
    local failed=0
    local total=0

    # Check for skip flag
    if [ "${SKIP_SECURITY_SCAN:-0}" = "1" ]; then
        log_warn "Security scanning skipped (SKIP_SECURITY_SCAN=1)"
        exit 0
    fi

    log_info "QuantPlatform Docker Security Scanner"
    log_info "Severity levels: $SEVERITY"
    echo ""

    # Prerequisites
    check_trivy
    check_docker
    create_report_dir

    echo ""

    # Scan images
    if [ "$target" = "all" ]; then
        log_info "Scanning all QuantPlatform images..."
        echo ""

        for name in "${!IMAGES[@]}"; do
            image="${IMAGES[$name]}"
            ((total++))

            if ! scan_image "$name" "$image"; then
                ((failed++))
            fi
            echo ""
        done
    else
        # Scan single image
        if [ -z "${IMAGES[$target]:-}" ]; then
            log_error "Unknown image: $target"
            log_info "Available images: ${!IMAGES[*]}"
            exit 1
        fi

        ((total++))
        if ! scan_image "$target" "${IMAGES[$target]}"; then
            ((failed++))
        fi
    fi

    # Summary
    echo "==============================================================================="
    log_info "Scan Summary"
    echo "  Total images scanned: $total"
    echo "  Passed: $((total - failed))"
    echo "  Failed: $failed"
    echo "==============================================================================="

    if [ $failed -gt 0 ]; then
        log_error "Security scan failed: $failed image(s) have vulnerabilities"
        log_info "Review reports in: $REPORT_DIR/"
        exit 1
    else
        log_info "All images passed security scan"
        exit 0
    fi
}

main "$@"
