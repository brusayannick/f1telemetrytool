import path from "node:path";
import { fileURLToPath } from "node:url";
import type { NextConfig } from "next";

const root = path.dirname(fileURLToPath(import.meta.url));

const nextConfig: NextConfig = {
  // Pin the Turbopack workspace root to this project so lockfile detection
  // does not walk up into parent directories.
  turbopack: { root },
};

export default nextConfig;
