/**
 * Cœur « agenda » — le rendez-vous comme objet à part entière, indépendant des
 * cookies et de Next. Même philosophie que lib/crm/exchange.ts : un seul
 * chemin, réutilisé par les server actions ET par le connecteur MCP. Aucune
 * logique métier dans les composants.
 *
 * Trois gestes :
 *   · poserRendezVous     — créer le créneau (heure OBLIGATOIRE), tracer au
 *                           journal, laisser l'étape suivre le fait ;
 *   · deplacerRendezVous  — reporter, en versant l'ancienne et la nouvelle
 *                           date au journal ;
 *   · cloturerRendezVous  — le DÉBRIEF : honoré ou annulé, avec compte rendu.
 *
 * Deux invariants hérités de la règle des faits :
 *   · un rendez-vous a TOUJOURS une heure — pas de rendez-vous « toute la
 *     journée » : c'est ce flou qui a perdu le RDV du 31/08 ;
 *   · l'étape « Rendez-vous » devient un fait DÉDUIT (applyAutoStatus) —
 *     JAMAIS de status_locked posé ici.
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import { localInputToISO } from "@/lib/time";
import { fmtDateTime } from "@/lib/constants";
import { applyAutoStatus } from "@/lib/crm/status";
import { recalcConfidence } from "@/lib/crm/confidence";
import { ADRESSE_MAX } from "@/lib/crm/maps";
import type { ProspectStatus } from "@/lib/types";
import type { RelanceReportee } from "@/lib/crm/prochaineAction";

export type MeetingKind = "prospect" | "perso";
export type MeetingStatus = "prevu" | "confirme" | "honore" | "annule" | "reporte";

export const MEETING_STATUS_LABEL: Record<MeetingStatus, string> = {
  prevu: "Prévu",
  confirme: "Confirmé",
  honore: "Honoré",
  annule: "Annulé",
  reporte: "Reporté",
};

/** Durée par défaut d'un rendez-vous, en minutes. */
export const MEETING_DEFAULT_MIN = 60;

/** Un chevauchement détecté — averti, jamais bloquant. */
export type MeetingConflit = {
  id: string;
  title: string;
  starts_at: string;
  ends_at: string;
};

const LOCAL_DATETIME = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/;
const LOCAL_DATE_ONLY = /^\d{4}-\d{2}-\d{2}$/;

/**
 * Valide et convertit un début de rendez-vous : « YYYY-MM-DDTHH:mm »
 * (Bruxelles) exigé. Une date sans heure est REFUSÉE — jamais complétée en
 * silence.
 */
function litDebut(startsAt: string): { iso?: string; error?: string } {
  const v = (startsAt ?? "").trim();
  if (LOCAL_DATE_ONLY.test(v)) {
    return {
      error:
        "Un rendez-vous a une heure précise — pas de rendez-vous « toute la journée ». Précisez-la (ex. 2026-09-01T11:00).",
    };
  }
  if (!LOCAL_DATETIME.test(v)) {
    return { error: "Date invalide — attendu « YYYY-MM-DDTHH:mm » (heure de Bruxelles)." };
  }
  const iso = localInputToISO(v);
  if (!iso) return { error: "Date invalide." };
  return { iso };
}

/** Le premier rendez-vous du même propriétaire qui chevauche le créneau. */
async function chercheConflit(
  supabase: SupabaseClient,
  ownerId: string,
  startsISO: string,
  endsISO: string,
  exceptId?: string
): Promise<MeetingConflit | null> {
  let q = supabase
    .from("meetings")
    .select("id, title, starts_at, ends_at")
    .eq("owner_id", ownerId)
    .neq("status", "annule")
    .lt("starts_at", endsISO)
    .gt("ends_at", startsISO)
    .limit(1);
  if (exceptId) q = q.neq("id", exceptId);
  const { data } = await q;
  return (data?.[0] as MeetingConflit | undefined) ?? null;
}

/**
 * Les relances que le rendez-vous tient en sommeil — son FILET. Ce n'est pas
 * ce code qui les a déplacées : c'est le trigger `meetings_prochaine_action`
 * (migration 022), pour que la règle vaille aussi pour le connecteur MCP et le
 * SQL direct. On les relit seulement pour le DIRE.
 */
