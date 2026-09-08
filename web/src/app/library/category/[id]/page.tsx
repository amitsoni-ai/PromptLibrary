import { notFound } from "next/navigation";
import Link from "next/link";
import { getAccess } from "@/server/auth";
import { resolveScope } from "@/server/scope";
import { listPrompts, categoriesInScope } from "@/server/prompts";
import { LibraryView } from "@/features/library/LibraryView";
import type { PromptsListResponse } from "@/contracts/prompts";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Category detail — the Library filtered to one category.
export default async function CategoryPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const category = decodeURIComponent(id);

  const access = await getAccess();
  const scope = resolveScope(access);
  const cats = await categoriesInScope(scope);
  const known = cats.categories.find((c) => c.category === category);
  if (!known) notFound();

  const page = await listPrompts(scope, { limit: 30, category });
  const initialPage: PromptsListResponse = {
    ...page,
    scope: { mode: scope.mode, restricted: scope.restricted, label: scope.label },
  };

  return (
    <div>
      <div className="mx-auto max-w-6xl px-4 pt-6 sm:px-6">
        <Link href="/library" className="text-sm text-accent hover:text-accent-strong">
          ← All categories
        </Link>
      </div>
      <LibraryView
        scope={initialPage.scope}
        categories={cats.categories}
        initialPage={initialPage}
        initialFilters={{ category }}
        heading={category}
      />
    </div>
  );
}
