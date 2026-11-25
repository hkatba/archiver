import { ViewTransition } from "react";

// Each route change: the old page fades out fast, the new one rises in (classes in globals.css).
export default function Template({ children }: { children: React.ReactNode }) {
  return (
    <ViewTransition enter="page-enter" exit="page-exit" default="none">
      {children}
    </ViewTransition>
  );
}
