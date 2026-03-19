import { test, expect } from '@playwright/test';

test.describe('Watchlist Analysis Flow', () => {
    test('should allow a user to create and analyze a watchlist', async ({ page }) => {
        // 1. Navigate to the app
        await page.goto('/');

        // 2. Go to Analyze section (it's on the main page)
        // No need to goto('/analyze') as it doesn't exist

        // 3. Enter Strategy Prompt
        const tickerInput = page.getByLabel('Watchlist Generator');
        await tickerInput.fill('High volatility technology stocks for 2024');

        // 4. Trigger Analysis
        const analyzeButton = page.locator('button:has-text("Generate")');
        await analyzeButton.click();

        // 5. Wait for results
        // We expect a loading state then a report summary
        await expect(page.locator('text=Synthesis Report')).toBeVisible({ timeout: 30000 });

        // 6. Verify core markers appear
        await expect(page.locator('text=Structural Risk')).toBeVisible();

        // 7. Capture screenshot of the report
        await page.screenshot({ path: 'tests/e2e/screenshots/watchlist-report.png' });
    });

    test('should show initial state correctly', async ({ page }) => {
        await page.goto('/');
        await expect(page.locator('text=Watchlist Generator')).toBeVisible();
    });
});
