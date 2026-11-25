"use client";

import { Check, Copy, Download, Upload } from "lucide-react";
import Link from "next/link";
import { useTheme } from "next-themes";
import { useRef, useState } from "react";
import useSWR from "swr";
import { toast } from "sonner";
import { PageHeader } from "@/components/bits";
import { useLinkActions } from "@/components/link-views";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { api } from "@/lib/api";
import { ago } from "@/lib/format";
import type { AIStatus } from "@/lib/types";

interface SystemStatus {
  ai: AIStatus;
  embeddings: { provider: string; model: string };
  browser_enabled: boolean;
  respect_robots_txt: boolean;
  github_token: boolean;
  queue: Record<string, number>;
}
interface Token { id: string; name: string; created_at: string; last_used_at: string | null }

function Card({ title, children, description }: { title: string; description?: string; children: React.ReactNode }) {
  return (
    <section className="grid gap-4 border-t py-8 md:grid-cols-[280px_minmax(0,1fr)] md:gap-10">
      <div>
        <h2 className="title-md">{title}</h2>
        {description && <p className="mt-2 text-sm text-muted-foreground">{description}</p>}
      </div>
      <div className="min-w-0">{children}</div>
    </section>
  );
}

function Tokens() {
  const { data, mutate } = useSWR<Token[]>("/api/tokens");
  const [name, setName] = useState("");
  const [created, setCreated] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  async function create(e: React.FormEvent) {
    e.preventDefault();
    const t = await api<{ token: string }>("/api/tokens", { method: "POST", json: { name } });
    setCreated(t.token);
    setName("");
    mutate();
  }
  async function revoke(id: string) {
    await api(`/api/tokens/${id}`, { method: "DELETE" });
    toast.success("Token revoked.");
    mutate();
  }
  return (
    <div className="grid gap-4">
      {created && (
        <div className="rounded-lg border border-lichen/50 bg-card p-4 text-sm">
          <p className="font-medium">Copy this token now. It won&apos;t be shown again.</p>
          <div className="mt-2 flex gap-2">
            <code className="min-w-0 flex-1 truncate rounded bg-muted px-2 py-1.5">{created}</code>
            <Button size="sm" variant="outline" onClick={async () => { await navigator.clipboard.writeText(created); setCopied(true); }}>
              {copied ? <Check /> : <Copy />} {copied ? "Copied" : "Copy"}
            </Button>
          </div>
        </div>
      )}
      <form onSubmit={create} className="flex gap-2">
        <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="Token name, e.g. Chrome extension" aria-label="Token name" required />
        <Button type="submit" disabled={!name.trim()}>Create token</Button>
      </form>
      {data && data.length > 0 && (
        <ul className="divide-y border-y text-sm">
          {data.map((t) => (
            <li key={t.id} className="flex items-center justify-between gap-3 py-3">
              <span className="min-w-0">
                <span className="font-medium">{t.name}</span>
                <span className="block text-xs text-muted-foreground">Created {ago(t.created_at)}, last used {ago(t.last_used_at)}</span>
              </span>
              <Button size="sm" variant="ghost" onClick={() => revoke(t.id)}>Revoke</Button>
            </li>
          ))}
        </ul>
      )}
      <p className="text-xs text-muted-foreground">
        Use as <code>Authorization: Bearer &lt;token&gt;</code>. Full reference in the <a className="underline" href="/api/docs" target="_blank" rel="noreferrer">API docs</a>.
      </p>
    </div>
  );
}

