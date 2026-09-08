"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useInfiniteQuery, keepPreviousData } from "@tanstack/react-query";
import { api } from "@/lib/api-client";
import { Badge, Button, SkeletonCard } from "@/components/ui";
import type { PromptsListResponse } from "@/contracts/prompts";
import type { CategoryCount } from "@/contracts/categories";
import { PromptCard } from "./PromptCard";
import { Filters, EMPTY_FILTERS, type FilterState } from "./Filters";
import { useSaved } from "./useSaved";

// Debounce a value (search input).
function useDebounced<T>(value: T, ms: number): T {
  const [v, setV] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setV(value), ms);
    return () => clearTimeout(t);
  }, [value, ms]);
  return v;
}

export function LibraryView({
  scope,
  categories,
  initialPage,
  initialFilters,
  heading,
}: {
  scope: PromptsListResponse["scope"];
  categories: CategoryCount[];
  initialPage: PromptsListResponse;
  initialFilters?: Partial<FilterState>;
  heading?: string;
}) {
  const [filters, setFilters] = useState<FilterState>({ ...EMPTY_FILTERS, ...initialFilters });
  const debouncedQ = useDebounced(filters.q, 250);
  const saved = useSaved();

  // "Saved only" is a real server-side filter (the caller's FULL saved set,
  // scope-checked + paginated like every other filter) — not a client-side
  // post-filter over whatever page happened to be loaded. A sentinel id that
  // matches nothing keeps the query shape uniform when there are zero saves.
  const savedIds = filters.savedOnly
    ? saved.ids.length
      ? saved.ids.join(",")
      : "__no_saved_prompts__"
    : undefined;

  const serverFilters = useMemo(
    () => ({
      q: debouncedQ || undefined,
      category: filters.category || undefined,
      difficulty: (filters.difficulty || undefined) as
        | "Beginner"
        | "Intermediate"
        | "Advanced"
        | undefined,
      level: filters.level ? Number(filters.level) : undefined,
      template: filters.template || undefined,
      ids: savedIds,
      limit: 30,
    }),
    [debouncedQ, filters.category, filters.difficulty, filters.level, filters.template, savedIds],
  );

  // Log a search event (fire-and-forget) when a query settles.
  useEffect(() => {
    if (debouncedQ) api.logActivity({ event: "search", meta: { q: debouncedQ } }).catch(() => {});
  }, [debouncedQ]);

  const isDefault =
    !serverFilters.q &&
    !serverFilters.category &&
    !serverFilters.difficulty &&
    !serverFilters.level &&
    !serverFilters.template &&
    !serverFilters.ids;

  const query = useInfiniteQuery({
    queryKey: ["prompts", serverFilters],
    queryFn: ({ pageParam }) =>
      api.listPrompts({ ...serverFilters, cursor: pageParam ?? undefined, limit: 30 }),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (last) => last.nextCursor ?? undefined,
    placeholderData: keepPreviousData,
    // Don't query "saved only" until the saved set has loaded — avoids a flash
    // of "no saved prompts" while /api/v2/state is still in flight.
    enabled: !filters.savedOnly || saved.ready,
    initialData: isDefault
      ? { pages: [initialPage], pageParams: [undefined] }
      : undefined,
  });

  const items = useMemo(() => query.data?.pages.flatMap((p) => p.items) ?? [], [query.data]);

  const total = query.data?.pages[0]?.total ?? (isDefault ? initialPage.total : 0);

  // Infinite scroll sentinel.
  const sentinel = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = sentinel.current;
    if (!el) return;
    const io = new IntersectionObserver((entries) => {
      if (entries[0]?.isIntersecting && query.hasNextPage && !query.isFetchingNextPage) {
        query.fetchNextPage();
      }
    });
    io.observe(el);
    return () => io.disconnect();
  }, [query]);

  return (
    <div className="mx-auto max-w-6xl px-4 py-8 sm:px-6">
      <header className="mb-6">
        <h1 className="font-display text-2xl font-semibold text-text">{heading ?? "Prompt Library"}</h1>
        <div className="mt-2 flex flex-wrap items-center gap-2 text-sm text-text-muted">
          {scope.restricted ? (
            <Badge tone="accent">Scoped library</Badge>
          ) : (
            <Badge tone="neutral">Full library</Badge>
          )}
          {scope.label ? <span>{scope.label}</span> : null}
          <span aria-live="polite">· {total.toLocaleString()} prompts in scope</span>
        </div>
      </header>

      <div className="grid gap-8 lg:grid-cols-[260px_1fr]">
        <aside className="lg:sticky lg:top-6 lg:self-start">
          <Filters value={filters} onChange={(patch) => setFilters((f) => ({ ...f, ...patch }))} categories={categories} />
        </aside>

        <section aria-busy={query.isFetching}>
          {query.isError ? (
            <div className="rounded-lg border border-danger-soft bg-danger-soft p-4 text-danger">
              Couldn’t load prompts.{" "}
              <button className="underline" onClick={() => query.refetch()}>
                Retry
              </button>
            </div>
          ) : filters.savedOnly && !saved.ready ? (
            <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
              {Array.from({ length: 3 }).map((_, i) => (
                <SkeletonCard key={i} />
              ))}
            </div>
          ) : items.length === 0 && !query.isFetching ? (
            <p className="rounded-lg border border-border bg-surface p-8 text-center text-text-muted">
              {filters.savedOnly ? "No saved prompts yet." : "No prompts match these filters."}
            </p>
          ) : (
            <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
              {items.map((p) => (
                <PromptCard key={p.id} prompt={p} saved={saved.isSaved(p.id)} onToggleSave={saved.toggle} />
              ))}
              {query.isFetching &&
                !query.isFetchingNextPage &&
                items.length === 0 &&
                Array.from({ length: 6 }).map((_, i) => <SkeletonCard key={i} />)}
            </div>
          )}

          <div ref={sentinel} className="h-10" />
          {query.isFetchingNextPage ? (
            <p className="py-4 text-center text-sm text-text-muted">Loading more…</p>
          ) : query.hasNextPage ? (
            <div className="py-4 text-center">
              <Button variant="secondary" onClick={() => query.fetchNextPage()}>
                Load more
              </Button>
            </div>
          ) : null}
        </section>
      </div>
    </div>
  );
}
