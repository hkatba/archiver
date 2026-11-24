import type { LinkStatus } from "./types";

/** Each top-level category is a mineral; the color marks it everywhere (cards, filters, the cairn). */
const MINERALS: Record<string, string> = {
  "AI Tools": "#3e8e72", // jade
  "Developer Tools": "#3b62b5", // lapis
  Design: "#b4536a", // rhodonite
  Productivity: "#b8892e", // ochre
  "Automation & No-Code": "#7a5da6", // amethyst
  "Writing & Content": "#b0683a", // copper
  "Marketing & SEO": "#9a3f4c", // garnet
  "Research & Learning": "#2c8597", // azurite
  "Data & Analytics": "#7a8b35", // olivine
  "Documents & PDF": "#5c6a72", // slate
  Media: "#c27c8e", // rose quartz
  "Business & Finance": "#a8902a", // citrine
  "Communication & Collaboration": "#3aa0a0", // turquoise
  "Hosting & Infrastructure": "#4d555c", // basalt
  "Security & Privacy": "#6b4e4e", // hematite
  "Open Source": "#2f7a55", // malachite
  "News & Articles": "#7d7468", // flint
};

export function mineral(category: string | null | undefined): string {
  return (category && MINERALS[category]) || "#8a918e"; // granite
}

export const STATUS_LABEL: Record<LinkStatus, string> = {
  PENDING: "Waiting",
  QUEUED: "Queued",
  PROCESSING: "Reading page",
  ENRICHING: "Analyzing",
  INDEXING: "Indexing",
  COMPLETED: "Ready",
  FAILED: "Failed",
  BLOCKED: "Blocked",
  NEEDS_REVIEW: "Needs review",
};

export function hostPath(url: string): string {
  try {
    const u = new URL(url);
    const path = u.pathname === "/" ? "" : u.pathname;
    return (u.host.replace(/^www\./, "") + path + u.search).slice(0, 90);
  } catch {
    return url;
  }
}

const rtf = new Intl.RelativeTimeFormat("en", { numeric: "auto" });

export function ago(iso: string | null | undefined): string {
  if (!iso) return "never";
  const s = (new Date(iso).getTime() - Date.now()) / 1000;
  const abs = Math.abs(s);
  if (abs < 60) return "just now";
  if (abs < 3600) return rtf.format(Math.round(s / 60), "minute");
  if (abs < 86400) return rtf.format(Math.round(s / 3600), "hour");
  if (abs < 86400 * 30) return rtf.format(Math.round(s / 86400), "day");
  return new Date(iso).toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" });
}

export function compact(n: number | undefined | null): string {
  if (n === undefined || n === null) return "";
  return Intl.NumberFormat("en", { notation: "compact", maximumFractionDigits: 1 }).format(n);
}
