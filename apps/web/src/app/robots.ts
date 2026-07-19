import type { MetadataRoute } from "next";

export default function robots(): MetadataRoute.Robots {
  return {
    rules: { userAgent: "*", allow: "/" },
    // www, not the apex — caldearte.com 308-redirects to www.caldearte.com
    // at the Vercel domain level. Pointing this at the apex made Google
    // Search Console's sitemap fetch fail ("Couldn't fetch") after
    // following the robots.txt-declared Sitemap: line into a redirect.
    sitemap: "https://www.caldearte.com/sitemap.xml",
  };
}
