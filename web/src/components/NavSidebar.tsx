"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/cn";

// 1:1 with src/part_app_5.js#NAV_PRIMARY (Home · Library · Learn · Practice ·
// Me). Home and Library are ported (real Next routes); Learn/Practice/Me stay
// on the legacy SPA — legacy has no deep-linkable URL per view (it's a client
// `STATE.view` switch with no distinct route), so these open the legacy root
// and the learner picks the tab there. One extra click, honestly disclosed
// rather than a dead/fake link.
const NAV_ITEMS = [
  { key: "home", label: "Home", href: "/", ported: true },
  { key: "library", label: "Library", href: "/library", ported: true },
  { key: "learn", label: "Learn", href: "/legacy", ported: false },
  { key: "practice", label: "Practice", href: "/legacy", ported: false },
  { key: "me", label: "Me", href: "/legacy", ported: false },
] as const;

const ICONS: Record<string, React.ReactNode> = {
  home: (
    <path d="M3 9.5 10 4l7 5.5V16a1 1 0 0 1-1 1h-3.5a.5.5 0 0 1-.5-.5V13a2 2 0 0 0-4 0v3.5a.5.5 0 0 1-.5.5H4a1 1 0 0 1-1-1z" />
  ),
  library: <circle cx="9" cy="9" r="6" />,
  learn: <path d="M3 5.5C3 4.7 3.7 4 4.5 4H9v12H4.5A1.5 1.5 0 0 1 3 14.5zM17 5.5c0-.8-.7-1.5-1.5-1.5H11v12h4.5a1.5 1.5 0 0 0 1.5-1.5z" />,
  practice: <circle cx="10" cy="10" r="6" />,
  me: <path d="M10 10a3 3 0 1 0 0-6 3 3 0 0 0 0 6zm-6 7c0-3 2.7-5 6-5s6 2 6 5" />,
};

function NavIcon({ name }: { name: string }) {
  return (
    <svg width="18" height="18" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.4" aria-hidden="true">
      {ICONS[name]}
    </svg>
  );
}

export function NavSidebar() {
  const pathname = usePathname();
  return (
    <nav aria-label="Primary" className="flex w-sidebar shrink-0 flex-col gap-1 border-r border-border bg-surface p-3">
      <div className="mb-2 px-2 py-1 font-display text-sm font-semibold text-text">Synottic</div>
      {NAV_ITEMS.map((item) => {
        const active = item.href === "/" ? pathname === "/" : pathname?.startsWith(item.href) && item.href !== "/legacy";
        return (
          <Link
            key={item.key}
            href={item.href}
            className={cn(
              "flex items-center gap-2.5 rounded px-3 py-2 text-sm font-medium text-text-muted transition-colors hover:bg-surface-hover hover:text-text",
              active && "bg-accent-soft text-accent-strong hover:bg-accent-soft",
            )}
            aria-current={active ? "page" : undefined}
            title={!item.ported ? `${item.label} (opens the legacy app)` : undefined}
          >
            <NavIcon name={item.key} />
            <span>{item.label}</span>
          </Link>
        );
      })}
    </nav>
  );
}
