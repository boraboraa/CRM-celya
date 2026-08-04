/**
 * Cœur « étape fondée sur les faits » — la règle, écrite une seule fois.
 *
 * L'étape d'un prospect n'est plus déduite en lisant des mots dans les notes
 * (c'est ainsi qu'une fiche s'est retrouvée en « Rendez-vous » sans qu'aucun
 * rendez-vous ne soit posé). Elle se déduit de faits vérifiables :
 *
 *   a_appeler    défaut — aucun échange sortant enregistré
 *   contacte     au moins un échange réel (email envoyé/reçu, note d'appel
 *                attestée, rendez-vous)
 *   rendez_vous  UNIQUEMENT une activité « rendez_vous » réellement
 *                enregistrée, ou une relance « RDV avec … » ouverte
 *   proposition  UNIQUEMENT un signal explicite (proposal_sent_at)
 *   gagne/perdu  JAMAIS automatiques — décisions humaines irréversibles
 *
 * Trois invariants :
 *   1. l'auto-classification n'avance que sur un fait non ambigu ;
 *   2. elle ne recule jamais une étape toute seule ;
 *   3. elle ne passe jamais par-dessus un choix humain (status_locked) — au
 *      mieux elle suggère, et Bora accepte ou ignore.
 *
 * Partagé par les server actions, le connecteur MCP et l'affichage de la
 * fiche : un seul jeu de règles, aucun doublon.
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import type { ProspectStatus } from "@/lib/types";
import { normalizeStatus, fmtDate } from "@/lib/constants";

/** Ordre d'avancement. « Gagné » et « Perdu » sont des fins de parcours. */
export const STATUS_RANK: Record<ProspectStatus, number> = {
  a_appeler: 0,
  contacte: 1,
  rendez_vous: 2,
  proposition: 3,
  gagne: 4,
  perdu: 4,
};

/** Étapes qui ne s'obtiennent qu'à la main, jamais par déduction. */
export const MANUAL_ONLY: ProspectStatus[] = ["gagne", "perdu"];

export function isManualOnly(status: ProspectStatus): boolean {
  return MANUAL_ONLY.includes(status);
}

// ---------------------------------------------------------------------------
// Les faits
// ---------------------------------------------------------------------------

/** Un fait daté : ce qui s'est réellement passé, et quand. */
export type Fact = { at: string; label: string };

export type ProspectFacts = {
  /** Dernier échange réel — email, note d'appel attestée, rendez-vous. */
  exchange: Fact | null;
  /** Rendez-vous réellement enregistré (activité datée ou relance « RDV … »). */
  meeting: Fact | null;
  /** Proposition explicitement marquée envoyée. */
  proposal: Fact | null;
};

export const NO_FACTS: ProspectFacts = { exchange: null, meeting: null, proposal: null };

/** Garde le fait le plus récent des deux. */
function latest(a: Fact | null, b: Fact | null): Fact | null {
  if (!a) return b;
  if (!b) return a;
  return new Date(b.at).getTime() > new Date(a.at).getTime() ? b : a;
}

/**
 * Lit les faits d'un prospect. Ne lit JAMAIS le contenu des notes — seulement
 * leur type, leur date et la case « j'ai eu cet échange ». Les brouillons sont
 * exclus : un email jamais envoyé n'est pas un échange.
 */
export async function readProspectFacts(
  supabase: SupabaseClient,
  prospectId: string
): Promise<ProspectFacts> {
  const [activitiesRes, emailsRes, tasksRes, prospectRes] = await Promise.all([
    supabase
      .from("activities")
      .select("type, occurred_at, is_exchange, is_draft")
      .eq("prospect_id", prospectId)
      .eq("is_draft", false)
      .order("occurred_at", { ascending: false })
      .limit(200),
    supabase
      .from("emails")
      .select("direction, received_at")
      .eq("prospect_id", prospectId)
      .order("received_at", { ascending: false })
      .limit(50),
    supabase
      .from("tasks")
      .select("title, due_at")
      .eq("prospect_id", prospectId)
      .eq("status", "a_faire")
      .like("title", "RDV%")
      .order("due_at", { ascending: false })
      .limit(10),
    supabase
      .from("prospects")
      .select("proposal_sent_at")
      .eq("id", prospectId)
      .maybeSingle(),
  ]);

  const facts: ProspectFacts = { exchange: null, meeting: null, proposal: null };

  for (const a of (activitiesRes.data ?? []) as {
    type: string;
    occurred_at: string;
    is_exchange: boolean | null;
    is_draft: boolean | null;
  }[]) {
    if (a.is_draft) continue;

    if (a.type === "rendez_vous") {
      facts.meeting = latest(facts.meeting, {
        at: a.occurred_at,
        label: `un rendez-vous a été enregistré le ${fmtDate(a.occurred_at)}`,
      });
      facts.exchange = latest(facts.exchange, {
        at: a.occurred_at,
        label: `un rendez-vous a été enregistré le ${fmtDate(a.occurred_at)}`,
      });
    } else if (a.type === "email") {
      facts.exchange = latest(facts.exchange, {
        at: a.occurred_at,
        label: `un email a été échangé le ${fmtDate(a.occurred_at)}`,
      });
    } else if (a.is_exchange !== false) {
      // Note attestée : « j'ai eu cet échange » était cochée.
      facts.exchange = latest(facts.exchange, {
        at: a.occurred_at,
        label: `un échange a été noté le ${fmtDate(a.occurred_at)}`,
      });
    }
  }

  for (const e of (emailsRes.data ?? []) as {
    direction: string;
    received_at: string;
  }[]) {
    facts.exchange = latest(facts.exchange, {
      at: e.received_at,
      label:
        e.direction === "entrant"
          ? `une réponse est arrivée le ${fmtDate(e.received_at)}`
          : `un email a été envoyé le ${fmtDate(e.received_at)}`,
    });
  }

  // Une relance « RDV avec … » ouverte : c'est la tâche que pose la fiche
  // quand on date un rendez-vous. Un fait, pas une lecture de texte.
  for (const t of (tasksRes.data ?? []) as { title: string; due_at: string }[]) {
    facts.meeting = latest(facts.meeting, {
      at: t.due_at,
      label: `un rendez-vous est prévu le ${fmtDate(t.due_at)}`,
    });
  }

  const proposalAt = (prospectRes.data as { proposal_sent_at: string | null } | null)
    ?.proposal_sent_at;
  if (proposalAt) {
    facts.proposal = {
      at: proposalAt,
      label: `une proposition a été marquée envoyée le ${fmtDate(proposalAt)}`,
    };
  }

  return facts;
}

