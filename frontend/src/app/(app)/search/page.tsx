import type { Metadata } from "next";
import { Suspense } from "react";
import { PageSkeleton } from "@/components/page-skeleton";
import { SearchPage } from "@/components/pages/search";

export const metadata: Metadata = { title: "Search" };

export default function Page() {
  return (
    <Suspense fallback={<PageSkeleton />}>
      <SearchPage />
    </Suspense>
  );
}
