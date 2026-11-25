"use client";

import { ArrowRight, Search } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useRef, useState } from "react";
import useSWR from "swr";
import { toast } from "sonner";
import { useAddLinks } from "@/components/app-shell";
import { ButtonLink, Count, Favicon, SectionHead, TextLink, useMagnetic, vars } from "@/components/bits";
import { Cairn3D, type CairnApi, type CairnStone } from "@/components/cairn-3d";
import { CursorChip, LinkRow, useLinkActions } from "@/components/link-views";
import { Terrain } from "@/components/terrain";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { api } from "@/lib/api";
import { ago, mineral } from "@/lib/format";
import { EASE, gsap, MOTION, ScrollTrigger, SplitText, useGSAP } from "@/lib/gsap";
import type { LinkCard, Stats, Suggestion } from "@/lib/types";

interface Row extends CairnStone { children: string[] }

/** One stone per category (top seven, then the rest), largest first: the base of the cairn. */
function buildStones(stats: Stats): Row[] {
  const rows: Row[] = stats.categories.slice(0, 7).map((c) => ({
    name: c.name, count: c.count, color: mineral(c.name), href: `/links?category=${encodeURIComponent(c.name)}`,
    children: c.children.slice(0, 4).map((x) => x.name),
  }));
  const rest = stats.categories.slice(7);
  if (rest.length) {
    rows.push({ name: "Other categories", count: rest.reduce((n, c) => n + c.count, 0), color: mineral(null), href: "/categories", children: rest.slice(0, 4).map((c) => c.name) });
  }
  const uncategorized = stats.total - stats.categories.reduce((n, c) => n + c.count, 0);
  if (uncategorized > 0) rows.push({ name: "Not yet categorized", count: uncategorized, color: "#b9bcb5", href: "/links", children: [] });
  return rows.sort((a, b) => b.count - a.count);
}

/** The CSS cairn, used when WebGL is unavailable. */
function FlatCairn({ stones }: { stones: Row[] }) {
  const max = Math.max(1, ...stones.map((s) => s.count));
  return (
    <div className="flex h-full flex-col-reverse items-center justify-center" aria-hidden="true">
      {stones.map((s, i) => (
        <span key={s.name} className="stone block" style={{
          width: `${26 + 60 * (s.count / max)}%`, height: `${22 + 22 * Math.sqrt(s.count / max)}px`, marginTop: -3,
          background: s.color, boxShadow: "inset 0 -6px 0 rgb(0 0 0 / 0.16)", transform: `translateX(${(i % 2 ? 1 : -1) * 6}px)`,
        }} />
      ))}
    </div>
  );
}

/**
 * Hero and the library's composition as one scene. The 3D cairn holds still on the right (sticky)
 * while the categories scroll past on the left; scrolling lifts the stones apart and lights the
 * one being read, then sets them back down.
 */
