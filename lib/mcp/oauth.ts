/**
 * Serveur d'autorisation OAuth 2.1 minimal mais conforme, pour le connecteur
 * MCP « Celya CRM ». Un seul utilisateur (Bora, l'administrateur), donc le flux
 * est réduit à l'essentiel : découverte → enregistrement dynamique (DCR) →
 * autorisation avec PKCE → jeton Bearer.
 *
 * L'identité s'appuie sur Supabase Auth : Bora se connecte avec son email et
 * son mot de passe habituels sur la page d'autorisation ; on ne délivre un
 * jeton qu'à un compte crm_users actif ET admin — car le connecteur agit en
 * service_role (contournant la RLS), il ne doit jamais être ouvert à un
 * commercial qui verrait alors tous les prospects.
 */

import { randomBytes, createHash, timingSafeEqual } from "crypto";
import { createClient } from "@supabase/supabase-js";
import { getPublicOrigin } from "mcp-handler";
import { SUPABASE_URL, SUPABASE_ANON_KEY } from "@/lib/env";
import { createAdminClient } from "@/lib/supabase/admin";
import { signJwt } from "./jwt";

export const SCOPE = "crm";
export const ACCESS_TTL = 3600; // 1 h
const CODE_TTL_MS = 10 * 60 * 1000; // 10 min
const REFRESH_TTL_MS = 90 * 24 * 3600 * 1000; // 90 jours

// --- Origine et points d'entrée (dérivés dynamiquement, proxy Vercel inclus) ---

export function issuerFromRequest(req: Request): string {
  return getPublicOrigin(req);
}

/** Le chemin du serveur MCP : c'est l'URL que Bora colle dans Claude. */
export const MCP_PATH = "/mcp";

export function mcpResourceUrl(issuer: string): string {
  return `${issuer}${MCP_PATH}`;
}

export function authServerMetadata(issuer: string) {
  return {
    issuer,
    authorization_endpoint: `${issuer}/api/oauth/authorize`,
    token_endpoint: `${issuer}/api/oauth/token`,
    registration_endpoint: `${issuer}/api/oauth/register`,
    response_types_supported: ["code"],
    grant_types_supported: ["authorization_code", "refresh_token"],
    code_challenge_methods_supported: ["S256"],
    token_endpoint_auth_methods_supported: ["none"],
    scopes_supported: [SCOPE],
  };
}

// --- PKCE ---

export function verifyPkce(verifier: string, challenge: string): boolean {
  if (!verifier || !challenge) return false;
  const computed = createHash("sha256").update(verifier).digest("base64url");
  const a = Buffer.from(computed);
  const b = Buffer.from(challenge);
  return a.length === b.length && timingSafeEqual(a, b);
}

const rand = (bytes = 32) => randomBytes(bytes).toString("base64url");

// --- Clients (DCR) ---

export type OAuthClient = {
  client_id: string;
  client_name: string | null;
  redirect_uris: string[];
};

export async function registerClient(input: {
  client_name?: string | null;
  redirect_uris: string[];
}): Promise<OAuthClient> {
  const admin = createAdminClient();
  const client_id = `mcp_${rand(18)}`;
  const { error } = await admin.from("mcp_oauth_clients").insert({
    client_id,
    client_name: input.client_name ?? null,
    redirect_uris: input.redirect_uris,
  });
  if (error) throw new Error(error.message);
  return { client_id, client_name: input.client_name ?? null, redirect_uris: input.redirect_uris };
}

export async function getClient(client_id: string): Promise<OAuthClient | null> {
  const admin = createAdminClient();
  const { data } = await admin
    .from("mcp_oauth_clients")
    .select("client_id, client_name, redirect_uris")
    .eq("client_id", client_id)
    .maybeSingle();
  return (data as OAuthClient) ?? null;
}

// --- Codes d'autorisation (usage unique) ---

