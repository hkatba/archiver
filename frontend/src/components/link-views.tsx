"use client";

import { GitFork, Star } from "lucide-react";
import Link from "next/link";
import { useRef, useState } from "react";
import { useSWRConfig } from "swr";
import { toast } from "sonner";
import { api } from "@/lib/api";
import { ago, compact, mineral } from "@/lib/format";
import { EASE, gsap, MOTION, ScrollTrigger, useGSAP } from "@/lib/gsap";
import type { LinkCard } from "@/lib/types";
import { cn } from "@/lib/utils";
import { Availability, CategoryMark, Favicon, FavoriteStar, StatusPill, vars } from "./bits";

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

// The entrance stagger stops after a dozen items so long lists never wait on it
const stagger = (i?: number) => (i === undefined ? undefined : vars({ "--i": Math.min(i, 12) }));

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

function Thumb({ link, className }: { link: LinkCard; className?: string }) {
  const [broken, setBroken] = useState(false); // an archived file can go missing; fall back to the mineral tile
  return (
    <div className={cn("frame aspect-[16/10]", className)}>
      {link.thumbnail && !broken ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={link.thumbnail} alt="" loading="lazy" decoding="async" onError={() => setBroken(true)}
          className="size-full object-cover object-left-top" />
      ) : (
        <div className="grid size-full place-items-center"
          style={{ background: `color-mix(in oklab, ${mineral(link.category)} 16%, var(--card))` }}>
          <Favicon link={link} size={34} />
        </div>
      )}
    </div>
  );
}

