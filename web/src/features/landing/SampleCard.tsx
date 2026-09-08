import type { LandingFreeSample, LandingPremiumSample } from "@/server/landing";
import { LandingCopyButton } from "./LandingCopyButton";

function CategoryChip({ label }: { label: string }) {
  return (
    <span className="inline-flex items-center rounded-sm border border-border bg-surface-2 px-2 py-0.5 text-xs font-medium text-text-muted">
      {label}
    </span>
  );
}

function FrameworkChip({ badge, isTemplate }: { badge: string | null; isTemplate: boolean }) {
  if (badge) {
    return (
      <span className="inline-flex items-center rounded-sm border border-transparent bg-accent-soft px-2 py-0.5 font-mono text-xs font-medium text-accent-strong">
        {badge}
      </span>
    );
  }
  if (isTemplate) {
    return (
      <span className="inline-flex items-center rounded-sm border border-transparent bg-warn-soft px-2 py-0.5 text-xs font-medium text-warn">
        Template
      </span>
    );
  }
  return null;
}

// ── Free tier — fully readable, with a working copy button ───────────────────
export function FreeSampleCard({ sample }: { sample: LandingFreeSample }) {
  return (
    <article className="flex flex-col rounded-lg border border-border bg-surface shadow">
      <div className="flex flex-1 flex-col gap-3 p-5">
        <div className="flex flex-wrap items-center gap-1.5">
          <span className="inline-flex items-center gap-1 rounded-sm border border-transparent bg-accent-soft px-2 py-0.5 text-xs font-semibold text-accent-strong">
            <svg width="11" height="11" viewBox="0 0 20 20" fill="currentColor" aria-hidden="true">
              <path d="M10 2a8 8 0 1 0 0 16 8 8 0 0 0 0-16Zm3.7 6.3-4.4 4.4a1 1 0 0 1-1.4 0L5.8 10.6a1 1 0 1 1 1.4-1.4l1.4 1.4 3.7-3.7a1 1 0 0 1 1.4 1.4Z" />
            </svg>
            Free
          </span>
          <CategoryChip label={sample.category} />
          <FrameworkChip badge={sample.frameworkBadge} isTemplate={sample.isTemplate} />
        </div>

        <h3 className="font-display text-base font-semibold leading-snug text-text">{sample.title}</h3>

        {sample.description ? (
          <p className="line-clamp-2 text-sm text-text-muted">{sample.description}</p>
        ) : null}

        <pre className="max-h-40 overflow-y-auto whitespace-pre-wrap rounded border border-border bg-surface-2 px-3 py-2.5 font-mono text-xs leading-relaxed text-text">
          {sample.body}
        </pre>

        {sample.variables.length ? (
          <div className="flex flex-wrap gap-1">
            {sample.variables.map((v) => (
              <span
                key={v}
                className="rounded-sm bg-good-blue-soft px-1.5 py-0.5 font-mono text-[11px] text-good-blue"
              >
                {v}
              </span>
            ))}
          </div>
        ) : null}

        <div className="mt-auto pt-1">
          <LandingCopyButton text={sample.body} />
        </div>
      </div>
    </article>
  );
}

// ── Premium tier — grayed / locked, whole card links to the sign-up gate ─────
export function PremiumSampleCard({ sample }: { sample: LandingPremiumSample }) {
  return (
    <a
      href="/legacy"
      className="group flex flex-col rounded-lg border border-border bg-surface shadow transition-all duration-200 hover:border-border-strong hover:shadow-lg focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
      aria-label={`${sample.title} — a premium prompt in ${sample.category}. Sign up free to unlock.`}
    >
      <div className="flex flex-1 flex-col gap-2 p-5">
        <div className="flex flex-wrap items-center gap-1.5">
          <CategoryChip label={sample.category} />
          <FrameworkChip badge={sample.frameworkBadge} isTemplate={sample.isTemplate} />
        </div>

        <h3 className="font-display text-base font-semibold leading-snug text-text">{sample.title}</h3>

        {sample.description ? (
          <p className="line-clamp-2 text-sm text-text-muted">{sample.description}</p>
        ) : null}

        <div className="relative mt-1 overflow-hidden rounded border border-border bg-surface-2">
          <p
            aria-hidden="true"
            className="max-h-24 select-none whitespace-pre-wrap px-3 py-2.5 font-mono text-xs leading-relaxed text-text-faint blur-[3px]"
          >
            {sample.preview}
          </p>
          <div className="pointer-events-none absolute inset-0 bg-gradient-to-t from-surface-2 to-transparent" />
          <div className="absolute inset-x-0 bottom-0 flex items-center justify-center gap-1.5 pb-2 text-xs font-semibold text-accent-strong">
            <svg width="13" height="13" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.6" aria-hidden="true">
              <rect x="4" y="9" width="12" height="8" rx="1.5" />
              <path d="M7 9V6.5a3 3 0 0 1 6 0V9" />
            </svg>
            Sign up to unlock
          </div>
        </div>
      </div>
    </a>
  );
}
