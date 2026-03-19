"use client";
import { devConsole } from "@/lib/devLog";

import { useState, useEffect, useCallback } from "react";
import { searchTickers, TickerSearchResult } from "../services/massiveService";

export function useTickerSearch() {
    const [query, setQuery] = useState("");
    const [results, setResults] = useState<TickerSearchResult[]>([]);
    const [loading, setLoading] = useState(false);

    useEffect(() => {
        if (query.trim().length < 1) {
            setResults([]);
            return;
        }

        const timer = setTimeout(async () => {
            setLoading(true);
            try {
                const data = await searchTickers(query);
                setResults(data);
            } catch (error) {
                devConsole.error("Search error:", error);
            } finally {
                setLoading(false);
            }
        }, 300); // 300ms debounce

        return () => clearTimeout(timer);
    }, [query]);

    return {
        query,
        setQuery,
        results,
        loading,
    };
}
