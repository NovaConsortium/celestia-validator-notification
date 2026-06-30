/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  experimental: {
    serverComponentsExternalPackages: ["@prisma/client", "prisma"],
    // Tree-shake icon barrels — lucide-react ships ~1300 icons, but we only
    // import a few dozen. Without this, dev compiles every icon module.
    optimizePackageImports: ["lucide-react"],
  },
  // Validator logos are arbitrary third-party URLs (Celenium identity avatars,
  // IPFS, random CDNs). They're rendered `unoptimized` / via plain <img>, so
  // they don't go through /_next/image and need no remotePatterns allowlist.
  images: {
    remotePatterns: [],
  },
};

export default nextConfig;
