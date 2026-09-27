import path from "node:path";
import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  transpilePackages: ["@consentos/shared", "@consentos/policy-engine"],
  // PGlite ships WebAssembly and data files that must be loaded from node_modules.
  serverExternalPackages: ["@electric-sql/pglite", "pg"],
  // Ship the SQL migrations with the server so a deployment can migrate itself
  // (CONSENTOS_AUTO_MIGRATE=true) without anyone handling database credentials.
  outputFileTracingRoot: path.join(import.meta.dirname, "../.."),
  outputFileTracingIncludes: {
    "/**": ["../../supabase/migrations/*.sql"],
  },
  poweredByHeader: false,
  async headers() {
    return [
      {
        source: "/:path*",
        headers: [
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
          { key: "X-Frame-Options", value: "DENY" },
          { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=()" },
        ],
      },
    ];
  },
};

export default nextConfig;
