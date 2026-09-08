"use client";

import { useCallback, useEffect, useState } from "react";
import { api } from "@/lib/api-client";

// Saved (favorites) toggle. Server-synced via /api/v2/state (subject
// 'user:'+id, reusing learner_state) with a localStorage fallback for
// anonymous / no-DB, mirroring the legacy app's behaviour. Also logs the
// favorited / unfavorited activity event.
const LS_KEY = "syn_v2_favorites";

function readLocal(): string[] {
  try {
    const raw = localStorage.getItem(LS_KEY);
    const arr = raw ? JSON.parse(raw) : [];
    return Array.isArray(arr) ? arr.filter((x) => typeof x === "string") : [];
  } catch {
    return [];
  }
}
function writeLocal(ids: string[]) {
  try {
    localStorage.setItem(LS_KEY, JSON.stringify(ids));
  } catch {
    /* ignore */
  }
}

export function useSaved() {
  const [ids, setIds] = useState<string[]>([]);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const local = readLocal();
      try {
        const state = await api.getState(["favorites"]);
        const server = Array.isArray(state.favorites)
          ? (state.favorites as unknown[]).filter((x): x is string => typeof x === "string")
          : null;
        if (!cancelled) setIds(server ?? local);
      } catch {
        if (!cancelled) setIds(local);
      } finally {
        if (!cancelled) setReady(true);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const toggle = useCallback(
    (id: string) => {
      setIds((prev) => {
        const has = prev.includes(id);
        const next = has ? prev.filter((x) => x !== id) : [...prev, id];
        writeLocal(next);
        api.putState({ key: "favorites", value: next }).catch(() => {});
        api.logActivity({ event: has ? "unfavorited" : "favorited", promptId: id }).catch(() => {});
        return next;
      });
    },
    [],
  );

  return { ids, isSaved: (id: string) => ids.includes(id), toggle, ready };
}
