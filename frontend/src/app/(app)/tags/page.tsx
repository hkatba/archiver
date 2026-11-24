import type { Metadata } from "next";
import { Suspense } from "react";
import { PageSkeleton } from "@/components/page-skeleton";
import { TagsPage } from "@/components/pages/facets";

export const metadata: Metadata = { title: "Tags" };

export default function Page() {
  return (
    <Suspense fallback={<PageSkeleton />}>
      <TagsPage />
    </Suspense>
  );
}
