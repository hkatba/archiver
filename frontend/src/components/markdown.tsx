"use client";

import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";

/** Safe Markdown: raw HTML is never rendered, javascript: URLs are stripped by react-markdown's
 * default urlTransform, links open in a new tab without referrer, and remote images are shown as links
 * (no third-party requests while reading). */
export function Markdown({ children, compact = false }: { children: string; compact?: boolean }) {
  return (
    <div className={compact ? "reader reader-compact" : "reader"}>
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        components={{
          a: ({ href, children: c }) => (
            <a href={href} target="_blank" rel="noopener noreferrer nofollow">{c}</a>
          ),
          img: ({ src, alt }) =>
            typeof src === "string" && src ? (
              <a href={src} target="_blank" rel="noopener noreferrer nofollow">[image{alt ? `: ${alt}` : ""}]</a>
            ) : null,
        }}
      >
        {children}
      </ReactMarkdown>
    </div>
  );
}
