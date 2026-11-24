import type { Metadata } from "next";
import { Suspense } from "react";
import { PageSkeleton } from "@/components/page-skeleton";
import { CollectionDetailPage } from "@/components/pages/collections";

export const metadata: Metadata = { title: "Collection" };

export default function Page() {
  return (
    <Suspense fallback={<PageSkeleton />}>
      <CollectionDetailPage />
    </Suspense>
  );
}
