/**
 * JWT HS256 minimal — jetons d'accès sans état du connecteur MCP. Signés et
 * vérifiés par ce serveur uniquement (aucun tiers), donc HMAC symétrique suffit.
 *
 * La clé de signature dérive de MCP_OAUTH_SECRET si défini, sinon de
 * SUPABASE_SERVICE_ROLE_KEY (déjà secrète et côté serveur) — un secret de moins
 * à configurer. On la hache avec un label fixe pour la séparer de son usage
 * Supabase.
 */

import { createHmac, createHash, timingSafeEqual } from "crypto";

export type JwtClaims = {
  iss: string;
  sub: string;
  aud: string;
  scope: string;
  client_id: string;
  iat: number;
  exp: number;
};

function signingKey(): Buffer {
  const secret =
    process.env.MCP_OAUTH_SECRET || process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!secret) {
    throw new Error(
      "MCP_OAUTH_SECRET ou SUPABASE_SERVICE_ROLE_KEY requis pour signer les jetons du connecteur."
    );
  }
  return createHash("sha256").update(`mcp-oauth-v1:${secret}`).digest();
}

const b64url = (input: Buffer | string): string =>
  Buffer.from(input).toString("base64url");

export function signJwt(claims: JwtClaims): string {
  const header = b64url(JSON.stringify({ alg: "HS256", typ: "JWT" }));
  const payload = b64url(JSON.stringify(claims));
  const data = `${header}.${payload}`;
  const sig = b64url(createHmac("sha256", signingKey()).update(data).digest());
  return `${data}.${sig}`;
}

export function verifyJwt(token: string): JwtClaims | null {
  const parts = token.split(".");
  if (parts.length !== 3) return null;
  const [h, p, s] = parts;

  const expected = b64url(
    createHmac("sha256", signingKey()).update(`${h}.${p}`).digest()
  );
  const got = Buffer.from(s);
  const want = Buffer.from(expected);
  if (got.length !== want.length || !timingSafeEqual(got, want)) return null;

  let claims: JwtClaims;
  try {
    claims = JSON.parse(Buffer.from(p, "base64url").toString("utf8"));
  } catch {
    return null;
  }
  if (typeof claims.exp !== "number") return null;
  if (claims.exp < Math.floor(Date.now() / 1000)) return null; // expiré
  return claims;
}