async function litFilet(
  supabase: SupabaseClient,
  meetingId: string
): Promise<RelanceReportee[]> {
  const { data } = await supabase
    .from("tasks")
    .select("id, title, due_at")
    .eq("meeting_id", meetingId)
    .eq("status", "a_faire")
    .order("due_at", { ascending: true });
  return (data ?? []) as RelanceReportee[];
}

// ---------------------------------------------------------------------------
// Poser
// ---------------------------------------------------------------------------

export type PoserRendezVousInput = {
  prospectId?: string | null;
  /** Défaut : « prospect » si prospectId est fourni, « perso » sinon. */
  kind?: MeetingKind;
  title?: string | null;
  /** « YYYY-MM-DDTHH:mm » (Bruxelles). L'heure est OBLIGATOIRE. */
  startsAt: string;
  /** « YYYY-MM-DDTHH:mm » — à défaut, startsAt + dureeMin (défaut 60). */
  endsAt?: string | null;
  dureeMin?: number | null;
  /** À défaut, HÉRITE de `prospects.address` (rien à ressaisir chez un client). */
  location?: string | null;
  notes?: string | null;
  /**
   * false quand l'appelant tient déjà le journal (saveExchangeCore écrit sa
   * propre activité) : le rendez-vous est créé, rien d'autre.
   */
  ecrireActivite?: boolean;
  /** false quand l'appelant applique déjà applyAutoStatus + recalcConfidence. */
  avancerEtape?: boolean;
};

export type PoserRendezVousResult = {
  error?: string;
  id?: string;
  title?: string;
  startsAtISO?: string;
  endsAtISO?: string;
  /** Chevauchement avec un autre rendez-vous du même owner — averti, jamais bloquant. */
  conflit?: MeetingConflit | null;
  autoStatus?: ProspectStatus | null;
  autoReason?: string | null;
  /**
   * Les relances ouvertes qui tombaient AVANT ce rendez-vous et qu'il a
   * repoussées au premier jour ouvré qui le suit (migration 022). Dites, jamais
   * demandées.
   */
  reportees?: RelanceReportee[];
};

export async function poserRendezVous(
  supabase: SupabaseClient,
  userId: string,
  input: PoserRendezVousInput
): Promise<PoserRendezVousResult> {
  const kind: MeetingKind = input.kind ?? (input.prospectId ? "prospect" : "perso");
  if (kind === "prospect" && !input.prospectId) {
    return { error: "Un rendez-vous prospect doit viser une fiche." };
  }

  const debut = litDebut(input.startsAt);
  if (debut.error) return { error: debut.error };
  const startsISO = debut.iso!;

  let endsISO: string;
  if (input.endsAt) {
    if (!LOCAL_DATETIME.test(input.endsAt.trim())) {
      return { error: "Fin invalide — attendu « YYYY-MM-DDTHH:mm »." };
    }
    endsISO = localInputToISO(input.endsAt.trim())!;
  } else {
    const min = input.dureeMin && input.dureeMin > 0 ? input.dureeMin : MEETING_DEFAULT_MIN;
    endsISO = new Date(new Date(startsISO).getTime() + min * 60000).toISOString();
  }
  if (new Date(endsISO).getTime() <= new Date(startsISO).getTime()) {
    return { error: "La fin du rendez-vous doit suivre son début." };
  }

  // La fiche visée — son nom sert au titre par défaut et au journal, son
  // adresse au lieu par défaut (voir plus bas).
  let companyName: string | null = null;
  let prospectAddress: string | null = null;
  if (input.prospectId) {
    const { data: prospect } = await supabase
      .from("prospects")
      .select("id, company_name, address")
      .eq("id", input.prospectId)
      .maybeSingle();
    if (!prospect) return { error: "Prospect introuvable." };
    companyName = prospect.company_name as string;
    prospectAddress = (prospect.address as string | null) ?? null;
  }

  // Le lieu HÉRITE de l'adresse de la fiche quand il n'est pas précisé :
  // renseignée une fois, elle sert tous les rendez-vous suivants chez ce
  // client — et les boutons Maps apparaissent dans l'agenda sans rien ressaisir.
  const location = input.location?.trim().slice(0, ADRESSE_MAX) || prospectAddress;

  const title =
    input.title?.trim().slice(0, 200) ||
    (companyName ? `RDV avec ${companyName}` : "Rendez-vous personnel");

  // Chevauchement : détecté et RENVOYÉ, jamais bloquant — deux rendez-vous
  // peuvent sciemment se toucher, c'est à l'humain de trancher.
  const conflit = await chercheConflit(supabase, userId, startsISO, endsISO);

  const { data: inserted, error } = await supabase
    .from("meetings")
    .insert({
      owner_id: userId,
      prospect_id: input.prospectId ?? null,
      kind,
      title,
      starts_at: startsISO,
      ends_at: endsISO,
      location: location || null,
      notes: input.notes?.trim().slice(0, 2000) || null,
      created_by: userId,
    })
    .select("id")
    .single();
  if (error) return { error: error.message };

  // Le journal de la fiche garde la trace du geste — sauf si l'appelant
  // (saveExchangeCore) a déjà écrit la sienne.
  if (kind === "prospect" && input.ecrireActivite !== false) {
    await supabase.from("activities").insert({
      prospect_id: input.prospectId,
      author_id: userId,
      type: "rendez_vous",
      subject: title,
      body:
        `Rendez-vous le ${fmtDateTime(startsISO)}` +
        (location ? ` — ${location}` : "") +
        (input.notes?.trim() ? `\n${input.notes.trim()}` : ""),
      occurred_at: new Date().toISOString(),
      is_draft: false,
      is_exchange: true,
    });
  }

  // L'étape « Rendez-vous » devient un fait DÉDUIT — jamais de verrou ici.
  let autoStatus: ProspectStatus | null = null;
  let autoReason: string | null = null;
  if (kind === "prospect" && input.avancerEtape !== false) {
    const auto = await applyAutoStatus(supabase, input.prospectId!);
    if (auto.changed) {
      autoStatus = auto.status ?? null;
      autoReason = auto.reason ?? null;
    }
    await recalcConfidence(supabase, input.prospectId!);
  }

  // Le rendez-vous devient la prochaine action : le trigger a repoussé les
  // relances qui tombaient avant lui — on le dit.
  const reportees = kind === "prospect" ? await litFilet(supabase, inserted.id as string) : [];

  return {
    id: inserted.id as string,
    title,
    startsAtISO: startsISO,
    endsAtISO: endsISO,
    conflit,
    autoStatus,
    autoReason,
    reportees,
  };
}

