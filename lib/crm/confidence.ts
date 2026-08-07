/**
 * Cœur « confiance commerciale » — Chaud / Tiède / Froid, estimé par l'IA.
 *
 * Remplace la probabilité chiffrée à la main : Bora ne veut plus saisir un
 * pourcentage, il veut lire d'un coup d'œil si une affaire est chaude, et
 * pourquoi. Le niveau est estimé à partir des signaux réels du dossier :
 * contenu des échanges (notes, emails envoyés, réponses reçues), étape du
 * pipeline, historique (réponse positive, objection, silence prolongé,
 * rendez-vous posé).
 *
 * Règles, calquées sur la règle des faits (lib/crm/status.ts) :
 *   1. suggestion, pas vérité : Bora peut corriger le niveau à la main, et sa
 *      correction est respectée — confidence_locked, même logique que
 *      status_locked ;
 *   2. recalcul SUR ÉVÉNEMENT (échange noté, email envoyé, réponse traitée,
 *      changement d'étape), jamais à chaque affichage ;
 *   3. IA indisponible ou pas assez d'éléments → « à évaluer » (null), jamais
 *      un faux niveau, et rien ne se bloque.
 */

import { after } from "next/server";
import type { SupabaseClient } from "@supabase/supabase-js";
import { chatJSON, aiAvailable } from "@/lib/ai/provider";
import { normalizeStatus, STATUS_LABEL, fmtDate } from "@/lib/constants";
import type { ConfidenceLevel } from "@/lib/types";

export type { ConfidenceLevel };

export const CONFIDENCE_LEVELS: ConfidenceLevel[] = ["chaud", "tiede", "froid"];

export function isConfidenceLevel(v: unknown): v is ConfidenceLevel {
  return typeof v === "string" && (CONFIDENCE_LEVELS as string[]).includes(v);
}

export type ConfidenceOutcome =
  /** Un niveau a été estimé et enregistré. */
  | "evalue"
  /** Pas assez d'éléments : la fiche repasse à « à évaluer ». */
  | "a_evaluer"
  /** Fournisseur IA absent ou en panne : rien n'est écrit. */
  | "indisponible"
  /** Niveau fixé à la main : l'IA ne réécrit rien. */
  | "verrouille"
  | "introuvable";

export type ConfidenceResult = {
  outcome: ConfidenceOutcome;
  level?: ConfidenceLevel | null;
  reason?: string | null;
};

// ---------------------------------------------------------------------------
// Les signaux — ce que l'IA a le droit de lire
// ---------------------------------------------------------------------------

const MAX_EVENTS = 10;
const SNIPPET = 280;

function snippet(text: string | null | undefined): string {
  if (!text) return "";
  const clean = text.replace(/\s+/g, " ").trim();
  return clean.length > SNIPPET ? `${clean.slice(0, SNIPPET)}…` : clean;
}

function daysSince(iso: string | null): number | null {
  if (!iso) return null;
  const ms = Date.now() - new Date(iso).getTime();
  return ms > 0 ? Math.floor(ms / 86400000) : 0;
}

/**
 * Compile le dossier en signaux lisibles par le modèle. Renvoie null si le
 * prospect n'existe pas, et `events: 0` s'il n'y a encore aucun échange réel
 * (dans ce cas on n'appelle pas l'IA : il n'y a rien à évaluer).
 */
