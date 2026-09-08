import { getAccess } from "@/server/auth";
import { resolveScope } from "@/server/scope";
import { listPrompts, categoriesInScope } from "@/server/prompts";
import { LibraryView } from "@/features/library/LibraryView";
import type { PromptsListResponse } from "@/contracts/prompts";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Library landing. RSC renders the scoped first page + categories; the client
// LibraryView takes over for search / filters / infinite scroll / saved.
export default async function LibraryPage() {
  const access = await getAccess();
  const scope = resolveScope(access);
  const [page, cats] = await Promise.all([
    listPrompts(scope, { limit: 30 }),
    categoriesInScope(scope),
  ]);

  const initialPage: PromptsListResponse = {
    ...page,
    scope: { mode: scope.mode, restricted: scope.restricted, label: scope.label },
  };

  return (
    <LibraryView
      scope={initialPage.scope}
      categories={cats.categories}
      initialPage={initialPage}
    />
  );
}
