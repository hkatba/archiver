"use client";

import { LoaderCircle } from "lucide-react";
import { useRouter, useSearchParams } from "next/navigation";
import { useState } from "react";
import { useSWRConfig } from "swr";
import { Logo, useMagnetic, vars } from "@/components/bits";
import { Terrain } from "@/components/terrain";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { api } from "@/lib/api";

export function LoginPage() {
  const router = useRouter();
  const sp = useSearchParams();
  const [mode, setMode] = useState<"login" | "register">("login");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const { mutate } = useSWRConfig();
  const magnet = useMagnetic<HTMLButtonElement>(0.12, 5);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const res = await api<{ user: { email: string } }>(`/api/auth/${mode}`, { method: "POST", json: { email, password } });
      // Drop anything cached from a previous session (including the 401 from /api/auth/me)
      await mutate(() => true, undefined, { revalidate: false });
      await mutate("/api/auth/me", res.user, { revalidate: false });
      const next = sp.get("next");
      router.replace(next && next.startsWith("/") && !next.startsWith("//") ? next : "/");
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="grid min-h-dvh lg:grid-cols-[minmax(0,1.3fr)_minmax(440px,0.7fr)]">
      <section aria-label="About Cairn"
        className="relative isolate flex min-h-[44vh] flex-col justify-between overflow-hidden border-b px-6 pt-6 pb-8 sm:px-10 sm:pb-10 lg:min-h-dvh lg:border-r lg:border-b-0 lg:px-14 lg:pt-10 lg:pb-14">
        <div aria-hidden="true" className="absolute inset-0 -z-10"><Terrain strength={1.35} /></div>
        <div className="enter-fade flex items-center gap-2.5">
          <Logo className="size-7" />
          <span className="text-sm text-muted-foreground">A library for the links you keep</span>
        </div>
        <div>
          <p className="mask-line display text-[clamp(5.5rem,3rem+13vw,13.5rem)] leading-[0.82] tracking-[-0.03em]">
            <span style={vars({ "--d": "120ms" })}>Cairn</span>
          </p>
          <p className="enter mt-5 max-w-[46ch] text-[1.05rem] leading-relaxed text-foreground/80 sm:mt-7" style={vars({ "--d": "380ms" })}>
            Paste in the links you have saved. Cairn reads each page, writes down what it is for, files it, and finds it
            again when you describe what you need.
          </p>
        </div>
      </section>

      <section className="flex items-center px-6 py-14 sm:px-10 lg:px-16">
        <div className="w-full max-w-sm">
          <h1 key={mode} className="mask-line display text-[2.9rem]">
            <span>{mode === "login" ? "Sign in" : "Create your account"}</span>
          </h1>
          <p className="enter-fade mt-3 text-sm text-muted-foreground">
            {mode === "login" ? "Welcome back to your library." : "One account holds one private library."}
          </p>
          <form onSubmit={submit} className="enter mt-10 grid gap-5" style={vars({ "--d": "180ms" })}>
            <div className="grid gap-2">
              <Label htmlFor="email">Email</Label>
              <Input id="email" type="email" autoComplete="email" required value={email} onChange={(e) => setEmail(e.target.value)} className="h-11" />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="password">Password</Label>
              <Input id="password" type="password" required minLength={8} aria-describedby={mode === "register" ? "pw-hint" : undefined}
                autoComplete={mode === "login" ? "current-password" : "new-password"} value={password} onChange={(e) => setPassword(e.target.value)}
                className="h-11" />
              {mode === "register" && <p id="pw-hint" className="text-xs text-muted-foreground">At least 8 characters.</p>}
            </div>
            {error && <p className="text-sm text-destructive" role="alert">{error}</p>}
            <Button ref={magnet} type="submit" size="lg" disabled={busy} className="mt-2 w-full">
              {busy && <LoaderCircle className="animate-spin" />}{mode === "login" ? "Sign in" : "Create account"}
            </Button>
          </form>
          <p className="mt-8 border-t pt-6 text-sm text-muted-foreground">
            {mode === "login" ? "New here? " : "Already have an account? "}
            <button type="button" className="group font-medium text-foreground"
              onClick={() => { setMode(mode === "login" ? "register" : "login"); setError(null); }}>
              <span className="underline decoration-lichen decoration-1 underline-offset-4 transition-[text-decoration-color] duration-200 group-hover:decoration-foreground">{mode === "login" ? "Create an account" : "Sign in"}</span>
            </button>
          </p>
        </div>
      </section>
    </main>
  );
}
