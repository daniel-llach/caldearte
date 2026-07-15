import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  transpilePackages: ["@caldearte/shared-types"],
  // Hides the floating "N" dev-mode route indicator — errors still surface.
  devIndicators: false,
  images: {
    // Event images are scraped external URLs from unknown domains — no
    // re-hosting yet (that's Phase 3, see docs/roadmap.md), so there's no
    // fixed allowlist to put in remotePatterns.
    unoptimized: true,
  },
};

export default nextConfig;
