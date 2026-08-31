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
 *                enregistrée, ou un rendez-vous À VENIR (non annulé) dans
 *                l'agenda (meetings)
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
import { normalizeStatus, fmtDate, fmtDateTime } from "@/lib/constants";

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

/** Les lignes brutes dont les faits se déduisent — rien d'autre. */
export type FactRows = {
  /** Activités du prospect, brouillons compris (ils sont écartés ici). */
  activities: {
    type: string;
    occurred_at: string;
    is_exchange: boolean | null;
    is_draft: boolean | null;
  }[];
  emails: { direction: string; received_at: string }[];
  /** Rendez-vous de la fiche (agenda) — le filtre « à venir, non annulé »
   *  est appliqué ici, pas chez l'appelant. */
  meetings: { starts_at: string; status: string }[];
  proposalSentAt: string | null;
};

/**
 * Déduit les faits de lignes DÉJÀ lues. Fonction pure : c'est elle qui porte
 * la règle, `readProspectFacts` n'est plus qu'un lecteur.
 *
 * Sépare la règle de la lecture pour que la fiche prospect, qui a déjà chargé
 * activités, emails et relances pour l'affichage, n'aille pas les redemander
 * une deuxième fois (c'étaient quatre allers-retours de plus par ouverture).
 */
export function factsFromRows(rows: FactRows): ProspectFacts {
  const facts: ProspectFacts = { exchange: null, meeting: null, proposal: null };

  for (const a of rows.activities) {
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

  for (const e of rows.emails) {
    facts.exchange = latest(facts.exchange, {
      at: e.received_at,
      label:
        e.direction === "entrant"
          ? `une réponse est arrivée le ${fmtDate(e.received_at)}`
          : `un email a été envoyé le ${fmtDate(e.received_at)}`,
    });
  }

  // Un rendez-vous À VENIR dans l'agenda (non annulé) : le fait que posait
  // autrefois la tâche « RDV avec … ». Un rendez-vous passé n'est pas oublié
  // pour autant — son activité `rendez_vous` (ci-dessus) reste un fait.
  const now = Date.now();
  for (const m of rows.meetings) {
    if (m.status === "annule") continue;
    if (new Date(m.starts_at).getTime() < now) continue;
    facts.meeting = latest(facts.meeting, {
      at: m.starts_at,
      label: `un rendez-vous est prévu le ${fmtDateTime(m.starts_at)}`,
    });
  }

  if (rows.proposalSentAt) {
    facts.proposal = {
      at: rows.proposalSentAt,
      label: `une proposition a été marquée envoyée le ${fmtDate(rows.proposalSentAt)}`,
    };
  }

  return facts;
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
  const [activitiesRes, emailsRes, meetingsRes, prospectRes] = await Promise.all([
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
    // La lecture de l'agenda passe par la vue meetings_visibles (règle du
    // projet) — les colonnes lues ici ne sont jamais masquées pour un
    // rendez-vous de prospect.
    supabase
      .from("meetings_visibles")
      .select("starts_at, status")
      .eq("prospect_id", prospectId)
      .neq("status", "annule")
      .gte("starts_at", new Date().toISOString())
      .order("starts_at", { ascending: true })
      .limit(10),
    supabase
      .from("prospects")
      .select("proposal_sent_at")
      .eq("id", prospectId)
      .maybeSingle(),
  ]);

  return factsFromRows({
    activities: (activitiesRes.data ?? []) as FactRows["activities"],
    emails: (emailsRes.data ?? []) as FactRows["emails"],
    meetings: (meetingsRes.data ?? []) as FactRows["meetings"],
    proposalSentAt:
      (prospectRes.data as { proposal_sent_at: string | null } | null)
        ?.proposal_sent_at ?? null,
  });
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