function CairnStory({ stats }: { stats: Stats }) {
  const router = useRouter();
  const root = useRef<HTMLElement>(null);
  const cairn = useRef<CairnApi | null>(null);
  const [flat, setFlat] = useState(false);
  const [q, setQ] = useState("");
  const stones = buildStones(stats); // cheap; the 3D scene rebuilds only when names or counts change
  const status = stats.in_progress > 0
    ? `${stats.in_progress} being read now`
    : stats.failed + stats.needs_review > 0 ? `${stats.failed + stats.needs_review} need a look` : "all read and filed";
  const line = stats.favorites ? `${stats.favorites} favorite${stats.favorites === 1 ? "" : "s"}, ${status}.` : `${status[0].toUpperCase()}${status.slice(1)}.`;
  const title = `${stats.total.toLocaleString()} links,`;

  useGSAP(() => {
    const rows = gsap.utils.toArray<HTMLElement>("[data-story-row]");
    const activate = (i: number | null) => {
      rows.forEach((r, j) => r.toggleAttribute("data-active", j === i));
      cairn.current?.setActive(i);
    };
    rows.forEach((row, i) => ScrollTrigger.create({
      trigger: row, start: "top 58%", end: "bottom 58%",
      onToggle: (s) => { if (s.isActive) activate(i); else if (i === 0 && s.direction < 0) activate(null); },
    }));

    const mm = gsap.matchMedia();
    mm.add(MOTION.ok, () => {
      const split = SplitText.create("[data-hero-title]", { type: "words,chars", mask: "words" });
      gsap.timeline({ defaults: { ease: EASE.out } })
        .from(split.chars, { yPercent: 115, duration: 1.2, stagger: 0.028 })
        .from("[data-hero-line]", { yPercent: 110, duration: 1 }, 0.25)
        .from("[data-hero-search]", { y: 24, opacity: 0, duration: 1 }, 0.45)
        .from("[data-hero-hint]", { opacity: 0, duration: 0.8 }, 0.7);
      // Lift apart while the list is read, restack as it ends
      ScrollTrigger.create({
        trigger: "[data-story]", start: "top 75%", end: "bottom 40%", scrub: true,
        onUpdate: (s) => {
          const p = s.progress;
          cairn.current?.setExplode(gsap.utils.clamp(0, 1, p / 0.22) * (1 - gsap.utils.clamp(0, 1, (p - 0.82) / 0.18)));
        },
      });
      gsap.to("[data-terrain]", { yPercent: 18, opacity: 0.25, ease: "none", scrollTrigger: { trigger: root.current, start: "top top", end: "+=700", scrub: true } });
      return () => split.revert();
    });
  }, { scope: root, dependencies: [stones.length, title], revertOnUpdate: true });

  return (
    <section ref={root} aria-labelledby="library-h" className="relative isolate -mx-5 -mt-8 px-5 sm:-mx-10 sm:-mt-12 sm:px-10 lg:-mx-14 lg:px-14">
      <div data-terrain aria-hidden="true" className="absolute inset-x-0 top-0 -z-10 h-[100svh] [mask-image:linear-gradient(to_bottom,black_45%,transparent)]">
        <Terrain />
      </div>
      {/* Phones: hero, cairn, list. Desktop: the cairn holds a sticky column beside both. */}
      <div className="grid [grid-template-areas:'hero'_'stage'_'story'] lg:grid-cols-[minmax(0,1fr)_minmax(0,0.95fr)] lg:gap-x-10 lg:[grid-template-areas:'hero_stage'_'story_stage']">
          <div className="flex min-w-0 flex-col justify-center pt-10 pb-6 [grid-area:hero] lg:min-h-[calc(100svh-3rem)] lg:pt-0 lg:pb-24">
            <h1 id="library-h" key={title} data-hero-title className="title-xl text-[clamp(3.4rem,2rem+5vw,7rem)]">
              {stats.total.toLocaleString()} <em className="text-muted-foreground">links,</em>
            </h1>
            <p className="display mt-2 overflow-clip pb-[0.08em] text-[clamp(1.6rem,1.1rem+1.6vw,2.8rem)]"><span data-hero-line className="inline-block">{line}</span></p>
            <form role="search" data-hero-search className="group/search relative mt-10 max-w-2xl sm:mt-14"
              onSubmit={(e) => { e.preventDefault(); router.push(`/search?q=${encodeURIComponent(q)}`); }}>
              <Search className="pointer-events-none absolute top-1/2 left-0 size-5 -translate-y-1/2 text-muted-foreground" aria-hidden="true" />
              <input value={q} onChange={(e) => setQ(e.target.value)} aria-label="Search your library by describing what you need"
                placeholder="Describe what you need"
                className="h-16 w-full border-0 border-b border-foreground/25 bg-transparent pr-12 pl-9 font-serif text-[1.35rem] caret-lichen outline-none transition-colors duration-200 placeholder:text-muted-foreground/75 hover:border-foreground/50 focus:border-foreground focus-visible:outline-none sm:text-[1.6rem] lg:text-[1.35rem] xl:text-[1.6rem]" />
              <span aria-hidden="true" className="pointer-events-none absolute bottom-0 left-0 h-px w-full origin-left scale-x-0 bg-lichen transition-transform duration-500 ease-(--ease-out) group-focus-within/search:scale-x-100" />
              <button type="submit" aria-label="Search"
                className="press absolute top-1/2 right-0 grid size-11 -translate-y-1/2 place-items-center rounded-md text-muted-foreground hover:text-foreground">
                <ArrowRight className="size-5" />
              </button>
            </form>
            <p data-hero-hint className="mt-5 hidden text-sm text-muted-foreground sm:block">
              <kbd className="mr-1 rounded-[3px] border px-1.5 py-0.5">Ctrl K</kbd> searches from anywhere,
              <kbd className="mx-1 rounded-[3px] border px-1.5 py-0.5">N</kbd> adds links.
            </p>
          </div>

          <div className="-mx-5 h-[52vh] [grid-area:stage] sm:-mx-10 lg:mx-0 lg:h-auto">
            <div className="h-full lg:sticky lg:top-0 lg:h-svh">
              {flat ? <FlatCairn stones={stones} /> : (
                <Cairn3D stones={stones} apiRef={cairn} onFail={() => setFlat(true)}
                  onSelect={(i) => router.push(stones[i].href)} />
              )}
            </div>
          </div>

          {/* Story: one row per stone */}
          <div data-story className="min-w-0 pb-10 [grid-area:story] lg:pb-[30vh]">
            <SectionHead title="What you have collected" aside={<TextLink href="/categories">All categories</TextLink>} />
            <ol>
              {stones.map((s) => (
                <li key={s.name} data-story-row
                  className="group/row flex min-h-[22vh] flex-col justify-center border-b py-8 transition-opacity duration-500 lg:min-h-[34vh] lg:opacity-30 lg:data-active:opacity-100">
                  <div className="flex items-baseline gap-5 sm:gap-8">
                    <span className="display min-w-[2ch] text-[clamp(3.2rem,2rem+4vw,6.5rem)] leading-none tabular-nums">{s.count}</span>
                    <div className="min-w-0">
                      <Link href={s.href} className="group flex items-center gap-3">
                        <span className="stone inline-block h-3 w-5 shrink-0" style={{ background: s.color }} aria-hidden="true" />
                        <span className="display ink-link text-[clamp(1.7rem,1.2rem+1.6vw,2.9rem)] leading-[1.05]">{s.name}</span>
                      </Link>
                      <p className="mt-2 text-sm text-muted-foreground">
                        {Math.round((s.count / Math.max(1, stats.total)) * 100)}% of your library
                        {s.children.length > 0 && <>, mostly {s.children.join(", ").toLowerCase()}</>}
                      </p>
                    </div>
                  </div>
                </li>
              ))}
            </ol>
          </div>
      </div>
    </section>
  );
}

