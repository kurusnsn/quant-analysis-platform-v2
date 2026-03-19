import Link from 'next/link';
import React, { useState } from 'react';
import { Watchlist } from '../types';
import { useCompanyLogos } from '../hooks/useCompanyLogos';
import { useStockPrices } from '../hooks/useStockPrices';
import { useTickerSearch } from '../hooks/useTickerSearch';

interface Props {
    isOpen: boolean;
    onClose: () => void;
    watchlist: Watchlist | null;
    onSave: (name: string, tickers: string[]) => void;
    onDelete: (id: string) => void;
}

export const EditWatchlistModal: React.FC<Props> = ({ isOpen, onClose, watchlist, onSave, onDelete }) => {
    type StockProfileLogoSource = {
        website?: string | null;
        homepageUrl?: string | null;
        homepage_url?: string | null;
    };

    const parseDomain = (urlOrDomain?: string | null): string | null => {
        if (!urlOrDomain) return null;
        const value = urlOrDomain.trim();
        if (!value) return null;

        try {
            const withProtocol = /^https?:\/\//i.test(value) ? value : `https://${value}`;
            return new URL(withProtocol).hostname.replace(/^www\./i, "") || null;
        } catch {
            return null;
        }
    };

    const placeholderText = 'Enter watchlist name...';
    const [name, setName] = useState(watchlist?.name || '');
    const [tickers, setTickers] = useState<string[]>(watchlist?.tickers.map(t => t.symbol) || []);
    const [draggedIndex, setDraggedIndex] = useState<number | null>(null);
    const [dragOverIndex, setDragOverIndex] = useState<number | null>(null);
    const [newTicker, setNewTicker] = useState('');
    const [tickerError, setTickerError] = useState<string | null>(null);
    const [animatedPlaceholder, setAnimatedPlaceholder] = useState(placeholderText);
    const [showResults, setShowResults] = useState(false);
    const [logoLoadErrors, setLogoLoadErrors] = useState<Record<string, boolean>>({});
    const [logoFallbacks, setLogoFallbacks] = useState<Record<string, string>>({});
    const [logoFallbackAttempts, setLogoFallbackAttempts] = useState<Record<string, boolean>>({});

    const { query, setQuery, results, loading: searchLoading } = useTickerSearch();

    // Fetch logos for all tickers in the modal
    const { getLogo } = useCompanyLogos(tickers);
    const { getLatestPrice, prices, loading: pricesLoading } = useStockPrices();

    // Update state when watchlist changes
    React.useEffect(() => {
        if (watchlist) {
            setName(watchlist.name);
            setTickers(watchlist.tickers.map(t => t.symbol));
        } else {
            setName('');
            setTickers([]);
        }
        setLogoLoadErrors({});
        setLogoFallbacks({});
        setLogoFallbackAttempts({});
    }, [watchlist, isOpen]);

    React.useEffect(() => {
        if (!isOpen) return;

        if (watchlist || name.trim()) {
            setAnimatedPlaceholder(placeholderText);
            return;
        }

        let index = 0;
        let timeoutId: ReturnType<typeof setTimeout> | null = null;
        let cancelled = false;

        const typeNext = () => {
            if (cancelled) return;
            setAnimatedPlaceholder(placeholderText.slice(0, index));

            if (index < placeholderText.length) {
                index += 1;
                timeoutId = setTimeout(typeNext, 60);
            } else {
                timeoutId = setTimeout(() => {
                    index = 0;
                    typeNext();
                }, 1200);
            }
        };

        typeNext();

        return () => {
            cancelled = true;
            if (timeoutId) clearTimeout(timeoutId);
        };
    }, [isOpen, name, watchlist, placeholderText]);


    if (!isOpen) return null;

    const handleSave = () => {
        onSave(name, tickers);
        onClose();
    };

    const removeTicker = (symbol: string) => {
        setTickers(prev => prev.filter(s => s !== symbol));
    };

    const resolveFallbackLogo = async (symbol: string): Promise<string | null> => {
        try {
            const response = await fetch(`/api/stocks/${encodeURIComponent(symbol)}/profile`, { cache: "no-store" });
            if (!response.ok) return null;

            const profile = (await response.json()) as StockProfileLogoSource;
            const domain = parseDomain(profile.website ?? profile.homepageUrl ?? profile.homepage_url ?? null);
            if (!domain) return null;

            return `https://www.google.com/s2/favicons?domain=${encodeURIComponent(domain)}&sz=128`;
        } catch {
            return null;
        }
    };

    const handleLogoError = (symbol: string, currentSrc: string | null) => {
        const normalized = symbol.toUpperCase();
        const alreadyTriedFallback = logoFallbackAttempts[normalized] === true;
        const currentFallback = logoFallbacks[normalized];

        if (alreadyTriedFallback || (currentFallback && currentSrc === currentFallback)) {
            setLogoLoadErrors((prev) => ({ ...prev, [normalized]: true }));
            return;
        }

        setLogoFallbackAttempts((prev) => ({ ...prev, [normalized]: true }));

        void (async () => {
            const fallback = await resolveFallbackLogo(normalized);
            if (!fallback) {
                setLogoLoadErrors((prev) => ({ ...prev, [normalized]: true }));
                return;
            }

            setLogoFallbacks((prev) => ({ ...prev, [normalized]: fallback }));
            setLogoLoadErrors((prev) => ({ ...prev, [normalized]: false }));
        })();
    };

    // Add ticker with input
    const addTicker = (symbolOverride?: string) => {
        const symbol = (symbolOverride || newTicker).trim().toUpperCase();
        if (!symbol) return;

        if (tickers.includes(symbol)) {
            setTickerError(`${symbol} is already in this watchlist.`);
            return;
        }

        setTickers([...tickers, symbol]);
        setNewTicker('');
        setQuery('');
        setShowResults(false);
        setTickerError(null);
    };

    // Drag and drop handlers
    const handleDragStart = (e: React.DragEvent, index: number) => {
        setDraggedIndex(index);
        e.dataTransfer.effectAllowed = 'move';
        e.dataTransfer.setData('text/plain', index.toString());
        // Add some styling to dragged element
        if (e.currentTarget instanceof HTMLElement) {
            e.currentTarget.style.opacity = '0.5';
        }
    };

    const handleDragEnd = (e: React.DragEvent) => {
        setDraggedIndex(null);
        setDragOverIndex(null);
        if (e.currentTarget instanceof HTMLElement) {
            e.currentTarget.style.opacity = '1';
        }
    };

    const handleDragOver = (e: React.DragEvent, index: number) => {
        e.preventDefault();
        e.dataTransfer.dropEffect = 'move';
        setDragOverIndex(index);
    };

    const handleDragLeave = () => {
        setDragOverIndex(null);
    };

    const handleDrop = (e: React.DragEvent, dropIndex: number) => {
        e.preventDefault();
        const dragIndex = draggedIndex;

        if (dragIndex === null || dragIndex === dropIndex) {
            setDragOverIndex(null);
            return;
        }

        // Reorder the tickers
        const newTickers = [...tickers];
        const [removed] = newTickers.splice(dragIndex, 1);
        newTickers.splice(dropIndex, 0, removed);
        setTickers(newTickers);

        setDraggedIndex(null);
        setDragOverIndex(null);
    };

    return (
        <div className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center z-[150] p-4 animate-in fade-in duration-300 font-mono">
            <div className="bg-modal-bg w-full max-w-[560px] rounded-xl shadow-2xl border border-sentinel-border flex flex-col overflow-hidden max-h-[90vh]">
                {/* Header Section */}
                <div className="px-6 pt-8 pb-4 text-left">
                    <div className="flex flex-col gap-1.5 relative">
                        {watchlist && (
                            <Link
                                href={`/watchlist/${watchlist.id}`}
                                onClick={onClose}
                                className="absolute right-0 top-0 text-[10px] font-bold bg-primary/10 text-primary border border-primary/20 px-3 py-1.5 rounded-lg flex items-center gap-1.5 hover:bg-primary/20 transition-all uppercase tracking-widest"
                            >
                                <span className="material-symbols-outlined !text-sm">analytics</span>
                                View Analysis
                            </Link>
                        )}
                        <label className="text-xs font-semibold uppercase tracking-wider text-sentinel-muted px-1">Watchlist Name</label>
                        <input
                            className="w-full bg-transparent border-none text-foreground text-2xl font-bold p-1 focus:ring-0 focus:outline-none placeholder:text-sentinel-muted"
                            placeholder={animatedPlaceholder}
                            type="text"
                            maxLength={120}
                            value={name}
                            onChange={(e) => setName(e.target.value)}
                        />
                        <div className="h-[1px] w-full bg-sentinel-border mt-1"></div>
                    </div>
                </div>

                {/* Scrollable Stock List */}
                <div className="flex-1 overflow-y-auto px-2 py-2 custom-scrollbar">
                    {tickers.map((symbol, index) => {
                        const normalizedSymbol = symbol.toUpperCase();
                        const logoUrl = logoFallbacks[normalizedSymbol] ?? getLogo(normalizedSymbol);
                        const hasLogoError = logoLoadErrors[normalizedSymbol] === true;
                        const price = getLatestPrice(normalizedSymbol);
                        return (
                            <div
                                key={symbol}
                                draggable
                                onDragStart={(e) => handleDragStart(e, index)}
                                onDragEnd={handleDragEnd}
                                onDragOver={(e) => handleDragOver(e, index)}
                                onDragLeave={handleDragLeave}
                                onDrop={(e) => handleDrop(e, index)}
                                className={`group flex items-center gap-2 px-4 py-3 rounded-lg hover:bg-white/5 transition-all border-2 border-transparent ${dragOverIndex === index ? 'border-neon-green/50 bg-neon-green/5' : ''
                                    } ${draggedIndex === index ? 'opacity-30 grayscale' : ''}`}
                            >
                                <div className="text-sentinel-muted cursor-grab active:cursor-grabbing hover:text-foreground transition-colors select-none p-1">
                                    <span className="material-symbols-outlined">drag_indicator</span>
                                </div>
                                <div className="flex items-center gap-4 flex-1">
                                    <div className="flex items-center justify-center rounded-lg bg-card-item shrink-0 size-11 border border-sentinel-border overflow-hidden">
                                        {logoUrl && !hasLogoError ? (
                                            <img
                                                src={logoUrl}
                                                alt={`${normalizedSymbol} logo`}
                                                className="w-full h-full object-cover bg-white"
                                                onError={() => {
                                                    handleLogoError(normalizedSymbol, logoUrl);
                                                }}
                                            />
                                        ) : (
                                            <span className="material-symbols-outlined text-neon-green">monitoring</span>
                                        )}
                                    </div>
                                    <div className="flex flex-col justify-center text-left flex-1">
                                        <p className="text-foreground text-base font-semibold leading-none mb-1">{normalizedSymbol}</p>
                                        <p className="text-sentinel-muted text-xs font-normal leading-normal line-clamp-1 font-mono">
                                            {price ? `$${price.close.toFixed(2)}` : 'No price data'}
                                        </p>
                                    </div>
                                </div>
                                <button
                                    onClick={() => removeTicker(symbol)}
                                    className="text-sentinel-muted hover:text-neon-red p-2 transition-colors"
                                >
                                    <span className="material-symbols-outlined">delete</span>
                                </button>
                            </div>
                        );
                    })}

                    {/* Add Ticker Input */}
                    <div className="mt-4 mx-4 relative">
                        <div className="flex gap-2">
                            <div className="flex-1 relative">
                                <input
                                    className="w-full bg-sentinel-bg border border-sentinel-border rounded-2xl px-4 py-3 text-foreground placeholder:text-sentinel-muted focus:outline-none focus:border-neon-green focus:shadow-[0_0_10px_rgba(0,255,65,0.1)] transition-all"
                                    placeholder="Search tickers (e.g., Apple, NVDA)"
                                    type="text"
                                    maxLength={32}
                                    value={newTicker}
                                    onChange={(e) => {
                                        const val = e.target.value;
                                        setNewTicker(val);
                                        setQuery(val);
                                        setShowResults(true);
                                        setTickerError(null);
                                    }}
                                    onBlur={() => {
                                        // Delay hiding to allow clicking results
                                        setTimeout(() => setShowResults(false), 200);
                                    }}
                                    onFocus={() => {
                                        if (results.length > 0) setShowResults(true);
                                    }}
                                    onKeyDown={(e) => {
                                        if (e.key === 'Enter') {
                                            e.preventDefault();
                                            addTicker();
                                        }
                                        if (e.key === 'Escape') {
                                            setShowResults(false);
                                        }
                                    }}
                                />
                                {searchLoading && (
                                    <div className="absolute right-3 top-1/2 -translate-y-1/2">
                                        <div className="w-4 h-4 border-2 border-neon-green/30 border-t-neon-green rounded-full animate-spin"></div>
                                    </div>
                                )}
                            </div>
                            <button
                                onClick={() => addTicker()}
                                className="px-3 py-2 rounded-lg bg-neon-green hover:bg-neon-green/90 text-white transition-all flex items-center gap-1.5 font-bold shrink-0 text-sm"
                            >
                                <span className="material-symbols-outlined text-base">add</span>
                            </button>
                        </div>

                        {/* Search Results Dropdown */}
                        {showResults && results.length > 0 && (
                            <div className="absolute left-0 right-0 top-full mt-2 bg-[#0A0A0A] border border-sentinel-border rounded-xl shadow-2xl z-[160] overflow-hidden max-h-[300px] overflow-y-auto animate-in fade-in slide-in-from-top-2 duration-200">
                                {results.map((result) => (
                                    <button
                                        key={result.ticker}
                                        onClick={() => addTicker(result.ticker)}
                                        className="w-full flex items-center gap-3 px-4 py-3 hover:bg-white/5 transition-colors text-left border-b border-white/[0.03] last:border-0"
                                    >
                                        <div className="size-8 rounded bg-white/5 flex items-center justify-center shrink-0 border border-white/10 font-bold text-xs">
                                            {result.ticker.slice(0, 1)}
                                        </div>
                                        <div className="flex-1 min-w-0">
                                            <div className="flex items-center gap-2">
                                                <span className="text-foreground font-bold">{result.ticker}</span>
                                                <span className="text-[10px] text-sentinel-muted px-1 border border-white/10 rounded uppercase">{result.primary_exchange}</span>
                                            </div>
                                            <div className="text-sentinel-muted text-xs truncate">{result.name}</div>
                                        </div>
                                        <span className="material-symbols-outlined text-sentinel-muted text-sm scale-75">add_circle</span>
                                    </button>
                                ))}
                            </div>
                        )}

                        {tickerError && (
                            <div className="mt-2 text-xs text-neon-red px-1 flex items-center gap-1">
                                <span className="material-symbols-outlined text-xs">error</span>
                                {tickerError}
                            </div>
                        )}
                    </div>
                </div>

                {/* Footer Section */}
                <div className="px-6 py-6 mt-2 border-t border-sentinel-border bg-background-dark/30 flex items-center justify-between">
                    <button
                        onClick={() => { if (watchlist) onDelete(watchlist.id); onClose(); }}
                        className="text-neon-red hover:text-neon-red/80 flex items-center gap-1.5 transition-colors text-sm font-medium uppercase tracking-wide"
                    >
                        <span className="material-symbols-outlined text-lg">delete_forever</span>
                        Delete Watchlist
                    </button>
                    <div className="flex items-center gap-3">
                        {watchlist && (
                            <Link
                                href={`/watchlist/${watchlist.id}`}
                                onClick={onClose}
                                className="px-4 py-2 rounded-lg border border-sentinel-border text-foreground/80 hover:bg-white/5 transition-colors text-xs font-medium uppercase tracking-wide"
                            >
                                View Watchlist
                            </Link>
                        )}
                        <button
                            onClick={onClose}
                            className="px-4 py-2 rounded-lg text-sentinel-muted hover:bg-white/5 transition-colors text-xs font-medium uppercase tracking-wide"
                        >
                            Cancel
                        </button>
                        <button
                            onClick={handleSave}
                            className="px-5 py-2 rounded-lg bg-neon-green hover:bg-neon-green/90 text-white transition-all shadow-[0_0_10px_rgba(0,255,65,0.3)] text-xs font-bold uppercase tracking-wide"
                        >
                            Save Changes
                        </button>
                    </div>
                </div>
            </div>
        </div>
    );
};
