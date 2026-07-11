import type { Metadata } from "next";
import "./globals.css";

const title = "AI Circuit Studio — Prompt, wire, simulate";
const description =
  "Design Arduino circuits with AI, edit the schematic and code, then simulate the result in your browser.";

export const metadata: Metadata = { title, description };

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
