import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  experimental: {
    serverActions: { bodySizeLimit: "50mb" }, // allow video uploads later
  },
};

export default nextConfig;
