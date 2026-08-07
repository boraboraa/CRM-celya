/** @type {import('next').NextConfig} */
const nextConfig = {
  eslint: { ignoreDuringBuilds: true },
  typescript: { ignoreBuildErrors: false },

  /**
   * Cache du routeur côté client. Par défaut Next jette la page dès qu'on la
   * quitte : revenir sur « À faire » relançait un rendu serveur complet à
   * chaque aller-retour. Avec ce délai, un écran déjà visité se réaffiche
   * instantanément.
   *
   * Sans risque de fraîcheur : toutes les mutations passent par des server
   * actions qui appellent revalidatePath, ce qui invalide AUSSI ce cache —
   * après un geste de Bora, l'écran est toujours recalculé. Ne subsiste que
   * la fenêtre où la donnée a changé AILLEURS (relève IMAP toutes les 5 min,
   * autre commercial) : 30 s, c'est le compromis assumé.
   */
  experimental: {
    staleTimes: { dynamic: 30, static: 180 },
  },

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