// ---------------------------------------------------------------------------
// Déplacer
// ---------------------------------------------------------------------------

type MeetingRow = {
  id: string;
  owner_id: string;
  prospect_id: string | null;
  kind: MeetingKind;
  title: string;
  starts_at: string;
  ends_at: string;
  status: MeetingStatus;
};

/**
 * Relit le rendez-vous et vérifie que l'appelant a la main dessus. Avec le
 * client RLS de l'interface, la base filtre déjà ; ce contrôle est là pour le
 * chemin service_role du connecteur MCP, où c'est le code qui tient la
 * cloison. Introuvable et hors périmètre donnent le MÊME message.
 */
async function litMeeting(
  supabase: SupabaseClient,
  userId: string,
  id: string,
  isAdmin: boolean
): Promise<MeetingRow | { error: string }> {
  const { data } = await supabase
    .from("meetings")
    .select("id, owner_id, prospect_id, kind, title, starts_at, ends_at, status")
    .eq("id", id)
    .maybeSingle();
  if (!data || (!isAdmin && (data as MeetingRow).owner_id !== userId)) {
    return { error: "Rendez-vous introuvable." };
  }
  return data as MeetingRow;
}

export type DeplacerRendezVousInput = {
  id: string;
  /** « YYYY-MM-DDTHH:mm » (Bruxelles). L'heure est OBLIGATOIRE. */
  startsAt: string;
  /** « YYYY-MM-DDTHH:mm » — à défaut, la durée existante est conservée. */
  endsAt?: string | null;
  motif?: string | null;
  /** L'appelant est admin (relu en base par l'appelant, jamais déclaré par un client). */
  isAdmin?: boolean;
};

export type DeplacerRendezVousResult = {
  error?: string;
  id?: string;
  title?: string;
  prospectId?: string | null;
  startsAtISO?: string;
  conflit?: MeetingConflit | null;
  /** Le filet a SUIVI le rendez-vous (trigger, migration 022). */
  reportees?: RelanceReportee[];
};