/** The queue as a ledger: what is moving, what needs you. */
function Ledger({ stats }: { stats: Stats }) {
  const { refresh } = useLinkActions();
  const done = stats.total - stats.in_progress;
  async function retryAll() {
    const r = await api<{ queued: number }>("/api/links/retry-failed", { method: "POST" });
    toast.success(`Retrying ${r.queued} link${r.queued === 1 ? "" : "s"}.`);
    refresh();
  }
  const cells: [string, number, string | null, string?][] = [
    ["Ready", stats.completed, "/links"],
    ["Needs review", stats.needs_review, "/links?status=NEEDS_REVIEW"],
    ["Blocked", stats.blocked, "/links?status=BLOCKED"],
    ["Failed", stats.failed, "/links?status=FAILED", "text-destructive"],
  ];
  return (
    <section aria-labelledby="queue-h">
      <SectionHead id="queue-h" title="The queue" />
      <dl className="grid grid-cols-2 border-t sm:grid-cols-4">
        {cells.map(([label, value, href, tone]) => (
          <div key={label} className="border-b py-6 pr-4 odd:border-r sm:border-r sm:pl-5 sm:first:pl-0 sm:last:border-r-0 sm:odd:border-r [&:nth-child(even)]:pl-4 sm:[&:nth-child(even)]:pl-5">
            <dt className="text-sm text-muted-foreground">{label}</dt>
            <dd className={value && tone ? tone : undefined}>
              {value && href ? (
                <Link href={href} className="group inline-block"><Count value={value} className="display ink-link text-[clamp(2.6rem,2rem+2vw,4rem)] leading-none tabular-nums" /></Link>
              ) : <Count value={value} className="display text-[clamp(2.6rem,2rem+2vw,4rem)] leading-none text-muted-foreground tabular-nums" />}
            </dd>
          </div>
        ))}
      </dl>
      <div className="mt-6 flex flex-wrap items-center justify-between gap-4">
        <div className="min-w-0 flex-1">
          {stats.in_progress > 0 ? (
            <>
              <p className="text-sm text-muted-foreground">{stats.in_progress} {stats.in_progress === 1 ? "link is" : "links are"} being read and analyzed.</p>
              <div className="mt-3 h-px max-w-md overflow-hidden bg-border" role="progressbar"
                aria-valuemin={0} aria-valuemax={stats.total} aria-valuenow={done} aria-label="Links processed">
                <div className="h-full origin-left bg-lichen transition-transform duration-700 ease-(--ease-out)"
                  style={{ transform: `scaleX(${done / Math.max(1, stats.total)})` }} />
              </div>
            </>
          ) : (
            <p className="text-sm text-muted-foreground">
              Nothing waiting. {stats.ai.configured
                ? <>Analysis by {stats.ai.provider}, {stats.ai.fast_model}.</>
                : <>No AI provider set, so summaries come from page metadata. <Link href="/settings" className="underline underline-offset-2 hover:text-foreground">Set one up</Link></>}
            </p>
          )}
        </div>
        {stats.failed > 0 && <Button variant="outline" size="sm" onClick={retryAll}>Retry failed links</Button>}
      </div>
    </section>
  );
}

