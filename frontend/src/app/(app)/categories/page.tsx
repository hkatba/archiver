import type { Metadata } from "next";
import { Suspense } from "react";
import { PageSkeleton } from "@/components/page-skeleton";
import { CategoriesPage } from "@/components/pages/facets";

export const metadata: Metadata = { title: "Categories" };

export default function Page() {
  return (
    <Suspense fallback={<PageSkeleton />}>
      <CategoriesPage />
    </Suspense>
  );
}
