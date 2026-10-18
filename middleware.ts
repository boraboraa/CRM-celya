import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";
import { SUPABASE_URL, SUPABASE_ANON_KEY } from "@/lib/env";
import { PAGES_PERIMETRE, PERIMETRE_COOKIE } from "@/lib/crm/perimetre";

// /login, /auth : parcours d'authentification de l'app.
// /mcp, /sse, /message : serveur MCP (auth par jeton Bearer, pas par cookie).
// /api/oauth, /.well-known : serveur d'autorisation OAuth du connecteur MCP.
// /api/appels-ia/{tick,outils,fin} : le moteur d'appels de Janet, appelé par
// pg_cron (secret du Vault) et par l'edge function annexe (signature HMAC) —
// jamais par un navigateur. /api/appels-ia/suivi et /etat restent derrière la
// session : ce sont les écrans de l'admin qui les sondent.
const PUBLIC_PATHS = [
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
  // mémorise ici — un composant serveur ne peut pas poser de cookie. Ce n'est
  // qu'un rappel : la valeur repasse par `lirePerimetre`, qui la valide comme
  // une URL (lib/crm/perimetre.ts). Longueur bornée : rien d'autre qu'un mot
  // ou un uuid n'a à y entrer.
  const choisi = request.nextUrl.searchParams.get("perimetre");
  if (
    user &&
    choisi &&
    choisi.length <= 40 &&
    PAGES_PERIMETRE.some((p) => path === p) &&
    request.cookies.get(PERIMETRE_COOKIE)?.value !== choisi
  ) {
    response.cookies.set(PERIMETRE_COOKIE, choisi, {
      path: "/",
      httpOnly: true,
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
