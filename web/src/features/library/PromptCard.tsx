"use client";

import Link from "next/link";
import { Card, Badge } from "@/components/ui";
import { frameworkBadge } from "@/lib/framework";
import type { PromptCard as PromptCardT } from "@/contracts/prompt";

export function PromptCard({
  prompt,
  saved,
  onToggleSave,
}: {
  prompt: PromptCardT;
  saved: boolean;
  onToggleSave: (id: string) => void;
}) {
  const fw = frameworkBadge(prompt.frameworkLevel ?? null);
  return (
    <Card interactive className="relative flex h-full flex-col">
      <div className="flex items-start justify-between gap-2 p-4 pb-2">
        <Link
          href={`/library/prompt/${encodeURIComponent(prompt.id)}`}
          className="font-display text-[0.95rem] font-semibold leading-snug text-text hover:text-accent-strong"
        >
          {prompt.title}
        </Link>
        <button
          type="button"
          aria-pressed={saved}
          aria-label={saved ? "Remove from saved" : "Save prompt"}
          onClick={() => onToggleSave(prompt.id)}
          className="shrink-0 rounded p-1 text-text-faint hover:bg-surface-hover hover:text-accent focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent"
        >
          <svg width="18" height="18" viewBox="0 0 20 20" aria-hidden="true" fill={saved ? "currentColor" : "none"} className={saved ? "text-accent" : ""}>
            <path
              d="M10 2.5l2.35 4.76 5.25.76-3.8 3.7.9 5.23L10 14.98l-4.7 2.47.9-5.23-3.8-3.7 5.25-.76z"
              stroke="currentColor"
              strokeWidth="1.3"
              strokeLinejoin="round"
            />
          </svg>
        </button>
      </div>

      {prompt.description ? (
        <p className="line-clamp-2 px-4 text-sm text-text-muted">{prompt.description}</p>
      ) : null}

      <div className="mt-auto flex flex-wrap items-center gap-1.5 p-4 pt-3">
        <Badge tone="neutral">{prompt.category}</Badge>
        {fw ? (
          <Badge tone="accent" title={`Written like a Level ${prompt.frameworkLevel} framework prompt`}>
            {fw}
          </Badge>
        ) : null}
        {prompt.difficulty ? <Badge tone="blue">{prompt.difficulty}</Badge> : null}
        {prompt.isTemplate ? <Badge tone="warn">Template</Badge> : null}
      </div>
    </Card>
  );
}
