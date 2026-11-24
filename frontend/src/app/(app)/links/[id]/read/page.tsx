import type { Metadata } from "next";
import { Suspense } from "react";
import { PageSkeleton } from "@/components/page-skeleton";
import { ReaderPage } from "@/components/pages/reader";

export const metadata: Metadata = { title: "Reader" };

export default function Page() {
  return (
    <Suspense fallback={<PageSkeleton />}>
      <ReaderPage />
    </Suspense>
  );
}
