import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  /* config options here */
  output: "standalone",
  serverExternalPackages: ["@neondatabase/serverless", "ws"],
  allowedDevOrigins: ["localhost", "127.0.0.1", "192.168.23.111"],
};

export default nextConfig;
