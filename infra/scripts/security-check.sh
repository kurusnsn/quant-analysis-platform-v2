#!/usr/bin/env bash
#===============================================================================
# security-check.sh - Comprehensive Security Validation
#===============================================================================
# One-stop security validation for QuantPlatform Docker infrastructure.
#
# Validates:
#   1. Trivy scans - Vulnerability detection
#   2. Read-only containers - Immutable filesystems
#   3. Network isolation - Segmentation testing
#   4. Security configurations - Non-root users, capabilities
#
# Usage:
#   ./security-check.sh [--full|--quick]
#
# Options:
#   --full   - Run all checks including time-consuming Trivy scans
#   --quick  - Skip Trivy scans (default)
#
# Environment Variables:
#   SKIP_SECURITY_SCAN - Skip Trivy scanning if set to 1
#===============================================================================

set -euo pipefail

# Configuration
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
MODE="${1:-quick}"

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
CYAN='\033[0;36m'
NC='\033[0m' # No Color

# Counters
CHECKS_PASSED=0
CHECKS_FAILED=0
CHECKS_WARNED=0

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

log_section() {
    echo ""
    echo -e "${CYAN}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
    echo -e "${CYAN}  $1${NC}"
    echo -e "${CYAN}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
    echo ""
}

check_pass() {
    echo -e "  ${GREEN}✓ PASS${NC} - $1"
    ((CHECKS_PASSED++))
}

check_fail() {
    echo -e "  ${RED}✗ FAIL${NC} - $1"
    ((CHECKS_FAILED++))
}

check_warning() {
    echo -e "  ${YELLOW}⚠ WARN${NC} - $1"
    ((CHECKS_WARNED++))
}

print_header() {
    echo "==============================================================================="
    echo "  QuantPlatform Security Check"
    echo "  Mode: $MODE"
    echo "==============================================================================="
    echo ""
}

#===============================================================================
# Security Checks
#===============================================================================

check_vulnerability_scanning() {
    log_section "1. Vulnerability Scanning (Trivy)"

    if [ "$MODE" = "quick" ]; then
        log_warn "Skipping Trivy scans in quick mode (use --full for complete scan)"
        check_warning "Trivy scans skipped"
        return 0
    fi

    if [ "${SKIP_SECURITY_SCAN:-0}" = "1" ]; then
        log_warn "Security scanning disabled (SKIP_SECURITY_SCAN=1)"
        check_warning "Trivy scans disabled"
        return 0
    fi

    local trivy_script="$SCRIPT_DIR/trivy-scan.sh"

    if [ ! -f "$trivy_script" ]; then
        log_error "Trivy scan script not found at: $trivy_script"
        check_fail "Trivy script missing"
        return 1
    fi

    if ! command -v trivy &> /dev/null; then
        log_warn "Trivy not installed"
        check_warning "Trivy not available"
        return 0
    fi

    log_info "Running Trivy vulnerability scans..."
    if bash "$trivy_script" all; then
        check_pass "No critical vulnerabilities found"
        return 0
    else
        check_fail "Vulnerabilities detected"
        return 1
    fi
}

check_readonly_containers() {
    log_section "2. Read-only Container Validation"

    local containers=("quant-platform-gateway" "quant-platform-ai" "quant-platform-ui" "quant-platform-nginx")
    local all_readonly=true

    for container in "${containers[@]}"; do
        if ! docker ps --format '{{.Names}}' | grep -q "^${container}$"; then
            log_warn "Container ${container} not running"
            check_warning "${container} not running (cannot verify)"
            continue
        fi

        local is_readonly=$(docker inspect "$container" | jq -r '.[0].HostConfig.ReadonlyRootfs')

        if [ "$is_readonly" = "true" ]; then
            check_pass "${container} has read-only filesystem"
        else
            check_fail "${container} does NOT have read-only filesystem"
            all_readonly=false
        fi
    done

    return 0
}

check_nonroot_users() {
    log_section "3. Non-root User Validation"

    local services=("quant-platform-gateway" "quant-platform-ai" "quant-platform-ui")
    local all_nonroot=true

    for container in "${services[@]}"; do
        if ! docker ps --format '{{.Names}}' | grep -q "^${container}$"; then
            log_warn "Container ${container} not running"
            check_warning "${container} not running (cannot verify)"
            continue
        fi

        local user=$(docker inspect "$container" | jq -r '.[0].Config.User')

        if [ -z "$user" ] || [ "$user" = "root" ] || [ "$user" = "0" ]; then
            check_fail "${container} running as root"
            all_nonroot=false
        else
            check_pass "${container} running as non-root user: ${user:-<default>}"
        fi
    done

    return 0
}

