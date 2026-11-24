"use client";

import { ClipboardPaste, FileUp, LoaderCircle } from "lucide-react";
import { useRef, useState } from "react";
import useSWR from "swr";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/textarea";
import { api } from "@/lib/api";
import type { Collection, PreviewItem } from "@/lib/types";
import { cn } from "@/lib/utils";
import { useLinkActions } from "./link-views";

interface Preview {
  items: PreviewItem[];
  total: number;
  new: number;
  duplicates: number;
  invalid: number;
}

function itemState(i: PreviewItem): { label: string; tone: string } {
  if (!i.valid) return { label: i.error ?? "Invalid", tone: "text-destructive" };
  if (i.duplicate_of) return { label: "Already saved", tone: "text-muted-foreground" };
  if (i.duplicate_in_batch) return { label: "Repeated in this list", tone: "text-muted-foreground" };
  return { label: "New", tone: "text-ok" };
}

export function AddLinksDialog({ open, onOpenChange, collectionId }: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  collectionId?: string;
}) {
  const [text, setText] = useState("");
  const [preview, setPreview] = useState<Preview | null>(null);
  const [busy, setBusy] = useState(false);
  const [dragging, setDragging] = useState(false);
  const [collection, setCollection] = useState(collectionId ?? "");
  const fileRef = useRef<HTMLInputElement>(null);
  const { data: collections } = useSWR<Collection[]>(open ? "/api/collections" : null);
  const { refresh } = useLinkActions();

  function reset() {
    setText("");
    setPreview(null);
  }

  async function runPreview(value = text) {
    if (!value.trim()) return;
    setBusy(true);
    try {
      setPreview(await api<Preview>("/api/links/preview", { method: "POST", json: { text: value } }));
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function loadFile(file: File) {
    if (file.size > 5_000_000) return toast.error("That file is larger than 5 MB.");
    const content = await file.text();
    setText(content);
    await runPreview(content);
  }

  async function pasteClipboard() {
    try {
      const clip = await navigator.clipboard.readText();
      if (!clip.trim()) return toast.message("The clipboard is empty.");
      const next = text.trim() ? `${text.trim()}\n${clip}` : clip;
      setText(next);
      await runPreview(next);
    } catch {
      toast.error("The browser didn't allow reading the clipboard. Paste with Ctrl+V instead.");
    }
  }

  async function submit() {
    if (!preview) return;
    const urls = preview.items.filter((i) => i.valid && !i.duplicate_of && !i.duplicate_in_batch).map((i) => i.input);
    if (urls.length === 0 && !collection) return;
    setBusy(true);
    try {
      const res = await api<{ created: unknown[]; duplicates: unknown[] }>("/api/links/bulk", {
        method: "POST",
        json: { urls: urls.length ? urls : preview.items.filter((i) => i.duplicate_of).map((i) => i.input), collection_id: collection || null },
      });
      toast.success(res.created.length
        ? `Added ${res.created.length} link${res.created.length === 1 ? "" : "s"}. Reading and analyzing them now.`
        : "Added the saved links to the collection.");
      reset();
      onOpenChange(false);
      refresh();
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  const newCount = preview?.new ?? 0;

  return (
    <Dialog open={open} onOpenChange={(o) => { onOpenChange(o); if (!o) setPreview(null); }}>
      <DialogContent className="sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>Add links</DialogTitle>
          <DialogDescription>
            Paste one URL or hundreds, one per line. You can also drop a TXT or CSV file or a browser bookmarks export.
          </DialogDescription>
        </DialogHeader>

        {!preview ? (
          <div
            onDragOver={(e) => { e.preventDefault(); setDragging(true); }}
            onDragLeave={() => setDragging(false)}
            onDrop={(e) => {
              e.preventDefault();
              setDragging(false);
              const f = e.dataTransfer.files?.[0];
              if (f) loadFile(f);
              else {
                const t = e.dataTransfer.getData("text/plain");
                if (t) setText((prev) => (prev ? `${prev}\n${t}` : t));
              }
            }}
            className={cn("rounded-lg transition-colors", dragging && "ring-2 ring-ring")}
          >
            <Textarea
              autoFocus
              value={text}
              onChange={(e) => setText(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) runPreview(); }}
              placeholder={"https://example.com\nhttps://github.com/owner/repo\nanother-tool.ai"}
              className="min-h-52 font-[family-name:var(--font-instrument)] text-sm"
              aria-label="URLs to add"
            />
            <div className="mt-2 flex flex-wrap gap-2">
              <Button variant="outline" size="sm" onClick={() => fileRef.current?.click()}>
                <FileUp /> Import file
              </Button>
              <Button variant="outline" size="sm" onClick={pasteClipboard}>
                <ClipboardPaste /> Paste from clipboard
              </Button>
              <input ref={fileRef} type="file" accept=".txt,.csv,.html,.htm,.md,text/plain,text/csv,text/html" hidden
                onChange={(e) => { const f = e.target.files?.[0]; if (f) loadFile(f); e.target.value = ""; }} />
            </div>
          </div>
        ) : (
          <div>
            <p className="text-sm">
              <strong className="font-semibold">{preview.new} new</strong>
              <span className="text-muted-foreground">
                {preview.duplicates > 0 && `, ${preview.duplicates} already saved or repeated`}
                {preview.invalid > 0 && `, ${preview.invalid} not valid`}
              </span>
            </p>
            <ul className="mt-3 max-h-72 overflow-y-auto rounded-md border text-sm">
              {preview.items.map((i, idx) => {
                const s = itemState(i);
                return (
                  <li key={idx} className="flex items-baseline gap-3 border-b px-3 py-1.5 last:border-b-0">
                    <span className="min-w-0 flex-1 truncate" title={i.input}>{i.normalized_url ?? i.input}</span>
                    <span className={cn("shrink-0 text-xs", s.tone)}>{s.label}</span>
                  </li>
                );
              })}
              {preview.items.length === 0 && <li className="px-3 py-6 text-center text-muted-foreground">No URLs found in that text.</li>}
            </ul>
            {collections && collections.filter((c) => !c.is_smart).length > 0 && (
              <label className="mt-4 flex items-center gap-2 text-sm">
                <span className="text-muted-foreground">Also add to</span>
                <select value={collection} onChange={(e) => setCollection(e.target.value)}
                  className="h-8 rounded-md border bg-background px-2 text-sm">
                  <option value="">No collection</option>
                  {collections.filter((c) => !c.is_smart).map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
                </select>
              </label>
            )}
          </div>
        )}

        <DialogFooter>
          {preview ? (
            <>
              <Button variant="ghost" onClick={() => setPreview(null)}>Edit list</Button>
              <Button onClick={submit} disabled={busy || (newCount === 0 && !collection)}>
                {busy && <LoaderCircle className="animate-spin" />}
                {newCount > 0 ? `Add ${newCount} link${newCount === 1 ? "" : "s"}` : "Add to collection"}
              </Button>
            </>
          ) : (
            <Button onClick={() => runPreview()} disabled={busy || !text.trim()}>
              {busy && <LoaderCircle className="animate-spin" />} Check links
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
