"use client";

import {
  BookOpen,
  Check,
  ChevronRight,
  Copy,
  Download,
  Ellipsis,
  ExternalLink,
  FolderClosed,
  Globe,
  LoaderCircle,
  Pencil,
  RefreshCw,
  RotateCcw,
  Sparkles,
  Trash2,
} from "lucide-react";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import useSWR from "swr";
import { toast } from "sonner";
import { ButtonLink, CategoryMark, Favicon, FavoriteStar, StatusPill, Verified } from "@/components/bits";
import { LinkRow, useLinkActions } from "@/components/link-views";
import { Markdown } from "@/components/markdown";
import { PageSkeleton } from "@/components/page-skeleton";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { api, ApiError } from "@/lib/api";
import { ago, compact, hostPath, STATUS_LABEL } from "@/lib/format";
import type { Collection, LinkCard, LinkDetail, LinkStatus } from "@/lib/types";
import { ACTIVE } from "@/lib/types";
import { cn } from "@/lib/utils";

const CATEGORIES = [
  "AI Tools", "Developer Tools", "Design", "Productivity", "Automation & No-Code", "Writing & Content",
  "Marketing & SEO", "Research & Learning", "Data & Analytics", "Documents & PDF", "Media", "Business & Finance",
  "Communication & Collaboration", "Hosting & Infrastructure", "Security & Privacy", "Open Source",
  "News & Articles", "Other",
];
const STAGES: LinkStatus[] = ["QUEUED", "PROCESSING", "ENRICHING", "INDEXING", "COMPLETED"];

function Section({ title, children, aside }: { title: string; children: React.ReactNode; aside?: React.ReactNode }) {
  return (
    <section className="border-t pt-5">
      <div className="mb-2 flex items-baseline justify-between gap-3">
        <h2 className="font-medium">{title}</h2>
        {aside}
      </div>
      {children}
    </section>
  );
}

function Fact({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="grid grid-cols-[110px_minmax(0,1fr)] gap-3 py-1.5 text-sm">
      <dt className="text-muted-foreground">{label}</dt>
      <dd className="min-w-0">{children}</dd>
    </div>
  );
}

function Progress({ link }: { link: LinkDetail }) {
  const { refresh } = useLinkActions();
  const active = ACTIVE.includes(link.status);
  async function retry() {
    try {
      await api(`/api/links/${link.id}/retry`, { method: "POST" });
      toast.success("Retrying.");
      refresh();
    } catch (e) {
      toast.error((e as Error).message);
    }
  }
  if (link.status === "COMPLETED") return null;
  const idx = STAGES.indexOf(link.status === "PENDING" ? "QUEUED" : link.status);
  return (
    <div className={cn("mb-6 rounded-lg border p-4",
      ["FAILED", "BLOCKED"].includes(link.status) && "border-destructive/40 bg-destructive/5",
      link.status === "NEEDS_REVIEW" && "border-warn/40 bg-warn/5")} role="status">
      {active ? (
        <ol className="flex flex-wrap items-center gap-x-2 gap-y-1 text-sm">
          {STAGES.slice(0, 4).map((s, i) => (
            <li key={s} className={cn("flex items-center gap-2", i > idx && "text-muted-foreground", i === idx && "font-medium")}>
              {i < idx ? <Check className="size-4 text-ok" aria-hidden="true" /> : i === idx
                ? <LoaderCircle className="size-4 animate-spin" aria-hidden="true" /> : <span className="size-4" />}
              {STATUS_LABEL[s]}
              {i < 3 && <ChevronRight className="size-3.5 text-muted-foreground" aria-hidden="true" />}
            </li>
          ))}
        </ol>
      ) : (
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            <p className="font-medium">{STATUS_LABEL[link.status]}</p>
            <p className="mt-0.5 text-sm text-muted-foreground">{link.status_detail || link.last_error}</p>
          </div>
          {link.status !== "NEEDS_REVIEW" || link.extraction?.partial ? (
            <Button size="sm" variant="outline" onClick={retry}><RotateCcw /> Try again</Button>
          ) : null}
        </div>
      )}
      {active && link.status_detail && <p className="mt-2 text-sm text-muted-foreground">{link.status_detail}</p>}
    </div>
  );
}

