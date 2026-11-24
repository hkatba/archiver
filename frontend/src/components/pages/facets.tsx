"use client";

import Link from "next/link";
import useSWR from "swr";
import { Empty, PageHeader } from "@/components/bits";
import { PageSkeleton } from "@/components/page-skeleton";
import { mineral } from "@/lib/format";
import type { Facet } from "@/lib/types";

export function CategoriesPage() {
  const { data } = useSWR<Facet[]>("/api/categories");
  if (!data) return <PageSkeleton />;
  return (
    <>
      <PageHeader title="Categories" description="What each saved link does, grouped by area." />
      {data.length === 0 ? <Empty title="No categories yet">Categories are assigned when links are analyzed.</Empty> : (
        <div className="columns-1 gap-8 md:columns-2 xl:columns-3">
          {data.map((top) => (
            <section key={top.name} className="mb-8 break-inside-avoid">
              <Link href={`/links?category=${encodeURIComponent(top.name)}`} className="group flex items-center gap-3">
                <span className="stone inline-block h-4 w-7" style={{ background: mineral(top.name) }} aria-hidden="true" />
                <h2 className="display text-2xl group-hover:underline">{top.name}</h2>
                <span className="ml-auto text-sm tabular-nums text-muted-foreground">{top.count}</span>
              </Link>
              {top.children.length > 0 && (
                <ul className="mt-2 border-l pl-4" style={{ borderColor: mineral(top.name) }}>
                  {top.children.map((c) => (
                    <li key={c.name}>
                      <Link href={`/links?subcategory=${encodeURIComponent(c.name)}`} className="flex justify-between gap-3 py-1 text-sm hover:underline">
                        <span>{c.name}</span><span className="tabular-nums text-muted-foreground">{c.count}</span>
                      </Link>
                    </li>
                  ))}
                </ul>
              )}
            </section>
          ))}
        </div>
      )}
    </>
  );
}

export function TagsPage() {
  const { data } = useSWR<Facet[]>("/api/tags");
  if (!data) return <PageSkeleton />;
  const groups = new Map<string, Facet[]>();
  [...data].sort((a, b) => a.name.localeCompare(b.name)).forEach((t) => {
    const k = /[a-z]/.test(t.name[0]) ? t.name[0].toUpperCase() : "#";
    groups.set(k, [...(groups.get(k) ?? []), t]);
  });
  return (
    <>
      <PageHeader title="Tags" description={`${data.length} tags across your library.`} />
      {data.length === 0 ? <Empty title="No tags yet">Tags are added when links are analyzed, and you can edit them on any link.</Empty> : (
        <div className="columns-2 gap-8 sm:columns-3 lg:columns-4">
          {[...groups.entries()].map(([letter, tags]) => (
            <section key={letter} className="mb-6 break-inside-avoid">
              <h2 className="display mb-1 text-2xl text-muted-foreground">{letter}</h2>
              <ul>
                {tags.map((t) => (
                  <li key={t.name}>
                    <Link href={`/links?tag=${encodeURIComponent(t.name)}`} className="flex justify-between gap-2 py-0.5 text-sm hover:underline">
                      <span className="truncate">{t.name}</span><span className="tabular-nums text-muted-foreground">{t.count}</span>
                    </Link>
                  </li>
                ))}
              </ul>
            </section>
          ))}
        </div>
      )}
    </>
  );
}
