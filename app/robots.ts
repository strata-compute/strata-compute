import type { MetadataRoute } from "next";

/**
 * The Terminal is excluded from indexing.
 *
 * Every page under it is rendered per request from live market data, so a
 * crawled copy is stale the moment it is stored and would be served to
 * searchers as if it were current. The public site describes the product;
 * the product itself is not a document.
 */
export default function robots(): MetadataRoute.Robots {
  return {
    rules: [{ userAgent: "*", allow: "/", disallow: ["/terminal/", "/api/"] }],
    sitemap: "https://stratacompute.app/sitemap.xml",
    host: "https://stratacompute.app",
  };
}
