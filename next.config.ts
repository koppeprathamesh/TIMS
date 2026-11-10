import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  /* config options here */
  // Dev server blocks JS/HMR for non-localhost origins unless listed (e.g. "192.168.1.20,mypc.corp.local").
  allowedDevOrigins: (process.env.ALLOWED_DEV_ORIGINS ?? "")
    .split(",")
    .map((origin) => origin.trim())
    .filter(Boolean),
  cacheComponents: true,
  partialPrefetching: true,
  experimental: {
    // Routes intentionally wait for live access checks, not an instant cached UI.
    // Keep instant validation available for routes that explicitly opt in.
    instantInsights: { validationLevel: "manual-warning" },
  },
  turbopack: {
    root: process.cwd(),
    rules: {
      "*.css": {
        loaders: ["@tailwindcss/turbopack"],
        as: "*.css",
      },
    },
  },
};

export default nextConfig;
