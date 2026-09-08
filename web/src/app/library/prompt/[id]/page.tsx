import { notFound } from "next/navigation";
import Link from "next/link";
import { getAccess } from "@/server/auth";
import { resolveScope } from "@/server/scope";
import { getPromptById } from "@/server/prompts";
import { Badge } from "@/components/ui";
import { frameworkBadge } from "@/lib/framework";
import { PromptDetailActions } from "@/features/library/PromptDetailActions";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Prompt detail (RSC). Scope-checked — an out-of-scope id 404s. Prompt text is
// rendered as plain text (React escapes children) — no HTML injection surface.
export default async function PromptPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const access = await getAccess();
  const scope = resolveScope(access);
  const prompt = await getPromptById(scope, id);
  if (!prompt) notFound();

  const fw = frameworkBadge(prompt.frameworkLevel ?? null);
  const body = prompt.originalPrompt || "";
  const variables = prompt.variables || [];

  return (
    <main className="mx-auto max-w-3xl px-4 py-8 sm:px-6">
      <Link
        href={`/library/category/${encodeURIComponent(prompt.category)}`}
        className="text-sm text-accent hover:text-accent-strong"
      >
        ← {prompt.category}
      </Link>

      <h1 className="mt-3 font-display text-2xl font-semibold text-text">{prompt.title}</h1>

      <div className="mt-3 flex flex-wrap items-center gap-1.5">
        <Badge tone="neutral">{prompt.category}</Badge>
        {fw ? <Badge tone="accent">{fw}</Badge> : null}
        {prompt.difficulty ? <Badge tone="blue">{prompt.difficulty}</Badge> : null}
        {prompt.isTemplate ? <Badge tone="warn">Template</Badge> : null}
        {prompt.role ? <Badge tone="neutral">{prompt.role}</Badge> : null}
      </div>

      {prompt.description ? (
        <p className="mt-4 text-text-muted">{prompt.description}</p>
      ) : null}

      <div className="mt-5">
        <PromptDetailActions promptId={prompt.id} copyText={body} />
      </div>

      <section className="mt-6">
        <h2 className="mb-2 font-display text-sm font-semibold uppercase tracking-wide text-text-faint">
          Prompt
        </h2>
        <pre className="overflow-x-auto whitespace-pre-wrap rounded-lg border border-border bg-surface-2 p-4 font-mono text-sm text-text">
          {body}
        </pre>
      </section>

      {variables.length ? (
        <section className="mt-6">
          <h2 className="mb-2 font-display text-sm font-semibold uppercase tracking-wide text-text-faint">
            Variables to fill in
          </h2>
          <div className="flex flex-wrap gap-1.5">
            {variables.map((v) => (
              <Badge key={v} tone="blue">
                {v}
              </Badge>
            ))}
          </div>
        </section>
      ) : null}

      {prompt.outcome ? (
        <section className="mt-6">
          <h2 className="mb-2 font-display text-sm font-semibold uppercase tracking-wide text-text-faint">
            Outcome
          </h2>
          <p className="text-text-muted">{prompt.outcome}</p>
        </section>
      ) : null}
    </main>
  );
}