async function gatherSignals(
  supabase: SupabaseClient,
  prospectId: string
): Promise<{ text: string; events: number; locked: boolean } | null> {
  const [prospectRes, activitiesRes, emailsRes, tasksRes] = await Promise.all([
    supabase
      .from("prospects")
      .select(
        "status, last_contact_at, proposal_sent_at, confidence_locked, created_at"
      )
      .eq("id", prospectId)
      .maybeSingle(),
    supabase
      .from("activities")
      .select("type, occurred_at, is_exchange, is_draft, subject, body")
      .eq("prospect_id", prospectId)
      .eq("is_draft", false)
      .order("occurred_at", { ascending: false })
      .limit(MAX_EVENTS),
    supabase
      .from("emails")
      .select("direction, received_at, subject, body_text")
      .eq("prospect_id", prospectId)
      .order("received_at", { ascending: false })
      .limit(MAX_EVENTS),
    supabase
      .from("tasks")
      .select("title, due_at")
      .eq("prospect_id", prospectId)
      .eq("status", "a_faire")
      .order("due_at", { ascending: true })
      .limit(5),
  ]);

  const prospect = prospectRes.data as {
    status: string;
    last_contact_at: string | null;
    proposal_sent_at: string | null;
    confidence_locked: boolean | null;
    created_at: string;
  } | null;
  if (!prospect) return null;

  type Event = { at: string; label: string; text: string };
  const events: Event[] = [];

  for (const a of (activitiesRes.data ?? []) as {
    type: string;
    occurred_at: string;
    is_exchange: boolean | null;
    subject: string | null;
    body: string | null;
  }[]) {
    const label =
      a.type === "rendez_vous"
        ? "rendez-vous"
        : a.type === "email"
          ? "email consigné"
          : a.is_exchange === false
            ? "note interne (pas un échange)"
            : "échange noté";
    events.push({
      at: a.occurred_at,
      label,
      text: snippet([a.subject, a.body].filter(Boolean).join(" — ")),
    });
  }

  for (const e of (emailsRes.data ?? []) as {
    direction: string;
    received_at: string;
    subject: string | null;
    body_text: string | null;
  }[]) {
    events.push({
      at: e.received_at,
      label:
        e.direction === "entrant"
          ? "réponse reçue du prospect"
          : "email envoyé au prospect",
      text: snippet([e.subject, e.body_text].filter(Boolean).join(" — ")),
    });
  }

  events.sort((a, b) => new Date(b.at).getTime() - new Date(a.at).getTime());
  const recent = events.slice(0, MAX_EVENTS);

  const silence = daysSince(prospect.last_contact_at);
  const openTasks = (tasksRes.data ?? []) as { title: string; due_at: string }[];
  const meeting = openTasks.find((t) => t.title.startsWith("RDV"));

  const lines: string[] = [
    `Étape du pipeline : ${STATUS_LABEL[normalizeStatus(prospect.status)]}`,
    silence === null
      ? "Dernier contact : jamais"
      : `Dernier contact : il y a ${silence} jour${silence > 1 ? "s" : ""}`,
    meeting
      ? `Rendez-vous prévu : ${fmtDate(meeting.due_at)} (${meeting.title})`
      : "Rendez-vous prévu : aucun",
    prospect.proposal_sent_at
      ? `Proposition envoyée le ${fmtDate(prospect.proposal_sent_at)}`
      : "Proposition envoyée : non",
    openTasks.length > 0
      ? `Relances ouvertes : ${openTasks.map((t) => `« ${t.title} » (${fmtDate(t.due_at)})`).join(" ; ")}`
      : "Relances ouvertes : aucune",
    "",
    recent.length > 0
      ? "Derniers événements, du plus récent au plus ancien :"
      : "Aucun échange enregistré.",
    ...recent.map(
      (e) => `- [${fmtDate(e.at)}] ${e.label}${e.text ? ` : ${e.text}` : ""}`
    ),
  ];

  return {
    text: lines.join("\n"),
    events: recent.length,
    locked: Boolean(prospect.confidence_locked),
  };
}

// ---------------------------------------------------------------------------
// L'estimation
// ---------------------------------------------------------------------------

const SYSTEM_PROMPT = `Tu évalues la probabilité qu'une affaire de prospection se conclue, pour le CRM d'une petite agence belge. On te donne le dossier d'un prospect : étape du pipeline, silence éventuel, rendez-vous, proposition, et les derniers échanges (notes, emails envoyés, réponses reçues).

Réponds UNIQUEMENT par un objet JSON : {"niveau": "chaud" | "tiede" | "froid" | null, "raison": "…"}

Les trois niveaux :
- "chaud" : signal d'intérêt réel et récent — réponse positive, demande de rendez-vous, RDV posé, proposition en discussion active.
- "tiede" : le contact existe mais sans signal fort — échange en cours, demande d'information, réponse neutre, attente normale.
- "froid" : signal négatif ou silence prolongé — objection, refus poli, plusieurs relances sans réponse, plus de nouvelles depuis longtemps.

Règles impératives :
- Fonde-toi UNIQUEMENT sur les signaux fournis. N'invente rien.
- Une note marquée « pas un échange » est un repérage interne : elle ne vaut pas contact.
- Pas assez d'éléments pour trancher (aucun échange réel, ou signaux trop maigres) → "niveau": null.
- "raison" : une raison très courte en français (moins de 12 mots), factuelle, tirée du dossier — par exemple « réponse positive reçue », « sans réponse depuis 12 jours », « objection sur le prix ». Jamais de supposition.`;