// ---------------------------------------------------------------------------
// La règle
// ---------------------------------------------------------------------------

/** L'étape que les faits justifient — jamais « Gagné » ni « Perdu ». */
export function statusFromFacts(facts: ProspectFacts): ProspectStatus {
  if (facts.proposal) return "proposition";
  if (facts.meeting) return "rendez_vous";
  if (facts.exchange) return "contacte";
  return "a_appeler";
}

/** L'événement déclencheur, en clair — affiché à chaque changement auto. */
export function factReason(
  derived: ProspectStatus,
  facts: ProspectFacts
): string | null {
  if (derived === "proposition") return facts.proposal?.label ?? null;
  if (derived === "rendez_vous") return facts.meeting?.label ?? null;
  if (derived === "contacte") return facts.exchange?.label ?? null;
  return null;
}

export type StatusVerdict = {
  /** L'étape justifiée par les faits. */
  derived: ProspectStatus;
  /** Pourquoi — l'événement déclencheur. */
  reason: string | null;
  /** À écrire tout de suite (fiche non verrouillée). */
  apply: boolean;
  /** À proposer discrètement : la fiche est verrouillée, Bora tranche. */
  suggest: boolean;
};

/**
 * Confronte l'étape actuelle aux faits.
 *
 * N'avance que vers l'avant, jamais vers l'arrière ; ne touche jamais une
 * fiche Gagné/Perdu ; n'écrit jamais par-dessus un choix humain — dans ce
 * dernier cas elle suggère, et c'est tout.
 */
export function evaluateStatus(
  current: ProspectStatus,
  locked: boolean,
  facts: ProspectFacts
): StatusVerdict {
  const derived = statusFromFacts(facts);
  const reason = factReason(derived, facts);

  // Gagné / Perdu : plus rien ne bouge automatiquement.
  if (isManualOnly(current)) {
    return { derived, reason, apply: false, suggest: false };
  }
  // Ne recule jamais, et ne re-déclenche pas sur place.
  if (STATUS_RANK[derived] <= STATUS_RANK[current]) {
    return { derived, reason, apply: false, suggest: false };
  }

  return { derived, reason, apply: !locked, suggest: locked };
}

// ---------------------------------------------------------------------------
// L'écriture
// ---------------------------------------------------------------------------

export type AutoStatusResult = {
  changed: boolean;
  status?: ProspectStatus;
  reason?: string | null;
};

/**
 * Applique l'avancement automatique après un fait nouveau (échange noté,
 * email envoyé, proposition marquée). Ne fait rien si la fiche est
 * verrouillée : c'est la fiche qui affichera la suggestion.
 */
export async function applyAutoStatus(
  supabase: SupabaseClient,
  prospectId: string
): Promise<AutoStatusResult> {
  const { data } = await supabase
    .from("prospects")
    .select("id, status, status_locked")
    .eq("id", prospectId)
    .maybeSingle();
  if (!data) return { changed: false };

  const row = data as { id: string; status: string; status_locked: boolean | null };
  const facts = await readProspectFacts(supabase, prospectId);
  const verdict = evaluateStatus(
    normalizeStatus(row.status),
    Boolean(row.status_locked),
    facts
  );
  if (!verdict.apply) return { changed: false };

  const { error } = await supabase
    .from("prospects")
    .update({
      status: verdict.derived,
      status_auto_reason: verdict.reason,
      status_auto_at: new Date().toISOString(),
    })
    .eq("id", prospectId);
  if (error) return { changed: false };

  return { changed: true, status: verdict.derived, reason: verdict.reason };
}

/**
 * Le patch d'un changement d'étape DÉCIDÉ PAR UN HUMAIN : il verrouille la
 * fiche. Sans ce verrou, le système se battrait contre Bora — il corrige,
 * l'auto-classification remet l'erreur au tour suivant.
 */
export function manualStatusPatch(status: ProspectStatus): Record<string, unknown> {
  return {
    status,
    status_locked: true,
    status_locked_at: new Date().toISOString(),
    status_auto_reason: null,
    status_auto_at: null,
  };
}

/** Rendre la main à l'IA : l'étape redevient déductible des faits. */
export function unlockStatusPatch(): Record<string, unknown> {
  return { status_locked: false, status_locked_at: null };
}
