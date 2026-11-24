import type { Metadata } from "next";
import { Suspense } from "react";
import { PageSkeleton } from "@/components/page-skeleton";
import { SnippetsPage } from "@/components/pages/snippets";

export const metadata: Metadata = { title: "Code snippets" };

export default function Page() {
  return (
    <Suspense fallback={<PageSkeleton />}>
      <SnippetsPage />
    </Suspense>
  );
}
