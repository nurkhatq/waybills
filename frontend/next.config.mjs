const VPS = process.env.VPS_API_URL ?? "http://194.238.41.18/waybills";

/** @type {import('next').NextConfig} */
const nextConfig = {
  webpack(config) {
    config.experiments = { ...config.experiments, asyncWebAssembly: true };
    return config;
  },
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
