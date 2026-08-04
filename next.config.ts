import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  /* config options here */
  output: "standalone",
  transpilePackages: [
    "@radix-ui/react-dropdown-menu",
    "@radix-ui/react-popover",
    "@radix-ui/react-slot",
    "class-variance-authority",
    "lucide-react",
    "next-themes",
    "resize-observer-polyfill",
    "sonner",
    "tailwind-merge",
  ],
  serverExternalPackages: ["@neondatabase/serverless", "ws"],
  allowedDevOrigins: ["localhost", "127.0.0.1", "192.168.23.111"],
};

export default nextConfig;
