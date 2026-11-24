import type { Metadata } from "next";
import { Suspense } from "react";
import { PageSkeleton } from "@/components/page-skeleton";
import { CollectionsPage } from "@/components/pages/collections";

export const metadata: Metadata = { title: "Collections" };

export default function Page() {
  return (
    <Suspense fallback={<PageSkeleton />}>
      <CollectionsPage />
    </Suspense>
  );
}
