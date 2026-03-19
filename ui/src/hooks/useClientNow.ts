"use client";

import { useEffect, useState } from "react";

export function useClientNow(refreshMs?: number) {
  const [now, setNow] = useState<number | null>(null);

  useEffect(() => {
    setNow(Date.now());

    if (!refreshMs) return;
    const id = window.setInterval(() => {
      setNow(Date.now());
    }, refreshMs);

    return () => window.clearInterval(id);
  }, [refreshMs]);

  return now;
}
