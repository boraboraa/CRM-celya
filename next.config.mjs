/** @type {import('next').NextConfig} */
const nextConfig = {
  eslint: { ignoreDuringBuilds: true },
  typescript: { ignoreBuildErrors: false },
  async redirects() {
    // L'écran « clients » est devenu « prospects » (poste d'appels).
    return [
      { source: "/clients", destination: "/prospects", permanent: true },
      { source: "/clients/:path*", destination: "/prospects/:path*", permanent: true },
    ];
  },
};

export default nextConfig;
