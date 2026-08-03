/** @type {import('next').NextConfig} */
const nextConfig = {
  eslint: { ignoreDuringBuilds: true },
  typescript: { ignoreBuildErrors: false },
  async redirects() {
    return [
      // L'écran « clients » est devenu « prospects ».
      { source: "/clients", destination: "/prospects", permanent: true },
      { source: "/clients/:path*", destination: "/prospects/:path*", permanent: true },
      // Trois écrans, pas cinq : Relances et Pipeline ont fusionné ailleurs.
      { source: "/taches", destination: "/dashboard", permanent: true },
      { source: "/pipeline", destination: "/prospects?vue=colonnes", permanent: true },
    ];
  },
};

export default nextConfig;
