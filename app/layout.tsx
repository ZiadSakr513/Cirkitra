import type { Metadata, Viewport } from "next";
import { Analytics } from "@vercel/analytics/next";
import "./globals.css";
import "./schematic-symbols.css";

const title = "Cirkitra";
const description =
  "Design Arduino circuits with AI, edit the schematic and code, then simulate the result in your browser.";
const siteUrl = "https://cirkitra-green.vercel.app";

export const metadata: Metadata = {
  metadataBase: new URL(siteUrl),
  title: {
    default: "Cirkitra — AI Arduino Circuit Design & Simulation",
    template: "%s | Cirkitra",
  },
  description,
  applicationName: title,
  keywords: [
    "Arduino circuit simulator",
    "AI circuit design",
    "Arduino schematic",
    "electronic circuit simulator",
    "browser circuit simulator",
    "Arduino code generator",
  ],
  authors: [{ name: "Ziad Sakr" }],
  creator: "Ziad Sakr",
  publisher: "Cirkitra",
  alternates: { canonical: "/" },
  manifest: "/manifest.webmanifest",
  icons: { icon: "/favicon.svg" },
  openGraph: {
    type: "website",
    url: siteUrl,
    siteName: title,
    title: "Cirkitra — AI Arduino Circuit Design & Simulation",
    description,
    images: [{ url: "/opengraph-image", width: 1200, height: 630, alt: "Cirkitra AI Arduino circuit designer and simulator" }],
  },
  twitter: {
    card: "summary_large_image",
    title: "Cirkitra — AI Arduino Circuit Design & Simulation",
    description,
    images: ["/opengraph-image"],
  },
};

export const viewport: Viewport = {
  themeColor: "#070b10",
  colorScheme: "dark",
};

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body>
        {children}
        <Analytics />
      </body>
    </html>
  );
}