/** A saved link as a card. `featured` is the lead card: two columns wide (and two rows on desktop). */
export function LinkGridCard({ link, featured = false }: { link: LinkCard; featured?: boolean }) {
  const { toggleFavorite } = useLinkActions();
  return (
    <Link href={`/links/${link.id}`} data-reveal data-cursor="Open"
      className={cn("group lift flex flex-col rounded-lg outline-offset-4", featured && "sm:col-span-2 lg:row-span-2")}>
      <Thumb link={link} className={featured ? "sm:aspect-[16/8] lg:aspect-auto lg:min-h-[340px] lg:flex-1" : undefined} />
      <div className={cn("flex flex-col gap-2", featured ? "pt-5" : "flex-1 pt-3.5")}>
        <div className="flex items-start gap-2.5">
          <span className={featured ? "mt-2" : "mt-0.5"}><Favicon link={link} size={featured ? 22 : 18} /></span>
          <div className="min-w-0 flex-1">
            {featured ? (
              <p className="display truncate text-[clamp(1.9rem,1.4rem+1.4vw,2.8rem)] leading-tight"><span className="ink-link">{link.name || link.domain}</span></p>
            ) : (
              <p className="truncate font-medium leading-snug"><span className="ink-link">{link.name || link.domain}</span></p>
            )}
            <p className="truncate text-xs text-muted-foreground">{link.domain}{featured && <> · saved {ago(link.created_at)}</>}</p>
          </div>
          <FavoriteStar on={link.is_favorite} onToggle={() => toggleFavorite(link)} className="-mt-1.5 -mr-1.5" />
        </div>
        {link.description ? (
          <p className={cn("text-muted-foreground", featured ? "line-clamp-3 max-w-[60ch] font-serif text-lg text-foreground/80" : "line-clamp-2 text-sm")}>{link.description}</p>
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

export function LinkRow({ link, reasons, extra, index, reveal = false }: { link: LinkCard; reasons?: string[]; extra?: React.ReactNode; index?: number; reveal?: boolean }) {
  const { toggleFavorite } = useLinkActions();
  return (
    <div style={reveal ? undefined : stagger(index)} data-reveal={reveal || undefined}
      className={cn("group relative flex items-start gap-3.5 border-t px-1 py-4 transition-colors duration-200 first:border-t-0 hover:bg-card/70 sm:px-3", !reveal && "enter")}>
      <span className="mt-0.5"><Favicon link={link} size={20} /></span>
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-baseline gap-x-2.5">
          <Link href={`/links/${link.id}`} className="font-medium after:absolute after:inset-0 focus-visible:outline-none">
            <span className="ink-link">{link.name || link.domain}</span>
          </Link>
          <span className="text-xs text-muted-foreground">{link.domain}</span>
        </div>
        {link.description && <p className="mt-1 line-clamp-1 text-sm text-muted-foreground">{link.description}</p>}
        {reasons && reasons.length > 0 && (
          <ul className="mt-2 flex flex-wrap gap-x-3 gap-y-1">
            {reasons.map((r) => (
              <li key={r} className="text-xs text-foreground/75 before:mr-1.5 before:text-lichen before:content-['›']">{r}</li>
            ))}
          </ul>
        )}
        <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1">
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
        <span className="hidden text-xs text-muted-foreground tabular-nums sm:inline">{ago(link.created_at)}</span>
        <FavoriteStar on={link.is_favorite} onToggle={() => toggleFavorite(link)} />
      </div>
      {/* Focus ring for the whole row, drawn by the stretched link */}
      <span aria-hidden="true" className="pointer-events-none absolute inset-0 rounded-md ring-ring ring-offset-0 group-has-[a:focus-visible]:ring-2" />
    </div>
  );
}

/** A small ink disc that follows a fine pointer over anything marked `data-cursor` inside its parent,
 * saying what a click does. (Bound to its parent element: a parent's ref is not attached yet when a child's effect runs.) */
export function CursorChip() {
  const chip = useRef<HTMLDivElement>(null);
  useGSAP(() => {
    const el = chip.current, root = el?.parentElement;
    if (!root || !el || !matchMedia("(pointer: fine) and (prefers-reduced-motion: no-preference)").matches) return;
    gsap.set(el, { xPercent: -50, yPercent: -50, scale: 0, autoAlpha: 0 });
    const x = gsap.quickTo(el, "x", { duration: 0.5, ease: "power3" });
    const y = gsap.quickTo(el, "y", { duration: 0.5, ease: "power3" });
    let shown = false;
    const show = (on: boolean, label?: string) => {
      if (label) el.textContent = label;
      if (on === shown) return;
      shown = on;
      gsap.to(el, { scale: on ? 1 : 0.4, autoAlpha: on ? 1 : 0, duration: on ? 0.45 : 0.25, ease: on ? EASE.out : "power2.in", overwrite: "auto" });
    };
    const move = (e: PointerEvent) => {
      const target = (e.target as HTMLElement).closest<HTMLElement>("[data-cursor]");
      const overControl = (e.target as HTMLElement).closest("button");
      if (!shown) gsap.set(el, { x: e.clientX, y: e.clientY });
      x(e.clientX);
      y(e.clientY);
      show(!!target && !overControl, target?.dataset.cursor);
    };
    const leave = () => show(false);
    root.addEventListener("pointermove", move);
    root.addEventListener("pointerleave", leave);
    window.addEventListener("scroll", leave, { passive: true });
    return () => {
      root.removeEventListener("pointermove", move);
      root.removeEventListener("pointerleave", leave);
      window.removeEventListener("scroll", leave);
    };
  });
  return (
    <div ref={chip} aria-hidden="true"
      className="pointer-events-none invisible fixed top-0 left-0 z-50 grid size-[72px] place-items-center rounded-full bg-primary text-[0.8rem] font-medium text-primary-foreground" />
  );
}

/** Cards and rows rise in as they scroll into view; pictures are wiped up into their frames. Each item plays once. */
function useBatchReveal(root: React.RefObject<HTMLElement | null>, key: string) {
  useGSAP(() => {
    gsap.matchMedia().add(MOTION.ok, () => {
      const fresh = gsap.utils.toArray<HTMLElement>("[data-reveal]:not([data-armed])", root.current);
      if (!fresh.length) return;
      fresh.forEach((el) => el.setAttribute("data-armed", ""));
      gsap.set(fresh, { autoAlpha: 0, y: 56 });
      ScrollTrigger.batch(fresh, {
        start: "top 94%", once: true, interval: 0.08,
        onEnter: (batch) => {
          const els = batch as HTMLElement[];
          gsap.to(els, { autoAlpha: 1, y: 0, duration: 1.1, ease: EASE.out, stagger: 0.09, clearProps: "opacity,visibility,transform" });
          const frames = els.map((el) => el.querySelector<HTMLElement>(".frame")).filter((f): f is HTMLElement => !!f);
          if (!frames.length) return;
          gsap.fromTo(frames, { clipPath: "inset(100% 0% 0% 0%)" }, { clipPath: "inset(0% 0% 0% 0%)", duration: 1.25, ease: "expo.inOut", stagger: 0.09, clearProps: "clipPath" });
          const imgs = frames.map((f) => f.firstElementChild as HTMLElement);
          gsap.fromTo(imgs, { scale: 1.3, transition: "none" }, { scale: 1, duration: 1.7, ease: EASE.out, stagger: 0.09, clearProps: "transform,transition" });
        },
      });
      ScrollTrigger.refresh();
    });
  }, { scope: root, dependencies: [key] });
}

export function LinkCollection({ links, view, feature = false }: { links: LinkCard[]; view: "grid" | "list"; feature?: boolean }) {
  const root = useRef<HTMLDivElement>(null);
  useBatchReveal(root, `${view}:${links.map((l) => l.id).join(",")}`);
  if (view === "list") {
    return (
      <div ref={root} className="border-y">
        {links.map((l) => <LinkRow key={l.id} link={l} reveal />)}
      </div>
    );
  }
  return (
    <div ref={root} className="grid grid-cols-1 gap-x-7 gap-y-12 sm:grid-cols-2 lg:grid-cols-3 2xl:grid-cols-4">
      {links.map((l, i) => <LinkGridCard key={l.id} link={l} featured={feature && i === 0 && links.length > 3} />)}
      <CursorChip />
    </div>
  );
}
