"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import useSWR from "swr";
import { Markdown } from "@/components/markdown";
import { PageSkeleton } from "@/components/page-skeleton";
import { ago, hostPath } from "@/lib/format";
import type { LinkDetail } from "@/lib/types";

export function ReaderPage() {
  const { id } = useParams<{ id: string }>();
  const { data: link } = useSWR<LinkDetail>(`/api/links/${id}`);
  if (!link) return <PageSkeleton />;
  return (
    <article className="mx-auto max-w-[72ch]">
      <Link href={`/links/${link.id}`} className="text-sm text-muted-foreground hover:text-foreground hover:underline">
        Back to {link.name ?? link.domain}
      </Link>
      <h1 className="mt-4 font-serif text-4xl leading-tight font-medium">{link.title || link.name}</h1>
      <p className="mt-2 text-sm text-muted-foreground">
        Archived from <a className="underline" href={link.url} target="_blank" rel="noopener noreferrer">{hostPath(link.url)}</a>{" "}
        {ago(link.extraction?.created_at)}
      </p>
      <div className="mt-8">
        {link.markdown ? <Markdown>{link.markdown}</Markdown> : <p className="text-muted-foreground">No readable content was saved for this page.</p>}
      </div>
    </article>
  );
}
