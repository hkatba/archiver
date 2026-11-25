"use client";

import { Grid2x2, LayoutList, Search, X } from "lucide-react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useEffect, useLayoutEffect, useRef, useState, useSyncExternalStore } from "react";
import useSWR from "swr";
import { toast } from "sonner";
import { useAddLinks } from "@/components/app-shell";
import { Count, Empty, PageHeader } from "@/components/bits";
import { Segmented } from "@/components/segmented";
import { LinkCollection, LinkRow, useLinkActions } from "@/components/link-views";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { api, qs } from "@/lib/api";
import { mineral, STATUS_LABEL } from "@/lib/format";
import { ScrollTrigger, useGSAP } from "@/lib/gsap";
import type { Facet, LinkCard, LinkStatus } from "@/lib/types";
import { cn } from "@/lib/utils";
import { ACTIVE } from "@/lib/types";

const CHIP_LABELS: Record<string, string> = {
  category: "Category", subcategory: "Type", tag: "Tag", domain: "Site", duplicates: "Possible duplicates",
  deleted: "Trash", open_source: "Open source",
};

const selectCls = "h-9 rounded-md border border-input bg-card/60 px-2.5 text-sm transition-colors hover:border-foreground/30";

function readView(): "grid" | "list" {
  try {
    return localStorage.getItem("cairn.view") === "list" ? "list" : "grid";
  } catch {
    return "grid";
  }
}
function subscribeView(cb: () => void) {
  window.addEventListener("storage", cb);
  return () => window.removeEventListener("storage", cb);
}
function usePersistedView(): ["grid" | "list", (v: "grid" | "list") => void] {
  const view = useSyncExternalStore(subscribeView, readView, () => "grid" as const);
  return [view, (v) => {
    try { localStorage.setItem("cairn.view", v); } catch {}
    window.dispatchEvent(new StorageEvent("storage"));
  }];
}

/** Categories as a typographic rail; a lichen rule slides under the chosen one. Scrolls sideways on phones. */
function CategoryRail({ active, onPick }: { active: string | null; onPick: (c: string | null) => void }) {
  const { data } = useSWR<Facet[]>("/api/categories");
  const list = useRef<HTMLDivElement>(null);
  const bar = useRef<HTMLSpanElement>(null);
  useLayoutEffect(() => {
    const el = list.current?.querySelector<HTMLElement>("[aria-pressed=true]");
    if (!el || !bar.current) return;
    const first = !bar.current.dataset.placed;
    bar.current.style.transitionDuration = first ? "0ms" : "";
    bar.current.style.transform = `translateX(${el.offsetLeft}px) scaleX(${el.offsetWidth / 100})`;
    bar.current.dataset.placed = "1";
    if (!first) el.scrollIntoView({ block: "nearest", inline: "nearest", behavior: "smooth" });
  }, [active, data]);
  if (!data?.length) return null;
  return (
    <div className="-mx-5 overflow-x-auto px-5 [mask-image:linear-gradient(to_right,black_calc(100%-72px),transparent)] [scrollbar-width:none] sm:-mx-10 sm:px-10 lg:-mx-14 lg:px-14">
      <div ref={list} role="group" aria-label="Category" className="relative flex w-max gap-6 border-b pr-5">
        {[null, ...data].map((c) => {
          const name = c?.name ?? null;
          const on = active === name;
          return (
            <button key={name ?? "all"} type="button" aria-pressed={on} onClick={() => onPick(name)}
              className={cn("inline-flex h-11 items-center gap-2 text-[0.9375rem] whitespace-nowrap transition-colors duration-200",
                on ? "text-foreground" : "text-muted-foreground hover:text-foreground")}>
              {c && <span className="stone inline-block h-2 w-3" style={{ background: mineral(c.name) }} aria-hidden="true" />}
              {name ?? "Everything"}
              {c && <sup className="text-xs text-muted-foreground tabular-nums">{c.count}</sup>}
            </button>
          );
        })}
        <span ref={bar} aria-hidden="true"
          className="absolute -bottom-px left-0 h-0.5 w-[100px] origin-left bg-lichen transition-transform duration-500 ease-(--ease-in-out)" />
      </div>
    </div>
  );
}

