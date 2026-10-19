import type { Metadata, Viewport } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Celya CRM",
  description: "Suivi des prospects et des relances — Celya",
  // Installé sur l'iPhone : plein écran, barre d'état sombre, le nom sous
  // l'icône. (Le manifeste, app/manifest.ts, porte le reste ; l'icône vient
  // de app/apple-icon.tsx.)
  appleWebApp: {
    capable: true,
    title: "Celya CRM",
    statusBarStyle: "black",
  },
  // Next 15 n'émet plus que « mobile-web-app-capable » : les iOS plus anciens
  // attendent encore la balise préfixée.
  other: { "apple-mobile-web-app-capable": "yes" },
};

export const viewport: Viewport = {
  themeColor: "#0A0E1A",
  width: "device-width",
  initialScale: 1,
  // Sans « cover », iOS laisse env(safe-area-inset-*) à 0 : la barre d'onglets
  // du bas passerait sous la barre d'accueil de l'iPhone.
  viewportFit: "cover",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="fr">
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="" />
        <link
          href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600&family=Schibsted+Grotesk:wght@500;600;700&display=swap"
          rel="stylesheet"
        />
        <style
          dangerouslySetInnerHTML={{
            __html: `:root{--font-inter:'Inter';--font-display:'Schibsted Grotesk'}`,
          }}
        />
      </head>
      <body className="font-sans antialiased min-h-screen">{children}</body>
    </html>
  );
}
