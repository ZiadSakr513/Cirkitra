import type { Metadata, Viewport } from "next";
import { Analytics } from "@vercel/analytics/next";
import { FirebaseSessionProvider } from "../lib/firebase/session-provider";
import "./globals.css";
import "./schematic-symbols.css";

const title = "Cirkitra";
const description =
  "Design circuits with AI, edit board-compatible schematics and code, then simulate the result in your browser.";
const siteUrl = "https://cirkitra-green.vercel.app";

export const metadata: Metadata = {
  metadataBase: new URL(siteUrl),
  title: {
    default: "Cirkitra — AI Circuit Design & Simulation",
    template: "%s | Cirkitra",
  },
  description,
  applicationName: title,
  verification: {
    google: "2UUPcb4kjCjUl59CceQ00moJzJQG6Kx319xbkPZUbco",
  },
  keywords: [
    "microcontroller circuit simulator",
    "AI circuit design",
    "microcontroller schematic",
    "electronic circuit simulator",
    "browser circuit simulator",
    "board-compatible code generator",
    "ESP32 simulator",
    "Raspberry Pi Pico simulator",
  ],
  authors: [{ name: "Ziad Sakr" }],
  creator: "Ziad Sakr",
  publisher: "Cirkitra",
  alternates: { canonical: "/" },
  manifest: "/manifest.webmanifest",
  icons: { icon: "/cirkitra-logo.png", apple: "/cirkitra-logo.png" },
  openGraph: {
    type: "website",
    url: siteUrl,
    siteName: title,
    title: "Cirkitra — AI Circuit Design & Simulation",
    description,
    images: [{ url: "/opengraph-image", width: 1200, height: 630, alt: "Cirkitra AI circuit designer and simulator for microcontroller boards" }],
  },
  twitter: {
    card: "summary_large_image",
    title: "Cirkitra — AI Circuit Design & Simulation",
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
    <html lang="en" suppressHydrationWarning>
      <body>
        <FirebaseSessionProvider>
          {children}
          <Analytics />
        </FirebaseSessionProvider>
      </body>
    </html>
  );
}