/**
 * Ré-évalue la confiance d'un prospect et enregistre le résultat.
 *
 * Ne touche jamais une fiche verrouillée (correction humaine). N'écrit rien
 * si le fournisseur IA est absent ou en panne — le niveau précédent reste,
 * plutôt qu'un faux. « Pas assez d'éléments » est un verdict honnête : la
 * fiche repasse à « à évaluer ».
 */
export async function evaluateConfidenceCore(
  supabase: SupabaseClient,
  prospectId: string
): Promise<ConfidenceResult> {
  // Sans fournisseur configuré, le recalcul est un no-op immédiat : le
  // niveau existant reste (ou « à évaluer » par défaut), rien ne se bloque.
  if (!aiAvailable()) return { outcome: "indisponible" };

  const signals = await gatherSignals(supabase, prospectId);
  if (!signals) return { outcome: "introuvable" };
  if (signals.locked) return { outcome: "verrouille" };

  const write = async (
    level: ConfidenceLevel | null,
    reason: string | null
  ) => {
    await supabase
      .from("prospects")
      .update({
        confidence_level: level,
        confidence_reason: reason,
        confidence_at: new Date().toISOString(),
      })
      .eq("id", prospectId)
      .eq("confidence_locked", false);
  };

  // Aucun échange réel : rien à évaluer, inutile d'appeler le modèle.
  if (signals.events === 0) {
    await write(null, null);
    return { outcome: "a_evaluer" };
  }

  const raw = await chatJSON({
    system: SYSTEM_PROMPT,
    user: signals.text,
    maxTokens: 200,
  });
  if (!raw) return { outcome: "indisponible" };

  const niveau = raw.niveau ?? null;
  if (niveau === null) {
    await write(null, null);
    return { outcome: "a_evaluer" };
  }
  if (!isConfidenceLevel(niveau)) return { outcome: "indisponible" };

  const reason =
    typeof raw.raison === "string" && raw.raison.trim()
      ? raw.raison.trim().slice(0, 140)
      : null;

  await write(niveau, reason);
  return { outcome: "evalue", level: niveau, reason };
}

/**
 * Recalcul déclenché par un événement (échange noté, email envoyé, réponse
 * traitée, changement d'étape). Silencieux par construction : une panne
 * d'estimation ne doit jamais faire échouer le geste qui l'a déclenchée.
 *
 * HORS DU CHEMIN CRITIQUE (7 août). L'estimation appelle un modèle : plusieurs
 * secondes dans le pire cas. Tant qu'elle était attendue, glisser une carte ou
 * cocher une relance faisait patienter Bora pour un badge qu'il ne regardait
 * même pas à cet instant. Elle part donc dans `after()` : la réponse est
 * envoyée d'abord, l'estimation se fait ensuite, et le niveau s'affiche au
 * chargement suivant de la fiche.
 *
 * Rien n'est perdu : les MÊMES événements déclenchent toujours le recalcul.
 * Seul le moment où le badge se met à jour se décale. La ré-estimation
 * explicite (bouton ✨) reste synchrone, elle : Bora attend son résultat.
 */
export async function recalcConfidence(
  supabase: SupabaseClient,
  prospectId: string | null | undefined
): Promise<void> {
  if (!prospectId) return;

  const evaluer = async () => {
    try {
      await evaluateConfidenceCore(supabase, prospectId);
    } catch {
      /* jamais bloquant */
    }
  };

  try {
    after(evaluer);
  } catch {
    // Hors contexte de requête (script, tâche planifiée) : on évalue tout de
    // suite plutôt que de perdre l'estimation.
    await evaluer();
  }
}

// ---------------------------------------------------------------------------
// La correction humaine — même logique que le verrou d'étape
// ---------------------------------------------------------------------------

/** Bora fixe le niveau à la main : verrouillé, l'IA ne réécrit plus rien. */
export function manualConfidencePatch(
  level: ConfidenceLevel
): Record<string, unknown> {
  return {
    confidence_level: level,
    confidence_reason: null,
    confidence_locked: true,
    confidence_at: new Date().toISOString(),
  };
}

/** Rendre la main à l'assistant : le niveau redevient estimable. */
export function unlockConfidencePatch(): Record<string, unknown> {
  return { confidence_locked: false };
}
