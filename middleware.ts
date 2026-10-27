import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";
import { SUPABASE_URL, SUPABASE_ANON_KEY } from "@/lib/env";
import { PERIMETRE_COOKIE, perimetreAMemoriser } from "@/lib/crm/perimetre";

// /login, /auth : parcours d'authentification de l'app.
// /mcp, /sse, /message : serveur MCP (auth par jeton Bearer, pas par cookie).
// /api/oauth, /.well-known : serveur d'autorisation OAuth du connecteur MCP.
// /api/appels-ia/{tick,outils,fin} : le moteur d'appels de Janet, appelé par
// pg_cron (secret du Vault) et par l'edge function annexe (signature HMAC) —
// jamais par un navigateur. /api/appels-ia/suivi et /etat restent derrière la
// session : ce sont les écrans de l'admin qui les sondent.
// /manifest.webmanifest, /icon, /apple-icon : l'application installable —
// le navigateur les charge SANS cookie (une redirection vers /login casserait
// l'installation). Ils ne portent aucune donnée.
const PUBLIC_PATHS = [
  "/manifest.webmanifest",
  "/icon",
  "/apple-icon",
  "/api/appels-ia/tick",
  "/api/appels-ia/outils",
  "/api/appels-ia/fin",
  "/login",
  "/auth",
  "/mcp",
  "/sse",
  "/message",
  "/api/oauth",
  "/.well-known",
];

export async function middleware(request: NextRequest) {
  let response = NextResponse.next({ request });

  const supabase = createServerClient(
    SUPABASE_URL,
    SUPABASE_ANON_KEY,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value }) =>
            request.cookies.set(name, value)
          );
          response = NextResponse.next({ request });
          cookiesToSet.forEach(({ name, value, options }) =>
            response.cookies.set(name, value, options)
          );
        },
      },
    }
  );

  // getClaims() plutôt que getUser() : les jetons de ce projet sont signés en
  // ES256, la signature se vérifie en local contre le JWKS (mis en cache pour
  // tout le processus). Le middleware s'exécute sur CHAQUE requête — y compris
  // les préchargements et les server actions — et ne paie donc plus d'aller-
  // retour vers Supabase Auth. Le rafraîchissement du jeton expiré a lieu
  // toujours ici : getClaims() passe par getSession(), qui renouvelle et
  // repose les cookies.
  const { data } = await supabase.auth.getClaims();
  const user = data?.claims?.sub ? data.claims : null;

  const path = request.nextUrl.pathname;
  const isPublic = PUBLIC_PATHS.some((p) => path.startsWith(p));

  if (!user && !isPublic) {
    const url = request.nextUrl.clone();
    url.pathname = "/login";
    url.searchParams.set("suivant", path);
    return NextResponse.redirect(url);
  }

  if (user && path === "/login") {
    const url = request.nextUrl.clone();
    url.pathname = "/dashboard";
    url.search = "";
    return NextResponse.redirect(url);
  }

  // Le DERNIER périmètre choisi (« Moi », « Toute l'équipe », un membre) se
  // mémorise ici pour un chargement COMPLET de la page (lien ouvert, onglet
  // neuf). Jamais sur une navigation RSC (en-tête `rsc`) : une réponse qui
  // porte un `Set-Cookie` n'est pas resservie par le cache du routeur, et
  // chaque bascule de périmètre refaisait un rendu serveur — c'est le
  // navigateur qui s'en charge alors (`MemoirePerimetre`, 27/10). Ce n'est
  // qu'un rappel : la valeur repasse par `lirePerimetre`, qui la valide comme
  // une URL (lib/crm/perimetre.ts).
  const choisi = perimetreAMemoriser(path, request.nextUrl.searchParams.get("perimetre"));
  // Un chargement COMPLET : le navigateur le dit (`Sec-Fetch-Dest: document`).
  // L'en-tête `rsc` d'une navigation, lui, n'arrive PAS jusqu'ici (Next le
  // retire avant le middleware) — vérifié le 27/10, il ne peut pas servir.
  const destination = request.headers.get("sec-fetch-dest");
  const chargementComplet =
    destination === "document" ||
    (destination === null && (request.headers.get("accept") ?? "").includes("text/html"));
  if (
    user &&
    choisi &&
    chargementComplet &&
    request.cookies.get(PERIMETRE_COOKIE)?.value !== choisi
  ) {
    response.cookies.set(PERIMETRE_COOKIE, choisi, {
      path: "/",
      httpOnly: false,
      sameSite: "lax",
      secure: request.nextUrl.protocol === "https:",
      maxAge: 60 * 60 * 24 * 365,
    });
  }

  return response;
}

export const config = {
  matcher: [
    "/((?!_next/static|_next/image|favicon.ico|mcp|sse|message|api/oauth|api/appels-ia/tick|api/appels-ia/outils|api/appels-ia/fin|\\.well-known|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)",
  ],
};
