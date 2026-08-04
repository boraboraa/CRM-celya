-- ============================================================
-- Celya CRM — serveur OAuth du connecteur MCP « Celya CRM »
-- ============================================================
-- Le connecteur personnalisé de Claude exige un flux OAuth (jeton Bearer non
-- configurable proprement dans son UI). Ces trois tables portent l'état du
-- serveur d'autorisation minimal servi par l'app Next.js (app/api/oauth).
--
-- Sécurité : RLS activée SANS AUCUNE POLICY — exactement comme email_accounts.
-- Elles sont donc fermées à anon et authenticated ; seul le service_role (les
-- routes serveur OAuth) y accède. Ne PAS « corriger » l'absence de policy :
-- l'ajouter ouvrirait ces tables, qui contiennent codes et jetons de rafraîchis-
-- sement. (Voir la note email_accounts dans CLAUDE.md.)

-- Clients enregistrés dynamiquement (Dynamic Client Registration, RFC 7591).
create table if not exists public.mcp_oauth_clients (
  client_id     text primary key,
  client_name   text,
  redirect_uris text[] not null default '{}',
  created_at    timestamptz not null default now()
);

-- Codes d'autorisation (usage unique, courte durée, liés à un PKCE).
create table if not exists public.mcp_oauth_codes (
  code                  text primary key,
  client_id             text not null,
  redirect_uri          text not null,
  code_challenge        text not null,
  code_challenge_method text not null default 'S256',
  scope                 text,
  resource              text,
  user_id               uuid not null,
  expires_at            timestamptz not null,
  created_at            timestamptz not null default now()
);

-- Jetons de rafraîchissement (les jetons d'accès sont des JWT sans état).
create table if not exists public.mcp_oauth_tokens (
  id            uuid primary key default gen_random_uuid(),
  refresh_token text unique not null,
  client_id     text not null,
  user_id       uuid not null,
  scope         text,
  resource      text,
  revoked       boolean not null default false,
  expires_at    timestamptz not null,
  created_at    timestamptz not null default now()
);

create index if not exists mcp_oauth_codes_expiry_idx  on public.mcp_oauth_codes(expires_at);
create index if not exists mcp_oauth_tokens_refresh_idx on public.mcp_oauth_tokens(refresh_token);

-- RLS activée, aucune policy : fermées à tous les rôles clients.
alter table public.mcp_oauth_clients enable row level security;
alter table public.mcp_oauth_codes   enable row level security;
alter table public.mcp_oauth_tokens  enable row level security;

-- Par prudence, on retire tout privilège éventuel des rôles clients.
revoke all on public.mcp_oauth_clients from anon, authenticated;
revoke all on public.mcp_oauth_codes   from anon, authenticated;
revoke all on public.mcp_oauth_tokens  from anon, authenticated;
