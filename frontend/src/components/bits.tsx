"use client";

import { Ban, CircleCheck, CircleDashed, LoaderCircle, Star, TriangleExclamationPoint } from "lucide-react";
import NextLink from "next/link";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { mineral, STATUS_LABEL } from "@/lib/format";
import type { LinkCard, LinkStatus } from "@/lib/types";
import { ACTIVE } from "@/lib/types";

export function Logo({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 32 32" className={className} aria-hidden="true">
      <ellipse cx="16" cy="25.5" rx="12" ry="4.5" fill="currentColor" opacity="0.9" />
      <ellipse cx="15.2" cy="17.4" rx="8.4" ry="3.9" fill="currentColor" opacity="0.7" />
      <ellipse cx="16.4" cy="10.2" rx="5.2" ry="3.2" fill="currentColor" opacity="0.5" />
      <ellipse cx="15.8" cy="4.8" rx="2.6" ry="2.1" fill="var(--lichen)" />
    </svg>
  );
}

export function Favicon({ link, size = 20 }: { link: Pick<LinkCard, "favicon" | "domain" | "name" | "category">; size?: number }) {
  const [broken, setBroken] = useState(false);
  if (link.favicon && !broken) {
    return (
      // eslint-disable-next-line @next/next/no-img-element
      <img src={link.favicon} alt="" width={size} height={size} onError={() => setBroken(true)}
        className="shrink-0 rounded-sm" style={{ width: size, height: size }} />
    );
  }
  const letter = (link.name || link.domain || "?").replace(/^www\./, "").charAt(0).toUpperCase();
  return (
    <span aria-hidden="true" className="inline-grid shrink-0 place-items-center rounded-sm font-semibold text-white"
      style={{ width: size, height: size, fontSize: size * 0.55, background: mineral(link.category) }}>
      {letter}
    </span>
  );
}

export function StatusPill({ status, detail }: { status: LinkStatus; detail?: string | null }) {
  if (status === "COMPLETED") return null;
  const active = ACTIVE.includes(status);
  const Icon = active ? LoaderCircle : status === "BLOCKED" ? Ban : status === "FAILED" ? TriangleExclamationPoint : CircleDashed;
  return (
    <span title={detail ?? undefined}
      className={cn("inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 text-xs font-medium",
        active && "bg-muted text-muted-foreground",
        status === "FAILED" && "bg-destructive/10 text-destructive",
        status === "BLOCKED" && "bg-destructive/10 text-destructive",
        status === "NEEDS_REVIEW" && "bg-warn/12 text-warn")}>
      <Icon className={cn("size-3", active && "animate-spin")} aria-hidden="true" />
      {STATUS_LABEL[status]}
    </span>
  );
}

export function CategoryMark({ category, subcategory, className }: { category: string | null; subcategory?: string | null; className?: string }) {
  if (!category) return <span className={cn("text-xs text-muted-foreground", className)}>Uncategorized</span>;
  return (
    <span className={cn("inline-flex min-w-0 items-center gap-1.5 text-xs text-muted-foreground", className)} title={category}>
      <span className="stone inline-block h-2 w-3 shrink-0" style={{ background: mineral(category) }} aria-hidden="true" />
      <span className="truncate">{subcategory || category}</span>
    </span>
  );
}

export function Availability({ value }: { value: LinkCard["availability"] }) {
  if (value === "up" || value === "unknown") return null;
  return (
    <span className={cn("text-xs", value === "down" ? "text-destructive" : "text-muted-foreground")}>
      {value === "down" ? "Site unreachable" : "Redirects elsewhere"}
    </span>
  );
}

export function FavoriteStar({ on, onToggle, className }: { on: boolean; onToggle: () => void; className?: string }) {
  return (
    <button type="button" onClick={(e) => { e.preventDefault(); e.stopPropagation(); onToggle(); }}
      aria-pressed={on} aria-label={on ? "Remove from favorites" : "Add to favorites"}
      className={cn("rounded-md p-1 text-muted-foreground transition-colors hover:bg-accent hover:text-foreground", on && "text-warn", className)}>
      <Star className="size-4" fill={on ? "currentColor" : "none"} />
    </button>
  );
}

export function Verified({ ok, quote }: { ok: boolean; quote?: string | null }) {
  return ok ? (
    <span className="inline-flex items-center gap-1 text-xs text-ok" title={quote ? `From the page: “${quote}”` : undefined}>
      <CircleCheck className="size-3" aria-hidden="true" /> On the page
    </span>
  ) : (
    <span className="text-xs text-muted-foreground" title="Inferred by AI; not found verbatim on the page">Inferred</span>
  );
}

export function Empty({ title, children, action }: { title: string; children?: React.ReactNode; action?: React.ReactNode }) {
  return (
    <div className="rounded-lg border border-dashed px-6 py-12 text-center">
      <p className="font-medium">{title}</p>
      {children && <div className="mx-auto mt-1 max-w-md text-sm text-muted-foreground">{children}</div>}
      {action && <div className="mt-4">{action}</div>}
    </div>
  );
}

export function PageHeader({ title, description, actions }: { title: React.ReactNode; description?: React.ReactNode; actions?: React.ReactNode }) {
  return (
    <div className="mb-6 flex flex-wrap items-end justify-between gap-3">
      <div className="min-w-0">
        <h1 className="display text-4xl">{title}</h1>
        {description && <p className="mt-2 text-sm text-muted-foreground">{description}</p>}
      </div>
      {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
    </div>
  );
}

export function ButtonLink({ href, ...props }: React.ComponentProps<typeof Button> & { href: string }) {
  return <Button nativeButton={false} render={<NextLink href={href} />} {...props} />;
}
