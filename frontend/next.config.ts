import type { NextConfig } from "next";

// The browser only talks to this Next.js server; /api/* is proxied to FastAPI so auth cookies stay
// first-party and no API URL or key is ever exposed to the client.
const API_URL = process.env.API_URL ?? "http://127.0.0.1:8000";

const nextConfig: NextConfig = {
  output: "standalone",
  cacheComponents: true,
  partialPrefetching: true,
  experimental: {
    proxyTimeout: 300_000, // AI assistant answers from local models can be slow
  },
  async rewrites() {
    return [{ source: "/api/:path*", destination: `${API_URL}/api/:path*` }];
  },
  turbopack: {
    rules: {
      "*.css": {
        loaders: ["@tailwindcss/turbopack"],
        as: "*.css",
      },
    },
  },
};

export default nextConfig;
