"use client";

import { Search } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import useSWR from "swr";
import { toast } from "sonner";
import { useAddLinks } from "@/components/app-shell";
import { ButtonLink, Empty, PageHeader } from "@/components/bits";
import { LinkRow, useLinkActions } from "@/components/link-views";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { api } from "@/lib/api";
import { mineral } from "@/lib/format";
import type { Facet, Stats, Suggestion } from "@/lib/types";

/** Library composition drawn as a cairn: one stone per category, largest at the base. */
function Cairn({ categories, total }: { categories: Facet[]; total: number }) {
  const top = categories.slice(0, 7);
  const rest = categories.slice(7).reduce((n, c) => n + c.count, 0);
  const uncategorized = total - categories.reduce((n, c) => n + c.count, 0);
  const stones = [...top.map((c) => ({ name: c.name, count: c.count, href: `/links?category=${encodeURIComponent(c.name)}` }))];
  if (rest) stones.push({ name: "Other categories", count: rest, href: "/categories" });
  if (uncategorized > 0) stones.push({ name: "Not yet categorized", count: uncategorized, href: "/links" });
  stones.sort((a, b) => a.count - b.count); // smallest on top
  const max = Math.max(1, ...stones.map((s) => s.count));
  if (stones.length === 0) return null;
  return (
    <ol className="flex flex-col" aria-label="Library by category">
      {stones.map((s, i) => {
        const r = s.count / max;
        return (
          <li key={s.name} className="grid grid-cols-[minmax(0,1.15fr)_minmax(0,1fr)] items-center gap-5">
            <div className="flex justify-center" style={{ transform: `translateX(${(i % 2 ? 1 : -1) * 5}px)` }}>
              <Link href={s.href} aria-label={`${s.name}: ${s.count} links`}
                className="stone block transition-[filter] hover:brightness-110 focus-visible:outline-offset-4"
                style={{ width: `${26 + 74 * r}%`, height: `${20 + 18 * Math.sqrt(r)}px`, marginTop: i ? -3 : 0,
                  background: mineral(s.name), boxShadow: "inset 0 -5px 0 rgb(0 0 0 / 0.14), inset 0 3px 0 rgb(255 255 255 / 0.12)" }} />
            </div>
            <Link href={s.href} className="flex min-w-0 items-baseline gap-2 text-sm hover:underline">
              <span className="display text-xl tabular-nums">{s.count}</span>
              <span className="truncate text-muted-foreground">{s.name}</span>
            </Link>
          </li>
        );
      })}
    </ol>
  );
}

function Processing({ stats }: { stats: Stats }) {
  const { refresh } = useLinkActions();
  const done = stats.total - stats.in_progress;
  async function retryAll() {
    const r = await api<{ queued: number }>("/api/links/retry-failed", { method: "POST" });
    toast.success(`Retrying ${r.queued} link${r.queued === 1 ? "" : "s"}.`);
    refresh();
  }
  return (
    <section aria-labelledby="processing-h" className="rounded-lg border bg-card p-4">
      <h2 id="processing-h" className="font-medium">Processing</h2>
      {stats.in_progress > 0 ? (
        <>
          <p className="mt-1 text-sm text-muted-foreground">
            {stats.in_progress} link{stats.in_progress === 1 ? " is" : "s are"} being read and analyzed.
          </p>
          <div className="mt-3 h-1.5 overflow-hidden rounded-full bg-muted" role="progressbar"
            aria-valuemin={0} aria-valuemax={stats.total} aria-valuenow={done} aria-label="Links processed">
            <div className="h-full rounded-full bg-primary transition-[width] duration-700" style={{ width: `${(done / Math.max(1, stats.total)) * 100}%` }} />
          </div>
        </>
      ) : (
        <p className="mt-1 text-sm text-muted-foreground">Nothing in the queue.</p>
      )}
      <dl className="mt-4 grid grid-cols-2 gap-y-2 text-sm">
        <dt className="text-muted-foreground">Ready</dt><dd className="text-right tabular-nums">{stats.completed}</dd>
        <dt className="text-muted-foreground">Needs review</dt>
        <dd className="text-right tabular-nums">
          {stats.needs_review ? <Link className="hover:underline" href="/links?status=NEEDS_REVIEW">{stats.needs_review}</Link> : 0}
        </dd>
        <dt className="text-muted-foreground">Blocked by site</dt>
        <dd className="text-right tabular-nums">
          {stats.blocked ? <Link className="hover:underline" href="/links?status=BLOCKED">{stats.blocked}</Link> : 0}
        </dd>
        <dt className="text-muted-foreground">Failed</dt>
        <dd className="text-right tabular-nums">
          {stats.failed ? <Link className="text-destructive hover:underline" href="/links?status=FAILED">{stats.failed}</Link> : 0}
        </dd>
      </dl>
      {stats.failed > 0 && <Button variant="outline" size="sm" className="mt-3 w-full" onClick={retryAll}>Retry failed links</Button>}
      <p className="mt-4 border-t pt-3 text-xs text-muted-foreground">
        {stats.ai.configured
          ? <>AI analysis by {stats.ai.provider} ({stats.ai.fast_model})</>
          : <>No AI provider set: summaries come from page metadata only. <Link href="/settings" className="underline">Set one up</Link></>}
      </p>
    </section>
  );
}