function Suggestions({ items }: { items: Suggestion[] }) {
  const router = useRouter();
  const { refresh } = useLinkActions();
  if (!items.length) return null;
  async function createSmart(s: Suggestion) {
    const c = await api<{ id: string }>("/api/collections", { method: "POST", json: { name: s.name, rules: s.rules } });
    toast.success(`Created the “${s.name}” collection.`);
    refresh();
    router.push(`/collections/${c.id}`);
  }
  return (
    <section aria-labelledby="suggest-h">
      <SectionHead id="suggest-h" title="Worth a look" />
      <ul className="divide-y border-b">
        {items.map((s) => (
          <li key={s.type + (s.name ?? "")} className="flex flex-wrap items-center justify-between gap-3 py-4">
            <span className="min-w-0 flex-1 font-serif text-lg">{s.message}</span>
            {s.type === "smart_collection" && <Button size="sm" variant="outline" onClick={() => createSmart(s)}>Create collection</Button>}
            {s.type === "duplicates" && <ButtonLink size="sm" variant="outline" href="/links?duplicates=1">Review duplicates</ButtonLink>}
          </li>
        ))}
      </ul>
    </section>
  );
}

/** A large poster card for the horizontal strip. */
function Poster({ link, n }: { link: LinkCard; n: number }) {
  const [broken, setBroken] = useState(false);
  return (
    <Link href={`/links/${link.id}`} data-cursor="Open"
      className="group lift flex w-[78vw] shrink-0 snap-start flex-col sm:w-[46vw] lg:w-[min(34vw,500px)]">
      <div className="frame aspect-[4/3]">
        {link.thumbnail && !broken ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img data-parallax src={link.thumbnail} alt="" loading="lazy" decoding="async" onError={() => setBroken(true)}
            className="h-full w-[116%] max-w-none -translate-x-[8%] object-cover object-top" />
        ) : (
          <div className="grid size-full place-items-center" style={{ background: `color-mix(in oklab, ${mineral(link.category)} 22%, var(--card))` }}>
            <span className="display text-[7rem] leading-none text-foreground/70">{(link.name || link.domain).charAt(0)}</span>
          </div>
        )}
      </div>
      <div className="mt-4 flex items-baseline gap-4">
        <span className="display text-xl text-muted-foreground tabular-nums">{String(n).padStart(2, "0")}</span>
        <div className="min-w-0 flex-1">
          <p className="display truncate text-[1.9rem] leading-tight"><span className="ink-link">{link.name || link.domain}</span></p>
          <p className="mt-1 flex items-center gap-2 text-sm text-muted-foreground">
            <Favicon link={link} size={14} /> <span className="truncate">{link.domain}</span> <span aria-hidden="true">·</span> {ago(link.created_at)}
          </p>
          {link.description && <p className="mt-2 line-clamp-2 text-sm text-foreground/80">{link.description}</p>}
        </div>
      </div>
    </Link>
  );
}

