"use client";

import Link from "next/link";
import useSWR from "swr";
import { Empty, PageHeader, vars } from "@/components/bits";
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
        <div className="columns-1 gap-12 md:columns-2 xl:columns-3">
          {data.map((top, i) => (
            <section key={top.name} className="enter mb-12 break-inside-avoid" style={vars({ "--i": i })}>
              <Link href={`/links?category=${encodeURIComponent(top.name)}`} className="group flex items-center gap-3">
                <span className="stone inline-block h-4 w-7" style={{ background: mineral(top.name) }} aria-hidden="true" />
                <h2 className="display text-[1.9rem]"><span className="ink-link">{top.name}</span></h2>
                <span className="display ml-auto text-xl tabular-nums text-muted-foreground">{top.count}</span>
              </Link>
              {top.children.length > 0 && (
                <ul className="mt-3 border-t pl-10">
                  {top.children.map((c) => (
                    <li key={c.name}>
                      <Link href={`/links?subcategory=${encodeURIComponent(c.name)}`} className="group flex justify-between gap-3 border-b py-1.5 text-sm">
                        <span className="ink-link">{c.name}</span><span className="tabular-nums text-muted-foreground">{c.count}</span>
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
        <div className="columns-2 gap-10 sm:columns-3 lg:columns-4">
          {[...groups.entries()].map(([letter, tags]) => (
            <section key={letter} className="mb-6 break-inside-avoid">
              <h2 className="display mb-2 border-b pb-1 text-[2.2rem] text-muted-foreground">{letter}</h2>
              <ul>
                {tags.map((t) => (
                  <li key={t.name}>
                    <Link href={`/links?tag=${encodeURIComponent(t.name)}`} className="group flex justify-between gap-2 py-1 text-sm">
                      <span className="ink-link truncate">{t.name}</span><span className="tabular-nums text-muted-foreground">{t.count}</span>
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
