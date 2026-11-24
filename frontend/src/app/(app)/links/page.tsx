import type { Metadata } from "next";
import { Suspense } from "react";
import { PageSkeleton } from "@/components/page-skeleton";
import { LinkBrowser } from "@/components/pages/link-browser";

export const metadata: Metadata = { title: "All links" };

export default function Page() {
  return (
    <Suspense fallback={<PageSkeleton />}>
      <LinkBrowser title="All links" />
    </Suspense>
  );
}
