-- ============================================================
-- Celya CRM — l'étape suit les faits, pas le texte
--
-- Le 4 août, un prospect s'est retrouvé en « Rendez-vous » sans qu'aucun
-- rendez-vous ne soit posé : l'étape était déduite en lisant des mots dans
-- les notes. Elle se déduit désormais de faits vérifiables uniquement, et
-- l'humain garde le dernier mot (verrou).
--
-- Migration ADDITIVE : le code déjà en production ignore ces colonnes et
-- continue de fonctionner (règle d'ordre migration ↔ déploiement de CLAUDE.md).
-- ============================================================

-- ---------- 1. Le verrou : l'humain a toujours le dernier mot ----------
-- Passé à vrai dès que Bora fixe une étape à la main (glisser-déposer,
-- sélecteur de la fiche, connecteur MCP). Tant qu'il est vrai,
-- l'auto-classification ne réécrit JAMAIS le statut : au mieux elle suggère.
alter table public.prospects
  add column if not exists status_locked    boolean not null default false,
  add column if not exists status_locked_at timestamptz;

-- ---------- 2. La traçabilité : pourquoi l'étape a bougé ----------
-- Chaque avancement automatique inscrit son événement déclencheur, affiché
-- sur la fiche. Un changement manuel les remet à null.
alter table public.prospects
  add column if not exists status_auto_reason text,
  add column if not exists status_auto_at     timestamptz;

-- ---------- 3. Le signal explicite d'une proposition ----------
-- « proposition » ne se devine pas dans le texte : il faut un geste explicite
-- (case « j'ai envoyé une proposition / un devis »). En cas de doute, rien
-- ne bouge.
alter table public.prospects
  add column if not exists proposal_sent_at timestamptz;

-- ---------- 4. Une note atteste-t-elle d'un échange réel ? ----------
-- Un email envoyé/reçu et un rendez-vous daté sont des faits forts, lisibles
-- sans interprétation. Une note, elle, peut être un simple repérage
-- (« prospect à haut potentiel ») autant qu'un compte rendu d'appel — seul
-- l'auteur le sait. La case « j'ai eu cet échange » tranche.
--   · défaut true  : la saisie humaine passe par « Noter un échange »
--   · le connecteur MCP, lui, doit le déclarer explicitement (défaut false
--     côté outil) — c'est ainsi qu'une note de repérage écrite par Claude ne
--     fait plus passer une fiche en « Contacté ».
alter table public.activities
  add column if not exists is_exchange boolean not null default true;

-- Les notes déjà en base n'attestent de rien : on ne peut pas le savoir après
-- coup, et le CRM n'invente jamais un contact. Direction conservatrice.
update public.activities
   set is_exchange = false
 where type = 'note';

-- ---------- 5. Les brouillons ne sont pas des échanges ----------
-- Un brouillon d'email jamais envoyé polluait la chronologie et comptait à
-- tort comme un fait. La colonne sort ces entrées du journal (l'espace
-- « Brouillons » dédié arrive avec le chantier 4) et les exclut des faits.
alter table public.activities
  add column if not exists is_draft boolean not null default false;

-- Reprise des brouillons existants : marqués, jamais supprimés (Bora les
-- supprimera d'un clic depuis la fiche s'il le souhaite).
update public.activities
   set is_draft = true
 where not is_draft
   and (subject ilike 'BROUILLON%' or body like '⚠️ BROUILLON%');

create index if not exists activities_journal_idx
  on public.activities(prospect_id, occurred_at desc)
  where not is_draft;

-- Un brouillon ne doit pas non plus faire croire à un contact : le trigger
-- qui remonte prospects.last_contact_at l'ignore désormais.
-- (Rappel CLAUDE.md : le corps d'une fonction plpgsql est du texte brut — il
--  vise bien « prospects », renommée depuis « clients ».)
create or replace function public.bump_last_contact()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if coalesce(new.is_draft, false) then
    return new;
  end if;

  update public.prospects
     set last_contact_at = greatest(coalesce(last_contact_at, new.occurred_at), new.occurred_at)
   where id = new.prospect_id;
  return new;
end $$;

-- ============================================================
-- 6. Ré-évaluation des fiches existantes mal classées
--
-- Opération UNIQUE, et à ce titre la seule autorisée à faire RECULER une
-- étape : elle corrige un classement produit par l'ancienne lecture de texte.
-- La règle permanente, elle, n'avance jamais que vers l'avant (lib/crm/status.ts).
--
-- Garde-fous : « Gagné » et « Perdu » ne sont jamais touchés (décisions
-- humaines irréversibles), et rien n'est verrouillé — si un rendez-vous
-- existe pour de vrai, un simple glisser le remet, et ce glisser verrouille.
-- ============================================================

with faits as (
  select
    p.id,
    p.status,

    -- Rendez-vous : une activité « rendez_vous » réellement enregistrée, ou
    -- une relance « RDV avec … » ouverte (la tâche que pose la fiche quand on
    -- date un rendez-vous). Jamais la lecture d'un « RDV » en texte libre.
    (
      exists (
        select 1 from public.activities a
         where a.prospect_id = p.id and not a.is_draft and a.type = 'rendez_vous'
      )
      or exists (
        select 1 from public.tasks t
         where t.prospect_id = p.id and t.status = 'a_faire' and t.title like 'RDV%'
      )
    ) as a_rdv,

    -- Échange réel : email envoyé ou reçu, rendez-vous, ou note attestée.
    (
      exists (
        select 1 from public.activities a
         where a.prospect_id = p.id and not a.is_draft
           and (a.type in ('email', 'rendez_vous') or a.is_exchange)
      )
      or exists (select 1 from public.emails e where e.prospect_id = p.id)
    ) as a_echange,

    (p.proposal_sent_at is not null) as a_proposition
  from public.prospects p
  where p.status not in ('gagne', 'perdu')
    and not p.status_locked
),
cible as (
  select
    id,
    status,
    case
      when a_proposition then 'proposition'::public.prospect_status
      when a_rdv         then 'rendez_vous'::public.prospect_status
      when a_echange     then 'contacte'::public.prospect_status
      else                    'a_appeler'::public.prospect_status
    end as nouvelle_etape,
    case
      when a_proposition then 'Une proposition a été marquée envoyée.'
      when a_rdv         then 'Un rendez-vous est enregistré sur la fiche.'
      when a_echange     then 'Au moins un échange réel est enregistré (email ou note d''appel).'
      else                    'Aucun échange enregistré à ce jour.'
    end as motif
  from faits
)
update public.prospects p
   set status             = c.nouvelle_etape,
       status_auto_reason = 'Ré-évaluation du 4 août (étape fondée sur les faits) : '
                            || c.motif,
       status_auto_at     = now()
  from cible c
 where p.id = c.id
   and p.status is distinct from c.nouvelle_etape;
