"use client";

import { LoaderCircle, Search, SendHorizontal } from "lucide-react";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import useSWR from "swr";
import { Empty, PageHeader } from "@/components/bits";
import { LinkRow } from "@/components/link-views";
import { Markdown } from "@/components/markdown";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { Textarea } from "@/components/ui/textarea";
import { api, ApiError } from "@/lib/api";
import type { Facet, LinkCard, SearchResult, Stats } from "@/lib/types";
import { cn } from "@/lib/utils";

const EXAMPLES = [
  "AI tool to make presentations",
  "convert or merge PDF files",
  "automate repetitive workflows without code",
  "debug and test APIs",
  "generate UI designs",
  "turn text into videos",
  "website builders",
  "open source alternatives",
];

interface Message { role: "user" | "assistant"; content: string; sources?: LinkCard[]; error?: boolean }

function Results() {
  const sp = useSearchParams();
  const router = useRouter();
  const pathname = usePathname();
  const query = sp.get("q") ?? "";
  const [input, setInput] = useState(query);
  const mode = sp.get("mode") === "keyword" ? "keyword" : "hybrid";
  const category = sp.get("category") ?? "";
  const freeOnly = sp.get("free") === "1";
  const inputRef = useRef<HTMLInputElement>(null);
  const { data: categories } = useSWR<Facet[]>("/api/categories");
  const filters = { category: category || undefined, free_plan: freeOnly ? true : undefined };
  const { data, isLoading, error } = useSWR<{ results: SearchResult[] }>(
    query || category || freeOnly ? ["/api/search", query, mode, category, freeOnly] : null,
    () => api("/api/search", { method: "POST", json: { query, mode, filters, limit: 30 } }),
  );

  const [shownQuery, setShownQuery] = useState(query);
  if (shownQuery !== query) {
    setShownQuery(query); // keep the box in sync when the URL changes (example chips, back button)
    setInput(query);
  }
  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  function update(next: Record<string, string | null>) {
    const p = new URLSearchParams(sp);
    for (const [k, v] of Object.entries(next)) {
      if (v) p.set(k, v);
      else p.delete(k);
    }
    router.replace(`${pathname}?${p}`);
  }

  return (
    <div>
      <form onSubmit={(e) => { e.preventDefault(); update({ q: input.trim() || null }); }} className="relative">
        <Search className="pointer-events-none absolute top-1/2 left-4 size-5 -translate-y-1/2 text-muted-foreground" aria-hidden="true" />
        <Input ref={inputRef} value={input} onChange={(e) => setInput(e.target.value)} aria-label="Describe what you're looking for"
          placeholder="Describe what you're looking for" className="h-14 rounded-lg pl-12 text-lg" />
      </form>
      <div className="mt-3 flex flex-wrap items-center gap-2 text-sm">
        <div className="flex rounded-md border p-0.5" role="group" aria-label="Search mode">
          {([["hybrid", "By meaning"], ["keyword", "Exact words"]] as const).map(([m, label]) => (
            <button key={m} type="button" aria-pressed={mode === m} onClick={() => update({ mode: m === "hybrid" ? null : m })}
              className={cn("rounded px-2.5 py-1 text-muted-foreground hover:text-foreground", mode === m && "bg-accent text-foreground")}>
              {label}
            </button>
          ))}
        </div>
        <select aria-label="Category" value={category} onChange={(e) => update({ category: e.target.value || null })}
          className="h-8 rounded-md border bg-background px-2">
          <option value="">All categories</option>
          {categories?.map((c) => <option key={c.name} value={c.name}>{c.name}</option>)}
        </select>
        <Button size="sm" variant={freeOnly ? "secondary" : "outline"} aria-pressed={freeOnly} onClick={() => update({ free: freeOnly ? null : "1" })}>
          Has a free plan
        </Button>
      </div>

      {!query && !category && !freeOnly ? (
        <div className="mt-8">
          <p className="mb-3 text-sm text-muted-foreground">Try asking for what you need, the way you&apos;d ask a colleague:</p>
          <ul className="flex flex-wrap gap-2">
            {EXAMPLES.map((ex) => (
              <li key={ex}>
                <button type="button" onClick={() => update({ q: ex })} className="rounded-md border bg-card px-3 py-1.5 text-sm hover:border-foreground/30">
                  {ex}
                </button>
              </li>
            ))}
          </ul>
        </div>
      ) : isLoading && !data ? (
        <div className="mt-6 flex flex-col gap-2">{Array.from({ length: 4 }, (_, i) => <Skeleton key={i} className="h-20" />)}</div>
      ) : error ? (
        <p className="mt-6 text-sm text-destructive">{(error as Error).message}</p>
      ) : data && data.results.length === 0 ? (
        <div className="mt-6">
          <Empty title="Nothing in your library matches that">
            Try describing the task differently, or switch to {mode === "hybrid" ? "exact words" : "search by meaning"}.
          </Empty>
        </div>
      ) : data ? (
        <div className="mt-6">
          <p className="mb-2 text-sm text-muted-foreground">{data.results.length} result{data.results.length === 1 ? "" : "s"}, best match first</p>
          <div className="overflow-hidden rounded-lg border bg-card">
            {data.results.map((r) => <LinkRow key={r.link.id} link={r.link} reasons={r.reasons} />)}
          </div>
        </div>
      ) : null}
    </div>
  );
}

