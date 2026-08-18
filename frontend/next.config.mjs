const VPS = process.env.VPS_API_URL ?? "http://185.185.49.163/waybills";

/** @type {import('next').NextConfig} */
const nextConfig = {
  turbopack: {},
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
