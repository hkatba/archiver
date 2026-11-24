"use client";

import { LoaderCircle } from "lucide-react";
import { useRouter, useSearchParams } from "next/navigation";
import { useState } from "react";
import { useSWRConfig } from "swr";
import { Logo } from "@/components/bits";
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
    <main className="grid min-h-screen place-items-center px-4">
      <div className="w-full max-w-sm">
        <div className="mb-8 flex items-center gap-3">
          <Logo className="size-10" />
          <div>
            <p className="display text-3xl">Cairn</p>
            <p className="text-sm text-muted-foreground">Save anything. Understand everything.</p>
          </div>
        </div>
        <form onSubmit={submit} className="grid gap-4 rounded-lg border bg-card p-6">
          <h1 className="text-lg font-medium">{mode === "login" ? "Sign in" : "Create your account"}</h1>
          <div className="grid gap-1.5">
            <Label htmlFor="email">Email</Label>
            <Input id="email" type="email" autoComplete="email" required value={email} onChange={(e) => setEmail(e.target.value)} />
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor="password">Password</Label>
            <Input id="password" type="password" required minLength={8}
              autoComplete={mode === "login" ? "current-password" : "new-password"} value={password} onChange={(e) => setPassword(e.target.value)} />
            {mode === "register" && <p className="text-xs text-muted-foreground">At least 8 characters.</p>}
          </div>
          {error && <p className="text-sm text-destructive" role="alert">{error}</p>}
          <Button type="submit" disabled={busy}>
            {busy && <LoaderCircle className="animate-spin" />}{mode === "login" ? "Sign in" : "Create account"}
          </Button>
        </form>
        <p className="mt-4 text-center text-sm text-muted-foreground">
          {mode === "login" ? "New here? " : "Already have an account? "}
          <button type="button" className="font-medium text-foreground underline" onClick={() => { setMode(mode === "login" ? "register" : "login"); setError(null); }}>
            {mode === "login" ? "Create an account" : "Sign in"}
          </button>
        </p>
      </div>
    </main>
  );
}
