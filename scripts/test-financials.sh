#!/usr/bin/env bash
#===============================================================================
# test-financials.sh - Test stock financials endpoint
#===============================================================================

set -euo pipefail

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m'

GATEWAY_URL="${GATEWAY_URL:-http://localhost:8000}"
AI_ENGINE_URL="${AI_ENGINE_URL:-http://localhost:5000}"

echo "Testing QuantPlatform Financials Endpoint"
echo "===================================="
echo ""

# Test AI Engine directly
echo -e "${YELLOW}1. Testing AI Engine directly...${NC}"
if curl -s "${AI_ENGINE_URL}/financials/AAPL" | jq -e '.ticker' > /dev/null 2>&1; then
    echo -e "${GREEN}✓ AI Engine financials endpoint works${NC}"
    echo "Sample data:"
    curl -s "${AI_ENGINE_URL}/financials/AAPL" | jq '{ticker, currency, company_name, has_income: (.statements.income_statement.annual.rows | length > 0)}'
else
    echo -e "${RED}✗ AI Engine financials endpoint failed${NC}"
    echo "Error:"
    curl -s "${AI_ENGINE_URL}/financials/AAPL" || echo "Connection failed"
fi

echo ""

# Test Gateway
echo -e "${YELLOW}2. Testing Gateway proxy...${NC}"
if curl -s "${GATEWAY_URL}/api/stocks/AAPL/financials" | jq -e '.ticker' > /dev/null 2>&1; then
    echo -e "${GREEN}✓ Gateway financials endpoint works${NC}"
    echo "Sample data:"
    curl -s "${GATEWAY_URL}/api/stocks/AAPL/financials" | jq '{ticker, currency, company_name, has_income: (.statements.income_statement.annual.rows | length > 0)}'
else
    echo -e "${RED}✗ Gateway financials endpoint failed${NC}"
    echo "Error:"
    curl -s "${GATEWAY_URL}/api/stocks/AAPL/financials" || echo "Connection failed"
fi

echo ""
echo "===================================="
echo ""

# Test multiple tickers
echo -e "${YELLOW}3. Testing multiple tickers...${NC}"
for ticker in AAPL TSLA MSFT GOOGL; do
    if curl -s "${GATEWAY_URL}/api/stocks/${ticker}/financials" | jq -e '.ticker' > /dev/null 2>&1; then
        echo -e "${GREEN}✓${NC} $ticker"
    else
        echo -e "${RED}✗${NC} $ticker"
    fi
done

echo ""
echo "Testing complete!"
