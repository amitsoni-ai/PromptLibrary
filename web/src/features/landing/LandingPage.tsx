import type { LandingData } from "@/server/landing";
import { FreeSampleCard, PremiumSampleCard } from "./SampleCard";

// Public marketing landing page for logged-out visitors to `/` (LANDING_V2).
// Full-bleed — no app sidebar (AppShell omits it for anonymous callers). Pure
// server component: every CTA is a real <a> to `/legacy` (next.config proxies
// that to the legacy sign-in / sign-up / access-code gate). No client JS except
// the small copy button on the free-prompt cards.

const BRAND_LINE = "Don't just use AI. Think with it.";
const nf = new Intl.NumberFormat("en-US");

const ROLES = [
  "Founders",
  "Managers",
  "Executives",
  "Sales",
  "Marketing",
  "L&D / HR",
  "Finance",
  "Product",
  "Support",
  "Consultants",
];

// "From prompt to progress" — mirrors the workflow in the product artwork.
const STEPS: { k: string; label: string; sub: string; icon: React.ReactNode }[] = [
  {
    k: "find",
    label: "Find",
    sub: "Search 3,500+ ready-to-use prompts by role and outcome.",
    icon: <path d="M9 3a6 6 0 1 0 3.5 10.9L17 18l1-1-4.1-4.5A6 6 0 0 0 9 3Z" />,
  },
  {
    k: "learn",
    label: "Learn",
    sub: "See why each prompt works — the framework is shown, not hidden.",
    icon: <path d="M3 5.5C3 4.7 3.7 4 4.5 4H10v13H4.5A1.5 1.5 0 0 1 3 15.5zM17 5.5c0-.8-.7-1.5-1.5-1.5H11v13h4.5a1.5 1.5 0 0 0 1.5-1.5z" />,
  },
  {
    k: "create",
    label: "Create",
    sub: "Build your own with the R‑C‑T‑F guardrails so you don't miss a part.",
    icon: <path d="M4 13.5 13.5 4l2.5 2.5L6.5 16H4zM12 5.5 14.5 8" />,
  },
  {
    k: "save",
    label: "Save",
    sub: "Keep the prompts that work in your personal library.",
    icon: <path d="M5 3h8l2 2v12l-5-3-5 3V3z" />,
  },
  {
    k: "use",
    label: "Use anywhere",
    sub: "Copy into ChatGPT, Claude, Gemini or Copilot — nothing to install.",
    icon: <path d="M10 3v9m0 0 3.5-3.5M10 12 6.5 8.5M4 15v1.5A1.5 1.5 0 0 0 5.5 18h9a1.5 1.5 0 0 0 1.5-1.5V15" />,
  },
];

const LEVELS: { code: string; name: string; adds: string; blurb: string }[] = [
  {
    code: "R‑C‑T‑F",
    name: "Level 1 — get a clean result",
    adds: "Role · Context · Task · Format",
    blurb: "Tell the model who to be, what it's working with, what to do, and how to hand it back.",
  },
  {
    code: "R‑C‑T‑F‑V‑V",
    name: "Level 2 — make it self‑check",
    adds: "+ Verification · Validation",
    blurb: "Ask it to check its own work and pressure‑test the answer before you see it.",
  },
  {
    code: "R‑C‑G‑T‑C‑E‑F‑V‑V",
    name: "Level 3 — think it through",
    adds: "+ Goal · Constraints · Examples",
    blurb: "State the real goal, the limits, and a model answer — for work that has to be right.",
  },
];

function Icon({ children, className = "h-5 w-5" }: { children: React.ReactNode; className?: string }) {
  return (
    <svg
      viewBox="0 0 20 20"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.6"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      aria-hidden="true"
    >
      {children}
    </svg>
  );
}

function PrimaryCta({ children = "Sign up free" }: { children?: React.ReactNode }) {
  return (
    <a
      href="/legacy"
      className="inline-flex items-center justify-center gap-2 rounded bg-accent px-5 py-3 font-display text-sm font-semibold text-accent-on shadow transition-colors duration-200 hover:bg-accent-strong focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
    >
      {children}
      <Icon className="h-4 w-4">
        <path d="M4 10h11M11 5.5 15.5 10 11 14.5" />
      </Icon>
    </a>
  );
}

