"use client";

import { useTheme } from "next-themes";
import { Moon, Sun, Laptop } from "@phosphor-icons/react";
import { useEffect, useState } from "react";

export function ThemeToggle() {
    const { theme, setTheme } = useTheme();
    const [mounted, setMounted] = useState(false);

    // Avoid hydration mismatch
    useEffect(() => {
        setMounted(true);
    }, []);

    if (!mounted) {
        return (
            <button className="p-2 rounded-full bg-sentinel-card border border-sentinel-border text-sentinel-muted">
                <div className="w-5 h-5" />
            </button>
        );
    }

    const toggleTheme = () => {
        if (theme === 'light') setTheme('dark');
        else if (theme === 'dark') setTheme('system');
        else setTheme('light');
    };

    const Icon = theme === 'light' ? Sun : theme === 'dark' ? Moon : Laptop;

    return (
        <button
            onClick={toggleTheme}
            className="p-2 rounded-full bg-sentinel-card border border-sentinel-border text-sentinel-muted hover:text-sentinel-primary hover:border-sentinel-accent transition-colors"
            title={`Current theme: ${theme}`}
        >
            <Icon className="w-5 h-5" />
        </button>
    );
}
