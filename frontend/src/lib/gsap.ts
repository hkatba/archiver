"use client";

import gsap from "gsap";
import { ScrollTrigger } from "gsap/ScrollTrigger";
import { SplitText } from "gsap/SplitText";
import { useGSAP } from "@gsap/react";

if (typeof window !== "undefined") {
  gsap.registerPlugin(ScrollTrigger, SplitText, useGSAP);
  // Display faces change line lengths when they arrive; re-measure every trigger once they have
  document.fonts?.ready.then(() => ScrollTrigger.refresh());
}

/** The motion language in GSAP terms (mirrors the CSS tokens in globals.css). */
export const EASE = { out: "expo.out", inOut: "power3.inOut" } as const;
/** Media conditions every animated component branches on. */
export const MOTION = {
  ok: "(prefers-reduced-motion: no-preference)",
  desktop: "(prefers-reduced-motion: no-preference) and (min-width: 1024px)",
} as const;

export { gsap, ScrollTrigger, SplitText, useGSAP };