export async function deplacerRendezVous(
  supabase: SupabaseClient,
  userId: string,
  input: DeplacerRendezVousInput
): Promise<DeplacerRendezVousResult> {
  const meeting = await litMeeting(supabase, userId, input.id, input.isAdmin === true);
  if ("error" in meeting) return meeting;
  if (meeting.status === "honore" || meeting.status === "annule") {
    return { error: "Ce rendez-vous est déjà clos — posez-en un nouveau." };
  }

  const debut = litDebut(input.startsAt);
  if (debut.error) return { error: debut.error };
  const startsISO = debut.iso!;

  let endsISO: string;
  if (input.endsAt) {
    if (!LOCAL_DATETIME.test(input.endsAt.trim())) {
      return { error: "Fin invalide — attendu « YYYY-MM-DDTHH:mm »." };
    }
    endsISO = localInputToISO(input.endsAt.trim())!;
  } else {
    const dureeMs =
      new Date(meeting.ends_at).getTime() - new Date(meeting.starts_at).getTime();
    endsISO = new Date(new Date(startsISO).getTime() + dureeMs).toISOString();
  }
  if (new Date(endsISO).getTime() <= new Date(startsISO).getTime()) {
    return { error: "La fin du rendez-vous doit suivre son début." };
  }

  const conflit = await chercheConflit(
    supabase,
    meeting.owner_id,
    startsISO,
    endsISO,
    meeting.id
  );

  const { error } = await supabase
    .from("meetings")
    .update({ starts_at: startsISO, ends_at: endsISO, status: "reporte" })
    .eq("id", meeting.id);
  if (error) return { error: error.message };

  // L'ancienne et la nouvelle date au journal — un report se lit après coup.
  if (meeting.prospect_id) {
    await supabase.from("activities").insert({
      prospect_id: meeting.prospect_id,
      author_id: userId,
      type: "note",
      subject: "Rendez-vous reporté",
      body:
        `${meeting.title} : reporté du ${fmtDateTime(meeting.starts_at)} au ${fmtDateTime(startsISO)}.` +
        (input.motif?.trim() ? `\nMotif : ${input.motif.trim()}` : ""),
      occurred_at: new Date().toISOString(),
      is_draft: false,
      is_exchange: false,
    });
  }

  return {
    id: meeting.id,
    title: meeting.title,
    prospectId: meeting.prospect_id,
    startsAtISO: startsISO,
    conflit,
    reportees: meeting.prospect_id ? await litFilet(supabase, meeting.id) : [],
  };
}

// ---------------------------------------------------------------------------
// Clôturer — le DÉBRIEF
// ---------------------------------------------------------------------------

export type CloturerRendezVousInput = {
  id: string;
  resultat: "honore" | "annule";
  compteRendu?: string | null;
  /**
   * « Et ensuite ? » — FACULTATIF. Une échéance (ISO UTC) : la relance-filet
   * y est re-datée (à défaut la relance ouverte la plus proche, à défaut une
   * relance créée — jamais de doublon). « rien » : le filet est annulé.
   * Absente : on ne dit rien, et le filet se réveille seul au premier jour
   * ouvré (trigger, migration 022) — la fiche ne disparaît jamais de partout.
   */
  suite?: { dueAt: string } | "rien" | null;
  /** Voir DeplacerRendezVousInput.isAdmin. */
  isAdmin?: boolean;
};

export type CloturerRendezVousResult = {
  error?: string;
  id?: string;
  title?: string;
  prospectId?: string | null;
  resultat?: "honore" | "annule";
  /**
   * La prochaine action de la fiche après le débrief : la relance posée (ou
   * réveillée), avec son échéance — ou null si la fiche n'en a plus.
   */
  ensuite?: { title: string; due_at: string } | null;
};