check_security_options() {
    log_section "4. Security Options (no-new-privileges, capabilities)"

    local containers=("quant-platform-gateway" "quant-platform-ai" "quant-platform-ui" "quant-platform-nginx")

    for container in "${containers[@]}"; do
        if ! docker ps --format '{{.Names}}' | grep -q "^${container}$"; then
            log_warn "Container ${container} not running"
            check_warning "${container} not running (cannot verify)"
            continue
        fi

        # Check no-new-privileges
        local sec_opts=$(docker inspect "$container" | jq -r '.[0].HostConfig.SecurityOpt[]' 2>/dev/null | grep -c "no-new-privileges:true" || echo "0")

        if [ "$sec_opts" -gt 0 ]; then
            check_pass "${container} has no-new-privileges enabled"
        else
            check_warning "${container} missing no-new-privileges"
        fi

        # Check capabilities dropped
        local caps_dropped=$(docker inspect "$container" | jq -r '.[0].HostConfig.CapDrop[]' 2>/dev/null | grep -c "ALL" || echo "0")

        if [ "$caps_dropped" -gt 0 ]; then
            check_pass "${container} dropped ALL capabilities"
        else
            check_warning "${container} has not dropped ALL capabilities"
        fi
    done

    return 0
}

check_network_segmentation() {
    log_section "5. Network Segmentation"

    # Check if networks exist
    local networks=("quant-platform-frontend" "quant-platform-backend" "quant-platform-observability")
    local all_exist=true

    for network in "${networks[@]}"; do
        if docker network ls --format '{{.Name}}' | grep -q "^${network}$"; then
            check_pass "Network ${network} exists"
        else
            check_fail "Network ${network} does NOT exist"
            all_exist=false
        fi
    done

    if [ "$all_exist" = false ]; then
        log_error "Network segmentation not configured"
        return 1
    fi

    # Check internal network flag
    local obs_internal=$(docker network inspect quant-platform-observability | jq -r '.[0].Internal')
    if [ "$obs_internal" = "true" ]; then
        check_pass "Observability network is internal-only"
    else
        check_fail "Observability network is NOT internal (security risk)"
    fi

    return 0
}

check_network_isolation() {
    log_section "6. Network Isolation Testing"

    local test_script="$SCRIPT_DIR/test-network-isolation.sh"

    if [ ! -f "$test_script" ]; then
        log_error "Network test script not found at: $test_script"
        check_fail "Network test script missing"
        return 1
    fi

    # Check if containers are running
    if ! docker ps --format '{{.Names}}' | grep -q "quant-platform-gateway"; then
        log_warn "Containers not running - skipping network isolation tests"
        check_warning "Network tests skipped (containers not running)"
        return 0
    fi

    log_info "Running network isolation tests..."
    if bash "$test_script" > /dev/null 2>&1; then
        check_pass "Network isolation verified"
        return 0
    else
        check_fail "Network isolation tests failed"
        log_info "Run: $test_script for details"
        return 1
    fi
}

check_tmpfs_mounts() {
    log_section "7. Tmpfs Mounts (for read-only containers)"

    local containers=("quant-platform-gateway" "quant-platform-ai" "quant-platform-ui" "quant-platform-nginx")

    for container in "${containers[@]}"; do
        if ! docker ps --format '{{.Names}}' | grep -q "^${container}$"; then
            continue
        fi

        local tmpfs_count=$(docker inspect "$container" | jq -r '.[0].HostConfig.Tmpfs | length' 2>/dev/null || echo "0")

        if [ "$tmpfs_count" -gt 0 ]; then
            check_pass "${container} has tmpfs mounts configured"
        else
            check_warning "${container} has no tmpfs mounts (may not need)"
        fi
    done

    return 0
}

#===============================================================================
# Main
#===============================================================================

main() {
    print_header

    # Run all security checks
    check_vulnerability_scanning || true
    check_readonly_containers || true
    check_nonroot_users || true
    check_security_options || true
    check_network_segmentation || true
    check_network_isolation || true
    check_tmpfs_mounts || true

    # Summary
    echo ""
    echo "==============================================================================="
    echo "  Security Check Summary"
    echo "==============================================================================="
    echo ""
    echo "  Total checks:"
    echo -e "    ${GREEN}Passed:  $CHECKS_PASSED${NC}"
    echo -e "    ${RED}Failed:  $CHECKS_FAILED${NC}"
    echo -e "    ${YELLOW}Warnings: $CHECKS_WARNED${NC}"
    echo ""

    if [ $CHECKS_FAILED -eq 0 ]; then
        if [ $CHECKS_WARNED -eq 0 ]; then
            echo -e "${GREEN}✓ All security checks passed with no warnings${NC}"
            echo ""
            exit 0
        else
            echo -e "${YELLOW}⚠ Security checks passed with warnings${NC}"
            echo ""
            log_warn "Review warnings above and address if necessary"
            exit 0
        fi
    else
        echo -e "${RED}✗ Security checks failed${NC}"
        echo ""
        log_error "Fix failed checks before deploying to production"
        echo ""
        exit 1
    fi
}

# Parse arguments
case "${1:-quick}" in
    --full)
        MODE="full"
        ;;
    --quick)
        MODE="quick"
        ;;
    *)
        MODE="quick"
        ;;
esac

main "$@"
