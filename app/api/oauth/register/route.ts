import { registerClient } from "@/lib/mcp/oauth";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "*",
};

/**
 * Enregistrement dynamique de client (RFC 7591). Claude s'enregistre ici avant
 * l'autorisation. Client public (PKCE) : pas de secret, auth « none ».
 */
export async function POST(req: Request) {
  let body: Record<string, unknown> = {};
  try {
    body = await req.json();
  } catch {
    return Response.json(
      { error: "invalid_client_metadata", error_description: "Corps JSON attendu." },
      { status: 400, headers: CORS }
    );
  }

  const uris = body.redirect_uris;
  const redirect_uris = Array.isArray(uris)
    ? uris.filter((u): u is string => typeof u === "string" && /^https?:\/\//.test(u))
    : [];

  if (redirect_uris.length === 0) {
    return Response.json(
      {
        error: "invalid_redirect_uri",
        error_description: "Au moins un redirect_uri https est requis.",
      },
      { status: 400, headers: CORS }
    );
  }

  const client_name =
    typeof body.client_name === "string" ? body.client_name.slice(0, 200) : null;

  const client = await registerClient({ client_name, redirect_uris });

  return Response.json(
    {
      client_id: client.client_id,
      client_name: client.client_name,
      redirect_uris: client.redirect_uris,
      grant_types: ["authorization_code", "refresh_token"],
      response_types: ["code"],
      token_endpoint_auth_method: "none",
    },
    { status: 201, headers: CORS }
  );
}

export function OPTIONS() {
  return new Response(null, { status: 204, headers: CORS });
}
