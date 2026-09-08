"use client";

import Link from "next/link";
import { PromptCard } from "@/features/library/PromptCard";
import { useSaved } from "@/features/library/useSaved";
import type { Prompt } from "@/contracts/prompt";

export interface HomePick {
  prompt: Prompt;
  reason: string;
}

// Groups consecutive picks sharing a reason under one caption — mirrors
// src/part_app_3.js#renderHome's `groups` reduction so "Based on what you
// saved" / "Because you work in X" / "Popular in your library" each get a
// single row heading instead of repeating per card.
function groupByReason(picks: HomePick[]): { reason: string; picks: HomePick[] }[] {
  const groups: { reason: string; picks: HomePick[] }[] = [];
  for (const p of picks) {
    const last = groups[groups.length - 1];
    if (last && last.reason === p.reason) last.picks.push(p);
    else groups.push({ reason: p.reason, picks: [p] });
  }
  return groups;
}

export function HomeSections({
  recommended,
  recentlyUsed,
  saved,
}: {
  recommended: HomePick[];
  recentlyUsed: Prompt[];
  saved: Prompt[];
}) {
  const savedState = useSaved();
  const groups = groupByReason(recommended);

  return (
    <div className="mt-10 space-y-10">
      <section>
        <div className="mb-3 flex items-center justify-between">
          <h2 className="font-display text-lg font-semibold text-text">Recommended for you</h2>
          <Link href="/library" className="text-sm text-accent hover:text-accent-strong">
            Browse the library
          </Link>
        </div>
        {groups.length === 0 ? (
          <p className="rounded-lg border border-border bg-surface p-6 text-sm text-text-muted">
            Save and use a few prompts and this list will sharpen.
          </p>
        ) : (
          <div className="space-y-5">
            {groups.map((g, i) => (
              <div key={i}>
                <div className="mb-2 text-xs font-medium uppercase tracking-wide text-text-faint">{g.reason}</div>
                <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
                  {g.picks.map(({ prompt }) => (
                    <PromptCard
                      key={prompt.id}
                      prompt={prompt}
                      saved={savedState.isSaved(prompt.id)}
                      onToggleSave={savedState.toggle}
                    />
                  ))}
                </div>
              </div>
            ))}
          </div>
        )}
      </section>

      <div className="grid gap-8 sm:grid-cols-2">
        <section>
          <h2 className="mb-3 font-display text-lg font-semibold text-text">Recently used</h2>
          {recentlyUsed.length === 0 ? (
            <p className="rounded-lg border border-border bg-surface p-4 text-sm text-text-muted">
              Prompts you open, copy, or use show up here.
            </p>
          ) : (
            <ul className="space-y-1.5">
              {recentlyUsed.map((p) => (
                <li key={p.id}>
                  <Link
                    href={`/library/prompt/${encodeURIComponent(p.id)}`}
                    className="flex items-center justify-between rounded border border-border bg-surface px-3 py-2 text-sm hover:bg-surface-hover"
                  >
                    <span className="truncate text-text">{p.title}</span>
                    <span className="ml-2 shrink-0 rounded-sm bg-surface-2 px-1.5 py-0.5 text-xs text-text-muted">
                      {p.category}
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </section>

        <section>
          <h2 className="mb-3 font-display text-lg font-semibold text-text">Saved</h2>
          {saved.length === 0 ? (
            <p className="rounded-lg border border-border bg-surface p-4 text-sm text-text-muted">
              Tap the star on any prompt to keep it here.
            </p>
          ) : (
            <ul className="space-y-1.5">
              {saved.map((p) => (
                <li key={p.id}>
                  <Link
                    href={`/library/prompt/${encodeURIComponent(p.id)}`}
                    className="flex items-center justify-between rounded border border-border bg-surface px-3 py-2 text-sm hover:bg-surface-hover"
                  >
                    <span className="truncate text-text">{p.title}</span>
                    <span className="ml-2 shrink-0 rounded-sm bg-surface-2 px-1.5 py-0.5 text-xs text-text-muted">
                      {p.category}
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>
    </div>
  );
}
