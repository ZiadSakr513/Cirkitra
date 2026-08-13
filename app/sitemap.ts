import type { MetadataRoute } from "next";

export default function sitemap(): MetadataRoute.Sitemap {
  return [{ url: "https://cirkitra-green.vercel.app", lastModified: new Date(), changeFrequency: "weekly", priority: 1 }];
}