function SecondaryCta({ children = "Log in" }: { children?: React.ReactNode }) {
  return (
    <a
      href="/legacy"
      className="inline-flex items-center justify-center rounded border border-border-strong bg-surface px-5 py-3 font-display text-sm font-semibold text-text transition-colors duration-200 hover:bg-surface-hover focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
    >
      {children}
    </a>
  );
}

function Eyebrow({ children }: { children: React.ReactNode }) {
  return (
    <p className="font-display text-xs font-semibold uppercase tracking-[0.18em] text-accent-strong">
      {children}
    </p>
  );
}

// Schematic product preview — echoes the app (Library / Learn / Practice / My
// Prompts, a search field, prompt rows with "Use prompt"). Pure CSS, decorative.
function ProductPreview() {
  const rows = ["Strategic planning prompt", "Customer interview → themes", "Weekly team update"];
  return (
    <div
      aria-hidden="true"
      className="overflow-hidden rounded-lg border border-border bg-surface shadow-lg"
    >
      <div className="flex items-center gap-1.5 border-b border-border bg-surface-2 px-3 py-2">
        <span className="h-2.5 w-2.5 rounded-full bg-border-strong" />
        <span className="h-2.5 w-2.5 rounded-full bg-border-strong" />
        <span className="h-2.5 w-2.5 rounded-full bg-border-strong" />
      </div>
      <div className="grid grid-cols-[128px_1fr] gap-0">
        <nav className="hidden flex-col gap-1 border-r border-border bg-surface-2 p-3 text-xs text-text-muted sm:flex">
          {["Library", "Learn", "Practice", "My Prompts"].map((l, i) => (
            <span
              key={l}
              className={
                "whitespace-nowrap rounded px-2 py-1.5 " +
                (i === 0 ? "bg-accent-soft font-semibold text-accent-strong" : "")
              }
            >
              {l}
            </span>
          ))}
        </nav>
        <div className="p-4">
          <div className="flex items-center gap-2 rounded border border-border-strong bg-surface px-3 py-2 text-xs text-text-faint">
            <Icon className="h-3.5 w-3.5">
              <path d="M9 3a6 6 0 1 0 3.5 10.9L17 18l1-1-4.1-4.5A6 6 0 0 0 9 3Z" />
            </Icon>
            Find the right prompt for your work…
          </div>
          <div className="mt-3 flex flex-wrap gap-1.5">
            {["Level 1 · R‑C‑T‑F", "Level 2 · R‑C‑T‑F‑V‑V", "Level 3 · R‑C‑G‑T‑C‑E‑F‑V‑V"].map((t) => (
              <span
                key={t}
                className="rounded-sm bg-surface-2 px-2 py-0.5 font-mono text-[10px] text-text-muted"
              >
                {t}
              </span>
            ))}
          </div>
          <div className="mt-3 space-y-2">
            {rows.map((r, i) => (
              <div
                key={r}
                className="flex items-center justify-between rounded border border-border bg-surface px-3 py-2 text-xs"
              >
                <span className="truncate text-text">{r}</span>
                <span
                  className={
                    "ml-2 shrink-0 rounded-sm px-2 py-0.5 text-[10px] font-semibold " +
                    (i === 0
                      ? "bg-accent text-accent-on"
                      : "border border-border-strong text-text-muted")
                  }
                >
                  Use prompt →
                </span>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

export function LandingPage({ data }: { data: LandingData }) {
  const { prompts, categories, frameworkLevels } = data.counts;
  const leveled = frameworkLevels.reduce((n, l) => n + l.count, 0);

  return (
    <div className="font-body text-text">
      {/* ── Top bar ──────────────────────────────────────────────────────── */}
      <header className="sticky top-0 z-20 border-b border-border bg-bg">
        <div className="mx-auto flex max-w-6xl items-center justify-between px-4 py-3 sm:px-6">
          <a href="/legacy" aria-label="Prompt Intelligence by Synottic — home">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src="/prompt-intelligence.png"
              alt="Prompt Intelligence by Synottic"
              width={1962}
              height={338}
              className="landing-logo h-8 w-auto sm:h-12 lg:h-14"
            />
          </a>
          <nav className="flex items-center gap-2">
            <a
              href="/legacy"
              className="rounded px-3 py-2 text-sm font-medium text-text-muted transition-colors duration-200 hover:text-text focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
            >
              Log in
            </a>
            <a
              href="/legacy"
              className="rounded bg-accent px-3.5 py-2 text-sm font-semibold text-accent-on transition-colors duration-200 hover:bg-accent-strong focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
            >
              Sign up free
            </a>
          </nav>
        </div>
      </header>

      {/* ── Hero ─────────────────────────────────────────────────────────── */}
      <section className="border-b border-border bg-gradient-to-b from-accent-soft to-bg">
        <div className="mx-auto grid max-w-6xl gap-12 px-4 py-16 sm:px-6 sm:py-24 lg:grid-cols-[1.05fr_0.95fr] lg:items-center lg:gap-10">
          <div className="motion-safe:animate-[fadeUp_.5s_ease-out]">
            <Eyebrow>AI workspace for real work</Eyebrow>
            <h1 className="mt-4 text-balance font-display text-4xl font-semibold leading-[1.05] tracking-tight text-text sm:text-6xl">
              {BRAND_LINE}
            </h1>
            <p className="mt-5 max-w-xl text-lg leading-relaxed text-text-muted">
              A library of <span className="font-semibold text-text">{nf.format(prompts)} role‑based prompts</span>{" "}
              and a simple framework for writing your own — so AI gives you sharper thinking and
              finished work, not first drafts you have to redo.
            </p>
            <div className="mt-8 flex flex-col gap-3 sm:flex-row">
              <PrimaryCta />
              <SecondaryCta />
            </div>
            <p className="mt-4 text-sm text-text-faint">
              Free to start · no credit card ·{" "}
              <a href="/legacy" className="font-medium text-accent-strong underline-offset-2 hover:underline">
                have an access code?
              </a>
            </p>
            <dl className="mt-8 flex flex-wrap gap-x-8 gap-y-3 border-t border-border pt-6 text-sm">
              {[
                [nf.format(prompts), "curated prompts"],
                [nf.format(categories), "categories"],
                ["3", "framework levels"],
              ].map(([n, l]) => (
                <div key={l} className="flex items-baseline gap-2">
                  <dd className="font-display text-lg font-semibold tabular-nums text-text">{n}</dd>
                  <dt className="text-text-muted">{l}</dt>
                </div>
              ))}
            </dl>
          </div>
          <div className="lg:pl-4">
            <ProductPreview />
            <p className="mt-3 text-center font-display text-sm italic text-text-faint">
              From prompt to progress.
            </p>
          </div>
        </div>
      </section>

      {/* ── Role band ────────────────────────────────────────────────────── */}
      <section className="border-b border-border bg-surface">
        <div className="mx-auto max-w-6xl px-4 py-10 sm:px-6">
          <p className="text-sm font-medium text-text-muted">
            Built for the work your team already does
          </p>
          <ul className="mt-4 flex flex-wrap gap-2">
            {ROLES.map((r) => (
              <li
                key={r}
                className="rounded-sm border border-border bg-surface-2 px-3 py-1.5 text-sm text-text-muted"
              >
                {r}
              </li>
            ))}
          </ul>
        </div>
      </section>

      {/* ── Why Synottic / the framework ─────────────────────────────────── */}
      <section aria-labelledby="why" className="mx-auto max-w-6xl px-4 py-20 sm:px-6 sm:py-28">
        <Eyebrow>Why Synottic</Eyebrow>
        <h2 id="why" className="mt-3 max-w-2xl text-balance font-display text-3xl font-semibold tracking-tight text-text sm:text-4xl">
          A prompt is a way of thinking — not a magic phrase.
        </h2>
        <p className="mt-4 max-w-2xl text-lg leading-relaxed text-text-muted">
          Most &ldquo;prompt packs&rdquo; are a pile of one‑liners. Synottic is built on{" "}
          <span className="font-semibold text-text">R‑C‑T‑F</span> — a repeatable structure you can
          feel yourself getting better at. Every prompt in the library is scored against it, so you
          always see <em>why</em> it works and can lift the pattern into your own.
        </p>

        <div className="mt-10 grid gap-4 md:grid-cols-3">
          {LEVELS.map((lv, i) => {
            const count = frameworkLevels[i]?.count ?? 0;
            return (
              <div
                key={lv.code}
                className="flex flex-col rounded-lg border border-border bg-surface p-5 shadow"
              >
                <span className="inline-flex w-fit items-center rounded-sm bg-accent-soft px-2 py-1 font-mono text-xs font-semibold text-accent-strong">
                  {lv.code}
                </span>
                <h3 className="mt-3 font-display text-base font-semibold text-text">{lv.name}</h3>
                <p className="mt-1 text-sm font-medium text-text-muted">{lv.adds}</p>
                <p className="mt-3 text-sm leading-relaxed text-text-muted">{lv.blurb}</p>
                <p className="mt-4 border-t border-border pt-3 font-display text-sm font-semibold tabular-nums text-text">
                  {nf.format(count)}{" "}
                  <span className="font-body font-normal text-text-faint">prompts at this level</span>
                </p>
              </div>
            );
          })}
        </div>
        <p className="mt-6 text-sm text-text-faint">
          {nf.format(leveled)} of {nf.format(prompts)} prompts carry a derived framework level — the
          rest are still solid starting points.
        </p>
      </section>

      {/* ── How it works ─────────────────────────────────────────────────── */}
      <section aria-labelledby="how" className="border-y border-border bg-surface">
        <div className="mx-auto max-w-6xl px-4 py-20 sm:px-6 sm:py-24">
          <Eyebrow>How it works</Eyebrow>
          <h2 id="how" className="mt-3 font-display text-3xl font-semibold tracking-tight text-text sm:text-4xl">
            From prompt to progress
          </h2>
          <ol className="mt-10 grid gap-6 sm:grid-cols-2 lg:grid-cols-5">
            {STEPS.map((s, i) => (
              <li key={s.k} className="flex flex-col gap-3">
                <div className="flex items-center gap-2">
                  <span className="flex h-8 w-8 items-center justify-center rounded-full bg-accent-soft font-display text-sm font-semibold text-accent-strong">
                    {i + 1}
                  </span>
                  <Icon className="h-5 w-5 text-text-faint">{s.icon}</Icon>
                </div>
                <h3 className="font-display text-base font-semibold text-text">{s.label}</h3>
                <p className="text-sm leading-relaxed text-text-muted">{s.sub}</p>
              </li>
            ))}
          </ol>
        </div>
      </section>

      {/* ── Free prompts ─────────────────────────────────────────────────── */}
      <section aria-labelledby="free" className="mx-auto max-w-6xl px-4 py-20 sm:px-6 sm:py-28">
        <div className="flex flex-wrap items-end justify-between gap-4">
          <div>
            <Eyebrow>Start now, no account</Eyebrow>
            <h2 id="free" className="mt-3 font-display text-3xl font-semibold tracking-tight text-text sm:text-4xl">
              {data.freeSamples.length} prompts you can copy right now
            </h2>
            <p className="mt-3 max-w-2xl text-lg leading-relaxed text-text-muted">
              Fully readable, ready to paste into any AI tool. No sign‑up, no email.
            </p>
          </div>
        </div>
        <div className="mt-8 grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {data.freeSamples.map((s) => (
            <FreeSampleCard key={s.id} sample={s} />
          ))}
        </div>
      </section>

      {/* ── Inside the full library — by category ───────────────────────── */}
      <section aria-labelledby="premium" className="border-t border-border bg-surface-2">
        <div className="mx-auto max-w-6xl px-4 py-20 sm:px-6 sm:py-28">
          <Eyebrow>Inside the full library</Eyebrow>
          <h2 id="premium" className="mt-3 font-display text-3xl font-semibold tracking-tight text-text sm:text-4xl">
            {nf.format(categories)} categories. {nf.format(prompts)} prompts. One free account.
          </h2>
          <p className="mt-3 max-w-2xl text-lg leading-relaxed text-text-muted">
            Whatever your work touches, there&rsquo;s a shelf for it. Sign up free to open any
            category and read, copy, save and adapt every prompt in it.
          </p>

          <ul className="mt-10 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
            {data.categories.map((c) => (
              <li key={c.name}>
                <a
                  href="/legacy"
                  className="group flex h-full items-center justify-between gap-2 rounded-lg border border-border bg-surface px-4 py-3 shadow transition-all duration-200 hover:border-accent hover:shadow-lg focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
                  aria-label={`${c.name} — ${c.count} prompts. Sign up free to browse.`}
                >
                  <span className="min-w-0">
                    <span className="block truncate font-display text-sm font-semibold text-text">
                      {c.name}
                    </span>
                    <span className="mt-0.5 block font-mono text-xs tabular-nums text-text-muted">
                      {nf.format(c.count)} prompts
                    </span>
                  </span>
                  <svg
                    width="14"
                    height="14"
                    viewBox="0 0 20 20"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="1.6"
                    aria-hidden="true"
                    className="shrink-0 text-text-faint transition-colors duration-200 group-hover:text-accent-strong"
                  >
                    <rect x="4" y="9" width="12" height="8" rx="1.5" />
                    <path d="M7 9V6.5a3 3 0 0 1 6 0V9" />
                  </svg>
                </a>
              </li>
            ))}
          </ul>

          <div className="mt-10 flex flex-col gap-3 sm:flex-row sm:items-center">
            <PrimaryCta>Unlock the full library — free</PrimaryCta>
            <SecondaryCta>Log in</SecondaryCta>
          </div>

          {data.premiumSamples.length ? (
            <div className="mt-16">
              <h3 className="font-display text-lg font-semibold text-text">A few, locked for now</h3>
              <p className="mt-1 text-sm text-text-muted">
                The kind of prompt waiting behind the sign‑up.
              </p>
              <div className="mt-6 grid gap-4 md:grid-cols-2 xl:grid-cols-4">
                {data.premiumSamples.map((s) => (
                  <PremiumSampleCard key={s.id} sample={s} />
                ))}
              </div>
            </div>
          ) : null}
        </div>
      </section>

      {/* ── Proof / who it's for ────────────────────────────────────────── */}
      <section className="mx-auto max-w-6xl px-4 py-20 sm:px-6 sm:py-24">
        <dl className="grid gap-6 rounded-lg border border-border bg-surface p-8 shadow sm:grid-cols-4">
          {[
            [nf.format(prompts), "curated prompts"],
            [nf.format(categories), "categories"],
            ["3", "framework levels"],
            ["4", "AI tools supported"],
          ].map(([n, l]) => (
            <div key={l}>
              <dd className="font-display text-3xl font-semibold tabular-nums text-text">{n}</dd>
              <dt className="mt-1 text-sm text-text-muted">{l}</dt>
            </div>
          ))}
        </dl>
        <h2 className="mt-12 font-display text-2xl font-semibold tracking-tight text-text">
          Who it&rsquo;s for
        </h2>
        <p className="mt-3 max-w-2xl text-lg leading-relaxed text-text-muted">
          Individuals who want AI to actually save them time, teams that want one shared way of
          working with it, and learners building the skill from the ground up.
        </p>
      </section>

      {/* ── Final CTA ───────────────────────────────────────────────────── */}
      <section className="border-t border-border bg-gradient-to-b from-bg to-accent-soft">
        <div className="mx-auto max-w-3xl px-4 py-20 text-center sm:px-6 sm:py-28">
          <h2 className="text-balance font-display text-3xl font-semibold tracking-tight text-text sm:text-4xl">
            {BRAND_LINE}
          </h2>
          <p className="mt-4 text-lg leading-relaxed text-text-muted">
            Start with the free prompts. Create an account when you want the whole library.
          </p>
          <div className="mt-8 flex flex-col justify-center gap-3 sm:flex-row">
            <PrimaryCta />
            <SecondaryCta />
          </div>
        </div>
      </section>

      {/* ── Footer ──────────────────────────────────────────────────────── */}
      <footer className="border-t border-border bg-surface">
        <div className="mx-auto flex max-w-6xl flex-col gap-3 px-4 py-8 text-sm text-text-faint sm:flex-row sm:items-center sm:justify-between sm:px-6">
          <div className="flex items-center gap-3">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src="/prompt-intelligence.png"
              alt="Prompt Intelligence by Synottic"
              width={1962}
              height={338}
              className="landing-logo h-8 w-auto"
            />
            <span>— Human‑Centred AI.</span>
          </div>
          <a href="/legacy" className="font-medium text-accent-strong underline-offset-2 hover:underline">
            Sign in
          </a>
        </div>
      </footer>
    </div>
  );
}