export function LinkBrowser({ title, description, fixed = {} }: {
  title: string;
  description?: string;
  fixed?: Record<string, string>;
}) {
  const sp = useSearchParams();
  const router = useRouter();
  const pathname = usePathname();
  const openAdd = useAddLinks();
  const { refresh } = useLinkActions();
  const [view, setView] = usePersistedView();
  const [limit, setLimit] = useState(60);
  const [q, setQ] = useState(sp.get("q") ?? "");
  const toolbar = useRef<HTMLDivElement>(null);
  // The toolbar is sticky; once it is stuck it gains a hairline so it reads as a layer above the grid
  useGSAP(() => {
    const el = toolbar.current;
    if (!el) return;
    ScrollTrigger.create({
      trigger: el, start: () => `top ${parseFloat(getComputedStyle(el).top) || 0}px+=1`, end: "max",
      onToggle: (s) => el.toggleAttribute("data-stuck", s.isActive),
    });
  });

  const params: Record<string, string | string[] | undefined> = {
    q: sp.get("q") ?? undefined, category: sp.get("category") ?? undefined, subcategory: sp.get("subcategory") ?? undefined,
    tag: sp.getAll("tag"), domain: sp.get("domain") ?? undefined, status: sp.get("status") ?? undefined,
    favorite: sp.get("favorite") ?? undefined, free_plan: sp.get("free_plan") ?? undefined,
    open_source: sp.get("open_source") ?? undefined, sort: sp.get("sort") ?? undefined,
    deleted: sp.get("deleted") ?? undefined, duplicates: sp.get("duplicates") ?? undefined, ...fixed,
  };
  const { data, isLoading } = useSWR<{ items: LinkCard[]; total: number }>(
    `/api/links${qs({ ...params, limit })}`,
    { refreshInterval: (d) => (d?.items.some((l) => ACTIVE.includes(l.status)) ? 2500 : 0) },
  );

  function setParam(key: string, value: string | null, remove?: string) {
    const next = new URLSearchParams(sp);
    if (remove !== undefined) {
      const rest = next.getAll(key).filter((v) => v !== remove);
      next.delete(key);
      rest.forEach((v) => next.append(key, v));
    } else if (value) next.set(key, value);
    else next.delete(key);
    router.replace(`${pathname}${next.size ? `?${next}` : ""}`);
  }

  useEffect(() => {
    const t = setTimeout(() => { if ((sp.get("q") ?? "") !== q) setParam("q", q || null); }, 300);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [q]);

  const chips: [string, string][] = [];
  const rail = !("category" in fixed) && !(sp.get("deleted") === "true" || sp.get("deleted") === "1");
  for (const k of [...(rail ? [] : ["category"]), "subcategory", "domain", "duplicates", "deleted", "open_source"]) {
    const v = sp.get(k);
    if (v && !(k in fixed)) chips.push([k, v]);
  }
  sp.getAll("tag").forEach((t) => chips.push(["tag", t]));
  const trash = params.deleted === "true" || params.deleted === "1";

  async function restore(id: string) {
    try {
      await api(`/api/links/${id}/restore`, { method: "POST" });
      toast.success("Restored to your library.");
      refresh();
    } catch (e) {
      toast.error((e as Error).message);
    }
  }

  return (
    <>
      <PageHeader description={description}
        title={<>{trash ? "Trash" : title}{data && (
          <sup className="ml-3 font-sans text-[0.28em] font-normal tracking-normal text-muted-foreground tabular-nums">
            <Count value={data.total} /><span className="sr-only"> links</span>
          </sup>
        )}</>} />

      <div ref={toolbar} style={{ animationDelay: "200ms" }}
        className="enter z-20 -mx-5 mb-8 border-b border-transparent bg-background/85 px-5 pt-3 backdrop-blur-md transition-colors duration-300 data-stuck:border-border sm:-mx-10 sm:px-10 md:sticky md:top-0 lg:-mx-14 lg:px-14">
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <div className="relative w-full sm:w-72">
          <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground" aria-hidden="true" />
          <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Filter by name or site" aria-label="Filter by name or site"
            className="pl-9" />
        </div>
        {!trash && (
          <select aria-label="Status" className={selectCls} value={sp.get("status") ?? ""} onChange={(e) => setParam("status", e.target.value || null)}>
            <option value="">Any status</option>
            {(Object.keys(STATUS_LABEL) as LinkStatus[]).map((s) => <option key={s} value={s}>{STATUS_LABEL[s]}</option>)}
          </select>
        )}
        <Button variant={sp.get("free_plan") === "true" ? "secondary" : "outline"} size="sm" aria-pressed={sp.get("free_plan") === "true"}
          onClick={() => setParam("free_plan", sp.get("free_plan") === "true" ? null : "true")}>
          Has a free plan
        </Button>
        <select aria-label="Sort" className={selectCls} value={sp.get("sort") ?? "created_desc"} onChange={(e) => setParam("sort", e.target.value === "created_desc" ? null : e.target.value)}>
          <option value="created_desc">Newest first</option>
          <option value="created_asc">Oldest first</option>
          <option value="name">Name</option>
          <option value="accessed">Recently opened</option>
          <option value="updated">Recently updated</option>
        </select>
        <Segmented className="ml-auto" label="Layout" value={view} onChange={setView}
          options={[
            ["grid", <><Grid2x2 className="size-4" aria-hidden="true" /><span className="sr-only">Grid view</span></>],
            ["list", <><LayoutList className="size-4" aria-hidden="true" /><span className="sr-only">List view</span></>],
          ]} />
      </div>
      {rail && <CategoryRail active={sp.get("category")} onPick={(c) => setParam("category", c)} />}
      </div>

      {chips.length > 0 && (
        <div className="mb-6 flex flex-wrap gap-1.5">
          {chips.map(([k, v]) => (
            <button key={k + v} type="button" onClick={() => (k === "tag" ? setParam("tag", null, v) : setParam(k, null))}
              className="press inline-flex h-8 items-center gap-1.5 rounded-md border border-input bg-card px-2.5 text-sm hover:border-foreground/35" aria-label={`Remove filter ${CHIP_LABELS[k]} ${v}`}>
              <span className="text-muted-foreground">{CHIP_LABELS[k]}</span>
              {k === "tag" ? `#${v}` : ["duplicates", "deleted", "open_source"].includes(k) ? "" : v}
              <X className="size-3.5" aria-hidden="true" />
            </button>
          ))}
        </div>
      )}

      {isLoading && !data ? (
        <div className="grid gap-x-7 gap-y-11 sm:grid-cols-2 lg:grid-cols-3">{Array.from({ length: 6 }, (_, i) => <Skeleton key={i} className="aspect-[16/14]" />)}</div>
      ) : data && data.items.length === 0 ? (
        chips.length || params.q || params.status || params.free_plan || (rail && params.category) ? (
          <Empty title="No links match these filters">Remove a filter or try a different word.</Empty>
        ) : trash ? (
          <Empty title="Trash is empty">Deleted links stay here so you can restore them.</Empty>
        ) : (
          <Empty title="Nothing here yet" action={<Button onClick={openAdd}>Add links</Button>}>
            Saved links show up here once you add them.
          </Empty>
        )
      ) : data ? (
        trash ? (
          <div className="border-y">
            {data.items.map((l, i) => (
              <LinkRow key={l.id} link={l} index={i} extra={<Button size="sm" variant="outline" onClick={() => restore(l.id)}>Restore</Button>} />
            ))}
          </div>
        ) : (
          <LinkCollection links={data.items} view={view}
            feature={!chips.length && !params.q && !params.status && !params.free_plan && !params.sort && !(rail && params.category)} />
        )
      ) : null}

      {data && data.items.length < data.total && (
        <div className="mt-12 text-center">
          <Button variant="outline" onClick={() => setLimit((n) => Math.min(n + 60, 200))} disabled={limit >= 200}>
            {limit >= 200 ? "Refine the filters to see more" : "Show more"}
          </Button>
        </div>
      )}
    </>
  );
}
