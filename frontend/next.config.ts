import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  cacheComponents: true,
  partialPrefetching: true,
  turbopack: {
    rules: {
      "*.css": {
        loaders: ["@tailwindcss/turbopack"],
        as: "*.css",
      },
    },
  },
  // Le navigateur ne parle qu'au backend local, jamais à une API externe.
  async rewrites() {
    return [{ source: "/api/:path*", destination: `http://127.0.0.1:${process.env.API_PORT ?? "8000"}/api/:path*` }];
  },
};

export default nextConfig;
