import type { Metadata } from "next";
import { Suspense } from "react";
import { PageSkeleton } from "@/components/page-skeleton";
import { LinkDetailPage } from "@/components/pages/link-detail";

export const metadata: Metadata = { title: "Link" };

export default function Page() {
  return (
    <Suspense fallback={<PageSkeleton />}>
      <LinkDetailPage />
    </Suspense>
  );
}
