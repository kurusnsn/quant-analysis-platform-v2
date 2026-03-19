"use client";

import { useState, useCallback } from "react";

interface CopyButtonProps {
  getText: () => string;
  label?: string;
  className?: string;
}

export default function CopyButton({ getText, label, className }: CopyButtonProps) {
  const [copied, setCopied] = useState(false);

  const handleCopy = useCallback(async () => {
    try {
      await navigator.clipboard.writeText(getText());
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1500);
    } catch {
      // Clipboard write failed silently
    }
  }, [getText]);

  return (
    <button
      type="button"
      onClick={handleCopy}
      className={`inline-flex items-center gap-1 text-[10px] text-muted hover:text-primary transition-colors ${className ?? ""}`}
      title="Copy to clipboard"
    >
      <span className="material-symbols-outlined text-sm">
        {copied ? "check_circle" : "content_copy"}
      </span>
      {label !== undefined ? (copied ? "Copied" : label) : (copied ? "Copied" : "Copy")}
    </button>
  );
}
