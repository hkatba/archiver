"use client";

import { Dialog as DialogPrimitive } from "@base-ui/react/dialog";
import { LogOut, Menu, Moon, Plus, Sun, X } from "lucide-react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useTheme } from "next-themes";
import { createContext, useContext, useEffect, useLayoutEffect, useRef, useState } from "react";
import useSWR, { useSWRConfig } from "swr";
import { Button } from "@/components/ui/button";
import { api, ApiError } from "@/lib/api";
import { cn } from "@/lib/utils";
import { AddLinksDialog } from "./add-links-dialog";
import { Logo, useMagnetic, vars } from "./bits";

// Grouped by job: find, organise, sources. Spacing separates the groups; no icons, the words do it.
const NAV: { href: string; label: string; kbd?: string }[][] = [
  [{ href: "/", label: "Overview" }, { href: "/links", label: "All links" }, { href: "/search", label: "Search", kbd: "Ctrl K" }],
  [{ href: "/collections", label: "Collections" }, { href: "/categories", label: "Categories" }, { href: "/tags", label: "Tags" }, { href: "/favorites", label: "Favorites" }],
  [{ href: "/snippets", label: "Code snippets" }, { href: "/github", label: "GitHub repos" }],
];

const AddLinksContext = createContext<() => void>(() => undefined);
export const useAddLinks = () => useContext(AddLinksContext);

/** Typographic nav. A lichen stone travels to the current page, so the move itself says where you went. */
function Nav({ pathname, large = false }: { pathname: string; large?: boolean }) {
  const listRef = useRef<HTMLDivElement>(null);
  const markerRef = useRef<HTMLSpanElement>(null);
  const active = (href: string) => (href === "/" ? pathname === "/" : pathname.startsWith(href));

  useLayoutEffect(() => {
    const list = listRef.current, mk = markerRef.current;
    if (!list || !mk) return;
    const el = list.querySelector<HTMLElement>('[aria-current="page"]');
    if (!el) {
      mk.style.opacity = "0";
      return;
    }
    const placed = mk.dataset.placed === "1";
    mk.style.transitionDuration = placed ? "" : "0ms";
    mk.style.transform = `translateY(${el.offsetTop + el.offsetHeight / 2 - mk.offsetHeight / 2}px)`;
    mk.style.opacity = "1";
    mk.dataset.placed = "1";
  }, [pathname]);

  let i = 0;
  return (
    <div ref={listRef} className="relative">
      <span ref={markerRef} aria-hidden="true"
        className={cn("stone absolute top-0 left-0 bg-lichen opacity-0 transition-[transform,opacity] duration-500 ease-(--ease-in-out)",
          large ? "h-2.5 w-4" : "h-2 w-3")} />
      {NAV.map((group, g) => (
        <ul key={g} className={cn(g > 0 && (large ? "mt-6" : "mt-5"))}>
          {group.map(({ href, label, kbd }) => {
            const on = active(href);
            return (
              <li key={href} className={large ? "enter" : undefined} style={large ? vars({ "--i": i++, "--d": "60ms" }) : undefined}>
                <Link href={href} aria-current={on ? "page" : undefined}
                  className={cn("group flex items-center transition-colors duration-200",
                    large ? "min-h-12 gap-3 pl-8 font-display text-[2.1rem] leading-none" : "h-9 gap-3 pl-6 text-[0.9375rem]",
                    on ? "text-foreground" : "text-muted-foreground hover:text-foreground")}>
                  <span className={cn("ink-link", on && !large && "font-medium")}>{label}</span>
                  {kbd && !large && <kbd className="ml-auto text-muted-foreground/70">{kbd}</kbd>}
                </Link>
              </li>
            );
          })}
        </ul>
      ))}
    </div>
  );
}

function Wordmark({ size = "md" }: { size?: "sm" | "md" }) {
  return (
    <Link href="/" className="group flex items-center gap-2.5" aria-label="Cairn, overview">
      <Logo className={cn("text-foreground transition-transform duration-500 ease-(--ease-out) group-hover:-translate-y-0.5", size === "md" ? "size-8" : "size-7")} />
      <span className={cn("display", size === "md" ? "text-[2rem]" : "text-[1.7rem]")}>Cairn</span>
    </Link>
  );
}

function Account({ email, onSignOut }: { email?: string; onSignOut: () => void }) {
  const { resolvedTheme, setTheme } = useTheme();
  const iconBtn = "press grid size-9 place-items-center rounded-md text-muted-foreground hover:bg-accent hover:text-foreground";
  return (
    <div className="flex items-center gap-1">
      <span className="min-w-0 flex-1 truncate text-xs text-muted-foreground" title={email}>{email}</span>
      <button type="button" onClick={() => setTheme(resolvedTheme === "dark" ? "light" : "dark")} className={iconBtn}
        aria-label="Toggle dark mode">
        <Sun className="hidden size-4 dark:block" /><Moon className="size-4 dark:hidden" />
      </button>
      <button type="button" onClick={onSignOut} className={iconBtn} aria-label="Sign out">
        <LogOut className="size-4" />
      </button>
    </div>
  );
}

