"use client";

import { ArrowRight, LoaderCircle, Search, SendHorizontal } from "lucide-react";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import useSWR from "swr";
import { Empty, PageHeader, vars } from "@/components/bits";
import { Segmented } from "@/components/segmented";
import { LinkRow } from "@/components/link-views";
import { Markdown } from "@/components/markdown";
import { Button } from "@/components/ui/button";
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
      <form role="search" onSubmit={(e) => { e.preventDefault(); update({ q: input.trim() || null }); }} className="group/search relative">
        <Search className="pointer-events-none absolute top-1/2 left-0 size-5 -translate-y-1/2 text-muted-foreground" aria-hidden="true" />
        <input ref={inputRef} value={input} onChange={(e) => setInput(e.target.value)} aria-label="Describe what you're looking for"
          placeholder="Describe what you're looking for"
          className="h-16 w-full border-0 border-b border-foreground/25 bg-transparent pr-12 pl-9 font-serif text-[1.35rem] caret-lichen outline-none transition-colors duration-200 placeholder:text-muted-foreground/75 hover:border-foreground/50 focus:border-foreground focus-visible:outline-none sm:text-[1.6rem]" />
        <span aria-hidden="true" className="pointer-events-none absolute bottom-0 left-0 h-px w-full origin-left scale-x-0 bg-lichen transition-transform duration-500 ease-(--ease-out) group-focus-within/search:scale-x-100" />
        <button type="submit" aria-label="Search"
          className="press absolute top-1/2 right-0 grid size-11 -translate-y-1/2 place-items-center rounded-md text-muted-foreground hover:text-foreground">
          <ArrowRight className="size-5" />
        </button>
      </form>
      <div className="mt-4 flex flex-wrap items-center gap-2 text-sm">
        <Segmented label="Search mode" value={mode} onChange={(m) => update({ mode: m === "hybrid" ? null : m })}
          options={[["hybrid", "By meaning"], ["keyword", "Exact words"]]} />
        <select aria-label="Category" value={category} onChange={(e) => update({ category: e.target.value || null })}
          className="h-9 rounded-md border border-input bg-card/60 px-2.5 transition-colors hover:border-foreground/30">
          <option value="">All categories</option>
          {categories?.map((c) => <option key={c.name} value={c.name}>{c.name}</option>)}
        </select>
        <Button size="sm" variant={freeOnly ? "secondary" : "outline"} aria-pressed={freeOnly} onClick={() => update({ free: freeOnly ? null : "1" })}>
          Has a free plan
        </Button>
      </div>

      {!query && !category && !freeOnly ? (
        <div className="mt-12">
          <p className="mb-4 text-sm text-muted-foreground">Ask for what you need, the way you&apos;d ask a colleague:</p>
          <ul className="flex flex-col">
            {EXAMPLES.map((ex, i) => (
              <li key={ex} className="enter border-t last:border-b" style={vars({ "--i": i, "--d": "120ms" })}>
                <button type="button" onClick={() => update({ q: ex })}
                  className="group flex w-full items-baseline justify-between gap-4 py-3 text-left font-serif text-lg italic text-foreground/85 transition-colors duration-200 hover:text-foreground">
                  <span className="ink-link">{ex}</span>
                  <ArrowRight className="size-4 shrink-0 -translate-x-1 self-center text-muted-foreground opacity-0 transition-[translate,opacity] duration-200 group-hover:translate-x-0 group-hover:opacity-100 group-focus-visible:opacity-100" aria-hidden="true" />
                </button>
              </li>
            ))}
          </ul>
        </div>
      ) : isLoading && !data ? (
        <div className="mt-10 flex flex-col gap-3" aria-busy="true" aria-label="Searching">{Array.from({ length: 4 }, (_, i) => <Skeleton key={i} className="h-20" />)}</div>
      ) : error ? (
        <p className="mt-6 text-sm text-destructive">{(error as Error).message}</p>
      ) : data && data.results.length === 0 ? (
        <div className="mt-10">
          <Empty title="Nothing in your library matches that">
            Try describing the task differently, or switch to {mode === "hybrid" ? "exact words" : "search by meaning"}.
          </Empty>
        </div>
      ) : data ? (
        <div className="mt-10">
          <p className="mb-3 text-sm text-muted-foreground" aria-live="polite">
            <span className="display mr-1 text-2xl text-foreground tabular-nums">{data.results.length}</span>
            result{data.results.length === 1 ? "" : "s"}, best match first
          </p>
          <div className="border-y">
            {data.results.map((r, i) => <LinkRow key={r.link.id} link={r.link} reasons={r.reasons} index={i} />)}
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
    // Only follow the conversation once it exists; on load this would drag the page down on phones
    if (messages.length) endRef.current?.scrollIntoView({ behavior: "smooth", block: "nearest" });
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
    <section aria-labelledby="ask-h" className="enter flex flex-col rounded-xl border bg-card/80" style={vars({ "--d": "200ms" })}>
      <div className="border-b px-5 pt-5 pb-4">
        <h2 id="ask-h" className="title-md">Ask your library</h2>
        <p className="mt-1 text-sm text-muted-foreground">Answers use only the links you&apos;ve saved, with sources.</p>
      </div>
      <div className="flex max-h-[60vh] min-h-48 flex-col gap-4 overflow-y-auto p-5" aria-live="polite">
        {stats && !configured && (
          <p className="text-sm text-muted-foreground">
            The assistant needs an AI provider (Anthropic, OpenAI, Gemini or a local Ollama model).{" "}
            <Link href="/settings" className="underline">See how to set one up</Link>. Search works without it.
          </p>
        )}
        {messages.length === 0 && configured && (
          <ul className="flex flex-col gap-1.5 text-sm">
            {["Compare the AI writing tools I've saved", "Which of my tools can replace Zapier?", "Which saved websites are open source?"].map((q) => (
              <li key={q}><button type="button" className="group py-0.5 text-left font-serif text-base italic text-muted-foreground transition-colors hover:text-foreground" onClick={() => setInput(q)}><span className="ink-link">{q}</span></button></li>
            ))}
          </ul>
        )}
        {messages.map((m, i) => (
          <div key={i} className={cn("enter-fade text-sm", m.role === "user" && "max-w-[85%] self-end rounded-lg rounded-br-sm bg-primary px-3.5 py-2 text-primary-foreground")}>
            {m.role === "assistant" ? (
              <>
                {m.error ? <p className="text-destructive">{m.content}</p> : <Markdown compact>{m.content}</Markdown>}
                {m.sources && m.sources.length > 0 && (
                  <ol className="mt-3 flex list-decimal flex-col gap-1 pl-5 text-xs marker:text-muted-foreground">
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
      <form onSubmit={ask} className="flex items-end gap-2 border-t p-3.5">
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
      <div className="grid gap-14 xl:grid-cols-[minmax(0,1fr)_380px] xl:gap-16">
        <Results />
        <div className="xl:sticky xl:top-10 xl:self-start"><Assistant /></div>
      </div>
    </>
  );
}
