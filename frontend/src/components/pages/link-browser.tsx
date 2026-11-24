"use client";

import { Grid2x2, LayoutList, X } from "lucide-react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useEffect, useState, useSyncExternalStore } from "react";
import useSWR from "swr";
import { toast } from "sonner";
import { useAddLinks } from "@/components/app-shell";
import { Empty, PageHeader } from "@/components/bits";
import { LinkCollection, LinkRow, useLinkActions } from "@/components/link-views";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { api, qs } from "@/lib/api";
import { STATUS_LABEL } from "@/lib/format";
import type { LinkCard, LinkStatus } from "@/lib/types";
import { ACTIVE } from "@/lib/types";
import { cn } from "@/lib/utils";

const CHIP_LABELS: Record<string, string> = {
  category: "Category", subcategory: "Type", tag: "Tag", domain: "Site", duplicates: "Possible duplicates",
  deleted: "Trash", open_source: "Open source",
};

const selectCls = "h-8 rounded-md border bg-background px-2 text-sm";

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
  for (const k of ["category", "subcategory", "domain", "duplicates", "deleted", "open_source"]) {
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
      <PageHeader title={trash ? "Trash" : title}
        description={data ? `${data.total} link${data.total === 1 ? "" : "s"}${description ? `. ${description}` : ""}` : description} />

      <div className="mb-4 flex flex-wrap items-center gap-2">
        <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Filter by name or site" aria-label="Filter by name or site"
          className="h-8 w-full sm:w-64" />
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
        <div className="ml-auto flex rounded-md border p-0.5" role="group" aria-label="Layout">
          {(["grid", "list"] as const).map((v) => {
            const Icon = v === "grid" ? Grid2x2 : LayoutList;
            return (
              <button key={v} type="button" onClick={() => setView(v)} aria-pressed={view === v} aria-label={`${v} view`}
                className={cn("rounded p-1.5 text-muted-foreground hover:text-foreground", view === v && "bg-accent text-foreground")}>
                <Icon className="size-4" />
              </button>
            );
          })}
        </div>
      </div>

      {chips.length > 0 && (
        <div className="mb-4 flex flex-wrap gap-1.5">
          {chips.map(([k, v]) => (
            <button key={k + v} type="button" onClick={() => (k === "tag" ? setParam("tag", null, v) : setParam(k, null))}
              className="inline-flex items-center gap-1 rounded-md bg-accent px-2 py-1 text-sm hover:bg-accent/70" aria-label={`Remove filter ${CHIP_LABELS[k]} ${v}`}>
              <span className="text-muted-foreground">{CHIP_LABELS[k]}</span>
              {k === "tag" ? `#${v}` : ["duplicates", "deleted", "open_source"].includes(k) ? "" : v}
              <X className="size-3.5" aria-hidden="true" />
            </button>
          ))}
        </div>
      )}

      {isLoading && !data ? (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">{Array.from({ length: 6 }, (_, i) => <Skeleton key={i} className="h-64" />)}</div>
      ) : data && data.items.length === 0 ? (
        chips.length || params.q || params.status || params.free_plan ? (
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
          <div className="overflow-hidden rounded-lg border bg-card">
            {data.items.map((l) => (
              <LinkRow key={l.id} link={l} extra={<Button size="sm" variant="outline" onClick={() => restore(l.id)}>Restore</Button>} />
            ))}
          </div>
        ) : (
          <LinkCollection links={data.items} view={view} />
        )
      ) : null}

      {data && data.items.length < data.total && (
        <div className="mt-6 text-center">
          <Button variant="outline" onClick={() => setLimit((n) => Math.min(n + 60, 200))} disabled={limit >= 200}>
            {limit >= 200 ? "Refine the filters to see more" : "Show more"}
          </Button>
        </div>
      )}
    </>
  );
}
