/**
 * Trigger backend ticker cache refresh
 * Periodically fetches all US tickers from Polygon and updates the local DB cache.
 * 
 * Usage:
 *   node scripts/refresh-ticker-cache.js
 */

const fetch = require('node-fetch');
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });

const GATEWAY_URL = process.env.API_URL || 'http://localhost:5271';
const INTERNAL_SECRET = process.env.INTERNAL_API_SECRET;

async function refreshCache() {
    console.log('🔄 Triggering ticker cache refresh...');

    if (!INTERNAL_SECRET) {
        console.error('❌ INTERNAL_API_SECRET not set in .env');
        process.exit(1);
    }

    try {
        const response = await fetch(`${GATEWAY_URL}/api/tickers/refresh`, {
            method: 'POST',
            headers: {
                'X-Internal-Refresh-Token': INTERNAL_SECRET
            }
        });

        if (response.ok) {
            const data = await response.json();
            console.log(`✅ Cache refreshed! Total tickers: ${data.total}`);
        } else {
            console.error(`❌ Refresh failed: ${response.status} ${response.statusText}`);
            const errorText = await response.text();
            console.error(errorText);
        }
    } catch (error) {
        console.error('❌ Exception during refresh:', error.message);
    }
}

refreshCache();
