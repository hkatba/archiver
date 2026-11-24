import type { Metadata } from "next";
import { Suspense } from "react";
import { PageSkeleton } from "@/components/page-skeleton";
import { LinkBrowser } from "@/components/pages/link-browser";

export const metadata: Metadata = { title: "Favorites" };

export default function Page() {
  return (
    <Suspense fallback={<PageSkeleton />}>
      <LinkBrowser title="Favorites" fixed={{ favorite: "true" }} />
    </Suspense>
  );
}
