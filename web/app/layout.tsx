import type { Metadata, Viewport } from "next";
import { Anton, Figtree, Geist_Mono, Instrument_Serif } from "next/font/google";
import { Providers } from "./providers";
import "./globals.css";

// Self-hosted at build time, so the CSP's font-src 'self' is enough.
const figtree = Figtree({ variable: "--font-figtree", subsets: ["latin"], weight: "variable" });
const anton = Anton({ variable: "--font-anton", subsets: ["latin"], weight: "400" });
const serif = Instrument_Serif({ variable: "--font-instrument-serif", subsets: ["latin"], weight: "400", style: ["normal", "italic"] });
const mono = Geist_Mono({ variable: "--font-geist-mono", subsets: ["latin"] });

function siteUrl(): string {
  if (process.env.NEXT_PUBLIC_SITE_URL) return process.env.NEXT_PUBLIC_SITE_URL;
  if (process.env.VERCEL_PROJECT_PRODUCTION_URL) return `https://${process.env.VERCEL_PROJECT_PRODUCTION_URL}`;
  return "http://localhost:3000";
}

export const metadata: Metadata = {
  metadataBase: new URL(siteUrl()),
  title: { default: "Sisonke · Go first. Get paid in full.", template: "%s · Sisonke" },
  description:
    "Sisonke holds USDC in a Stellar smart contract until the job is done. The payer releases it, the recipient can send it back, and this website never holds your keys or your money.",
  openGraph: { siteName: "Sisonke", type: "website" },
};

export const viewport: Viewport = { themeColor: "#F8F4E6", colorScheme: "light" };

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en" className={`${figtree.variable} ${anton.variable} ${serif.variable} ${mono.variable} antialiased`}>
      <body className="min-h-dvh">
        <a href="#main" className="sr-only-focusable absolute top-2 left-2 z-[60] rounded-pill bg-ink px-4 py-2 text-sm font-bold text-on-ink">
          Skip to content
        </a>
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