export function AppShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  const [adding, setAdding] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const { mutate } = useSWRConfig();
  const { data: me, error } = useSWR<{ email: string }>("/api/auth/me", { shouldRetryOnError: false });
  const magnet = useMagnetic<HTMLButtonElement>();

  useEffect(() => {
    if (error instanceof ApiError && error.status === 401) router.replace(`/login?next=${encodeURIComponent(pathname)}`);
  }, [error, pathname, router]);

  const [menuPath, setMenuPath] = useState(pathname);
  if (menuPath !== pathname) {
    setMenuPath(pathname); // close the mobile menu after navigating
    setMenuOpen(false);
  }

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      const target = e.target as HTMLElement;
      const typing = ["INPUT", "TEXTAREA", "SELECT"].includes(target.tagName) || target.isContentEditable;
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        router.push("/search");
      } else if (!typing && e.key === "n" && !e.metaKey && !e.ctrlKey && !e.altKey) {
        e.preventDefault();
        setAdding(true);
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [router]);

  async function signOut() {
    await api("/api/auth/logout", { method: "POST" }).catch(() => undefined);
    await mutate(() => true, undefined, { revalidate: false });
    router.replace("/login");
  }

  const settingsLink = (large = false) => (
    <Link href="/settings" aria-current={pathname.startsWith("/settings") ? "page" : undefined}
      className={cn("group flex items-center transition-colors duration-200",
        large ? "min-h-11 text-lg" : "h-9 text-[0.9375rem]",
        pathname.startsWith("/settings") ? "text-foreground" : "text-muted-foreground hover:text-foreground")}>
      <span className="ink-link">Settings</span>
    </Link>
  );

  return (
    <AddLinksContext.Provider value={() => setAdding(true)}>
      <a href="#main" className="sr-only focus:not-sr-only focus:fixed focus:top-3 focus:left-3 focus:z-[60] focus:rounded-md focus:bg-primary focus:px-3 focus:py-2 focus:text-primary-foreground">
        Skip to content
      </a>
      <div className="flex min-h-screen">
        <aside className="sticky top-0 hidden h-screen w-[244px] shrink-0 border-r md:block">
          <nav aria-label="Main" className="flex h-full flex-col px-5 pt-7 pb-5">
            <div className="mb-8 px-1"><Wordmark /></div>
            <Button ref={magnet} onClick={() => setAdding(true)} className="mb-8 h-10 justify-between pr-3" title="Add links (N)">
              <span className="flex items-center gap-2"><Plus /> Add links</span>
              <kbd className="text-primary-foreground/60">N</kbd>
            </Button>
            <div className="-mx-1 min-h-0 flex-1 overflow-y-auto px-1"><Nav pathname={pathname} /></div>
            <div className="mt-4 flex flex-col gap-2 border-t pt-4">
              <div className="pl-6">{settingsLink()}</div>
              <Account email={me?.email} onSignOut={signOut} />
            </div>
          </nav>
        </aside>

        <div className="flex min-w-0 flex-1 flex-col">
          <header className="sticky top-0 z-30 flex h-14 items-center gap-2 border-b bg-background/85 px-3 backdrop-blur-md md:hidden">
            <button type="button" onClick={() => setMenuOpen(true)} aria-label="Open menu" aria-expanded={menuOpen}
              className="press grid size-11 place-items-center rounded-md hover:bg-accent">
              <Menu className="size-5" />
            </button>
            <Wordmark size="sm" />
            <Button className="ml-auto h-10" onClick={() => setAdding(true)}><Plus /> Add</Button>
          </header>
          <main id="main" className="mx-auto w-full max-w-[1280px] flex-1 overflow-x-clip px-5 pt-8 pb-20 sm:px-10 sm:pt-12 lg:px-14">{children}</main>
        </div>
      </div>

      <DialogPrimitive.Root open={menuOpen} onOpenChange={setMenuOpen}>
        <DialogPrimitive.Portal>
          <DialogPrimitive.Popup aria-label="Menu"
            className="paper fixed inset-0 z-50 flex flex-col overflow-y-auto bg-background px-5 pt-0 pb-8 outline-none duration-200 data-open:animate-in data-open:fade-in-0 data-closed:animate-out data-closed:fade-out-0 data-closed:duration-150 md:hidden">
            <div className="flex h-14 shrink-0 items-center justify-between">
              <Wordmark size="sm" />
              <DialogPrimitive.Close aria-label="Close menu" className="press -mr-2 grid size-11 place-items-center rounded-md hover:bg-accent">
                <X className="size-5" />
              </DialogPrimitive.Close>
            </div>
            <nav aria-label="Main" className="mt-8 flex-1"><Nav pathname={pathname} large /></nav>
            <div className="mt-10 flex flex-col gap-3 border-t pt-5">
              {settingsLink(true)}
              <Account email={me?.email} onSignOut={signOut} />
            </div>
          </DialogPrimitive.Popup>
        </DialogPrimitive.Portal>
      </DialogPrimitive.Root>

      <AddLinksDialog open={adding} onOpenChange={setAdding} />
    </AddLinksContext.Provider>
  );
}
