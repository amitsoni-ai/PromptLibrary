import type { Metadata } from "next";
import { getAccess } from "@/server/auth";
import { resolveScope } from "@/server/scope";
import { getHomeData } from "@/server/home";
import { getLandingData } from "@/server/landing";
import { HomeSearch } from "@/features/home/HomeSearch";
import { HomeSections } from "@/features/home/HomeSections";
import { LandingPage } from "@/features/landing/LandingPage";

export const runtime = "nodejs";
export const dynamic = "force-dynamic"; // branches on identity (anon → landing, authed → dashboard)

// Marketing copy — reused from src/part_head.html (BRAND COPY ONLY; read, never
// edited). "Don't just use AI. Think with it." is the product's brand line.
const BRAND_LINE = "Don't just use AI. Think with it.";
const META_DESC =
  "Don't just use AI. Think with it. Your AI workspace for better thinking and better work — " +
  "find the right prompt, build better workflows, practice new AI skills, and apply them to real work.";
const OG_DESC =
  "Don't just use AI. Think with it. Your AI workspace for better thinking and better work.";

// Only the ANONYMOUS `/` gets a marketing document head — that's the case the
// landing serves (see middleware LANDING_V2). Authenticated `/` returns `{}` so
// it keeps inheriting the app metadata from the root layout, unchanged.
export async function generateMetadata(): Promise<Metadata> {
  const access = await getAccess();
  if (access.authenticated) return {};
  return {
    title: `Synottic Prompt Intelligence — ${BRAND_LINE}`,
    description: META_DESC,
    openGraph: {
      type: "website",
      title: "Synottic Prompt Intelligence",
      description: OG_DESC,
      images: ["/og-image.png"],
    },
    twitter: {
      card: "summary_large_image",
      title: "Synottic Prompt Intelligence",
      description: OG_DESC,
      images: ["/og-image.png"],
    },
  };
}

// 1:1 with src/part_app_3.js#greeting.
function greeting(): string {
  const h = new Date().getHours();
  return h < 12 ? "Good morning" : h < 18 ? "Good afternoon" : "Good evening";
}

// `/` — the app's front door. Anonymous callers (reached here only when
// LANDING_V2 is on — see middleware.ts) get the public marketing landing page;
// authenticated callers get the Home dashboard exactly as before. Continue-card /
// program-companion are intentionally omitted this slice (Learn/Practice-coupled)
// — see MIGRATION.md Phase 3.
export default async function HomePage() {
  const access = await getAccess();

  if (!access.authenticated) {
    const landing = await getLandingData();
    return <LandingPage data={landing} />;
  }

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
