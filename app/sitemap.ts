import type { MetadataRoute } from "next";

export default function sitemap(): MetadataRoute.Sitemap {
  const lastModified = new Date();
  return [
    { url: "https://cirkitra-green.vercel.app", lastModified, changeFrequency: "weekly", priority: 1 },
    { url: "https://cirkitra-green.vercel.app/pricing", lastModified, changeFrequency: "monthly", priority: 0.7 },
  ];
}
