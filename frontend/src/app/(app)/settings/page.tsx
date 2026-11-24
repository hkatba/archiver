import type { Metadata } from "next";
import { Suspense } from "react";
import { PageSkeleton } from "@/components/page-skeleton";
import { SettingsPage } from "@/components/pages/settings";

export const metadata: Metadata = { title: "Settings" };

export default function Page() {
  return (
    <Suspense fallback={<PageSkeleton />}>
      <SettingsPage />
    </Suspense>
  );
}
