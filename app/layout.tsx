import type { Metadata } from "next";
import "./globals.css";
import "./schematic-symbols.css";

const title = "Zircuit";
const description =
  "Design Arduino circuits with AI, edit the schematic and code, then simulate the result in your browser.";

export const metadata: Metadata = {
  title,
  description,
  authors: [{ name: "Ziad Sakr" }],
  creator: "Ziad Sakr",
};

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
