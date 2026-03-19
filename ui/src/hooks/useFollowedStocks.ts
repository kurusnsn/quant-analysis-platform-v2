"use client";

import { useEffect } from "react";
import { useUserStorageKey } from "@/hooks/useUserStorageKey";
import {
  hydrateFollowedStocksFromSession,
  startFollowedStocksStorageSync,
  useFollowedStocksStore,
} from "@/stores/followedStocksStore";

const BASE_STORAGE_KEY = "quant-platform_followed_stocks";

export function useFollowedStocks() {
  const { storageKey } = useUserStorageKey(BASE_STORAGE_KEY);
  const followed = useFollowedStocksStore((state) => state.followed);
  const setStorageKey = useFollowedStocksStore((state) => state.setStorageKey);
  const follow = useFollowedStocksStore((state) => state.follow);
  const unfollow = useFollowedStocksStore((state) => state.unfollow);
  const toggleFollow = useFollowedStocksStore((state) => state.toggleFollow);
  const isFollowed = useFollowedStocksStore((state) => state.isFollowed);

  useEffect(() => {
    if (typeof window === "undefined") return;
    if (storageKey !== BASE_STORAGE_KEY) {
      const legacy = localStorage.getItem(BASE_STORAGE_KEY);
      if (legacy && !localStorage.getItem(storageKey)) {
        localStorage.setItem(storageKey, legacy);
      }
    }

    setStorageKey(storageKey);
    startFollowedStocksStorageSync();
    void hydrateFollowedStocksFromSession(storageKey);
  }, [setStorageKey, storageKey]);

  return { followed, follow, unfollow, toggleFollow, isFollowed };
}
