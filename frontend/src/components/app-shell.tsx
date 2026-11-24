"use client";

import {
  CodeXml,
  FolderClosed,
  GitBranch,
  Hash,
  Layers,
  LayoutGrid,
  LogOut,
  Menu,
  Moon,
  Plus,
  Puzzle,
  Search,
  Settings,
  Star,
  Sun,
  Tag,
  TrendingDown,
} from "lucide-react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useTheme } from "next-themes";
import { createContext, useContext, useEffect, useState } from "react";
import useSWR, { useSWRConfig } from "swr";
import { Button } from "@/components/ui/button";
import { api, ApiError } from "@/lib/api";
import { cn } from "@/lib/utils";
import { AddLinksDialog } from "./add-links-dialog";
import { Logo } from "./bits";

const NAV = [
  { href: "/", label: "Overview", icon: LayoutGrid },
  { href: "/links", label: "All links", icon: Layers },
  { href: "/search", label: "Search", icon: Search },
  { href: "/collections", label: "Collections", icon: FolderClosed },
  { href: "/categories", label: "Categories", icon: Hash },
  { href: "/tags", label: "Tags", icon: Tag },
  { href: "/favorites", label: "Favorites", icon: Star },
  { href: "/snippets", label: "Code snippets", icon: CodeXml },
  { href: "/github", label: "GitHub repos", icon: GitBranch },
];
const LATER = [
  { label: "Price watch", icon: TrendingDown },
  { label: "Browser extension", icon: Puzzle },
];

const AddLinksContext = createContext<() => void>(() => undefined);
export const useAddLinks = () => useContext(AddLinksContext);

export function AppShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  const { resolvedTheme, setTheme } = useTheme();
  const [adding, setAdding] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const { mutate } = useSWRConfig();
  const { data: me, error } = useSWR<{ email: string }>("/api/auth/me", { shouldRetryOnError: false });

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

  const active = (href: string) => (href === "/" ? pathname === "/" : pathname.startsWith(href));

  const sidebar = (
    <nav aria-label="Main" className="flex h-full flex-col gap-1 px-3 py-4">
      <Link href="/" className="mb-4 flex items-center gap-2 px-2">
        <Logo className="size-7 text-foreground" />
        <span className="display text-2xl">Cairn</span>
      </Link>
      <Button onClick={() => setAdding(true)} className="mb-3 justify-start" title="Add links (N)">
        <Plus /> Add links
      </Button>
      {NAV.map(({ href, label, icon: Icon }) => (
        <Link key={href} href={href} aria-current={active(href) ? "page" : undefined}
          className={cn("flex items-center gap-2.5 rounded-md px-2 py-1.5 text-sm text-muted-foreground transition-colors hover:bg-accent hover:text-foreground",
            active(href) && "bg-accent font-medium text-foreground")}>
          <Icon className="size-4" aria-hidden="true" /> {label}
          {href === "/search" && <kbd className="ml-auto text-[11px] text-muted-foreground/80">Ctrl K</kbd>}
        </Link>
      ))}
      <div className="mt-4 px-2 pb-1 text-xs text-muted-foreground">Coming later</div>
      {LATER.map(({ label, icon: Icon }) => (
        <span key={label} aria-disabled="true" className="flex cursor-not-allowed items-center gap-2.5 rounded-md px-2 py-1.5 text-sm text-muted-foreground/60">
          <Icon className="size-4" aria-hidden="true" /> {label}
        </span>
      ))}
      <div className="mt-auto flex flex-col gap-1 border-t pt-3">
        <Link href="/settings" aria-current={active("/settings") ? "page" : undefined}
          className={cn("flex items-center gap-2.5 rounded-md px-2 py-1.5 text-sm text-muted-foreground hover:bg-accent hover:text-foreground",
            active("/settings") && "bg-accent font-medium text-foreground")}>
          <Settings className="size-4" aria-hidden="true" /> Settings
        </Link>
        <div className="flex items-center gap-1 px-2 pt-1">
          <span className="min-w-0 flex-1 truncate text-xs text-muted-foreground" title={me?.email}>{me?.email}</span>
          <button type="button" onClick={() => setTheme(resolvedTheme === "dark" ? "light" : "dark")}
            className="rounded-md p-1.5 text-muted-foreground hover:bg-accent hover:text-foreground" aria-label="Toggle dark mode">
            <Sun className="hidden size-4 dark:block" /><Moon className="size-4 dark:hidden" />
          </button>
          <button type="button" onClick={signOut} className="rounded-md p-1.5 text-muted-foreground hover:bg-accent hover:text-foreground" aria-label="Sign out">
            <LogOut className="size-4" />
          </button>
        </div>
      </div>
    </nav>
  );

  return (
    <AddLinksContext.Provider value={() => setAdding(true)}>
    <div className="flex min-h-screen">
      <aside className="sticky top-0 hidden h-screen w-60 shrink-0 border-r bg-sidebar md:block">{sidebar}</aside>
      {menuOpen && (
        <div className="fixed inset-0 z-40 md:hidden">
          <button type="button" aria-label="Close menu" className="absolute inset-0 bg-black/40" onClick={() => setMenuOpen(false)} />
          <aside className="absolute inset-y-0 left-0 w-64 border-r bg-sidebar">{sidebar}</aside>
        </div>
      )}
      <div className="flex min-w-0 flex-1 flex-col">
        <header className="sticky top-0 z-30 flex items-center gap-2 border-b bg-background/90 px-4 py-2 backdrop-blur md:hidden">
          <button type="button" onClick={() => setMenuOpen(true)} aria-label="Open menu" className="rounded-md p-1.5 hover:bg-accent">
            <Menu className="size-5" />
          </button>
          <Logo className="size-6" />
          <span className="display text-xl">Cairn</span>
          <Button size="sm" className="ml-auto" onClick={() => setAdding(true)}><Plus /> Add</Button>
        </header>
        <main className="mx-auto w-full max-w-[1320px] flex-1 px-4 py-6 sm:px-8 sm:py-8">{children}</main>
      </div>
      <AddLinksDialog open={adding} onOpenChange={setAdding} />
    </div>
    </AddLinksContext.Provider>
  );
}