export async function createAuthCode(input: {
  client_id: string;
  redirect_uri: string;
  code_challenge: string;
  scope: string;
  resource: string | null;
  user_id: string;
}): Promise<string> {
  const admin = createAdminClient();
  const code = rand(32);
  const { error } = await admin.from("mcp_oauth_codes").insert({
    code,
    client_id: input.client_id,
    redirect_uri: input.redirect_uri,
    code_challenge: input.code_challenge,
    code_challenge_method: "S256",
    scope: input.scope,
    resource: input.resource,
    user_id: input.user_id,
    expires_at: new Date(Date.now() + CODE_TTL_MS).toISOString(),
  });
  if (error) throw new Error(error.message);
  return code;
}

export type AuthCodeRow = {
  code: string;
  client_id: string;
  redirect_uri: string;
  code_challenge: string;
  scope: string | null;
  resource: string | null;
  user_id: string;
  expires_at: string;
};

/** Récupère ET supprime le code (usage unique). Renvoie null si absent/expiré. */
export async function consumeAuthCode(code: string): Promise<AuthCodeRow | null> {
  const admin = createAdminClient();
  const { data } = await admin
    .from("mcp_oauth_codes")
    .select("*")
    .eq("code", code)
    .maybeSingle();
  if (!data) return null;
  await admin.from("mcp_oauth_codes").delete().eq("code", code);
  const row = data as AuthCodeRow;
  if (new Date(row.expires_at).getTime() < Date.now()) return null;
  return row;
}

// --- Jetons ---

export async function issueAccessToken(input: {
  issuer: string;
  user_id: string;
  client_id: string;
  scope: string;
  resource: string | null;
}): Promise<string> {
  const now = Math.floor(Date.now() / 1000);
  return signJwt({
    iss: input.issuer,
    sub: input.user_id,
    aud: input.resource ?? mcpResourceUrl(input.issuer),
    scope: input.scope,
    client_id: input.client_id,
    iat: now,
    exp: now + ACCESS_TTL,
  });
}

export async function createRefreshToken(input: {
  client_id: string;
  user_id: string;
  scope: string;
  resource: string | null;
}): Promise<string> {
  const admin = createAdminClient();
  const refresh_token = rand(40);
  const { error } = await admin.from("mcp_oauth_tokens").insert({
    refresh_token,
    client_id: input.client_id,
    user_id: input.user_id,
    scope: input.scope,
    resource: input.resource,
    expires_at: new Date(Date.now() + REFRESH_TTL_MS).toISOString(),
  });
  if (error) throw new Error(error.message);
  return refresh_token;
}

export type RefreshRow = {
  refresh_token: string;
  client_id: string;
  user_id: string;
  scope: string | null;
  resource: string | null;
  revoked: boolean;
  expires_at: string;
};

export async function getRefreshToken(token: string): Promise<RefreshRow | null> {
  const admin = createAdminClient();
  const { data } = await admin
    .from("mcp_oauth_tokens")
    .select("*")
    .eq("refresh_token", token)
    .maybeSingle();
  if (!data) return null;
  const row = data as RefreshRow;
  if (row.revoked) return null;
  if (new Date(row.expires_at).getTime() < Date.now()) return null;
  return row;
}

// --- Identité : Supabase Auth + garde-fou admin ---

/**
 * Vérifie les identifiants Supabase de Bora, puis exige un compte crm_users
 * actif ET admin. Le connecteur agit en service_role (RLS contournée) : il ne
 * doit s'ouvrir qu'à l'administrateur, jamais à un commercial.
 */
export async function authenticateAdmin(
  email: string,
  password: string
): Promise<{ userId: string } | { error: string }> {
  const anon = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { data, error } = await anon.auth.signInWithPassword({ email, password });
  if (error || !data.user) return { error: "Email ou mot de passe incorrect." };

  const admin = createAdminClient();
  const { data: me } = await admin
    .from("crm_users")
    .select("is_active, role")
    .eq("id", data.user.id)
    .maybeSingle();

  if (!me || !me.is_active || me.role !== "admin") {
    return {
      error: "Accès refusé : le connecteur Celya CRM est réservé à l'administrateur.",
    };
  }
  return { userId: data.user.id };
}
