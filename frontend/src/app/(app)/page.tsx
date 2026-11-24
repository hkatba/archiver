import type { Metadata } from "next";
import { Suspense } from "react";
import { PageSkeleton } from "@/components/page-skeleton";
import { OverviewPage } from "@/components/pages/overview";

export const metadata: Metadata = { title: "Overview" };

export default function Page() {
  return (
    <Suspense fallback={<PageSkeleton />}>
      <OverviewPage />
    </Suspense>
  );
}
