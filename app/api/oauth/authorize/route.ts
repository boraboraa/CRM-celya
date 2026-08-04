import {
  getClient,
  createAuthCode,
  authenticateAdmin,
  SCOPE,
} from "@/lib/mcp/oauth";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

// ---------------------------------------------------------------------------
// Rendu — page de connexion aux couleurs Celya (thème sombre).
// ---------------------------------------------------------------------------

const esc = (s: string) =>
  s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");

type AuthParams = {
  client_id: string;
  redirect_uri: string;
  state: string;
  code_challenge: string;
  code_challenge_method: string;
  scope: string;
  resource: string;
};

function hidden(params: AuthParams): string {
  return (Object.keys(params) as (keyof AuthParams)[])
    .map((k) => `<input type="hidden" name="${k}" value="${esc(params[k])}" />`)
    .join("\n");
}

function page(body: string, status = 200): Response {
  const html = `<!doctype html>
<html lang="fr"><head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>Celya CRM — Connecteur</title>
<style>
  :root { color-scheme: dark; }
  * { box-sizing: border-box; }
  body { margin:0; min-height:100vh; display:grid; place-items:center; font-family: ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, sans-serif; background:#0A0E1A; color:#E2E8F0; padding:24px; }
  .card { width:100%; max-width:400px; background:rgba(255,255,255,.03); border:1px solid rgba(255,255,255,.08); border-radius:16px; padding:28px; }
  .brand { font-weight:700; font-size:20px; background:linear-gradient(90deg,#22D3EE,#4F7BFF,#A855F7); -webkit-background-clip:text; background-clip:text; color:transparent; }
  h1 { font-size:16px; font-weight:600; margin:16px 0 4px; }
  p.sub { color:#94A3B8; font-size:13px; margin:0 0 20px; }
  label { display:block; font-size:12px; color:#94A3B8; margin:14px 0 6px; }
  input[type=email], input[type=password] { width:100%; padding:10px 12px; border-radius:10px; border:1px solid rgba(255,255,255,.1); background:rgba(255,255,255,.04); color:#E2E8F0; font-size:14px; }
  input:focus { outline:none; border-color:#4F7BFF; }
  button { width:100%; margin-top:22px; padding:11px; border:0; border-radius:10px; font-size:14px; font-weight:600; color:#0A0E1A; cursor:pointer; background:linear-gradient(90deg,#22D3EE,#4F7BFF,#A855F7); }
  .err { margin-top:16px; padding:10px 12px; border-radius:10px; background:rgba(244,63,94,.12); border:1px solid rgba(244,63,94,.3); color:#FDA4AF; font-size:13px; }
  .foot { margin-top:18px; font-size:11px; color:#64748B; line-height:1.5; }
</style>
</head><body><div class="card">${body}</div></body></html>`;
  return new Response(html, {
    status,
    headers: { "content-type": "text/html; charset=utf-8" },
  });
}

function loginPage(params: AuthParams, error?: string): Response {
  return page(`
    <div class="brand">Celya CRM</div>
    <h1>Autoriser le connecteur</h1>
    <p class="sub">Connectez-vous pour lier Claude à votre CRM. Prospection Celya — prospects, statuts, relances.</p>
    ${error ? `<div class="err">${esc(error)}</div>` : ""}
    <form method="post">
      ${hidden(params)}
      <label for="email">Email</label>
      <input id="email" name="email" type="email" autocomplete="username" required autofocus />
      <label for="password">Mot de passe</label>
      <input id="password" name="password" type="password" autocomplete="current-password" required />
      <button type="submit">Autoriser l'accès</button>
    </form>
    <p class="foot">Réservé au compte administrateur. Le connecteur n'accède qu'aux prospects, activités, relances et emails du CRM — jamais à la comptabilité, jamais au SQL libre.</p>
  `);
}

function errorPage(message: string): Response {
  return page(
    `<div class="brand">Celya CRM</div><h1>Requête invalide</h1><p class="sub">${esc(
      message
    )}</p>`,
    400
  );
}

// ---------------------------------------------------------------------------
// Validation commune GET/POST.
// ---------------------------------------------------------------------------

async function validate(
  get: (k: string) => string | null
): Promise<{ params: AuthParams } | { error: string }> {
  const client_id = get("client_id") ?? "";
  const redirect_uri = get("redirect_uri") ?? "";
  const response_type = get("response_type") ?? "";
  const code_challenge = get("code_challenge") ?? "";
  const code_challenge_method = get("code_challenge_method") ?? "S256";

  if (!client_id || !redirect_uri) return { error: "client_id et redirect_uri requis." };
  if (response_type !== "code") return { error: "response_type doit valoir « code »." };
  if (!code_challenge) return { error: "PKCE requis (code_challenge manquant)." };
  if (code_challenge_method !== "S256")
    return { error: "Seul le PKCE S256 est accepté." };

  const client = await getClient(client_id);
  if (!client) return { error: "Client inconnu. Réenregistrez le connecteur." };
  if (!client.redirect_uris.includes(redirect_uri))
    return { error: "redirect_uri non autorisé pour ce client." };

  return {
    params: {
      client_id,
      redirect_uri,
      state: get("state") ?? "",
      code_challenge,
      code_challenge_method,
      scope: get("scope") || SCOPE,
      resource: get("resource") ?? "",
    },
  };
}

// ---------------------------------------------------------------------------
// GET — affiche la page de connexion.
// ---------------------------------------------------------------------------

export async function GET(req: Request) {
  const url = new URL(req.url);
  const v = await validate((k) => url.searchParams.get(k));
  if ("error" in v) return errorPage(v.error);
  return loginPage(v.params);
}

// ---------------------------------------------------------------------------
// POST — authentifie et délivre un code d'autorisation.
// ---------------------------------------------------------------------------

export async function POST(req: Request) {
  const form = await req.formData();
  const get = (k: string) => {
    const val = form.get(k);
    return typeof val === "string" ? val : null;
  };

  const v = await validate(get);
  if ("error" in v) return errorPage(v.error);
  const { params } = v;

  const email = (get("email") ?? "").trim();
  const password = get("password") ?? "";
  if (!email || !password) return loginPage(params, "Email et mot de passe requis.");

  const auth = await authenticateAdmin(email, password);
  if ("error" in auth) return loginPage(params, auth.error);

  const code = await createAuthCode({
    client_id: params.client_id,
    redirect_uri: params.redirect_uri,
    code_challenge: params.code_challenge,
    scope: params.scope,
    resource: params.resource || null,
    user_id: auth.userId,
  });

  const redirect = new URL(params.redirect_uri);
  redirect.searchParams.set("code", code);
  if (params.state) redirect.searchParams.set("state", params.state);

  return new Response(null, { status: 302, headers: { Location: redirect.toString() } });
}
