"use client";

import { ThemeProvider } from "next-themes";
import { SWRConfig } from "swr";
import { Toaster } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { fetcher } from "@/lib/api";

export function Providers({ children }: { children: React.ReactNode }) {
  return (
    <ThemeProvider attribute="class" defaultTheme="system" enableSystem disableTransitionOnChange>
      <SWRConfig value={{ fetcher, revalidateOnFocus: false, keepPreviousData: true }}>
        <TooltipProvider delay={300}>
          {children}
          <Toaster position="bottom-right" />
        </TooltipProvider>
      </SWRConfig>
    </ThemeProvider>
  );
}
