import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  reactStrictMode: true,
  turbopack: { root: process.cwd() },
  ...(process.env.OPEN_FORENSIC_STATIC_EXPORT === "1" ? { output: "export" as const, trailingSlash: true, distDir: ".next-export" } : {}),
};

export default nextConfig;
