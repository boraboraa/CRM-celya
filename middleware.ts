import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";
import { SUPABASE_URL, SUPABASE_ANON_KEY } from "@/lib/env";

// /login, /auth : parcours d'authentification de l'app.
// /mcp, /sse, /message : serveur MCP (auth par jeton Bearer, pas par cookie).
// /api/oauth, /.well-known : serveur d'autorisation OAuth du connecteur MCP.
const PUBLIC_PATHS = [
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

  return response;
}

export const config = {
  matcher: [
    "/((?!_next/static|_next/image|favicon.ico|mcp|sse|message|api/oauth|\\.well-known|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)",
  ],
};