function Suggestions({ items }: { items: Suggestion[] }) {
  const router = useRouter();
  const { refresh } = useLinkActions();
  if (!items.length) return null;
  async function createSmart(s: Suggestion) {
    const c = await api<{ id: string }>("/api/collections", { method: "POST", json: { name: s.name, rules: s.rules } });
    toast.success(`Created the “${s.name}” collection.`);
    refresh();
    router.push(`/collections/${c.id}`);
  }
  return (
    <section aria-labelledby="suggest-h">
      <h2 id="suggest-h" className="mb-2 font-medium">Suggestions</h2>
      <ul className="divide-y rounded-lg border bg-card">
        {items.map((s) => (
          <li key={s.type + (s.name ?? "")} className="flex flex-wrap items-center justify-between gap-3 px-4 py-3 text-sm">
            <span className="min-w-0 flex-1">{s.message}</span>
            {s.type === "smart_collection" && <Button size="sm" variant="outline" onClick={() => createSmart(s)}>Create collection</Button>}
            {s.type === "duplicates" && <ButtonLink size="sm" variant="outline" href="/links?duplicates=1">Review</ButtonLink>}
          </li>
        ))}
      </ul>
    </section>
  );
}

export function OverviewPage() {
  const router = useRouter();
  const openAdd = useAddLinks();
  const [q, setQ] = useState("");
  const { data: stats } = useSWR<Stats>("/api/stats", { refreshInterval: (d) => (d && d.in_progress > 0 ? 2500 : 0) });

  if (!stats) return <Skeleton className="h-96 w-full" />;

  if (stats.total === 0) {
    return (
      <>
        <PageHeader title="Welcome to Cairn" description="Save a link and Cairn reads the page, works out what it's for, and files it so you can find it by describing what you need." />
        <Empty title="Your library is empty" action={<Button onClick={openAdd}>Add your first links</Button>}>
          Paste a list of URLs, or import a TXT, CSV or bookmarks file. Each link is read, summarized, categorized and indexed for search.
        </Empty>
      </>
    );
  }

  return (
    <>
      <PageHeader title="Overview" description={`${stats.total} links in your library, ${stats.favorites} favorites.`} />
      <form className="relative mb-8 max-w-2xl" onSubmit={(e) => { e.preventDefault(); router.push(`/search?q=${encodeURIComponent(q)}`); }}>
        <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground" aria-hidden="true" />
        <Input value={q} onChange={(e) => setQ(e.target.value)} className="h-11 pl-9 text-base"
          placeholder="Describe what you need, e.g. turn text into a video" aria-label="Search your library" />
      </form>

      <div className="grid gap-8 lg:grid-cols-[minmax(0,1fr)_300px]">
        <section aria-labelledby="cairn-h">
          <div className="mb-4 flex items-baseline justify-between">
            <h2 id="cairn-h" className="font-medium">What you&apos;ve collected</h2>
            <Link href="/categories" className="text-sm text-muted-foreground hover:text-foreground hover:underline">All categories</Link>
          </div>
          <Cairn categories={stats.categories} total={stats.total} />
        </section>
        <Processing stats={stats} />
      </div>

      <div className="mt-10 grid gap-8 lg:grid-cols-[minmax(0,1fr)_300px]">
        <div className="flex min-w-0 flex-col gap-8">
          <Suggestions items={stats.suggestions} />
          <section aria-labelledby="recent-h">
            <div className="mb-2 flex items-baseline justify-between">
              <h2 id="recent-h" className="font-medium">Recently added</h2>
              <Link href="/links" className="text-sm text-muted-foreground hover:text-foreground hover:underline">All links</Link>
            </div>
            <div className="overflow-hidden rounded-lg border bg-card">
              {stats.recent.map((l) => <LinkRow key={l.id} link={l} />)}
            </div>
          </section>
          {stats.recently_accessed.length > 0 && (
            <section aria-labelledby="opened-h">
              <h2 id="opened-h" className="mb-2 font-medium">Recently opened</h2>
              <div className="overflow-hidden rounded-lg border bg-card">
                {stats.recently_accessed.map((l) => <LinkRow key={l.id} link={l} />)}
              </div>
            </section>
          )}
        </div>
        <section aria-labelledby="tags-h">
          <div className="mb-2 flex items-baseline justify-between">
            <h2 id="tags-h" className="font-medium">Most used tags</h2>
            <Link href="/tags" className="text-sm text-muted-foreground hover:text-foreground hover:underline">All tags</Link>
          </div>
          <ul className="flex flex-wrap gap-1.5">
            {stats.top_tags.map((t) => (
              <li key={t.name}>
                <Link href={`/links?tag=${encodeURIComponent(t.name)}`}
                  className="inline-flex items-baseline gap-1 rounded-md border bg-card px-2 py-1 text-sm hover:border-foreground/30">
                  #{t.name} <span className="text-xs tabular-nums text-muted-foreground">{t.count}</span>
                </Link>
              </li>
            ))}
            {stats.top_tags.length === 0 && <li className="text-sm text-muted-foreground">Tags appear once links are analyzed.</li>}
          </ul>
        </section>
      </div>
    </>
  );
}
