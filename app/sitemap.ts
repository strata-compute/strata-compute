import type { MetadataRoute } from "next";

/** The public pages. The Terminal is deliberately absent — see robots.ts. */
export default function sitemap(): MetadataRoute.Sitemap {
  const base = "https://stratacompute.app";
  return ["/", "/about", "/platform", "/docs", "/status"].map((path) => ({
    url: `${base}${path}`,
    changeFrequency: path === "/" ? "daily" : "weekly",
    priority: path === "/" ? 1 : 0.7,
  }));
}
