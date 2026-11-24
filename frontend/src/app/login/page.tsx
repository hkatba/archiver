import type { Metadata } from "next";
import { Suspense } from "react";
import { PageSkeleton } from "@/components/page-skeleton";
import { LoginPage } from "@/components/pages/login";

export const metadata: Metadata = { title: "Sign in" };

export default function Page() {
  return (
    <Suspense fallback={<PageSkeleton />}>
      <LoginPage />
    </Suspense>
  );
}
