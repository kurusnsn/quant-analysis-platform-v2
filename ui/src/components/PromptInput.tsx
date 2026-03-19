"use client";

import React, { useEffect, useMemo, useRef, useState } from "react";

type PromptSuggestion =
  | string
  | {
    value: string;
    display?: string;
  };

type PromptAction = {
  label: string;
  onClick?: () => void;
  isLoading?: boolean;
  isDisabled?: boolean;
  loadingLabel?: string;
  icon?: React.ReactNode;
  loadingIcon?: React.ReactNode;
};

type PromptInputProps = {
  label: string;
  placeholder: string;
  value: string;
  onChange: (value: string) => void;
  onSubmit?: () => void;
  icon?: React.ReactNode;
  action?: PromptAction;
  suggestions?: PromptSuggestion[];
  suggestionCycleMs?: number;
  suggestionAnimation?: "swap" | "typewriter";
  description?: string;
  footer?: React.ReactNode;
  readOnly?: boolean;
  maxLength?: number;
};

export default function PromptInput({
  label,
  placeholder,
  value,
  onChange,
  onSubmit,
  icon,
  action,
  suggestions,
  suggestionCycleMs = 2800,
  suggestionAnimation = "swap",
  description,
  footer,
  readOnly,
  maxLength,
}: PromptInputProps) {
  const inputRef = useRef<HTMLInputElement | null>(null);
  const [suggestionIndex, setSuggestionIndex] = useState(0);
  const [typedSuggestion, setTypedSuggestion] = useState("");

  const normalizedSuggestions = useMemo(
    () =>
      (suggestions ?? [])
        .map((item) => {
          if (typeof item === "string") {
            const trimmed = item.trim();
            if (!trimmed) return null;
            return { value: trimmed, display: trimmed };
          }
          if (!item || typeof item.value !== "string") return null;
          const value = item.value.trim();
          if (!value) return null;
          const display =
            typeof item.display === "string" && item.display.trim().length > 0 ? item.display : value;
          return { value, display };
        })
        .filter(
          (item): item is {
            value: string;
            display: string;
          } => Boolean(item)
        ),
    [suggestions]
  );

  const safeSuggestionIndex =
    normalizedSuggestions.length > 0 ? suggestionIndex % normalizedSuggestions.length : 0;
  const activeSuggestion = normalizedSuggestions[safeSuggestionIndex] ?? { value: "", display: "" };

  const shouldShowSuggestion = normalizedSuggestions.length > 0 && value.length === 0;

  useEffect(() => {
    if (suggestionAnimation !== "swap") return;
    if (!shouldShowSuggestion) return;
    if (normalizedSuggestions.length <= 1) return;

    const intervalId = window.setInterval(() => {
      setSuggestionIndex((prev) => (prev + 1) % normalizedSuggestions.length);
    }, suggestionCycleMs);

    return () => window.clearInterval(intervalId);
  }, [normalizedSuggestions.length, shouldShowSuggestion, suggestionAnimation, suggestionCycleMs]);

  useEffect(() => {
    if (suggestionAnimation !== "typewriter") return;
    if (!shouldShowSuggestion) return;
    if (normalizedSuggestions.length === 0) return;

    let cancelled = false;
    let timeoutId: number | null = null;

    // Reset the index when entering suggestion mode so it always feels intentional.
    let index = 0;

    const typeMs = 55;
    const deleteMs = 35;
    const betweenMs = 250;
    const minHoldMs = 600;

    const runCurrentSuggestion = () => {
      if (cancelled) return;
      const current = normalizedSuggestions[index];
      if (!current) return;

      const display = current.display;
      const len = display.length;
      const holdMs = Math.max(minHoldMs, suggestionCycleMs - len * (typeMs + deleteMs) - betweenMs);

      let char = 1;

      const typeNext = () => {
        if (cancelled) return;
        // Ensure click-to-accept uses the same suggestion that's being animated.
        setSuggestionIndex(index);
        setTypedSuggestion(display.slice(0, char));

        if (char < len) {
          char += 1;
          timeoutId = window.setTimeout(typeNext, typeMs);
          return;
        }

        timeoutId = window.setTimeout(() => {
          if (cancelled) return;
          let deleteChar = len - 1;

          const deleteNext = () => {
            if (cancelled) return;
            setTypedSuggestion(display.slice(0, deleteChar));

            if (deleteChar > 0) {
              deleteChar -= 1;
              timeoutId = window.setTimeout(deleteNext, deleteMs);
              return;
            }

            timeoutId = window.setTimeout(() => {
              if (cancelled) return;
              index = (index + 1) % normalizedSuggestions.length;
              runCurrentSuggestion();
            }, betweenMs);
          };

          deleteNext();
        }, holdMs);
      };

      typeNext();
    };

    // Kick off async so we don't synchronously set state inside the effect body.
    timeoutId = window.setTimeout(runCurrentSuggestion, 0);

    return () => {
      cancelled = true;
      if (timeoutId) window.clearTimeout(timeoutId);
    };
  }, [normalizedSuggestions, shouldShowSuggestion, suggestionAnimation, suggestionCycleMs]);

  const isActionDisabled = Boolean(action?.isLoading || action?.isDisabled || !action?.onClick);
  const activePlaceholder =
    shouldShowSuggestion && suggestionAnimation === "typewriter" ? typedSuggestion : activeSuggestion.display;

  return (
    <div className="bg-surface border border-border-color p-6 rounded-2xl relative overflow-hidden group">
      <div className="flex flex-col gap-4">
        <h2 className="text-sm font-bold text-foreground flex items-center gap-2 uppercase tracking-widest font-mono">
          {icon}
          {label}
        </h2>
        {description && (
          <p className="text-xs text-muted -mt-2 font-mono">{description}</p>
        )}
        <div className="relative flex bg-background-dark rounded-xl overflow-hidden p-1 border border-border-color focus-within:border-primary transition-all">
          <div className="relative flex-1">
            <input
              ref={inputRef}
              className="w-full bg-transparent border-none py-3 px-4 text-sm text-foreground placeholder-muted focus:ring-0 outline-none font-mono"
              aria-label={label}
              placeholder={shouldShowSuggestion ? activePlaceholder : placeholder}
              type="text"
              readOnly={readOnly}
              maxLength={maxLength}
              value={value}
              onChange={(event) => {
                if (readOnly) return;
                const nextValue =
                  typeof maxLength === "number" && maxLength > 0
                    ? event.target.value.slice(0, maxLength)
                    : event.target.value;
                onChange(nextValue);
              }}
              onKeyDown={(event) => event.key === "Enter" && onSubmit?.()}
              onPointerDown={(event) => {
                if (!shouldShowSuggestion) return;
                if (!activeSuggestion.value) return;
                if (event.pointerType === "mouse" && event.button !== 0) return;

                onChange(activeSuggestion.value);
                window.requestAnimationFrame(() => {
                  const input = inputRef.current;
                  if (!input) return;
                  input.focus();
                  input.select();
                });
              }}
            />
          </div>
          {action ? (
            <button
              onClick={action.onClick}
              disabled={isActionDisabled}
              className={`bg-primary text-white px-6 py-3 text-[10px] font-black uppercase tracking-widest hover:brightness-110 transition-all flex items-center gap-2 rounded-lg font-mono ${isActionDisabled ? "opacity-50 cursor-not-allowed" : ""
                }`}
            >
              {action.isLoading ? action.loadingLabel ?? action.label : action.label}
              {action.isLoading ? action.loadingIcon : action.icon}
            </button>
          ) : null}
        </div>
        {footer && <div className="flex justify-end">{footer}</div>}
      </div>
    </div>
  );
}
