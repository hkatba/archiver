"use client";

import { ArrowLeft } from "lucide-react";
import Link from "next/link";
import { useParams } from "next/navigation";
import useSWR from "swr";
import { vars } from "@/components/bits";
import { Markdown } from "@/components/markdown";
import { PageSkeleton } from "@/components/page-skeleton";
import { ago, hostPath } from "@/lib/format";
import type { LinkDetail } from "@/lib/types";

export function ReaderPage() {
  const { id } = useParams<{ id: string }>();
  const { data: link } = useSWR<LinkDetail>(`/api/links/${id}`);
  if (!link) return <PageSkeleton />;
  return (
    <article className="mx-auto max-w-[68ch]">
      {/* How far you have read: a lichen hairline driven by the scroll position (no script) */}
      <div aria-hidden="true" className="read-progress fixed inset-x-0 top-0 z-40 h-0.5 origin-left scale-x-0 bg-lichen md:left-[244px]" />
      <Link href={`/links/${link.id}`} className="group enter-fade inline-flex items-center gap-1.5 py-1 text-sm text-muted-foreground transition-colors hover:text-foreground">
        <ArrowLeft className="size-3.5 transition-[translate] duration-200 group-hover:-translate-x-0.5" aria-hidden="true" />
        <span className="ink-link">Back to {link.name ?? link.domain}</span>
      </Link>
      <h1 className="mask-line mt-8 font-serif text-[clamp(2.1rem,1.6rem+2vw,3.4rem)] leading-[1.08] font-normal tracking-[-0.01em]">
        <span>{link.title || link.name}</span>
      </h1>
      <p className="enter mt-5 text-sm text-muted-foreground" style={vars({ "--d": "160ms" })}>
        Archived from <a className="underline decoration-border underline-offset-3 hover:decoration-foreground" href={link.url} target="_blank" rel="noopener noreferrer">{hostPath(link.url)}</a>{" "}
        {ago(link.extraction?.created_at)}
      </p>
      <div className="rule mt-8" />
      <div className="enter mt-10" style={vars({ "--d": "240ms" })}>
        {link.markdown ? <Markdown>{link.markdown}</Markdown> : <p className="text-muted-foreground">No readable content was saved for this page.</p>}
      </div>
    </article>
  );
}
