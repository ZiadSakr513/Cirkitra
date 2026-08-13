import type { MetadataRoute } from "next";

export default function robots(): MetadataRoute.Robots {
  return {
    rules: { userAgent: "*", allow: "/", disallow: ["/api/", "/studio"] },
    sitemap: "https://cirkitra-green.vercel.app/sitemap.xml",
    host: "https://cirkitra-green.vercel.app",
  };
}
