import type { MetadataRoute } from "next";

/**
 * Le CRM « comme une app » (19/10) : installé sur l'écran d'accueil, il
 * s'ouvre plein écran (sans barre d'adresse) sur « À faire ». Le raccourci
 * « Nouveau prospect » (appui long sur l'icône) ouvre l'ajout rapide
 * (`?ajout=1`, lu par components/AjoutRapide.tsx).
 *
 * Pas de service worker : rien ne marche hors ligne, c'est voulu pour ce
 * chantier. Public (middleware) : le navigateur lit le manifeste sans cookie.
 */
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "Celya CRM",
    short_name: "Celya CRM",
    description: "Prospects, relances et rendez-vous — Celya",
    lang: "fr",
    start_url: "/dashboard",
    scope: "/",
    display: "standalone",
    orientation: "portrait",
    background_color: "#0A0E1A",
    theme_color: "#0A0E1A",
    icons: [
      { src: "/icon/192", sizes: "192x192", type: "image/png", purpose: "any" },
      { src: "/icon/512", sizes: "512x512", type: "image/png", purpose: "any" },
      { src: "/icon/512", sizes: "512x512", type: "image/png", purpose: "maskable" },
    ],
    shortcuts: [
      {
        name: "Nouveau prospect",
        short_name: "Nouveau",
        description: "Ajouter une fiche en trois champs",
        url: "/dashboard?ajout=1",
        icons: [{ src: "/icon/192", sizes: "192x192", type: "image/png" }],
      },
    ],
  };
}
