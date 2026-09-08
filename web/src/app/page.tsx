import { getAccess } from "@/server/auth";
import { resolveScope } from "@/server/scope";
import { getHomeData } from "@/server/home";
import { HomeSearch } from "@/features/home/HomeSearch";
import { HomeSections } from "@/features/home/HomeSections";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// 1:1 with src/part_app_3.js#greeting.
function greeting(): string {
  const h = new Date().getHours();
  return h < 12 ? "Good morning" : h < 18 ? "Good afternoon" : "Good evening";
}

// Home landing (reached only when HOME_V2 is on + authenticated — see
// middleware.ts). Continue-card / program-companion are intentionally omitted
// this slice (Learn/Practice-coupled) — see MIGRATION.md Phase 3.
export default async function HomePage() {
  const access = await getAccess();
  const scope = resolveScope(access);
  const data = await getHomeData(access, scope);

  return (
    <div className="mx-auto max-w-6xl px-4 py-10 sm:px-6">
      <div className="mx-auto max-w-2xl text-center">
        <p className="font-body text-sm text-text-muted">
          {greeting()}
          {access.org ? ` · ${access.org}` : ""}
        </p>
        <h1 className="mt-1 font-display text-3xl font-semibold text-text">
          What do you want to accomplish?
        </h1>
        <div className="mt-6 text-left">
          <HomeSearch examples={data.searchExamples} />
        </div>
      </div>

      <HomeSections
        recommended={data.recommended}
        recentlyUsed={data.recentlyUsed}
        saved={data.saved}
      />
    </div>
  );
}
