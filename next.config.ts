import type { NextConfig } from "next";

const securityHeaders = [
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  { key: "X-Frame-Options", value: "DENY" },
];

const nextConfig: NextConfig = {
  serverExternalPackages: ["@react-pdf/renderer"],
  poweredByHeader: false,
  // Lets the dev server be shared through a temporary Cloudflare quick tunnel (`cloudflared tunnel --url`).
  // Only affects `next dev`; production on Vercel ignores it.
  allowedDevOrigins: ["*.trycloudflare.com"],
  // Static sanctions lists read at runtime by the person screen (bundled data, not storage).
  outputFileTracingIncludes: { "/api/person-report": ["./data/sanctions/*.json"], "/api/report": ["./data/sanctions/*.json"] },
  async headers() {
    const privatePage = [{ key: "X-Robots-Tag", value: "noindex" }, { key: "Cache-Control", value: "no-store" }];
    return [
      { source: "/:path*", headers: securityHeaders },
      // Reports are private: never index or cache them.
      { source: "/report", headers: privatePage },
      { source: "/person-check/report", headers: privatePage },
    ];
  },
};

export default nextConfig;
