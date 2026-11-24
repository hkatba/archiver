"use client";

import { GitFork, Star } from "lucide-react";
import Link from "next/link";
import { useSWRConfig } from "swr";
import { toast } from "sonner";
import { api } from "@/lib/api";
import { ago, compact, mineral } from "@/lib/format";
import type { LinkCard } from "@/lib/types";
import { cn } from "@/lib/utils";
import { Availability, CategoryMark, Favicon, FavoriteStar, StatusPill } from "./bits";

export function useLinkActions() {
  const { mutate } = useSWRConfig();
  const refresh = () => mutate((key) => typeof key === "string" && key.startsWith("/api/"), undefined, { revalidate: true });
  return {
    refresh,
    async toggleFavorite(link: LinkCard) {
      try {
        await api(`/api/links/${link.id}`, { method: "PATCH", json: { is_favorite: !link.is_favorite } });
        await refresh();
      } catch (e) {
        toast.error((e as Error).message);
      }
    },
  };
}

function GithubStats({ gh }: { gh: NonNullable<LinkCard["github"]> }) {
  return (
    <span className="inline-flex items-center gap-2.5 text-xs text-muted-foreground">
      {gh.stars !== undefined && <span className="inline-flex items-center gap-0.5"><Star className="size-3" aria-hidden="true" />{compact(gh.stars)}</span>}
      {gh.forks !== undefined && <span className="inline-flex items-center gap-0.5"><GitFork className="size-3" aria-hidden="true" />{compact(gh.forks)}</span>}
      {gh.language && <span>{gh.language}</span>}
      {gh.license && <span>{gh.license}</span>}
    </span>
  );
}

function Thumb({ link }: { link: LinkCard }) {
  if (link.thumbnail) {
    // eslint-disable-next-line @next/next/no-img-element
    return <img src={link.thumbnail} alt="" loading="lazy" className="aspect-[16/10] w-full border-b object-cover object-top" />;
  }
  return (
    <div className="grid aspect-[16/10] w-full place-items-center border-b"
      style={{ background: `color-mix(in oklab, ${mineral(link.category)} 14%, var(--card))` }}>
      <Favicon link={link} size={36} />
    </div>
  );
}

export function LinkGridCard({ link }: { link: LinkCard }) {
  const { toggleFavorite } = useLinkActions();
  return (
    <Link href={`/links/${link.id}`}
      className="group flex flex-col overflow-hidden rounded-lg border bg-card transition-colors hover:border-foreground/25 focus-visible:border-ring">
      <Thumb link={link} />
      <div className="flex flex-1 flex-col gap-2 p-3.5">
        <div className="flex items-start gap-2">
          <Favicon link={link} size={18} />
          <div className="min-w-0 flex-1">
            <p className="truncate font-medium leading-tight">{link.name || link.domain}</p>
            <p className="truncate text-xs text-muted-foreground">{link.domain}</p>
          </div>
          <FavoriteStar on={link.is_favorite} onToggle={() => toggleFavorite(link)} className="-mr-1 -mt-1" />
        </div>
        {link.description ? (
          <p className="line-clamp-2 text-sm text-muted-foreground">{link.description}</p>
        ) : link.status === "COMPLETED" ? null : (
          <p className="text-sm text-muted-foreground">{link.status_detail || "Waiting to be read and analyzed."}</p>
        )}
        <div className="mt-auto flex flex-wrap items-center gap-x-3 gap-y-1 pt-1">
          <CategoryMark category={link.category} subcategory={link.subcategory} />
          {link.has_free_plan && <span className="text-xs text-ok">Free plan</span>}
          {link.github && <GithubStats gh={link.github} />}
          <StatusPill status={link.status} detail={link.status_detail} />
          <Availability value={link.availability} />
        </div>
        {link.tags.length > 0 && (
          <p className="truncate text-xs text-muted-foreground">{link.tags.map((t) => `#${t}`).join("  ")}</p>
        )}
      </div>
    </Link>
  );
}

export function LinkRow({ link, reasons, extra }: { link: LinkCard; reasons?: string[]; extra?: React.ReactNode }) {
  const { toggleFavorite } = useLinkActions();
  return (
    <div className="group relative flex items-start gap-3 border-b px-3 py-3 last:border-b-0 hover:bg-accent/50">
      <Favicon link={link} size={20} />
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-baseline gap-x-2">
          <Link href={`/links/${link.id}`} className="font-medium after:absolute after:inset-0 focus-visible:outline-none">
            {link.name || link.domain}
          </Link>
          <span className="text-xs text-muted-foreground">{link.domain}</span>
        </div>
        {link.description && <p className="mt-0.5 line-clamp-1 text-sm text-muted-foreground">{link.description}</p>}
        {reasons && reasons.length > 0 && (
          <ul className="mt-1.5 flex flex-wrap gap-1.5">
            {reasons.map((r) => (
              <li key={r} className="rounded-md bg-muted px-1.5 py-0.5 text-xs text-muted-foreground">{r}</li>
            ))}
          </ul>
        )}
        <div className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1">
          <CategoryMark category={link.category} subcategory={link.subcategory} />
          {link.tags.slice(0, 4).map((t) => (
            <span key={t} className="text-xs text-muted-foreground">#{t}</span>
          ))}
          {link.has_free_plan && <span className="text-xs text-ok">Free plan</span>}
          {link.github && <GithubStats gh={link.github} />}
          <StatusPill status={link.status} detail={link.status_detail} />
          <Availability value={link.availability} />
        </div>
      </div>
      <div className="relative z-10 flex shrink-0 items-center gap-2">
        {extra}
        <span className="hidden text-xs text-muted-foreground sm:inline">{ago(link.created_at)}</span>
        <FavoriteStar on={link.is_favorite} onToggle={() => toggleFavorite(link)} />
      </div>
    </div>
  );
}

export function LinkCollection({ links, view }: { links: LinkCard[]; view: "grid" | "list" }) {
  if (view === "list") {
    return (
      <div className="overflow-hidden rounded-lg border bg-card">
        {links.map((l) => <LinkRow key={l.id} link={l} />)}
      </div>
    );
  }
  return (
    <div className={cn("grid gap-4", "grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 2xl:grid-cols-4")}>
      {links.map((l) => <LinkGridCard key={l.id} link={l} />)}
    </div>
  );
}
