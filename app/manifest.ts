import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "Cirkitra — AI Arduino Circuit Studio",
    short_name: "Cirkitra",
    description: "Design and simulate Arduino circuits with AI in your browser.",
    start_url: "/studio",
    display: "standalone",
    background_color: "#070b10",
    theme_color: "#070b10",
    icons: [{ src: "/cirkitra-logo.png", sizes: "1024x1024", type: "image/png", purpose: "any" }],
  };
}
