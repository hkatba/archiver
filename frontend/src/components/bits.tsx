"use client";

import { Ban, CircleCheck, CircleDashed, LoaderCircle, Star, TriangleExclamationPoint } from "lucide-react";
import NextLink from "next/link";
import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { mineral, STATUS_LABEL } from "@/lib/format";
import { EASE, gsap, MOTION, useGSAP } from "@/lib/gsap";
import type { LinkCard, LinkStatus } from "@/lib/types";
import { ACTIVE } from "@/lib/types";

/** CSS custom properties for the motion system (`--d` delay, `--i` stagger index). */
export const vars = (v: Record<string, string | number>) => v as React.CSSProperties;

/** Pulls an element a few pixels towards a fine pointer, then springs back. Uses `translate`, so it
 * composes with the `scale` press feedback. Off for touch and reduced motion. */
export function useMagnetic<T extends HTMLElement>(pull = 0.22, max = 7) {
  const ref = useRef<T>(null);
  useEffect(() => {
    const el = ref.current;
    if (!el || !matchMedia("(pointer: fine) and (prefers-reduced-motion: no-preference)").matches) return;
    let raf = 0, x = 0, y = 0, tx = 0, ty = 0;
    const clamp = (n: number) => Math.max(-max, Math.min(max, n));
    const tick = () => {
      x += (tx - x) * 0.18;
      y += (ty - y) * 0.18;
      el.style.translate = `${x.toFixed(2)}px ${y.toFixed(2)}px`;
      raf = Math.abs(tx - x) + Math.abs(ty - y) > 0.05 ? requestAnimationFrame(tick) : 0;
    };
    const move = (e: PointerEvent) => {
      const r = el.getBoundingClientRect();
      tx = clamp((e.clientX - r.left - r.width / 2) * pull);
      ty = clamp((e.clientY - r.top - r.height / 2) * pull);
      if (!raf) raf = requestAnimationFrame(tick);
    };
    const leave = () => {
      tx = ty = 0;
      if (!raf) raf = requestAnimationFrame(tick);
    };
    el.addEventListener("pointermove", move);
    el.addEventListener("pointerleave", leave);
    return () => {
      cancelAnimationFrame(raf);
      el.removeEventListener("pointermove", move);
      el.removeEventListener("pointerleave", leave);
      el.style.translate = "";
    };
  }, [pull, max]);
  return ref;
}

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
        className="shrink-0 rounded-[3px]" style={{ width: size, height: size }} />
    );
  }
  const letter = (link.name || link.domain || "?").replace(/^www\./, "").charAt(0).toUpperCase();
  return (
    <span aria-hidden="true" className="inline-grid shrink-0 place-items-center rounded-[3px] font-display text-white"
      style={{ width: size, height: size, fontSize: size * 0.68, lineHeight: 1, background: mineral(link.category) }}>
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
      className={cn("inline-flex items-center gap-1 rounded-[3px] px-1.5 py-0.5 text-xs font-medium",
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
      className={cn("press relative grid size-8 place-items-center rounded-md text-muted-foreground hover:bg-accent hover:text-foreground",
        "before:absolute before:-inset-1.5 before:content-['']", on && "text-warn hover:text-warn", className)}>
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
    <div className="enter border-b pt-4 pb-14 sm:pb-20">
      <div className="max-w-lg">
        <p className="display text-[2rem]">{title}</p>
        {children && <div className="mt-3 text-muted-foreground">{children}</div>}
        {action && <div className="mt-6">{action}</div>}
      </div>
    </div>
  );
}

/** Editorial masthead for every page: a masked serif title, a quiet line under it, a drawn rule. */
export function PageHeader({ title, description, actions }: { title: React.ReactNode; description?: React.ReactNode; actions?: React.ReactNode }) {
  return (
    <header className="mb-10 sm:mb-14">
      <div className="flex flex-wrap items-end justify-between gap-x-8 gap-y-5">
        <div className="min-w-0 max-w-4xl">
          <h1 className="title-xl mask-line break-words"><span className="max-w-full">{title}</span></h1>
          {description && (
            <p className="enter mt-4 max-w-[62ch] text-muted-foreground" style={vars({ "--d": "160ms" })}>{description}</p>
          )}
        </div>
        {actions && <div className="enter flex flex-wrap items-center gap-2" style={vars({ "--d": "220ms" })}>{actions}</div>}
      </div>
      <div className="rule mt-7 sm:mt-9" />
    </header>
  );
}

/** Section heading: a drawn hairline, a serif title, an optional aside on the right. */
export function SectionHead({ id, title, aside, className }: { id?: string; title: React.ReactNode; aside?: React.ReactNode; className?: string }) {
  const ref = useRef<HTMLDivElement>(null);
  // As it scrolls into view: the hairline draws, then the title rises out of its own mask
  useGSAP(() => {
    gsap.matchMedia().add(MOTION.ok, () => {
      gsap.timeline({ scrollTrigger: { trigger: ref.current, start: "top 90%", once: true }, defaults: { ease: EASE.out } })
        .from("[data-hairline]", { scaleX: 0, transformOrigin: "left center", duration: 1.2 })
        .from("[data-title]", { yPercent: 110, duration: 1 }, 0.12)
        .from("[data-aside]", { opacity: 0, x: -8, duration: 0.7 }, 0.3);
    });
  }, { scope: ref });
  return (
    <div ref={ref} className={cn("mb-5", className)}>
      <div data-hairline className="mb-4 h-px bg-border" />
      <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
        <h2 id={id} className="title-md overflow-clip pb-[0.08em]"><span data-title className="inline-block">{title}</span></h2>
        {aside && <div data-aside className="text-sm text-muted-foreground">{aside}</div>}
      </div>
    </div>
  );
}

/** A number that counts up the first time it scrolls into view; screen readers get the value at once. */
export function Count({ value, className }: { value: number; className?: string }) {
  const ref = useRef<HTMLSpanElement>(null);
  const played = useRef(false);
  useGSAP(() => {
    const el = ref.current!;
    const show = (n: number) => { el.textContent = Math.round(n).toLocaleString(); };
    if (played.current || !value || matchMedia("(prefers-reduced-motion: reduce)").matches) return show(value);
    const o = { n: 0 };
    show(0);
    gsap.to(o, {
      n: value, duration: 1.6, ease: "power3.out", onUpdate: () => show(o.n), onComplete: () => { played.current = true; },
      scrollTrigger: { trigger: el, start: "top 92%", once: true },
    });
  }, { dependencies: [value], revertOnUpdate: true });
  return (
    <span className={className}>
      <span ref={ref} aria-hidden="true" />
      <span className="sr-only">{value.toLocaleString()}</span>
    </span>
  );
}

/** A quiet text link whose underline draws in. */
export function TextLink({ href, children, className }: { href: string; children: React.ReactNode; className?: string }) {
  return (
    <NextLink href={href} className={cn("group inline-flex py-1 text-sm text-muted-foreground transition-colors duration-200 hover:text-foreground", className)}>
      <span className="ink-link">{children}</span>
    </NextLink>
  );
}

export function ButtonLink({ href, ...props }: React.ComponentProps<typeof Button> & { href: string }) {
  return <Button nativeButton={false} render={<NextLink href={href} />} {...props} />;
}
