-- 044 — PERDU L'EMPORTE (31/10/2026, décision de Bora : « quand le commercial
-- marque que c'est perdu, c'est le perdu qui l'emporte sur les autres, par
-- exemple à rappeler »). Une fiche perdue n'a AUCUNE relance ouverte.
--
-- Constaté le 29/10 : passer une fiche en Perdu par le menu d'étape, le
-- glisser-déposer ou le formulaire laissait sa relance ouverte (seule la
-- pastille « Pas intéressé » les annulait) — Carrosserie Jans, Mechanik
-- Slawek ; et Braine Pneus reçut une relance 51 s APRÈS son « Pas
-- intéressé ». La règle vit donc en base, pour tous les écrivains (écran,
-- MCP, tri d'un mail, Janet, SQL direct) :
--
--   1. `prospects_perdu_annule_relances` : au PASSAGE en Perdu, les relances
--      ouvertes de la fiche sont annulées (`annule`, pas supprimées : la
--      correction immédiate d'un « Pas intéressé » les rouvre — defairePerdu,
--      app/actions.ts — après avoir sorti la fiche de Perdu) ;
--   2. `tasks_pas_sur_perdue` : on ne POSE ni ne ROUVRE une relance sur une
--      fiche perdue (P0001, la phrase de REFUS_RELANCE_PERDUE,
--      lib/crm/perdues.ts). Re-dater ou cocher une relance existante n'est
--      pas visé (il n'en reste aucune après la reprise ci-dessous) ;
--   3. la reprise : les relances encore ouvertes sur des fiches perdues sont
--      annulées, une fois.
--
-- Ceci REMPLACE la règle de la 023 « une fiche perdue garde ses relances
-- (vivier à rappeler plus tard) ». Pour rappeler une fiche perdue, on la
-- sort d'abord de « Perdu ».
-- Défaire : drop trigger prospects_perdu_annule_relances on public.prospects;
--           drop trigger tasks_pas_sur_perdue on public.tasks;
-- (la reprise se défait par la liste de `reprise_044`).

create or replace function public.prospects_perdu_annule_relances()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.status::text = 'perdu' and old.status::text is distinct from 'perdu' then
    update public.tasks
       set status = 'annule'
     where prospect_id = new.id
       and status = 'a_faire';
  end if;
  return null;
end
$$;

create trigger prospects_perdu_annule_relances
  after update of status on public.prospects
  for each row execute function public.prospects_perdu_annule_relances();

create or replace function public.tasks_pas_sur_perdue()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.status = 'a_faire'
     and new.prospect_id is not null
     and (tg_op = 'INSERT'
          or old.status is distinct from new.status
          or old.prospect_id is distinct from new.prospect_id)
     and exists (select 1 from public.prospects p
                  where p.id = new.prospect_id and p.status::text = 'perdu') then
    raise exception using
      errcode = 'P0001',
      message = 'Cette fiche est perdue : choisissez d''abord une autre étape pour la relancer.';
  end if;
  return new;
end
$$;

create trigger tasks_pas_sur_perdue
  before insert or update of status, prospect_id on public.tasks
  for each row execute function public.tasks_pas_sur_perdue();

-- La reprise : une fois, avec la liste pour défaire.
create table public.reprise_044 as
select t.id as task_id, t.prospect_id, t.title, t.due_at, now() as annulee_le
  from public.tasks t
  join public.prospects p on p.id = t.prospect_id
 where p.status::text = 'perdu' and t.status = 'a_faire';

alter table public.reprise_044 add primary key (task_id);
alter table public.reprise_044 enable row level security;
revoke all on public.reprise_044 from anon, authenticated;
comment on table public.reprise_044 is
  'Relances ouvertes sur des fiches perdues, annulées par la 044 (31/10/2026). RLS fermée. À supprimer une fois validée par Bora.';

update public.tasks t
   set status = 'annule'
  from public.reprise_044 r
 where r.task_id = t.id;
