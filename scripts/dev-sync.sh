#!/bin/bash
# QuantPlatform Dev Sync Script
# Watches local UI files and auto-syncs to Hetzner VM for hot reload development
#
# Usage: ./scripts/dev-sync.sh
# Prerequisites: brew install fswatch

set -e

REMOTE_HOST="root@46.224.4.132"
LOCAL_UI="$(dirname "$0")/../ui"
REMOTE_UI="/root/quant-platform-dev/ui"

# Colors for output
GREEN='\033[0;32m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

echo -e "${BLUE}🔄 QuantPlatform Dev Sync${NC}"
echo "   Local:  $LOCAL_UI"
echo "   Remote: $REMOTE_HOST:$REMOTE_UI"
echo ""

# Check if fswatch is installed
if ! command -v fswatch &> /dev/null; then
    echo "❌ fswatch not found. Install with: brew install fswatch"
    exit 1
fi

# Initial sync
echo -e "${BLUE}📤 Initial sync...${NC}"
rsync -avz --exclude='node_modules' --exclude='.next' --exclude='.git' \
    "$LOCAL_UI/" "$REMOTE_HOST:$REMOTE_UI/"
echo -e "${GREEN}✅ Initial sync complete${NC}"
echo ""

# Watch for changes
echo -e "${BLUE}👀 Watching for changes... (Ctrl+C to stop)${NC}"
fswatch -o "$LOCAL_UI/src" "$LOCAL_UI/public" | while read num; do
    echo -e "${BLUE}📤 Change detected, syncing...${NC}"
    rsync -avz --exclude='node_modules' --exclude='.next' --exclude='.git' \
        "$LOCAL_UI/" "$REMOTE_HOST:$REMOTE_UI/" 2>/dev/null
    echo -e "${GREEN}✅ Synced at $(date +%H:%M:%S)${NC}"
done