export function SettingsPage() {
  const { data: sys } = useSWR<SystemStatus>("/api/system/status");
  const { theme, setTheme } = useTheme();
  const { refresh } = useLinkActions();
  const fileRef = useRef<HTMLInputElement>(null);

  async function importFile(file: File) {
    try {
      const payload = JSON.parse(await file.text());
      const r = await api<{ restored: number; skipped: number }>("/api/import", { method: "POST", json: payload });
      toast.success(`Restored ${r.restored} links; skipped ${r.skipped} already in your library.`);
      refresh();
    } catch (e) {
      toast.error(e instanceof SyntaxError ? "That file isn't valid JSON." : (e as Error).message);
    }
  }

  return (
    <>
      <PageHeader title="Settings" />
      <Card title="AI analysis" description="Summaries, categories and the assistant. Configured on the server in the .env file.">
        {sys ? (
          <dl className="grid gap-1.5 text-sm">
            <div className="flex gap-2"><dt className="w-36 text-muted-foreground">Provider</dt><dd>{sys.ai.provider === "extractive" ? "None (page metadata only)" : sys.ai.provider}</dd></div>
            {sys.ai.configured && <>
              <div className="flex gap-2"><dt className="w-36 text-muted-foreground">Per-link model</dt><dd>{sys.ai.fast_model}</dd></div>
              <div className="flex gap-2"><dt className="w-36 text-muted-foreground">Assistant model</dt><dd>{sys.ai.smart_model}</dd></div>
            </>}
            {sys.ai.missing && <p className="text-destructive">Missing setting: {sys.ai.missing}</p>}
            {!sys.ai.configured && (
              <p className="mt-2 text-muted-foreground">
                Set <code>AI_PROVIDER</code> to <code>anthropic</code>, <code>openai</code>, <code>gemini</code> or <code>ollama</code> and add the
                matching key in <code>.env</code>, then restart the API and worker. Use Regenerate on a link, or Re-read, to analyze existing links.
              </p>
            )}
            <div className="mt-2 flex gap-2"><dt className="w-36 text-muted-foreground">Search embeddings</dt><dd>{sys.embeddings.model} (runs locally)</dd></div>
            <div className="flex gap-2"><dt className="w-36 text-muted-foreground">Page rendering</dt><dd>{sys.browser_enabled ? "Headless Chromium" : "Plain HTTP only"}</dd></div>
            <div className="flex gap-2"><dt className="w-36 text-muted-foreground">robots.txt</dt><dd>{sys.respect_robots_txt ? "Respected" : "Ignored"}</dd></div>
            <div className="flex gap-2"><dt className="w-36 text-muted-foreground">GitHub API</dt><dd>{sys.github_token ? "Authenticated" : "Anonymous (60 requests/hour)"}</dd></div>
          </dl>
        ) : <p className="text-sm text-muted-foreground">Loading…</p>}
      </Card>
      <Card title="Appearance">
        <div className="flex rounded-md border border-input bg-card/60 p-[3px] text-sm" role="radiogroup" aria-label="Theme" style={{ width: "fit-content" }}>
          {["system", "light", "dark"].map((t) => (
            <button key={t} type="button" role="radio" aria-checked={theme === t} onClick={() => setTheme(t)}
              className={`press h-8 rounded-[4px] px-3.5 capitalize ${theme === t ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground"}`}>{t}</button>
          ))}
        </div>
      </Card>
      <Card title="API tokens" description="For the browser extension, scripts and the future iOS app.">
        <Tokens />
      </Card>
      <Card title="Export and backup" description="Your data is yours. Markdown works with Obsidian and Logseq.">
        <div className="flex flex-wrap gap-2">
          <Button variant="outline" nativeButton={false} render={<a href="/api/export?format=json" />}><Download /> Full backup (JSON)</Button>
          <Button variant="outline" nativeButton={false} render={<a href="/api/export?format=markdown" />}><Download /> Markdown notes (ZIP)</Button>
          <Button variant="outline" onClick={() => fileRef.current?.click()}><Upload /> Restore a backup</Button>
          <input ref={fileRef} type="file" accept="application/json,.json" hidden
            onChange={(e) => { const f = e.target.files?.[0]; if (f) importFile(f); e.target.value = ""; }} />
        </div>
      </Card>
      <Card title="Trash" description="Deleted links can be restored.">
        <Link href="/links?deleted=true" className="text-sm underline decoration-lichen underline-offset-4 hover:decoration-foreground">Open trash</Link>
      </Card>
    </>
  );
}
