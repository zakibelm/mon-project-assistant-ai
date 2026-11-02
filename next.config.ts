import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Image Docker légère pour le VPS.
  output: "standalone",
  // Pilotes de base de données chargés tels quels côté serveur (PGlite embarque du WebAssembly).
  serverExternalPackages: ["@electric-sql/pglite", "pg"],
};

export default nextConfig;
