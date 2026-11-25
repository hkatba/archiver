"use client";

import { cn } from "@/lib/utils";

/** Two-or-more-way toggle. The thumb slides to the chosen option, so the change reads as one move. */
export function Segmented<T extends string>({ value, onChange, options, label, className }: {
  value: T;
  onChange: (v: T) => void;
  options: [T, React.ReactNode][];
  label: string;
  className?: string;
}) {
  const idx = Math.max(0, options.findIndex(([v]) => v === value));
  return (
    <div role="group" aria-label={label}
      className={cn("relative grid h-9 auto-cols-fr grid-flow-col rounded-md border border-input bg-card/60 p-[3px]", className)}>
      <span aria-hidden="true"
        className="absolute inset-y-[3px] left-[3px] rounded-[4px] bg-primary transition-transform duration-300 ease-(--ease-in-out)"
        style={{ width: `calc((100% - 6px) / ${options.length})`, transform: `translateX(${idx * 100}%)` }} />
      {options.map(([v, content]) => (
        <button key={v} type="button" aria-pressed={v === value} onClick={() => onChange(v)}
          className={cn("relative z-10 inline-flex min-w-9 items-center justify-center rounded-[4px] px-2.5 text-sm transition-colors duration-200",
            v === value ? "text-primary-foreground" : "text-muted-foreground hover:text-foreground")}>
          {content}
        </button>
      ))}
    </div>
  );
}
