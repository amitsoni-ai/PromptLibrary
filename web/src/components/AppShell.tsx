import { getAccess } from "@/server/auth";
import { NavSidebar } from "./NavSidebar";

// Wraps every Next-rendered page (root layout). The primary nav sidebar is app
// chrome — it renders only for AUTHENTICATED callers (see
// src/part_app_5.js#renderNav for the legacy equivalent). A logged-out visitor
// on the public marketing landing (`/` with LANDING_V2 on) gets a full-bleed,
// chrome-free layout. Authenticated Home/Library are unchanged: those screens
// were always reached authenticated, so they always had — and still have — the
// sidebar. Pages the flags gate to legacy never render this at all (the
// middleware rewrites them away before Next's own layout runs).
export async function AppShell({ children }: { children: React.ReactNode }) {
  const access = await getAccess();

  return (
    <div className="flex min-h-screen bg-bg">
      {access.authenticated && <NavSidebar />}
      <main className="min-w-0 flex-1">{children}</main>
    </div>
  );
}
