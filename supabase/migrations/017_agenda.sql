-- ============================================================
-- 017 — L'agenda : la table `meetings` (31 août 2026)
--
-- Il n'existait AUCUN agenda : le seul objet daté était `tasks`, qui n'a
-- qu'une échéance — pas de durée, pas de lieu, pas de statut « reporté »,
-- et pas d'existence sans prospect. Résultat mesuré : 38 tâches toutes à
-- 09:00 pile, zéro activité `rendez_vous` — l'heure d'un rendez-vous n'a
-- jamais été enregistrée, et un RDV dicté le 31/08 a été perdu.
--
-- `meetings` porte le rendez-vous comme un objet à part entière : début ET
-- fin, lieu, statut (prévu / confirmé / honoré / annulé / reporté), et
-- `debriefed_at` — la boucle de débrief que le produit n'avait pas. Bora y
-- met aussi ses rendez-vous PERSONNELS (kind 'perso', sans prospect).
--
-- Migration ADDITIVE : rien n'est renommé ni supprimé, le code déjà en
-- production ne connaît pas cette table et continue de fonctionner tel quel
-- (règle « ordre migration ↔ déploiement », voir CLAUDE.md).
-- ============================================================

create type meeting_kind as enum ('prospect','perso');
create type meeting_status as enum ('prevu','confirme','honore','annule','reporte');

create table public.meetings (
  id           uuid primary key default gen_random_uuid(),
  owner_id     uuid not null references crm_users(id),
  prospect_id  uuid references prospects(id) on delete set null,
  kind         meeting_kind not null default 'prospect',
  title        text not null,
  starts_at    timestamptz not null,
  ends_at      timestamptz not null,
  location     text,
  notes        text,
  status       meeting_status not null default 'prevu',
  debriefed_at timestamptz,
  created_by   uuid references crm_users(id),
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  constraint meetings_duree check (ends_at > starts_at),
  constraint meetings_coherence check (kind <> 'prospect' or prospect_id is not null)
);
create index on meetings (owner_id, starts_at);
create index on meetings (prospect_id);

create trigger trg_meetings_updated
  before update on public.meetings
  for each row execute function public.touch_updated_at();

-- Même règle que les prospects : chacun le sien, l'admin voit tout.
alter table meetings enable row level security;
create policy meetings_select on meetings for select
  using (is_member() and (is_admin() or owner_id = auth.uid()));
create policy meetings_insert on meetings for insert
  with check (is_member() and owner_id = auth.uid());
create policy meetings_update on meetings for update
  using (is_admin() or owner_id = auth.uid()) with check (is_member());
create policy meetings_delete on meetings for delete
  using (is_admin() or owner_id = auth.uid());

revoke all on public.meetings from public, anon;

-- Un rendez-vous PERSONNEL n'expose que son créneau aux autres. Rémi est agent
-- commercial INDÉPENDANT, sans lien de subordination : lire l'intitulé de ses
-- rendez-vous privés est un élément de requalification de la relation.
-- L'admin voit qu'il est occupé, pas pourquoi.
--
-- security_invoker : la RLS de `meetings` s'applique au lecteur — un
-- commercial ne voit que ses propres rendez-vous, l'admin voit les créneaux
-- de tous. TOUTE LECTURE de l'application passe par cette vue ; les écritures
-- vont sur `meetings`.
create view public.meetings_visibles with (security_invoker = true) as
select m.id, m.owner_id, m.starts_at, m.ends_at, m.status, m.kind, m.debriefed_at,
  case when m.kind='perso' and m.owner_id <> auth.uid() then 'Occupé' else m.title end       as title,
  case when m.kind='perso' and m.owner_id <> auth.uid() then null else m.location end        as location,
  case when m.kind='perso' and m.owner_id <> auth.uid() then null else m.notes end           as notes,
  case when m.kind='perso' and m.owner_id <> auth.uid() then null else m.prospect_id end     as prospect_id
from public.meetings m;

comment on view public.meetings_visibles is
  'Lecture de l''agenda : les rendez-vous perso des AUTRES sont réduits à « Occupé » '
  '(ni lieu, ni notes, ni prospect). Vue security_invoker : la RLS de meetings s''applique.';

revoke all on public.meetings_visibles from public, anon;
grant select on public.meetings_visibles to authenticated;
