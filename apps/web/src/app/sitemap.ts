import type { MetadataRoute } from "next";

// No per-event detail pages exist yet to enumerate — just the app's
// static routes.
export default function sitemap(): MetadataRoute.Sitemap {
  const base = "https://caldearte.com";
  return [
    { url: base, changeFrequency: "daily", priority: 1 },
    { url: `${base}/privacidad`, changeFrequency: "yearly", priority: 0.3 },
    { url: `${base}/contacto`, changeFrequency: "yearly", priority: 0.3 },
  ];
}
