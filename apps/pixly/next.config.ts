import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  transpilePackages: ["@consentos/sdk"],
  poweredByHeader: false,
};

export default nextConfig;