export async function cloturerRendezVous(
  supabase: SupabaseClient,
  userId: string,
  input: CloturerRendezVousInput
): Promise<CloturerRendezVousResult> {
  const meeting = await litMeeting(supabase, userId, input.id, input.isAdmin === true);
  if ("error" in meeting) return meeting;

  const { error } = await supabase
    .from("meetings")
    .update({ status: input.resultat, debriefed_at: new Date().toISOString() })
    .eq("id", meeting.id);
  if (error) return { error: error.message };

  // Le compte rendu part au journal. « Honoré » = l'échange a réellement eu
  // lieu (note ATTESTÉE) ; « annulé » = il n'a pas eu lieu (note simple).
  const compteRendu = input.compteRendu?.trim() || null;
  if (meeting.prospect_id && compteRendu) {
    await supabase.from("activities").insert({
      prospect_id: meeting.prospect_id,
      author_id: userId,
      type: "note",
      subject:
        input.resultat === "honore"
          ? `Compte rendu — ${meeting.title}`
          : `Rendez-vous annulé — ${meeting.title}`,
      body: compteRendu,
      occurred_at: new Date().toISOString(),
      is_draft: false,
      is_exchange: input.resultat === "honore",
    });
  }

  // La suite — c'est ICI que la prochaine action se pose. Le trigger vient de
  // réveiller le filet (premier jour ouvré) ; le choix humain, s'il y en a
  // un, le re-date ou l'annule. Fiche gagnée / perdue : on ne pose plus rien.
  let ensuite: { title: string; due_at: string } | null = null;
  if (meeting.prospect_id) {
    ensuite = await appliquerSuite(supabase, userId, meeting.id, meeting.prospect_id, input.suite);
  }

  // Un débrief est un événement : l'étape et la confiance suivent (jamais
  // bloquant, jamais par-dessus un verrou).
  if (meeting.prospect_id) {
    await applyAutoStatus(supabase, meeting.prospect_id);
    await recalcConfidence(supabase, meeting.prospect_id);
  }

  return {
    id: meeting.id,
    title: meeting.title,
    prospectId: meeting.prospect_id,
    resultat: input.resultat,
    ensuite,
  };
}

/**
 * « Et ensuite ? » après un débrief. Un seul chemin pour l'écran et le
 * connecteur MCP. Jamais de doublon : on re-date le filet du rendez-vous, à
 * défaut la relance ouverte la plus proche, à défaut on en crée une ; les
 * autres relances ouvertes de la fiche sont annulées (même règle que
 * « Relancer »). Renvoie la prochaine relance de la fiche, ou null.
 */
async function appliquerSuite(
  supabase: SupabaseClient,
  userId: string,
  meetingId: string,
  prospectId: string,
  suite: CloturerRendezVousInput["suite"]
): Promise<{ title: string; due_at: string } | null> {
  const { data: prospect } = await supabase
    .from("prospects")
    .select("id, company_name, status")
    .eq("id", prospectId)
    .maybeSingle();
  if (!prospect) return null;
  const close = prospect.status === "gagne" || prospect.status === "perdu";

  const { data: ouvertes } = await supabase
    .from("tasks")
    .select("id, title, due_at, meeting_id")
    .eq("prospect_id", prospectId)
    .eq("status", "a_faire")
    .order("due_at", { ascending: true });
  const toutes = (ouvertes ?? []) as {
    id: string;
    title: string;
    due_at: string;
    meeting_id: string | null;
  }[];
  const filet = toutes.filter((t) => t.meeting_id === meetingId);

  if (!close && suite === "rien") {
    if (filet.length > 0) {
      await supabase
        .from("tasks")
        .update({ status: "annule" })
        .in("id", filet.map((t) => t.id));
    }
    const reste = toutes.filter((t) => t.meeting_id !== meetingId);
    return reste[0] ? { title: reste[0].title, due_at: reste[0].due_at } : null;
  }

  if (!close && suite && typeof suite === "object" && suite.dueAt) {
    const cible = filet[0] ?? toutes[0] ?? null;
    if (cible) {
      // Un re-datage humain DÉTACHE le filet (tasks_detache_filet) : ce
      // n'est plus un filet, c'est la suite voulue.
      await supabase.from("tasks").update({ due_at: suite.dueAt }).eq("id", cible.id);
      const autres = toutes.filter((t) => t.id !== cible.id).map((t) => t.id);
      if (autres.length > 0) {
        await supabase.from("tasks").update({ status: "annule" }).in("id", autres);
      }
      return { title: cible.title, due_at: suite.dueAt };
    }
    const title = `Relancer ${prospect.company_name}`;
    await supabase.from("tasks").insert({
      prospect_id: prospectId,
      title,
      due_at: suite.dueAt,
      priority: 2,
      assignee_id: userId,
      created_by: userId,
    });
    return { title, due_at: suite.dueAt };
  }

  // Rien de dit : ce que la base a fait seule (filet réveillé) fait foi.
  return toutes[0] ? { title: toutes[0].title, due_at: toutes[0].due_at } : null;
}
