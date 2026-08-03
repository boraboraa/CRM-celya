-- ============================================================
-- Celya CRM — simplification : trois écrans, six étapes, la date décide
-- 1. prospect_status réduit à six valeurs (sans_reponse / contact_etabli /
--    rappel_programme → contacte, rdv → rendez_vous)
-- 2. activity_type réduit à note / email / rendez_vous
-- 3. Colonnes de la mécanique téléphonique supprimées
--
-- Renommage d'enum = incompatible avec l'ancien code par nature : cette
-- migration s'applique dans le même geste que le déploiement du code
-- (le code, rétro-tolérant en lecture via normalizeStatus, part en premier).
-- ============================================================

-- ---------- 1. Statuts ----------
create type public.prospect_status_new as enum
  ('a_appeler','contacte','rendez_vous','proposition','gagne','perdu');

alter table public.prospects alter column status drop default;
alter table public.prospects alter column status type public.prospect_status_new
  using (case status::text
           when 'sans_reponse'     then 'contacte'
           when 'contact_etabli'   then 'contacte'
           when 'rappel_programme' then 'contacte'
           when 'rdv'              then 'rendez_vous'
           else status::text
         end)::public.prospect_status_new;
alter table public.prospects alter column status set default 'a_appeler';

drop type public.prospect_status;
alter type public.prospect_status_new rename to prospect_status;

-- ---------- 2. Types d'échange ----------
-- appel, reunion, whatsapp, linkedin → note (le texte est conservé).
create type public.activity_type_new as enum ('note','email','rendez_vous');

alter table public.activities alter column "type" drop default;
alter table public.activities alter column "type" type public.activity_type_new
  using (case "type"::text
           when 'email' then 'email'
           else 'note'
         end)::public.activity_type_new;
alter table public.activities alter column "type" set default 'note';

drop type public.activity_type;
alter type public.activity_type_new rename to activity_type;

-- ---------- 3. Mécanique téléphonique ----------
alter table public.prospects
  drop column call_attempts,
  drop column last_outcome,
  drop column last_call_slot;
