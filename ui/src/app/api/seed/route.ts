import { devConsole } from "@/lib/devLog";
import { NextResponse, NextRequest } from 'next/server';
import fs from 'fs';
import path from 'path';
import { generateStrategyWatchlist } from '@/services/geminiService';
import { LANDING_DEMO_PROMPTS, normalizeLandingDemoPrompt } from '@/lib/landingDemoCache';

export const dynamic = 'force-dynamic';
export const maxDuration = 300;

export async function GET(request: NextRequest) {
    const filePath = path.join(process.cwd(), 'src/lib/landingDemoSeed.json');
    let results: Record<string, any> = {};

    if (fs.existsSync(filePath)) {
        results = JSON.parse(fs.readFileSync(filePath, 'utf-8'));
    }

    let updatedCount = 0;

    for (const prompt of LANDING_DEMO_PROMPTS) {
        const normalized = normalizeLandingDemoPrompt(prompt);
        // If it already exists and has tickers, skip to avoid rate limits
        if (results[normalized] && results[normalized].tickers && results[normalized].tickers.length > 0) {
            devConsole.log(`Skipping already generated: ${prompt}`);
            continue;
        }

        devConsole.log(`Generating seed for: ${prompt}`);

        // retry logic due to Groq/LLama rate limits
        let res = await generateStrategyWatchlist(prompt, { deepResearch: false });
        let retries = 3;
        while (!res.ok && retries > 0) {
            devConsole.log(`Retrying ${prompt}... (${retries} retries left)`);
            await new Promise(r => setTimeout(r, 6000));
            res = await generateStrategyWatchlist(prompt, { deepResearch: false });
            retries--;
        }

        if (res.ok) {
            const data = res.data;

            let insights: string[] = [];
            if (data.reasoning) {
                insights = data.reasoning.split('\n').filter(l => l.trim().length > 0).slice(0, 5);
            }

            results[normalized] = {
                prompt,
                watchlistName: data.watchlistName || "Strategy Portfolio",
                summary: data.narrative || "Synthesis unavailable.",
                insights,
                keyStats: { sp500_change: 0.62, nasdaq_change: 1.08, dow_change: 0.21, vix: 17.4 },
                savedAt: new Date().toISOString(),
                source: "seed",
                reasoning: data.reasoning,
                model: data.model,
                tickers: data.tickers,
                tickerExplanations: data.tickerExplanations,
            };
            updatedCount++;
            devConsole.log(`Success for: ${prompt}`);

            // Save incrementally in case of crash
            fs.writeFileSync(filePath, JSON.stringify(results, null, 2));
        } else {
            devConsole.error(`Failed to generate: ${prompt} - ${res.error}`);
        }

        await new Promise(r => setTimeout(r, 2000)); // Rate limit pause
    }

    return NextResponse.json({ success: true, updated: updatedCount, total: Object.keys(results).length });
}
