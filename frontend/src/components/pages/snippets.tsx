"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import useSWR from "swr";
import { Empty, PageHeader } from "@/components/bits";
import { PageSkeleton } from "@/components/page-skeleton";
import { SnippetBlock } from "@/components/pages/link-detail";
import { Input } from "@/components/ui/input";
import { qs } from "@/lib/api";
import type { Snippet } from "@/lib/types";

export function SnippetsPage() {
  const [q, setQ] = useState("");
  const [debounced, setDebounced] = useState("");
  const [language, setLanguage] = useState("");
  useEffect(() => {
    const t = setTimeout(() => setDebounced(q), 250);
    return () => clearTimeout(t);
  }, [q]);
  const { data } = useSWR<Snippet[]>(`/api/snippets${qs({ q: debounced, language, limit: 100 })}`);
  const { data: all } = useSWR<Snippet[]>("/api/snippets?limit=200");
  const languages = [...new Set((all ?? []).map((s) => s.language).filter(Boolean) as string[])].sort();

  return (
    <>
      <PageHeader title="Code snippets" description="Code found on the documentation and repositories you saved." />
      <div className="mb-6 flex flex-wrap gap-2">
        <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search code" aria-label="Search code" className="h-8 w-full sm:w-72" />
        <select aria-label="Language" value={language} onChange={(e) => setLanguage(e.target.value)} className="h-8 rounded-md border bg-background px-2 text-sm">
          <option value="">All languages</option>
          {languages.map((l) => <option key={l} value={l}>{l}</option>)}
        </select>
      </div>
      {!data ? <PageSkeleton /> : data.length === 0 ? (
        <Empty title={q || language ? "No snippets match" : "No code snippets yet"}>
          {q || language ? "Try another word or language." : "Save developer docs or GitHub repositories and their code examples appear here."}
        </Empty>
      ) : (
        <div className="grid gap-6 xl:grid-cols-2">
          {data.map((s) => (
            <div key={s.id} className="min-w-0">
              <Link href={`/links/${s.link_id}`} className="mb-1.5 inline-block text-sm font-medium hover:underline">{s.link_name}</Link>
              <SnippetBlock code={s.code} language={s.language} context={s.context} />
            </div>
          ))}
        </div>
      )}
    </>
  );
}
