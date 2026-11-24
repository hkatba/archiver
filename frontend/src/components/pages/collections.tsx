"use client";

import { Plus, Sparkles, Trash2 } from "lucide-react";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { useState } from "react";
import useSWR from "swr";
import { toast } from "sonner";
import { useAddLinks } from "@/components/app-shell";
import { ButtonLink, Empty, PageHeader } from "@/components/bits";
import { LinkCollection, LinkRow, useLinkActions } from "@/components/link-views";
import { PageSkeleton } from "@/components/page-skeleton";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { api } from "@/lib/api";
import type { Collection, Facet, LinkCard, SmartRules, Stats } from "@/lib/types";
import { cn } from "@/lib/utils";

export function describeRules(r: SmartRules): string {
  const parts: string[] = [];
  if (r.query) parts.push(`about “${r.query}”`);
  if (r.subcategory) parts.push(`type ${r.subcategory}`);
  else if (r.category) parts.push(`in ${r.category}`);
  if (r.tags?.length) parts.push(`tagged ${r.tags.map((t) => `#${t}`).join(" ")}`);
  if (r.domain) parts.push(`from ${r.domain}`);
  if (r.free_plan) parts.push("with a free plan");
  if (r.open_source) parts.push("open source");
  return parts.length ? `Links ${parts.join(", ")}` : "All links";
}

function CreateDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (o: boolean) => void }) {
  const router = useRouter();
  const { refresh } = useLinkActions();
  const { data: categories } = useSWR<Facet[]>(open ? "/api/categories" : null);
  const [smart, setSmart] = useState(false);
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [rules, setRules] = useState<SmartRules>({});

  async function create(e: React.FormEvent) {
    e.preventDefault();
    const cleaned: SmartRules = {
      query: rules.query?.trim() || undefined,
      category: rules.category || undefined,
      tags: (rules.tags ?? []).filter(Boolean),
      free_plan: rules.free_plan || undefined,
      open_source: rules.open_source || undefined,
    };
    try {
      const c = await api<Collection>("/api/collections", {
        method: "POST", json: { name, description: description || null, rules: smart ? cleaned : null },
      });
      toast.success(`Created “${c.name}”.`);
      onOpenChange(false);
      setName(""); setDescription(""); setRules({});
      refresh();
      router.push(`/collections/${c.id}`);
    } catch (err) {
      toast.error((err as Error).message);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <form onSubmit={create} className="grid gap-4">
          <DialogHeader>
            <DialogTitle>New collection</DialogTitle>
            <DialogDescription>Collect links by hand, or describe what belongs and let Cairn keep it up to date.</DialogDescription>
          </DialogHeader>
          <div className="grid grid-cols-2 gap-2" role="radiogroup" aria-label="Collection type">
            {[[false, "Manual", "You choose the links"], [true, "Smart", "Fills itself from rules"]].map(([v, label, hint]) => (
              <button key={String(v)} type="button" role="radio" aria-checked={smart === v} onClick={() => setSmart(v as boolean)}
                className={cn("rounded-md border p-3 text-left", smart === v && "border-ring ring-1 ring-ring")}>
                <span className="block text-sm font-medium">{label as string}</span>
                <span className="block text-xs text-muted-foreground">{hint as string}</span>
              </button>
            ))}
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor="c-name">Name</Label>
            <Input id="c-name" required value={name} onChange={(e) => setName(e.target.value)} placeholder="Design inspiration" />
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor="c-desc">Description</Label>
            <Input id="c-desc" value={description} onChange={(e) => setDescription(e.target.value)} placeholder="Optional" />
          </div>
          {smart && (
            <fieldset className="grid gap-3 rounded-md border p-3">
              <legend className="px-1 text-sm font-medium">Include links that match</legend>
              <div className="grid gap-1.5">
                <Label htmlFor="r-q">Description of the topic</Label>
                <Input id="r-q" value={rules.query ?? ""} onChange={(e) => setRules({ ...rules, query: e.target.value })}
                  placeholder="tools that generate images" />
              </div>
              <div className="grid gap-3 sm:grid-cols-2">
                <div className="grid gap-1.5">
                  <Label htmlFor="r-cat">Category</Label>
                  <select id="r-cat" value={rules.category ?? ""} onChange={(e) => setRules({ ...rules, category: e.target.value })}
                    className="h-9 rounded-md border bg-background px-2 text-sm">
                    <option value="">Any</option>
                    {categories?.map((c) => <option key={c.name} value={c.name}>{c.name}</option>)}
                  </select>
                </div>
                <div className="grid gap-1.5">
                  <Label htmlFor="r-tags">Tags</Label>
                  <Input id="r-tags" value={(rules.tags ?? []).join(", ")} placeholder="ai, video"
                    onChange={(e) => setRules({ ...rules, tags: e.target.value.split(",").map((t) => t.trim().toLowerCase()) })} />
                </div>
              </div>
              <div className="flex flex-wrap gap-4 text-sm">
                <label className="flex items-center gap-2"><input type="checkbox" checked={!!rules.free_plan}
                  onChange={(e) => setRules({ ...rules, free_plan: e.target.checked })} /> Has a free plan</label>
                <label className="flex items-center gap-2"><input type="checkbox" checked={!!rules.open_source}
                  onChange={(e) => setRules({ ...rules, open_source: e.target.checked })} /> Open source</label>
              </div>
            </fieldset>
          )}
          <DialogFooter>
            <Button type="submit" disabled={!name.trim()}>Create collection</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

export function CollectionsPage() {
  const [creating, setCreating] = useState(false);
  const { data } = useSWR<Collection[]>("/api/collections");
  const { data: stats } = useSWR<Stats>("/api/stats");
  const { refresh } = useLinkActions();
  const router = useRouter();
  const suggestions = stats?.suggestions.filter((s) => s.type === "smart_collection") ?? [];

  async function accept(name: string, rules: SmartRules) {
    const c = await api<Collection>("/api/collections", { method: "POST", json: { name, rules } });
    refresh();
    router.push(`/collections/${c.id}`);
  }

  return (
    <>
      <PageHeader title="Collections" description="Group links by project or topic."
        actions={<Button onClick={() => setCreating(true)}><Plus /> New collection</Button>} />
      {!data ? <PageSkeleton /> : data.length === 0 && suggestions.length === 0 ? (
        <Empty title="No collections yet" action={<Button onClick={() => setCreating(true)}>Create a collection</Button>}>
          A smart collection fills itself, for example every AI tool with a free plan.
        </Empty>
      ) : (
        <ul className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
          {data.map((c) => (
            <li key={c.id}>
              <Link href={`/collections/${c.id}`} className="flex h-full flex-col rounded-lg border bg-card p-4 hover:border-foreground/25">
                <span className="flex items-center gap-2 font-medium">
                  {c.is_smart && <Sparkles className="size-4 text-primary" aria-label="Smart collection" />}{c.name}
                </span>
                <span className="mt-1 line-clamp-2 text-sm text-muted-foreground">
                  {c.description || (c.rules ? describeRules(c.rules) : "Links you added by hand")}
                </span>
                <span className="mt-auto pt-3 text-sm tabular-nums text-muted-foreground">{c.link_count} link{c.link_count === 1 ? "" : "s"}</span>
              </Link>
            </li>
          ))}
          {suggestions.map((s) => (
            <li key={s.name} className="flex flex-col rounded-lg border border-dashed p-4">
              <span className="font-medium">{s.name}</span>
              <span className="mt-1 text-sm text-muted-foreground">Suggested: {s.count} links share this type.</span>
              <Button size="sm" variant="outline" className="mt-3 self-start" onClick={() => accept(s.name!, s.rules!)}>Create smart collection</Button>
            </li>
          ))}
        </ul>
      )}
      <CreateDialog open={creating} onOpenChange={setCreating} />
    </>
  );
}

export function CollectionDetailPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const openAdd = useAddLinks();
  const { refresh } = useLinkActions();
  const { data: c } = useSWR<Collection>(`/api/collections/${id}`);
  const { data } = useSWR<{ items: LinkCard[]; total: number }>(`/api/collections/${id}/links`);
  if (!c || !data) return <PageSkeleton />;

  async function remove() {
    if (!confirm(`Delete the collection “${c!.name}”? The links stay in your library.`)) return;
    await api(`/api/collections/${id}`, { method: "DELETE" });
    toast.success("Collection deleted.");
    refresh();
    router.push("/collections");
  }
  async function takeOut(linkId: string) {
    await api(`/api/collections/${id}/links/${linkId}`, { method: "DELETE" });
    refresh();
  }

  return (
    <>
      <PageHeader title={c.name}
        description={`${data.total} link${data.total === 1 ? "" : "s"}. ${c.description ?? (c.rules ? `${describeRules(c.rules)}, updated automatically.` : "")}`}
        actions={<>
          {!c.is_smart && <Button variant="outline" onClick={openAdd}><Plus /> Add links</Button>}
          <Button variant="ghost" onClick={remove}><Trash2 /> Delete</Button>
        </>} />
      {data.items.length === 0 ? (
        <Empty title={c.is_smart ? "No links match these rules yet" : "This collection is empty"}
          action={c.is_smart ? <ButtonLink href="/links" variant="outline">Browse links</ButtonLink> : undefined}>
          {c.is_smart ? "Links that match will appear here as you save them." : "Open a link and choose Add to collection, or add new links here."}
        </Empty>
      ) : c.is_smart ? (
        <LinkCollection links={data.items} view="grid" />
      ) : (
        <div className="overflow-hidden rounded-lg border bg-card">
          {data.items.map((l) => (
            <LinkRow key={l.id} link={l} extra={<Button size="sm" variant="ghost" onClick={() => takeOut(l.id)}>Remove</Button>} />
          ))}
        </div>
      )}
    </>
  );
}
