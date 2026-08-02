import type { Metadata, Viewport } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Celya CRM",
  description: "Suivi clients, notes d'appel et relances — Celya",
};

export const viewport: Viewport = {
  themeColor: "#0A0E1A",
  width: "device-width",
  initialScale: 1,
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
