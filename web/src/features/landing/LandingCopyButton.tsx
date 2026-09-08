"use client";

import { useState } from "react";

// Minimal copy button for the public landing's FREE prompt cards. Deliberately
// standalone — no /api/v2/activity call (that endpoint is auth-only; an
// anonymous visitor has no subject) and no app state. Just the clipboard.
export function LandingCopyButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);

  return (
    <button
      type="button"
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(text);
          setCopied(true);
          setTimeout(() => setCopied(false), 1600);
        } catch {
          /* clipboard blocked — no-op */
        }
      }}
      className="inline-flex items-center gap-1.5 rounded-sm border border-border-strong bg-surface px-3 py-1.5 text-xs font-semibold text-text transition-colors duration-200 hover:bg-surface-hover focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
      aria-live="polite"
    >
      {copied ? (
        <>
          <svg width="13" height="13" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
            <path d="m5 10 3.5 3.5L15 7" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
          Copied
        </>
      ) : (
        <>
          <svg width="13" height="13" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.6" aria-hidden="true">
            <rect x="7" y="7" width="9" height="9" rx="1.5" />
            <path d="M13 7V5.5A1.5 1.5 0 0 0 11.5 4h-6A1.5 1.5 0 0 0 4 5.5v6A1.5 1.5 0 0 0 5.5 13H7" />
          </svg>
          Copy prompt
        </>
      )}
    </button>
  );
}
