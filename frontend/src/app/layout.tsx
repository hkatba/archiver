import type { Metadata, Viewport } from "next";
import { Instrument_Sans, Instrument_Serif, Newsreader } from "next/font/google";
import { Providers } from "@/components/providers";
import "./globals.css";

// Instrument Sans and Instrument Serif are drawn as a pair: one voice for the interface, one for titles.
const instrument = Instrument_Sans({ variable: "--font-instrument", subsets: ["latin"], axes: ["wdth"] });
const instrumentSerif = Instrument_Serif({ variable: "--font-instrument-serif", subsets: ["latin"], weight: "400", style: ["normal", "italic"] });
// Newsreader is kept for long-form reading (summaries, the reader view).
const newsreader = Newsreader({ variable: "--font-newsreader", subsets: ["latin"], style: ["normal", "italic"] });

export const metadata: Metadata = {
  title: { default: "Cairn", template: "%s · Cairn" },
  description: "Save anything. Understand everything. Find it instantly.",
};

export const viewport: Viewport = {
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#ece9e1" },
    { media: "(prefers-color-scheme: dark)", color: "#0f1211" },
  ],
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en" suppressHydrationWarning
      className={`${instrument.variable} ${instrumentSerif.variable} ${newsreader.variable} h-full antialiased`}>
      <body className="min-h-full">
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