/** Recently added as a strip that moves sideways while you scroll down (desktop); a swipeable row on phones. */
function RecentStrip({ links }: { links: LinkCard[] }) {
  const root = useRef<HTMLElement>(null);
  useGSAP(() => {
    const mm = gsap.matchMedia();
    mm.add(MOTION.desktop, () => {
      const viewport = root.current!.querySelector<HTMLElement>("[data-viewport]")!;
      const track = root.current!.querySelector<HTMLElement>("[data-track]")!;
      const bar = root.current!.querySelector<HTMLElement>("[data-progress]");
      const distance = () => Math.max(0, track.scrollWidth - viewport.clientWidth);
      if (distance() < 40) return;
      const tween = gsap.to(track, {
        x: () => -distance(), ease: "none",
        scrollTrigger: {
          // pinSpacing must be explicit: GSAP turns it off when the parent is a flex column (the overview is one)
          trigger: root.current, start: "top top", end: () => `+=${distance()}`, pin: true, pinSpacing: true, scrub: 0.7, invalidateOnRefresh: true,
          onUpdate: (s) => { if (bar) bar.style.transform = `scaleX(${s.progress})`; },
        },
      });
      // Pictures drift inside their frames as the strip passes: depth without moving the cards
      gsap.utils.toArray<HTMLElement>("[data-parallax]", track).forEach((img) => {
        gsap.fromTo(img, { xPercent: -6 }, {
          xPercent: 6, ease: "none",
          scrollTrigger: { trigger: img.parentElement, containerAnimation: tween, start: "left right", end: "right left", scrub: true },
        });
      });
    });
  }, { scope: root, dependencies: [links.length] });

  return (
    <section ref={root} aria-labelledby="recent-h" className="flex flex-col justify-center py-10 lg:min-h-svh lg:py-0">
      <SectionHead id="recent-h" title="Recently added" aside={<TextLink href="/links">All links</TextLink>} />
      <div data-viewport className="-mx-5 overflow-x-auto px-5 pb-4 [scrollbar-width:none] sm:-mx-10 sm:px-10 lg:-mr-14 lg:ml-0 lg:overflow-visible lg:px-0">
        <div data-track className="flex w-max snap-x snap-mandatory gap-6 pr-5 lg:gap-10 lg:pr-[12vw]">
          {links.map((l, i) => <Poster key={l.id} link={l} n={i + 1} />)}
        </div>
      </div>
      <div className="mt-6 hidden h-px max-w-xs overflow-hidden bg-border lg:block" aria-hidden="true">
        <div data-progress className="h-full origin-left scale-x-0 bg-lichen" />
      </div>
      <CursorChip />
    </section>
  );
}

