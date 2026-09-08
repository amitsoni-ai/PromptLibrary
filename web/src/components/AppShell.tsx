import { NavSidebar } from "./NavSidebar";

// Wraps every Next-rendered page (root layout) with the primary nav sidebar —
// see src/part_app_5.js#renderNav for the legacy equivalent. Pages the flag
// gates to legacy never render this (the middleware rewrites them away before
// Next's own layout runs).
export function AppShell({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex min-h-screen bg-bg">
      <NavSidebar />
      <main className="min-w-0 flex-1">{children}</main>
    </div>
  );
}
