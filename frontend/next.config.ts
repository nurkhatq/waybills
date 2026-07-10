import type { NextConfig } from "next";

const VPS = process.env.VPS_API_URL ?? "http://194.238.41.18/waybills";

const nextConfig: NextConfig = {
  async rewrites() {
    return [
      {
        source: "/api/:path*",
        destination: `${VPS}/:path*`,
      },
    ];
  },
};

export default nextConfig;