/** Tags set large, drifting in two directions as the page scrolls (only with scroll, never on its own). */
function TagDrift({ tags }: { tags: Stats["top_tags"] }) {
  const root = useRef<HTMLElement>(null);
  useGSAP(() => {
    const mm = gsap.matchMedia();
    mm.add(MOTION.ok, () => {
      const rows = gsap.utils.toArray<HTMLElement>("[data-drift]");
      rows.forEach((row, i) => gsap.fromTo(row, { xPercent: i % 2 ? -28 : 0 }, {
        xPercent: i % 2 ? 0 : -28, ease: "none",
        scrollTrigger: { trigger: root.current, start: "top bottom", end: "bottom top", scrub: 0.6 },
      }));
    });
  }, { scope: root, dependencies: [tags.length] });
  if (!tags.length) return null;
  const half = Math.ceil(tags.length / 2);
  const rows = [tags.slice(0, half), tags.slice(half).length ? tags.slice(half) : tags];
  // Enough copies to cover the drift; only the first copy is reachable by keyboard and screen readers
  const copies = (row: typeof tags) => Math.max(2, Math.ceil(14 / Math.max(1, row.length)));
  return (
    <section ref={root} aria-labelledby="tags-h" className="-mx-5 overflow-hidden py-6 sm:-mx-10 lg:-mx-14">
      <div className="px-5 sm:px-10 lg:px-14">
        <SectionHead id="tags-h" title="Most used tags" aside={<TextLink href="/tags">All tags</TextLink>} />
      </div>
      {rows.map((row, r) => (
        <div key={r} data-drift className="flex w-max gap-10 py-2 whitespace-nowrap lg:gap-16">
          {Array.from({ length: copies(row) }, (_, c) => row.map((t, i) => (
            <Link key={`${c}-${t.name}`} href={`/links?tag=${encodeURIComponent(t.name)}`} tabIndex={c ? -1 : undefined} aria-hidden={c ? true : undefined}
              className={`group display inline-flex items-start text-[clamp(2.6rem,1.6rem+4vw,5.6rem)] leading-[1.05] transition-colors duration-300 hover:text-foreground ${(i + r) % 2 ? "italic text-muted-foreground" : "text-foreground/85"}`}>
              <span className="ink-link">#{t.name}</span>
              <sup className="ml-1.5 font-sans text-sm text-muted-foreground tabular-nums">{t.count}</sup>
            </Link>
          )))}
        </div>
      ))}
    </section>
  );
}

function FirstRun() {
  const openAdd = useAddLinks();
  const magnet = useMagnetic<HTMLButtonElement>();
  return (
    <section aria-labelledby="welcome-h" className="relative isolate -mx-5 -mt-8 min-h-[70vh] px-5 pt-14 pb-16 sm:-mx-10 sm:-mt-12 sm:px-10 sm:pt-24 lg:-mx-14 lg:px-14">
      <div aria-hidden="true" className="absolute inset-0 -z-10 [mask-image:linear-gradient(to_bottom,black_60%,transparent)]">
        <Terrain />
      </div>
      <h1 id="welcome-h" className="title-xl mask-line max-w-4xl"><span>Start a cairn.</span></h1>
      <p className="enter mt-6 max-w-[54ch] text-lg text-muted-foreground" style={vars({ "--d": "160ms" })}>
        Paste a list of links, or import a text, CSV or bookmarks file. Cairn reads each page, writes down what it is for,
        files it, and finds it again when you describe what you need.
      </p>
      <div className="enter mt-9" style={vars({ "--d": "260ms" })}>
        <Button ref={magnet} size="lg" onClick={openAdd}>Add your first links</Button>
      </div>
    </section>
  );
}

export function OverviewPage() {
  const { data: stats } = useSWR<Stats>("/api/stats", { refreshInterval: (d) => (d && d.in_progress > 0 ? 2500 : 0) });

  if (!stats) {
    return (
      <div className="flex flex-col gap-5" aria-busy="true" aria-label="Loading">
        <Skeleton className="h-24 w-96 max-w-full" />
        <Skeleton className="h-10 w-[28rem] max-w-full" />
        <Skeleton className="mt-6 h-16 w-full max-w-2xl" />
      </div>
    );
  }
  if (stats.total === 0) return <FirstRun />;

  return (
    <div className="flex flex-col gap-20 lg:gap-28">
      <CairnStory stats={stats} />
      <div className="grid gap-16 lg:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)] lg:gap-20">
        <Ledger stats={stats} />
        <Suggestions items={stats.suggestions} />
      </div>
      {stats.recent.length > 0 && <RecentStrip links={stats.recent} />}
      {stats.recently_accessed.length > 0 && (
        <section aria-labelledby="opened-h">
          <SectionHead id="opened-h" title="Recently opened" />
          <div className="border-b">
            {stats.recently_accessed.map((l, i) => <LinkRow key={l.id} link={l} index={i} />)}
          </div>
        </section>
      )}
      <TagDrift tags={stats.top_tags} />
    </div>
  );
}