function Assistant() {
  const { data: stats } = useSWR<Stats>("/api/stats");
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const endRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: "smooth", block: "nearest" });
  }, [messages]);

  async function ask(e?: React.FormEvent) {
    e?.preventDefault();
    const question = input.trim();
    if (!question || busy) return;
    const history = [...messages.filter((m) => !m.error), { role: "user" as const, content: question }];
    setMessages([...messages, { role: "user", content: question }]);
    setInput("");
    setBusy(true);
    try {
      const res = await api<{ answer: string; sources: LinkCard[] }>("/api/assistant", {
        method: "POST", json: { messages: history.map(({ role, content }) => ({ role, content })) },
      });
      setMessages((m) => [...m, { role: "assistant", content: res.answer, sources: res.sources }]);
    } catch (err) {
      setMessages((m) => [...m, { role: "assistant", content: err instanceof ApiError ? err.message : "Something went wrong.", error: true }]);
    } finally {
      setBusy(false);
    }
  }

  const configured = stats?.ai.configured;
  return (
    <section aria-labelledby="ask-h" className="flex flex-col rounded-lg border bg-card">
      <div className="border-b px-4 py-3">
        <h2 id="ask-h" className="font-medium">Ask your library</h2>
        <p className="text-sm text-muted-foreground">Answers use only the links you&apos;ve saved, with sources.</p>
      </div>
      <div className="flex max-h-[60vh] min-h-48 flex-col gap-4 overflow-y-auto p-4" aria-live="polite">
        {stats && !configured && (
          <p className="text-sm text-muted-foreground">
            The assistant needs an AI provider (Anthropic, OpenAI, Gemini or a local Ollama model).{" "}
            <Link href="/settings" className="underline">See how to set one up</Link>. Search works without it.
          </p>
        )}
        {messages.length === 0 && configured && (
          <ul className="flex flex-col gap-1.5 text-sm">
            {["Compare the AI writing tools I've saved", "Which of my tools can replace Zapier?", "Which saved websites are open source?"].map((q) => (
              <li key={q}><button type="button" className="text-left text-muted-foreground hover:text-foreground hover:underline" onClick={() => setInput(q)}>{q}</button></li>
            ))}
          </ul>
        )}
        {messages.map((m, i) => (
          <div key={i} className={cn("text-sm", m.role === "user" && "self-end rounded-lg bg-accent px-3 py-2")}>
            {m.role === "assistant" ? (
              <>
                {m.error ? <p className="text-destructive">{m.content}</p> : <Markdown compact>{m.content}</Markdown>}
                {m.sources && m.sources.length > 0 && (
                  <ol className="mt-2 flex flex-col gap-1 border-l-2 pl-3 text-xs">
                    {m.sources.map((s) => (
                      <li key={s.id}><Link href={`/links/${s.id}`} className="hover:underline">{s.name ?? s.domain}</Link> <span className="text-muted-foreground">{s.domain}</span></li>
                    ))}
                  </ol>
                )}
              </>
            ) : m.content}
          </div>
        ))}
        {busy && <p className="flex items-center gap-2 text-sm text-muted-foreground"><LoaderCircle className="size-4 animate-spin" /> Looking through your library…</p>}
        <div ref={endRef} />
      </div>
      <form onSubmit={ask} className="flex items-end gap-2 border-t p-3">
        <Textarea value={input} onChange={(e) => setInput(e.target.value)} rows={1} disabled={!configured}
          onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) ask(e); }}
          placeholder={configured ? "Ask a question" : "Set up an AI provider to ask questions"} aria-label="Question for the assistant"
          className="max-h-32 min-h-9 resize-none" />
        <Button type="submit" size="icon" disabled={!configured || busy || !input.trim()} aria-label="Send question"><SendHorizontal /></Button>
      </form>
    </section>
  );
}

export function SearchPage() {
  return (
    <>
      <PageHeader title="Search" description="Find saved links by describing the job you need done." />
      <div className="grid gap-8 xl:grid-cols-[minmax(0,1fr)_380px]">
        <Results />
        <div className="xl:sticky xl:top-8 xl:self-start"><Assistant /></div>
      </div>
    </>
  );
}
