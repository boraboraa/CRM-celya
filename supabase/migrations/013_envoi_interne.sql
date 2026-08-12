-- ============================================================
-- Celya CRM — envoi d'email serveur-à-serveur (connecteur MCP → crm-mail)
--
-- Le connecteur MCP s'authentifie avec un JWT HS256 signé par l'app (lib/mcp/
-- jwt.ts). Supabase Auth ne sait évidemment pas le vérifier : `case "send"` de
-- l'edge function crm-mail, qui exige un JWT Supabase, rejetait donc tout appel
-- venu du connecteur. Un outil MCP ne pouvait pas envoyer d'email.
--
-- Même solution que pour la relève planifiée (005) : un secret partagé dans le
-- Vault, lisible par le seul service_role. Le serveur MCP (qui agit déjà en
-- service_role) le lit et le présente en en-tête `x-internal-secret` ; l'edge
-- function accepte alors `payload.user_id` comme appelant.
--
-- Le secret AUTHENTIFIE, il n'AUTORISE pas : le contrôle d'accès au prospect
-- (admin, propriétaire, ou vivier — la règle de can_see_prospect) reste
-- appliqué à l'identique côté edge function, sur le rôle de cet utilisateur.
--
-- Migration additive et idempotente : rien à déployer avant elle.
-- ============================================================

do $$
begin
  if not exists (select 1 from vault.secrets where name = 'crm_mail_internal_secret') then
    perform vault.create_secret(
      encode(gen_random_bytes(32), 'hex'),
      'crm_mail_internal_secret',
      'Secret partagé serveur-à-serveur : connecteur MCP → crm-mail (envoi d''email)'
    );
  end if;
end $$;
