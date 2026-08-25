import {
  consumeAuthCode,
  getRefreshToken,
  issueAccessToken,
  createRefreshToken,
  verifyPkce,
  issuerFromRequest,
  ACCESS_TTL,
  SCOPE,
} from "@/lib/mcp/oauth";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "*",
};

const fail = (error: string, description: string, status = 400) =>
  Response.json({ error, error_description: description }, { status, headers: CORS });

export async function POST(req: Request) {
  const issuer = issuerFromRequest(req);

  let form: URLSearchParams;
  try {
    form = new URLSearchParams(await req.text());
  } catch {
    return fail("invalid_request", "Corps x-www-form-urlencoded attendu.");
  }
  const get = (k: string) => form.get(k) ?? "";
  const grant_type = get("grant_type");

  // --- authorization_code + PKCE ---
  if (grant_type === "authorization_code") {
    const code = get("code");
    const client_id = get("client_id");
    const redirect_uri = get("redirect_uri");
    const code_verifier = get("code_verifier");
    if (!code || !client_id || !code_verifier)
      return fail("invalid_request", "code, client_id et code_verifier requis.");

    const row = await consumeAuthCode(code);
    if (!row) return fail("invalid_grant", "Code invalide ou expiré.");
    if (row.client_id !== client_id)
      return fail("invalid_grant", "client_id ne correspond pas au code.");
    if (redirect_uri && row.redirect_uri !== redirect_uri)
      return fail("invalid_grant", "redirect_uri ne correspond pas au code.");
    if (!verifyPkce(code_verifier, row.code_challenge))
      return fail("invalid_grant", "Vérification PKCE échouée.");

    const scope = row.scope ?? SCOPE;
    const access_token = await issueAccessToken({
      issuer,
      user_id: row.user_id,
      client_id,
      scope,
      resource: row.resource,
    });
    const refresh_token = await createRefreshToken({
      client_id,
      user_id: row.user_id,
      scope,
      resource: row.resource,
    });

    return Response.json(
      {
        access_token,
        token_type: "Bearer",
        expires_in: ACCESS_TTL,
        refresh_token,
        scope,
      },
      { headers: { ...CORS, "Cache-Control": "no-store" } }
    );
  }

  // --- refresh_token ---
  if (grant_type === "refresh_token") {
    const refresh_token = get("refresh_token");
    const client_id = get("client_id");
    if (!refresh_token) return fail("invalid_request", "refresh_token requis.");

    const row = await getRefreshToken(refresh_token);
    if (!row) return fail("invalid_grant", "refresh_token invalide, expiré ou révoqué.");
    if (client_id && row.client_id !== client_id)
      return fail("invalid_grant", "client_id ne correspond pas au jeton.");

    const scope = row.scope ?? SCOPE;
    const access_token = await issueAccessToken({
      issuer,
      user_id: row.user_id,
      client_id: row.client_id,
      scope,
      resource: row.resource,
    });

    return Response.json(
      {
        access_token,
        token_type: "Bearer",
        expires_in: ACCESS_TTL,
        // Conservé, pas de rotation. Le compte est de toute façon relu dans
        // crm_users à chaque appel d'outil : un membre désactivé est coupé
        // immédiatement, sans attendre l'expiration de son jeton.
        refresh_token,
        scope,
      },
      { headers: { ...CORS, "Cache-Control": "no-store" } }
    );
  }

  return fail("unsupported_grant_type", `grant_type « ${grant_type} » non pris en charge.`);
}

export function OPTIONS() {
  return new Response(null, { status: 204, headers: CORS });
}
