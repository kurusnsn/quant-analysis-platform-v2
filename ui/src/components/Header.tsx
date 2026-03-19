"use client";

import React, { useState, useMemo, useEffect, useRef } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';

import { ThemeToggle } from './ThemeToggle';
import { BrandLogo } from './BrandLogo';
import { useCompanyLogos } from '../hooks/useCompanyLogos';
import { useStockPrices } from '../hooks/useStockPrices';
import { useMarketNews, useStockNews } from '../hooks/useStockNews';
import { useLocalWatchlists } from '../hooks/useLocalWatchlists';
import { MOCK_WATCHLISTS } from '../constants';
import { useSession, signOut as nextAuthSignOut } from 'next-auth/react';
import { getOrCreateDevUser, isDevAuthEnabled, type DevUser } from '../lib/devAuth';

export const Header: React.FC = () => {
    const router = useRouter();
    const [isSearchFocused, setIsSearchFocused] = useState(false);
    const [searchValue, setSearchValue] = useState('');
    const [activeIndex, setActiveIndex] = useState(0);
    const searchInputRef = useRef<HTMLInputElement | null>(null);
    const [placeholderText, setPlaceholderText] = useState('');

    // Typing animation for search placeholder
    useEffect(() => {
        const examples = ['AAPL', 'TSLA', 'NVDA', 'MSFT', 'AMZN', 'GOOGL', 'META', 'JPM', 'V', 'AMD'];
        let exampleIdx = 0;
        let charIdx = 0;
        let isDeleting = false;
        let timeoutId: ReturnType<typeof setTimeout>;

        const prefix = 'Search ';
        const suffix = ', companies, or themes...';

        const tick = () => {
            const word = examples[exampleIdx];
            if (!isDeleting) {
                charIdx++;
                if (charIdx > word.length) {
                    // Pause at full word
                    timeoutId = setTimeout(() => { isDeleting = true; tick(); }, 1800);
                    return;
                }
            } else {
                charIdx--;
                if (charIdx <= 0) {
                    isDeleting = false;
                    exampleIdx = (exampleIdx + 1) % examples.length;
                    timeoutId = setTimeout(tick, 300);
                    return;
                }
            }
            setPlaceholderText(`${prefix}${word.slice(0, charIdx)}${suffix}`);
            timeoutId = setTimeout(tick, isDeleting ? 60 : 100);
        };

        tick();
        return () => clearTimeout(timeoutId);
    }, []);
    const { data: sessionData, status: sessionStatus } = useSession();
    const [devUser, setDevUser] = useState<DevUser | null>(null);
    const [mounted, setMounted] = useState(false);
    const [isUserMenuOpen, setIsUserMenuOpen] = useState(false);
    const userMenuRef = useRef<HTMLDivElement | null>(null);
    const { watchlists, toggleTickerInWatchlist, isInWatchlist } = useLocalWatchlists({ fallback: MOCK_WATCHLISTS });
    const [isSigningOut, setIsSigningOut] = useState(false);

    // Resolve dev auth on mount only to avoid server/client hydration mismatch.
    useEffect(() => {
        setMounted(true);
        if (!isDevAuthEnabled()) {
            setDevUser(null);
            return;
        }
        setDevUser(getOrCreateDevUser());
    }, []);

    // Derive auth state from NextAuth session — gate on mounted to avoid SSR/client hydration mismatch
    const isAuthenticated = mounted && (sessionStatus === 'authenticated' || !!devUser);
    const userDisplayName = sessionData?.user?.name ?? devUser?.displayName ?? (devUser?.email?.split('@')[0]) ?? 'Account';
    const userSecondaryText = sessionData?.user?.email ?? devUser?.email ?? 'Signed in';
    const userAvatarUrl = sessionData?.user?.image ?? null;

    // Fetch logo for current search value (when it looks like a ticker)
    const searchSymbols = useMemo(() => {
        const val = searchValue.trim().toUpperCase();
        return val.length >= 1 && val.length <= 5 && /^[A-Z]+$/.test(val) ? [val] : [];
    }, [searchValue]);
    const { getLogo } = useCompanyLogos(searchSymbols);
    const currentLogo = searchSymbols[0] ? getLogo(searchSymbols[0]) : null;

    // Get price for current search
    const { getLatestPrice, loading: pricesLoading, prices } = useStockPrices();
    const currentPrice = searchSymbols[0] && !pricesLoading ? getLatestPrice(searchSymbols[0]) : null;

    // Get market news
    const { news: marketNews, loading: newsLoading } = useMarketNews(5);

    // Get ticker-specific news when valid ticker is entered
    const validTicker = searchSymbols[0] || '';
    const { news: tickerNews, loading: tickerNewsLoading } = useStockNews(validTicker, 3);

    const tickerNewsCount = validTicker ? tickerNews.length : 0;
    const marketNewsCount = marketNews.length;
    const totalItems = 1 + tickerNewsCount + marketNewsCount;
    const marketNewsStart = 1 + tickerNewsCount;

    const matchedWatchlists = useMemo(() => {
        if (!validTicker) return [];
        return watchlists.filter((watchlist) =>
            watchlist.tickers.some((ticker) => ticker.symbol === validTicker)
        );
    }, [watchlists, validTicker]);

    const userInitials = useMemo(() => {
        const source = userDisplayName || userSecondaryText;
        const compact = source.split('@')[0];
        const parts = compact.split(/[\s._-]+/).filter(Boolean);
        if (parts.length === 0) return 'U';
        if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
        return (parts[0][0] + parts[1][0]).toUpperCase();
    }, [userDisplayName, userSecondaryText]);

    useEffect(() => {
        if (isSearchFocused) {
            queueMicrotask(() => setActiveIndex(0));
        }
    }, [isSearchFocused, searchValue]);

    useEffect(() => {
        if (activeIndex >= totalItems) {
            queueMicrotask(() => setActiveIndex(0));
        }
    }, [activeIndex, totalItems]);

    useEffect(() => {
        const handleGlobalKeydown = (event: KeyboardEvent) => {
            const target = event.target as HTMLElement | null;
            const isEditable = !!target && (
                target.tagName === 'INPUT' ||
                target.tagName === 'TEXTAREA' ||
                target.isContentEditable
            );
            const key = event.key.toLowerCase();

            if ((event.metaKey || event.ctrlKey) && key === 'k') {
                event.preventDefault();
                searchInputRef.current?.focus();
                setIsSearchFocused(true);
                return;
            }

            if (key === '/' && !isEditable && !event.metaKey && !event.ctrlKey && !event.altKey) {
                event.preventDefault();
                searchInputRef.current?.focus();
                setIsSearchFocused(true);
                return;
            }

            if (key === 'escape' && isSearchFocused) {
                setIsSearchFocused(false);
                searchInputRef.current?.blur();
            }
        };

        window.addEventListener('keydown', handleGlobalKeydown);
        return () => window.removeEventListener('keydown', handleGlobalKeydown);
    }, [isSearchFocused]);

    useEffect(() => {
        const handleClickOutside = (event: MouseEvent) => {
            if (!isUserMenuOpen) return;
            const target = event.target as Node | null;
            if (target && userMenuRef.current && !userMenuRef.current.contains(target)) {
                setIsUserMenuOpen(false);
            }
        };

        const handleEscape = (event: KeyboardEvent) => {
            if (event.key === 'Escape') {
                setIsUserMenuOpen(false);
            }
        };

        document.addEventListener('mousedown', handleClickOutside);
        document.addEventListener('keydown', handleEscape);
        return () => {
            document.removeEventListener('mousedown', handleClickOutside);
            document.removeEventListener('keydown', handleEscape);
        };
    }, [isUserMenuOpen]);

    // Session state is now managed by NextAuth's useSession hook above

    const openActiveItem = (index: number) => {
        if (index === 0) {
            const symbol = searchValue.trim().toUpperCase();
            if (symbol) {
                router.push(`/stock/${symbol}`);
                setIsSearchFocused(false);
                searchInputRef.current?.blur();
            }
            return;
        }

        const tickerIndex = index - 1;
        if (validTicker && tickerIndex < tickerNews.length) {
            const article = tickerNews[tickerIndex];
            if (article?.link && typeof window !== 'undefined') {
                window.open(article.link, '_blank', 'noopener,noreferrer');
            }
            return;
        }

        const marketIndex = index - marketNewsStart;
        if (marketIndex >= 0 && marketIndex < marketNews.length) {
            const article = marketNews[marketIndex];
            if (article?.link && typeof window !== 'undefined') {
                window.open(article.link, '_blank', 'noopener,noreferrer');
            }
        }
    };

    const moveActiveIndex = (delta: number) => {
        if (totalItems <= 0) return;
        setActiveIndex((prev) => (prev + delta + totalItems) % totalItems);
    };

    const handleSearchKeyDown = (event: React.KeyboardEvent<HTMLInputElement>) => {
        if (!isSearchFocused) return;

        if (event.key === 'ArrowDown') {
            event.preventDefault();
            moveActiveIndex(1);
            return;
        }

        if (event.key === 'ArrowUp') {
            event.preventDefault();
            moveActiveIndex(-1);
            return;
        }

        if (event.key === 'Enter') {
            event.preventDefault();
            openActiveItem(activeIndex);
            return;
        }

        if (event.key === 'Escape') {
            event.preventDefault();
            setIsSearchFocused(false);
            searchInputRef.current?.blur();
        }
    };

    const handleSignOut = async () => {
        if (isSigningOut) return;
        setIsSigningOut(true);
        setIsUserMenuOpen(false);

        try {
            await nextAuthSignOut({ callbackUrl: '/landing' });
        } finally {
            setIsSigningOut(false);
        }
    };

    return (
        <header className="border-b border-border-color bg-surface sticky top-0 z-50 shadow-md">
            <div className="max-w-[1550px] mx-auto px-6 h-16 flex items-center justify-between">
                {/* Logo */}
                <div className="flex items-center gap-8">
                    <Link href="/home" className="flex items-center gap-3" aria-label="Go to market overview">
                        <BrandLogo height={34} />
                        <span className="hidden sm:inline-block text-[11px] font-bold tracking-[0.32em] text-primary uppercase">
                            QUANT PLATFORM
                        </span>
                    </Link>
                </div>

                {/* Search Input Container */}
                <div className="relative flex-1 max-w-[640px] px-8">
                    <div className="relative group">
                        <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none text-muted group-focus-within:text-primary transition-colors">
                            <span className="material-symbols-outlined !text-[20px]">search</span>
                        </div>
                        <input
                            ref={searchInputRef}
                            className="block w-full h-10 bg-surface border border-border-color rounded-lg pl-10 pr-12 text-sm text-foreground placeholder-muted focus:ring-1 focus:ring-primary focus:border-primary transition-all outline-none"
                            placeholder={placeholderText || "Search tickers, companies, or themes..."}
                            type="text"
                            value={searchValue}
                            onChange={(e) => setSearchValue(e.target.value)}
                            onKeyDown={handleSearchKeyDown}
                            onFocus={() => setIsSearchFocused(true)}
                            onBlur={() => setTimeout(() => setIsSearchFocused(false), 200)}
                        />
                        <div className="absolute inset-y-0 right-0 pr-3 flex items-center pointer-events-none">
                            <kbd className="hidden sm:inline-block px-1.5 py-0.5 text-[10px] font-semibold text-muted bg-background-dark border border-border-color rounded">⌘K</kbd>
                        </div>

                        {/* AUTOCOMPLETE DROPDOWN */}
                        {isSearchFocused && (
                            <div className="absolute top-[calc(100%+8px)] left-0 w-full bg-surface border border-border-color rounded-2xl shadow-2xl overflow-hidden animate-in fade-in slide-in-from-top-2 duration-200">
                                <div className="p-2 space-y-1">
                                    <p className="px-3 py-2 text-[11px] font-semibold text-muted uppercase tracking-wider text-left">Stocks & Equities</p>

                                    {/* Active Item */}
                                    <Link
                                        href={`/stock/${searchValue.toUpperCase()}`}
                                        className={`flex items-center justify-between px-3 py-2.5 rounded-lg border cursor-pointer group/item transition-colors ${activeIndex === 0 ? 'bg-primary/10 border-primary/30' : 'bg-primary/5 border-primary/10 hover:bg-primary/10'}`}
                                        onMouseEnter={() => setActiveIndex(0)}
                                    >
                                        <div className="flex items-center gap-3">
                                            <div className="size-9 rounded bg-white flex items-center justify-center overflow-hidden shrink-0 shadow-sm">
                                                {currentLogo ? (
                                                    <img
                                                        className="w-7 h-7 object-contain"
                                                        src={currentLogo}
                                                        alt={searchValue}
                                                        onError={(e) => {
                                                            (e.target as HTMLImageElement).style.display = 'none';
                                                        }}
                                                    />
                                                ) : (
                                                    <span className="text-xs font-bold text-gray-500">
                                                        {searchValue.slice(0, 2).toUpperCase()}
                                                    </span>
                                                )}
                                            </div>
                                            <div className="flex flex-col text-left">
                                                <div className="flex items-center gap-2">
                                                    <span className="font-bold text-sm text-foreground">{searchValue.toUpperCase()}</span>
                                                    <span className="text-[10px] bg-primary text-white px-1 rounded">MATCH</span>
                                                </div>
                                                <span className="text-xs text-muted">Company Name</span>
                                                {validTicker ? (
                                                    <div className="flex flex-wrap items-center gap-1 mt-1">
                                                        {matchedWatchlists.length > 0 ? (
                                                            <>
                                                                {matchedWatchlists.slice(0, 2).map((watchlist) => (
                                                                    <span
                                                                        key={watchlist.id}
                                                                        className="text-[9px] px-1.5 py-0.5 rounded bg-surface-highlight text-muted"
                                                                    >
                                                                        {watchlist.name}
                                                                    </span>
                                                                ))}
                                                                {matchedWatchlists.length > 2 ? (
                                                                    <span className="text-[9px] px-1.5 py-0.5 rounded bg-surface-highlight text-muted">
                                                                        +{matchedWatchlists.length - 2}
                                                                    </span>
                                                                ) : null}
                                                            </>
                                                        ) : (
                                                            <span className="text-[9px] text-muted">Not in watchlists</span>
                                                        )}
                                                    </div>
                                                ) : null}
                                            </div>
                                        </div>
                                        <div className="text-right">
                                            <p className="text-sm font-semibold text-foreground">
                                                {currentPrice ? `$${currentPrice.close.toFixed(2)}` : '$---.--'}
                                            </p>
                                            <p className="text-xs text-muted flex items-center justify-end gap-1">
                                                <span className="material-symbols-outlined !text-[14px]">monitoring</span>
                                                {currentPrice ? `Vol: ${(currentPrice.volume / 1000000).toFixed(1)}M` : 'No data'}
                                            </p>
                                        </div>
                                    </Link>

                                    <div className="px-3 pb-1 pt-2 border-t border-border-color/40">
                                        <div className="flex items-center justify-between">
                                            <p className="text-[10px] font-semibold text-muted uppercase tracking-wider text-left">Watchlists</p>
                                            {validTicker ? (
                                                <span className="text-[10px] text-muted">
                                                    {matchedWatchlists.length ? `In ${matchedWatchlists.length}` : 'Not tracked'}
                                                </span>
                                            ) : null}
                                        </div>
                                        {!validTicker ? (
                                            <p className="text-[11px] text-muted pt-2">
                                                Enter a ticker symbol to add it to a watchlist.
                                            </p>
                                        ) : watchlists.length === 0 ? (
                                            <p className="text-[11px] text-muted pt-2">
                                                No watchlists yet. Create one from the home page.
                                            </p>
                                        ) : (
                                            <div className="mt-2 space-y-1 max-h-[140px] overflow-y-auto">
                                                {watchlists.map((watchlist) => {
                                                    const inWatchlist = isInWatchlist(watchlist.id, validTicker);
                                                    const actionLabel = inWatchlist ? 'Remove' : 'Add';
                                                    return (
                                                        <button
                                                            key={watchlist.id}
                                                            type="button"
                                                            onMouseDown={(e) => e.preventDefault()}
                                                            onClick={() => toggleTickerInWatchlist(watchlist.id, validTicker)}
                                                            className={`w-full flex items-center justify-between px-2.5 py-2 rounded-md border text-left transition-colors ${inWatchlist
                                                                ? 'border-risk-red/40 bg-risk-red/10 text-foreground hover:bg-risk-red/15'
                                                                : 'border-border-color/50 hover:bg-surface-highlight text-foreground'
                                                                }`}
                                                        >
                                                            <span className="text-xs font-semibold truncate">{watchlist.name}</span>
                                                            <span className={`text-[10px] font-bold uppercase tracking-wider ${inWatchlist ? 'text-neon-red' : 'text-primary'}`}>
                                                                {actionLabel}
                                                            </span>
                                                        </button>
                                                    );
                                                })}
                                            </div>
                                        )}
                                    </div>
                                </div>

                                {/* Stock-specific news (when valid ticker is entered) */}
                                {validTicker && (
                                    <div className="p-2 border-t border-border-color/50">
                                        <p className="px-3 py-2 text-[11px] font-semibold text-muted uppercase tracking-wider text-left">
                                            {validTicker} News
                                        </p>
                                        <div className="px-3 pt-2 pb-4 space-y-2 max-h-[150px] overflow-y-auto">
                                            {tickerNewsLoading ? (
                                                <div className="flex items-center gap-3">
                                                    <div className="size-8 rounded skeleton shrink-0"></div>
                                                    <div className="space-y-2 flex-1">
                                                        <div className="h-3 w-3/4 skeleton rounded"></div>
                                                        <div className="h-2 w-1/2 skeleton rounded opacity-50"></div>
                                                    </div>
                                                </div>
                                            ) : tickerNews.length > 0 ? (
                                                tickerNews.map((article, index) => {
                                                    const itemIndex = 1 + index;
                                                    return (
                                                        <a
                                                            key={index}
                                                            href={article.link}
                                                            target="_blank"
                                                            rel="noopener noreferrer"
                                                            className={`block py-2 px-2 rounded transition-colors group ${activeIndex === itemIndex ? 'bg-surface-highlight' : 'hover:bg-surface-highlight'}`}
                                                            onMouseEnter={() => setActiveIndex(itemIndex)}
                                                        >
                                                            <p className="text-xs text-foreground group-hover:text-primary line-clamp-2 leading-tight mb-1">
                                                                {article.title}
                                                            </p>
                                                            <p className="text-[10px] text-muted">
                                                                {article.publisher}
                                                            </p>
                                                        </a>
                                                    );
                                                })
                                            ) : (
                                                <p className="text-xs text-muted py-2">No recent news</p>
                                            )}
                                        </div>
                                    </div>
                                )}

                                <div className="p-2 border-t border-border-color/50">
                                    <p className="px-3 py-2 text-[11px] font-semibold text-muted uppercase tracking-wider text-left">Market News</p>
                                    <div className="px-3 pt-2 pb-4 space-y-2 max-h-[200px] overflow-y-auto">
                                        {newsLoading ? (
                                            <div className="flex items-center gap-3">
                                                <div className="size-8 rounded skeleton shrink-0"></div>
                                                <div className="space-y-2 flex-1">
                                                    <div className="h-3 w-3/4 skeleton rounded"></div>
                                                    <div className="h-2 w-1/2 skeleton rounded opacity-50"></div>
                                                </div>
                                            </div>
                                        ) : marketNews.length > 0 ? (
                                            marketNews.map((article, index) => {
                                                const itemIndex = marketNewsStart + index;
                                                return (
                                                    <a
                                                        key={index}
                                                        href={article.link}
                                                        target="_blank"
                                                        rel="noopener noreferrer"
                                                        className={`block py-2 px-2 rounded transition-colors group ${activeIndex === itemIndex ? 'bg-surface-highlight' : 'hover:bg-surface-highlight'}`}
                                                        onMouseEnter={() => setActiveIndex(itemIndex)}
                                                    >
                                                        <p className="text-xs text-foreground group-hover:text-primary line-clamp-2 leading-tight mb-1">
                                                            {article.title}
                                                        </p>
                                                        <p className="text-[10px] text-muted">
                                                            {article.publisher}
                                                        </p>
                                                    </a>
                                                );
                                            })
                                        ) : (
                                            <p className="text-xs text-muted py-2">No news available</p>
                                        )}
                                    </div>
                                </div>

                                <div className="bg-black/5 px-5 py-3 flex items-center justify-between border-t border-border-color">
                                    <div className="flex items-center gap-4">
                                        <div className="flex items-center gap-1.5 text-[10px] text-muted">
                                            <kbd className="px-1.5 py-0.5 bg-surface-highlight rounded text-foreground">↑↓</kbd>
                                            <span>Navigate</span>
                                        </div>
                                        <div className="flex items-center gap-1.5 text-[10px] text-muted">
                                            <kbd className="px-1.5 py-0.5 bg-surface-highlight rounded text-foreground">↵</kbd>
                                            <span>Select</span>
                                        </div>
                                    </div>
                                    <div className="text-[10px] text-muted uppercase tracking-tight">
                                        Powered by <span className="font-bold text-primary">QUANT PLATFORM</span>
                                    </div>
                                </div>
                            </div>
                        )}
                    </div>
                </div>

                {/* Right Actions */}
                <div className="flex items-center gap-4">
                    <div className="flex gap-1">
                        <ThemeToggle />
                        <Link
                            href={isAuthenticated ? "/settings" : "/signin?next=%2Fsettings"}
                            className="size-10 flex items-center justify-center rounded-lg hover:bg-white/5 text-muted hover:text-foreground transition-colors"
                            aria-label="Open settings"
                        >
                            <span className="material-symbols-outlined">settings</span>
                        </Link>
                    </div>
                    {isAuthenticated ? (
                        <>
                            <div className="h-8 w-[1px] bg-border-color"></div>
                            <div ref={userMenuRef} className="relative">
                                <button
                                    type="button"
                                    onClick={() => setIsUserMenuOpen((prev) => !prev)}
                                    className="flex items-center gap-3 pl-2 pr-2 py-1.5 rounded-lg hover:bg-surface-highlight/40 transition-colors"
                                    aria-haspopup="menu"
                                    aria-expanded={isUserMenuOpen}
                                >
                                    <div className="text-right hidden md:block max-w-[180px]">
                                        <p className="text-xs font-semibold text-foreground truncate">{userDisplayName}</p>
                                        <p className="text-[10px] text-muted tracking-wide font-semibold truncate">{userSecondaryText}</p>
                                    </div>
                                    <div className="size-9 rounded-full border border-border-color overflow-hidden bg-surface-highlight flex items-center justify-center">
                                        {userAvatarUrl ? (
                                            <img
                                                src={userAvatarUrl}
                                                alt={userDisplayName}
                                                className="w-full h-full object-cover"
                                                onError={(e) => { (e.target as HTMLImageElement).style.display = 'none'; }}
                                            />
                                        ) : (
                                            <span className="text-[11px] font-bold text-foreground">{userInitials}</span>
                                        )}
                                    </div>
                                    <span className="material-symbols-outlined text-muted !text-[18px] hidden md:inline-block">
                                        expand_more
                                    </span>
                                </button>

                                {isUserMenuOpen ? (
                                    <div
                                        role="menu"
                                        className="absolute right-0 mt-2 w-56 bg-surface border border-border-color rounded-2xl shadow-2xl overflow-hidden"
                                    >
                                        <Link
                                            href="/settings"
                                            role="menuitem"
                                            onClick={() => setIsUserMenuOpen(false)}
                                            className="flex items-center gap-3 px-4 py-3 text-sm text-foreground hover:bg-surface-highlight transition-colors"
                                        >
                                            <span className="material-symbols-outlined !text-[18px] text-primary">settings</span>
                                            <span className="font-semibold">Settings</span>
                                        </Link>
                                        <Link
                                            href="/history"
                                            role="menuitem"
                                            onClick={() => setIsUserMenuOpen(false)}
                                            className="flex items-center gap-3 px-4 py-3 text-sm text-foreground hover:bg-surface-highlight transition-colors"
                                        >
                                            <span className="material-symbols-outlined !text-[18px] text-primary">history</span>
                                            <span className="font-semibold">History</span>
                                        </Link>
                                        <button
                                            type="button"
                                            role="menuitem"
                                            onClick={() => {
                                                void handleSignOut();
                                            }}
                                            disabled={isSigningOut}
                                            className="w-full flex items-center gap-3 px-4 py-3 text-sm text-foreground hover:bg-surface-highlight transition-colors disabled:opacity-60"
                                        >
                                            <span className="material-symbols-outlined !text-[18px] text-neon-red">logout</span>
                                            <span className="font-semibold">{isSigningOut ? 'Signing out...' : 'Sign out'}</span>
                                        </button>
                                    </div>
                                ) : null}
                            </div>
                        </>
                    ) : (
                        <>
                            <div className="h-8 w-[1px] bg-border-color"></div>
                            <div className="flex items-center gap-2">
                                <Link
                                    href="/signin"
                                    className="h-9 px-3 inline-flex items-center justify-center rounded-lg border border-border-color text-xs font-semibold uppercase tracking-[0.12em] text-muted hover:text-foreground hover:border-primary/50 transition-colors"
                                >
                                    Sign in
                                </Link>
                                <Link
                                    href="/signup"
                                    className="h-9 px-3 inline-flex items-center justify-center rounded-lg bg-primary text-white text-xs font-semibold uppercase tracking-[0.12em] hover:bg-primary/90 transition-colors"
                                >
                                    Sign up
                                </Link>
                            </div>
                        </>
                    )}
                </div>
            </div>
        </header>
    );
};