function EditDialog({ link, open, onOpenChange }: { link: LinkDetail; open: boolean; onOpenChange: (o: boolean) => void }) {
  const { refresh } = useLinkActions();
  // Mounted only while open, so the form starts from the current values each time
  const [form, setForm] = useState({
    name: link.name ?? "", description: link.description ?? "", tldr: link.tldr ?? "",
    category: link.category ?? "", subcategory: link.subcategory ?? "", tags: link.tags.join(", "),
    free_plan: link.has_free_plan === null ? "" : String(link.has_free_plan),
    open_source: link.is_open_source === null ? "" : String(link.is_open_source),
  });

  async function save() {
    const body: Record<string, unknown> = {};
    const text = (k: "name" | "description" | "tldr" | "subcategory", orig: string | null) => {
      if (form[k].trim() !== (orig ?? "")) body[k] = form[k].trim() || null;
    };
    text("name", link.name);
    text("description", link.description);
    text("tldr", link.tldr);
    if (form.category !== (link.category ?? "")) body.category = form.category || null;
    text("subcategory", link.subcategory);
    const tags = form.tags.split(",").map((t) => t.trim().toLowerCase()).filter(Boolean);
    if (tags.join(",") !== link.tags.join(",")) body.tags = tags;
    const tri = (v: string) => (v === "" ? null : v === "true");
    if (tri(form.free_plan) !== link.has_free_plan) body.free_plan = tri(form.free_plan);
    if (tri(form.open_source) !== link.is_open_source) body.open_source = tri(form.open_source);
    if (Object.keys(body).length === 0) return onOpenChange(false);
    try {
      await api(`/api/links/${link.id}`, { method: "PATCH", json: body });
      toast.success("Saved your edits. They take priority over the AI analysis.");
      onOpenChange(false);
      refresh();
    } catch (e) {
      toast.error((e as Error).message);
    }
  }

  async function revert() {
    const fields = ["name", "description", "tldr", "category", "subcategory", "tags", "free_plan", "open_source", "content_type"];
    await api(`/api/links/${link.id}`, { method: "PATCH", json: Object.fromEntries(fields.map((f) => [f, null])) });
    toast.success("Reverted to the AI analysis.");
    onOpenChange(false);
    refresh();
  }

  const field = (k: keyof typeof form, label: string, multiline = false) => (
    <div className="grid gap-1.5">
      <Label htmlFor={`edit-${k}`}>{label}</Label>
      {multiline ? (
        <Textarea id={`edit-${k}`} value={form[k]} onChange={(e) => setForm({ ...form, [k]: e.target.value })} rows={3} />
      ) : (
        <Input id={`edit-${k}`} value={form[k]} onChange={(e) => setForm({ ...form, [k]: e.target.value })} />
      )}
    </div>
  );
  const select = (k: "category" | "free_plan" | "open_source", label: string, options: [string, string][]) => (
    <div className="grid gap-1.5">
      <Label htmlFor={`edit-${k}`}>{label}</Label>
      <select id={`edit-${k}`} value={form[k]} onChange={(e) => setForm({ ...form, [k]: e.target.value })}
        className="h-9 rounded-md border bg-background px-2 text-sm">
        {options.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
      </select>
    </div>
  );

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-xl">
        <DialogHeader>
          <DialogTitle>Edit details</DialogTitle>
          <DialogDescription>Your edits are kept when the page is analyzed again.</DialogDescription>
        </DialogHeader>
        <div className="grid gap-4">
          {field("name", "Name")}
          {field("description", "What it does", true)}
          {field("tldr", "TL;DR", true)}
          <div className="grid gap-4 sm:grid-cols-2">
            {select("category", "Category", [["", "Uncategorized"], ...CATEGORIES.map((c) => [c, c] as [string, string])])}
            {field("subcategory", "Type")}
          </div>
          {field("tags", "Tags, separated by commas")}
          <div className="grid gap-4 sm:grid-cols-2">
            {select("free_plan", "Free plan", [["", "Unknown"], ["true", "Yes"], ["false", "No"]])}
            {select("open_source", "Open source", [["", "Unknown"], ["true", "Yes"], ["false", "No"]])}
          </div>
        </div>
        <DialogFooter className="sm:justify-between">
          <Button variant="ghost" onClick={revert} disabled={Object.keys(link.overrides).length === 0}>Revert to AI analysis</Button>
          <Button onClick={save}>Save edits</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function Notes({ link }: { link: LinkDetail }) {
  const [value, setValue] = useState(link.notes ?? "");
  const [saving, setSaving] = useState(false);
  const dirty = value !== (link.notes ?? "");
  async function save() {
    setSaving(true);
    try {
      await api(`/api/links/${link.id}`, { method: "PATCH", json: { notes: value || null } });
      toast.success("Notes saved.");
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setSaving(false);
    }
  }
  return (
    <div>
      <Textarea value={value} onChange={(e) => setValue(e.target.value)} rows={4} aria-label="Your notes"
        placeholder="Why you saved this, how you used it…" />
      {dirty && (
        <div className="mt-2 flex justify-end gap-2">
          <Button size="sm" variant="ghost" onClick={() => setValue(link.notes ?? "")}>Discard</Button>
          <Button size="sm" onClick={save} disabled={saving}>Save notes</Button>
        </div>
      )}
    </div>
  );
}

function SnippetBlock({ code, language, context }: { code: string; language: string | null; context: string | null }) {
  const [copied, setCopied] = useState(false);
  return (
    <figure className="overflow-hidden rounded-md border">
      <figcaption className="flex items-center justify-between gap-2 border-b bg-muted/60 px-3 py-1.5 text-xs text-muted-foreground">
        <span className="truncate">{[language, context].filter(Boolean).join(", ") || "Code"}</span>
        <button type="button" className="inline-flex items-center gap-1 hover:text-foreground" onClick={async () => {
          await navigator.clipboard.writeText(code);
          setCopied(true);
          setTimeout(() => setCopied(false), 1500);
        }}>
          {copied ? <Check className="size-3.5" /> : <Copy className="size-3.5" />} {copied ? "Copied" : "Copy"}
        </button>
      </figcaption>
      <pre className="max-h-80 overflow-auto bg-card p-3 text-[13px] leading-relaxed"><code>{code}</code></pre>
    </figure>
  );
}

export { SnippetBlock };

export function LinkDetailPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const { refresh, toggleFavorite } = useLinkActions();
  const [editing, setEditing] = useState(false);
  const [showContent, setShowContent] = useState(false);
  const { data: link, error } = useSWR<LinkDetail>(`/api/links/${id}`, {
    refreshInterval: (d) => (d && ACTIVE.includes(d.status) ? 2000 : 0),
  });
  const { data: related } = useSWR<{ link: LinkCard; similarity: number }[]>(
    link?.status === "COMPLETED" || link?.status === "NEEDS_REVIEW" ? `/api/links/${id}/related` : null);
  const { data: duplicateOf } = useSWR<LinkDetail>(link?.duplicate_of_id ? `/api/links/${link.duplicate_of_id}` : null);
  const { data: collections } = useSWR<Collection[]>("/api/collections");
  const title = link?.name ?? link?.domain;
  useEffect(() => {
    if (title) document.title = `${title} · Cairn`;
  }, [title]);

  if (error instanceof ApiError && error.status === 404) {
    return <div className="py-20 text-center"><p className="font-medium">This link doesn&apos;t exist or was removed.</p>
      <ButtonLink href="/links" variant="outline" className="mt-4">Back to all links</ButtonLink></div>;
  }
  if (!link) return <PageSkeleton />;

  const ai = link.ai?.data ?? {};
  const pricing = ai.pricing;
  const gh = link.github;

  async function act(path: string, success: string) {
    try {
      await api(`/api/links/${link!.id}/${path}`, { method: "POST" });
      toast.success(success);
      refresh();
    } catch (e) {
      toast.error((e as Error).message);
    }
  }
  async function remove() {
    await api(`/api/links/${link!.id}`, { method: "DELETE" });
    toast.success("Moved to trash.", { action: { label: "Undo", onClick: () => act("restore", "Restored.") } });
    refresh();
    router.push("/links");
  }
  async function addTo(c: Collection) {
    try {
      await api(`/api/collections/${c.id}/links`, { method: "POST", json: { link_ids: [link!.id] } });
      toast.success(`Added to “${c.name}”.`);
      refresh();
    } catch (e) {
      toast.error((e as Error).message);
    }
  }
  async function merge() {
    await api(`/api/links/${link!.id}/merge`, { method: "POST", json: { into_id: link!.duplicate_of_id } });
    toast.success("Merged. Notes, tags and collections were kept.");
    refresh();
    router.replace(`/links/${link!.duplicate_of_id}`);
  }

  const manual = (collections ?? []).filter((c) => !c.is_smart);

  return (
    <article>
      <Progress link={link} />
      {duplicateOf && (
        <div className="mb-6 flex flex-wrap items-center justify-between gap-3 rounded-lg border bg-card p-4 text-sm">
          <span>This looks like the same page as <Link className="font-medium underline" href={`/links/${duplicateOf.id}`}>{duplicateOf.name}</Link>.</span>
          <Button size="sm" variant="outline" onClick={merge}>Merge into it</Button>
        </div>
      )}

      <header className="mb-8 flex flex-wrap items-start gap-4">
        <Favicon link={link} size={40} />
        <div className="min-w-0 flex-1">
          <h1 className="display text-4xl break-words sm:text-5xl">{link.name || link.domain}</h1>
          <a href={link.url} target="_blank" rel="noopener noreferrer" className="mt-2 inline-flex max-w-full items-center gap-1 text-sm text-muted-foreground hover:text-foreground hover:underline">
            <span className="truncate">{hostPath(link.final_url || link.url)}</span>
          </a>
        </div>
        <div className="flex flex-wrap items-center gap-1.5">
          <Button render={<a href={link.url} target="_blank" rel="noopener noreferrer" />} nativeButton={false}>
            <ExternalLink /> Open site
          </Button>
          <Button variant="outline" size="icon" aria-label="Copy URL" title="Copy URL"
            onClick={async () => { await navigator.clipboard.writeText(link.url); toast.success("URL copied."); }}>
            <Copy />
          </Button>
          <Button variant="outline" size="icon" aria-label="Edit details" title="Edit details" onClick={() => setEditing(true)}><Pencil /></Button>
          <FavoriteStar on={link.is_favorite} onToggle={() => toggleFavorite(link)} className="p-2" />
          <DropdownMenu>
            <DropdownMenuTrigger render={<Button variant="outline" size="icon" aria-label="Add to collection" title="Add to collection" />}>
              <FolderClosed />
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-56">
              <DropdownMenuLabel>Add to collection</DropdownMenuLabel>
              {manual.map((c) => (
                <DropdownMenuItem key={c.id} onClick={() => addTo(c)} disabled={link.collections.some((x) => x.id === c.id)}>
                  {c.name}{link.collections.some((x) => x.id === c.id) && <Check className="ml-auto" />}
                </DropdownMenuItem>
              ))}
              {manual.length === 0 && <DropdownMenuItem onClick={() => router.push("/collections")}>Create a collection first</DropdownMenuItem>}
            </DropdownMenuContent>
          </DropdownMenu>
          <DropdownMenu>
            <DropdownMenuTrigger render={<Button variant="outline" size="icon" aria-label="More actions" />}>
              <Ellipsis />
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-60">
              <DropdownMenuItem onClick={() => act("regenerate", "Analyzing again.")}><Sparkles /> Regenerate AI analysis</DropdownMenuItem>
              <DropdownMenuItem onClick={() => act("reprocess", "Reading the page again.")}><RefreshCw /> Re-read the page</DropdownMenuItem>
              <DropdownMenuItem onClick={() => act("check", "Availability checked.")}><Globe /> Check if the site is up</DropdownMenuItem>
              <DropdownMenuItem onClick={() => router.push(`/links/${link.id}/read`)} disabled={!link.markdown}><BookOpen /> Open reader view</DropdownMenuItem>
              <DropdownMenuItem onClick={() => { const a = document.createElement("a"); a.href = `/api/links/${link.id}/markdown`; a.click(); }}><Download /> Download Markdown</DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem variant="destructive" onClick={remove}><Trash2 /> Move to trash</DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </header>

      <div className="grid gap-10 lg:grid-cols-[minmax(0,1fr)_340px]">
        <div className="flex min-w-0 flex-col gap-6">
          {link.tldr || link.description ? (
            <div>
              {link.tldr && <p className="max-w-[68ch] font-serif text-xl leading-relaxed">{link.tldr}</p>}
              {link.description && link.description !== link.tldr && (
                <p className="mt-3 max-w-[68ch] text-muted-foreground">{link.description}</p>
              )}
              {ai.source === "extractive" && (
                <p className="mt-3 text-xs text-muted-foreground">Taken from the page&apos;s own description. Set up an AI provider in Settings for a full analysis.</p>
              )}
            </div>
          ) : ACTIVE.includes(link.status) ? (
            <p className="text-muted-foreground">The summary appears here once the page has been read and analyzed.</p>
          ) : null}

          {ai.problems_solved && ai.problems_solved.length > 0 && (
            <Section title="Problems it solves">
              <ul className="ml-5 list-disc space-y-1">{ai.problems_solved.map((p) => <li key={p}>{p}</li>)}</ul>
            </Section>
          )}
          {ai.target_audience && ai.target_audience.length > 0 && (
            <Section title="Who it's for">
              <ul className="flex flex-wrap gap-1.5">{ai.target_audience.map((a) => <li key={a} className="rounded-md bg-muted px-2 py-0.5 text-sm">{a}</li>)}</ul>
            </Section>
          )}
          {ai.key_features && ai.key_features.length > 0 && (
            <Section title="Key features" aside={<span className="text-xs text-muted-foreground">Checked against the page text</span>}>
              <ul className="divide-y">
                {ai.key_features.map((f) => (
                  <li key={f.name} className="flex items-baseline justify-between gap-4 py-1.5">
                    <span>{f.name}</span>
                    <Verified ok={!!f.verified} quote={f.evidence} />
                  </li>
                ))}
              </ul>
            </Section>
          )}
          {ai.usage && Object.values(ai.usage).some(Boolean) && (
            <Section title="When to use it" aside={<span className="text-xs text-muted-foreground">AI interpretation</span>}>
              <dl className="grid gap-3 text-sm sm:grid-cols-2">
                {([["use_for", "Useful for"], ["when_to_use", "Use it when"], ["who_should_use", "Best for"],
                  ["differentiators", "What sets it apart"], ["limitations", "Limitations"]] as const).map(([k, label]) =>
                  ai.usage?.[k] ? (
                    <div key={k}><dt className="text-muted-foreground">{label}</dt><dd className="mt-0.5">{ai.usage[k]}</dd></div>
                  ) : null)}
              </dl>
            </Section>
          )}
          {ai.alternatives && ai.alternatives.length > 0 && (
            <Section title="Possible alternatives" aside={<span className="text-xs text-muted-foreground">AI suggestions, not verified</span>}>
              <ul className="space-y-1 text-sm">
                {ai.alternatives.map((a) => <li key={a.name}><span className="font-medium">{a.name}</span>{a.reason && <span className="text-muted-foreground">, {a.reason}</span>}</li>)}
              </ul>
            </Section>
          )}
          {link.snippets.length > 0 && (
            <Section title={`Code snippets (${link.snippets.length})`}>
              <div className="flex flex-col gap-3">
                {link.snippets.slice(0, 8).map((s) => <SnippetBlock key={s.id} code={s.code} language={s.language} context={s.context} />)}
              </div>
            </Section>
          )}
          {link.markdown && (
            <Section title="Archived copy of the page" aside={
              <span className="flex gap-3 text-sm">
                <Link href={`/links/${link.id}/read`} className="text-muted-foreground hover:text-foreground hover:underline">Reader view</Link>
                <button type="button" className="text-muted-foreground hover:text-foreground hover:underline" onClick={() => setShowContent((v) => !v)}>
                  {showContent ? "Hide" : "Show"}
                </button>
              </span>}>
              {showContent ? <Markdown>{link.markdown}</Markdown> : (
                <p className="text-sm text-muted-foreground">
                  {compact(link.extraction?.text_length)} characters saved {ago(link.extraction?.created_at)}, readable even if the site goes away.
                </p>
              )}
            </Section>
          )}
          {related && related.length > 0 && (
            <Section title="Related in your library">
              <div className="overflow-hidden rounded-lg border bg-card">
                {related.map((r) => <LinkRow key={r.link.id} link={r.link} />)}
              </div>
            </Section>
          )}
          <Section title="Processing history">
            <ol className="space-y-1 text-sm">
              {link.logs.slice(0, 12).map((l, i) => (
                <li key={i} className="flex gap-3">
                  <span className="w-24 shrink-0 text-muted-foreground">{ago(l.created_at)}</span>
                  <span className={cn(l.level === "error" && "text-destructive", l.level === "warning" && "text-warn")}>{l.message}</span>
                </li>
              ))}
            </ol>
          </Section>
        </div>

        <aside className="flex flex-col gap-6">
          {link.screenshot ? (
            <a href={link.screenshot} target="_blank" rel="noopener noreferrer" className="block overflow-hidden rounded-lg border" title="Open full screenshot">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={link.thumbnail ?? link.screenshot} alt={`Screenshot of ${link.name ?? link.domain}`} className="w-full" />
            </a>
          ) : null}

          <dl className="divide-y">
            <Fact label="Category"><CategoryMark category={link.category} subcategory={link.subcategory} className="text-sm text-foreground" /></Fact>
            <Fact label="Pricing">
              {pricing?.verified ? (
                <span title={pricing.evidence ? `From the page: “${pricing.evidence}”` : undefined}>
                  {[pricing.free_plan && "Free plan", pricing.free_trial && "Free trial", pricing.starting_price && `from ${pricing.starting_price}`,
                    pricing.free_plan === false && "No free plan"].filter(Boolean).join(", ") || "Paid"}
                  <span className="block text-xs text-muted-foreground">Confirmed on the page {ago(pricing.checked_at)}</span>
                </span>
              ) : link.has_free_plan !== null && "free_plan" in link.overrides ? (
                <span>{link.has_free_plan ? "Free plan" : "No free plan"} <span className="text-xs text-muted-foreground">(your edit)</span></span>
              ) : (
                <span className="text-muted-foreground">Not shown on the page</span>
              )}
            </Fact>
            {link.is_open_source !== null && <Fact label="Open source">{link.is_open_source ? "Yes" : "No"}</Fact>}
            {gh && (
              <Fact label="GitHub">
                <span>{compact(gh.stars)} stars, {compact(gh.forks)} forks</span>
                <span className="block text-xs text-muted-foreground">
                  {[gh.language, gh.license, gh.latest_release?.tag && `release ${gh.latest_release.tag}`, gh.pushed_at && `pushed ${ago(gh.pushed_at)}`]
                    .filter(Boolean).join(", ")}
                  {gh.archived && ", archived"}
                </span>
              </Fact>
            )}
            <Fact label="Availability">
              {link.availability === "up" ? "Online" : link.availability === "down" ? <span className="text-destructive">Unreachable</span>
                : link.availability === "redirected" ? "Redirects elsewhere" : "Not checked"}
              <span className="block text-xs text-muted-foreground">Checked {ago(link.last_checked_at)}</span>
            </Fact>
            <Fact label="Saved">{new Date(link.created_at).toLocaleDateString(undefined, { dateStyle: "medium" })}</Fact>
            {link.ai && (
              <Fact label="Analysis">
                {link.ai.provider === "extractive" ? "Page metadata only" : `${link.ai.model}`}
                {typeof ai.confidence === "number" && <span className="block text-xs text-muted-foreground">Confidence {Math.round(ai.confidence * 100)}%, {ago(link.ai.created_at)}</span>}
              </Fact>
            )}
            {link.extraction && link.extraction.tech_stack.length > 0 && <Fact label="Built with">{link.extraction.tech_stack.join(", ")}</Fact>}
          </dl>

          <div>
            <h2 className="mb-2 text-sm font-medium">Tags</h2>
            {link.tags.length ? (
              <ul className="flex flex-wrap gap-1.5">
                {link.tags.map((t) => (
                  <li key={t}><Link href={`/links?tag=${encodeURIComponent(t)}`} className="rounded-md border px-2 py-0.5 text-sm hover:border-foreground/30">#{t}</Link></li>
                ))}
              </ul>
            ) : <p className="text-sm text-muted-foreground">No tags yet.</p>}
          </div>

          {link.collections.length > 0 && (
            <div>
              <h2 className="mb-2 text-sm font-medium">In collections</h2>
              <ul className="space-y-1 text-sm">
                {link.collections.map((c) => <li key={c.id}><Link className="hover:underline" href={`/collections/${c.id}`}>{c.name}</Link></li>)}
              </ul>
            </div>
          )}

          <div>
            <h2 className="mb-2 text-sm font-medium">Your notes</h2>
            <Notes key={link.notes ?? ""} link={link} />
          </div>
          <StatusPill status={link.status} detail={link.status_detail} />
        </aside>
      </div>
      {editing && <EditDialog link={link} open={editing} onOpenChange={setEditing} />}
    </article>
  );
}
