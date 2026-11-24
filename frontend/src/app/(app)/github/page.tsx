import type { Metadata } from "next";
import { Suspense } from "react";
import { PageSkeleton } from "@/components/page-skeleton";
import { LinkBrowser } from "@/components/pages/link-browser";

export const metadata: Metadata = { title: "GitHub repositories" };

export default function Page() {
  return (
    <Suspense fallback={<PageSkeleton />}>
      <LinkBrowser title="GitHub repositories" description="Stars, license and activity come from the GitHub API" fixed={{ domain: "github.com" }} />
    </Suspense>
  );
}
