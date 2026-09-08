"use client";

import { useEffect, useState } from "react";
import { useInfiniteQuery, keepPreviousData } from "@tanstack/react-query";
import { api } from "@/lib/api-client";
import { Input, Button, SkeletonCard } from "@/components/ui";
import { PromptCard } from "@/features/library/PromptCard";
import { useSaved } from "@/features/library/useSaved";

function useDebounced<T>(value: T, ms: number): T {
  const [v, setV] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setV(value), ms);
    return () => clearTimeout(t);
  }, [value, ms]);
  return v;
}

// Hero omnibox — mirrors src/part_app_3.js#renderHome's `q ? compact results :
// empty-state sections` split. Deliberately simpler than the Library screen's
// LibraryView (no category/difficulty/level filter sidebar — legacy's Home
// passes `compactFilters: true` to the same effect).
export function HomeSearch({ examples }: { examples: string[] }) {
  const [query, setQuery] = useState("");
  const debounced = useDebounced(query, 250);
  const saved = useSaved();

  useEffect(() => {
    if (debounced) api.logActivity({ event: "search", meta: { q: debounced } }).catch(() => {});
  }, [debounced]);

  const searching = debounced.trim().length > 0;

  const result = useInfiniteQuery({
    queryKey: ["home-search", debounced],
    queryFn: ({ pageParam }) => api.listPrompts({ q: debounced, cursor: pageParam ?? undefined, limit: 30 }),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (last) => last.nextCursor ?? undefined,
    placeholderData: keepPreviousData,
    enabled: searching,
  });

  const items = result.data?.pages.flatMap((p) => p.items) ?? [];
  const total = result.data?.pages[0]?.total ?? 0;

  return (
    <div>
      <div className="relative">
        <svg
          width="18"
          height="18"
          viewBox="0 0 20 20"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.5"
          aria-hidden="true"
          className="pointer-events-none absolute left-4 top-1/2 -translate-y-1/2 text-text-faint"
        >
          <circle cx="8.5" cy="8.5" r="5.5" />
          <path d="m17 17-3.5-3.5" />
        </svg>
        <Input
          type="text"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Describe your task in your own words — e.g. write a launch email to unhappy customers"
          aria-label="Describe your task"
          className="h-12 pl-11 pr-11 text-base"
        />
        {query ? (
          <button
            type="button"
            aria-label="Clear search"
            onClick={() => setQuery("")}
            className="absolute right-3 top-1/2 -translate-y-1/2 rounded p-1 text-text-faint hover:bg-surface-hover hover:text-text"
          >
            <svg width="16" height="16" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.6" aria-hidden="true">
              <path d="M5 5l10 10M15 5L5 15" />
            </svg>
          </button>
        ) : null}
      </div>

      {!searching ? (
        <div className="mt-3 flex flex-wrap gap-2">
          {examples.map((ex) => (
            <button
              key={ex}
              type="button"
              onClick={() => setQuery(ex)}
              className="rounded-full border border-border bg-surface px-3 py-1.5 text-xs text-text-muted hover:bg-surface-hover hover:text-text"
            >
              {ex}
            </button>
          ))}
        </div>
      ) : (
        <div className="mt-6">
          <p className="mb-3 text-sm text-text-muted" aria-live="polite">
            {total.toLocaleString()} prompt{total === 1 ? "" : "s"}
          </p>
          {result.isFetching && items.length === 0 ? (
            <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
              {Array.from({ length: 6 }).map((_, i) => (
                <SkeletonCard key={i} />
              ))}
            </div>
          ) : items.length === 0 ? (
            <p className="rounded-lg border border-border bg-surface p-8 text-center text-text-muted">
              No prompts match “{debounced}”.
            </p>
          ) : (
            <>
              <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
                {items.map((p) => (
                  <PromptCard key={p.id} prompt={p} saved={saved.isSaved(p.id)} onToggleSave={saved.toggle} />
                ))}
              </div>
              {result.hasNextPage ? (
                <div className="py-4 text-center">
                  <Button
                    variant="secondary"
                    onClick={() => result.fetchNextPage()}
                    disabled={result.isFetchingNextPage}
                  >
                    {result.isFetchingNextPage ? "Loading…" : "Load more"}
                  </Button>
                </div>
              ) : null}
            </>
          )}
        </div>
      )}
    </div>
  );
}
