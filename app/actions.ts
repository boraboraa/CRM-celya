"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { SUPABASE_URL, SUPABASE_ANON_KEY } from "@/lib/env";
import { localInputToISO, dateInputToISO, inDaysAt9 } from "@/lib/time";
import { normalizeStatus, estResultatSaisissable, STATUS_ORDER } from "@/lib/constants";
import { estPerdue, lireAnnulation, relanceRefuseeSurPerdue, type AnnulationRefus } from "@/lib/crm/perdues";
import type { ProspectStatus } from "@/lib/types";
import {
  manualStatusPatch,
  unlockStatusPatch,
  applyAutoStatus,
} from "@/lib/crm/status";
import {
  evaluateConfidenceCore,
  recalcConfidence,
  manualConfidencePatch,
  unlockConfidencePatch,
  isConfidenceLevel,
} from "@/lib/crm/confidence";
import { entreeFormulaire } from "@/lib/crm/ligneProspect";
import { createProspectCore, nomsDesProprietaires } from "@/lib/crm/prospects";
import { doublonsEquipe } from "@/lib/crm/doublonsEquipe";
import { estDoublonEquipe, phraseDoublon } from "@/lib/crm/doublons";
import { ADRESSE_MAX } from "@/lib/crm/maps";
import { CONTACT_MAX } from "@/lib/crm/contactPropose";
import { normaliserSecteur } from "@/lib/crm/secteurs";
import { estRegion } from "@/lib/crm/regions";
import { LOT_MAX, idsPropres, peutSupprimerEnLot, resultatSuppression } from "@/lib/crm/suppression";
import { DEBUT_SALES_TROPHY, lundiDe } from "@/lib/crm/compteurs";
import { saveExchangeCore, type SaveExchangeInput } from "@/lib/crm/exchange";
import { poserRappelAuto } from "@/lib/crm/rappelAuto";
import {
  poserRendezVous,
  deplacerRendezVous,
  cloturerRendezVous,
  type MeetingConflit,
} from "@/lib/crm/agenda";
import type { RelanceAnnulee } from "@/lib/crm/prochaineAction";
import { estIssueDebrief, type IssueDebrief } from "@/lib/crm/debrief";
import { filtreRecherche } from "@/lib/crm/recherche";
import { estTableAbsente } from "@/lib/crm/access";
import { getSession } from "@/lib/auth";
import {
  importProspectsCore,
  type ImportRow,
  type ImportResult,
} from "@/lib/crm/prospects";

export type ActionState = { error?: string; success?: string };

// Types réexportés depuis le cœur partagé (lib/crm) pour ne pas rompre les
// imports existants des composants.
export type { SaveExchangeInput, ImportRow, ImportResult };

const str = (fd: FormData, k: string): string | null => {
  const v = fd.get(k);
  if (typeof v !== "string") return null;
  const t = v.trim();
  return t === "" ? null : t;
};

const num = (fd: FormData, k: string): number | null => {
  const v = str(fd, k);
  if (v === null) return null;
  const n = Number(v.replace(",", "."));
  return Number.isFinite(n) ? n : null;
};

/**
 * Qui agit — sans aller-retour réseau. Les jetons de ce projet sont signés en
 * ES256 : `getClaims()` vérifie la signature en local (JWKS mis en cache pour
 * tout le processus) là où `getUser()` interrogeait Supabase Auth à chaque
 * action. La RLS reste l'unique garde-fou des données.
 */
async function currentUserId() {
  const supabase = await createClient();
  const { data, error } = await supabase.auth.getClaims();
  const userId = data?.claims?.sub;
  if (error || !userId) redirect("/login");
  return { supabase, userId };
}

function revalidateProspect(id?: string | null) {
  if (id) revalidatePath(`/prospects/${id}`);
  revalidatePath("/prospects");
  revalidatePath("/dashboard");
}

// =====================================================================
// Prospects
// =====================================================================

export async function createProspectAction(fd: FormData) {
  const { supabase, userId } = await currentUserId();

  // Passe par le cœur partagé (même insertion que le connecteur MCP). Le
  // formulaire ne force ni dédup ni normalisation « +32 » : la saisie manuelle
  // est conservée telle quelle (la dédup a déjà été proposée à l'extraction).
  // La lecture du formulaire est celle de l'ajout rapide (ligneProspect.ts) :
  // un champ absent vaut null, la ligne insérée a toujours les mêmes clés.
  const session = await getSession();
  const result = await createProspectCore(
    supabase,
    userId,
    entreeFormulaire((k) => fd.get(k)),
    // Une fiche déjà suivie par un autre membre ne se recrée pas (031).
    { equipe: { isAdmin: session?.me?.role === "admin" }, force: fd.get("forcer") === "1" }
  );

  if (result.error) throw new Error(result.error);
  if (result.doublonEquipe) {
    throw new Error(`Cette société est ${result.doublonEquipe}. Demandez à l'administrateur de vous l'attribuer.`);
  }

  revalidatePath("/prospects");
  redirect(`/prospects/${result.id}`);
}

/**
 * L'AJOUT RAPIDE du téléphone (19/10) : société, contact, téléphone, une
 * adresse ou une position — et « ce qui s'est passé », déjà lu par
 * `lireCeQuiSestPasse` (lib/crm/ajoutRapide.ts) dans le navigateur, comme la
 * note de la fiche.
 *
 * Deux chemins EXISTANTS, rien de nouveau : la fiche par `createProspectCore`
 * (la même lecture de formulaire que le formulaire complet — un ajout rapide
 * est indiscernable d'une fiche créée à la main), puis l'échange par
 * `saveExchangeCore` (même journal, même rendez-vous, même relance, même
 * étape suivant les faits — `saveExchangeCore` refuse lui-même un
 * rendez-vous sans heure). Responsable = soi, étape jamais demandée.
 *
 * La fiche existe dès la première étape : si l'échange échoue, on le dit et
 * on renvoie quand même vers la fiche, où le geste se refait.
 */
export async function ajoutRapideAction(input: {
  champs: Partial<Record<"company_name" | "contact_name" | "phone" | "address" | "city" | "sector", string>>;
  echange: Omit<SaveExchangeInput, "prospectId"> | null;
  /** Admin seulement : créer malgré une fiche déjà suivie dans l'équipe. */
  forcer?: boolean;
}): Promise<{ id?: string; error?: string; erreurEchange?: string; doublonEquipe?: string }> {
  const { supabase, userId } = await currentUserId();
  if (!input.champs.company_name?.trim()) return { error: "Le nom de la société est requis." };
  const session = await getSession();

  const fiche = await createProspectCore(
    supabase,
    userId,
    entreeFormulaire((k) => input.champs[k as keyof typeof input.champs] ?? null),
    { equipe: { isAdmin: session?.me?.role === "admin" }, force: input.forcer === true }
  );
  if (fiche.doublonEquipe) return { doublonEquipe: fiche.doublonEquipe };
  if (fiche.error || !fiche.id) return { error: fiche.error ?? "La fiche n'a pas pu être créée." };

  let erreurEchange: string | undefined;
  if (input.echange?.note?.trim()) {
    const res = await saveExchangeCore(supabase, userId, { ...input.echange, prospectId: fiche.id });
    if (res.error) erreurEchange = res.error;
    if (input.echange.type === "rendez_vous") revalidatePath("/agenda");
  }

  revalidatePath("/prospects");
  revalidatePath("/dashboard");
  return { id: fiche.id, erreurEchange };
}

/**
 * L'étoile d'une fiche (031) — un tap, optimiste côté écran. La base tranche :
 * `prospects_update` n'accepte que le responsable (ou l'admin), donc un
 * encadrant qui toucherait l'étoile de son étudiant modifie ZÉRO ligne — on
 * le dit au lieu de faire croire que c'est fait.
 */
export async function etoilerProspectAction(prospectId: string, etoile: boolean): Promise<ActionState> {
  const { supabase } = await currentUserId();
  const { data, error } = await supabase
    .from("prospects")
    .update({ starred_at: etoile ? new Date().toISOString() : null })
    .eq("id", prospectId)
    .select("id");
  if (error) return { error: error.message };
  if (!data || data.length === 0) return { error: "Seul le responsable de la fiche peut l'étoiler." };
  revalidateProspect(prospectId);
  return {};
}

/**
 * Réattribuer des fiches (031) — l'admin seul, revérifié EN BASE
 * (`attribuer_prospects` lève 42501 hors admin). Les relances ouvertes et les
 * rendez-vous à venir suivent ; une ligne au journal de chaque fiche.
 */
export async function attribuerProspectsAction(
  ids: string[],
  ownerId: string
): Promise<{ error?: string; n?: number }> {
  const { supabase } = await currentUserId();
  const propres = [...new Set(ids.filter((x) => typeof x === "string" && /^[0-9a-f-]{36}$/i.test(x)))];
  if (propres.length === 0) return { error: "Aucune fiche sélectionnée." };
  if (propres.length > 500) return { error: "500 fiches au plus par attribution." };
  const { data, error } = await supabase.rpc("attribuer_prospects", { p_ids: propres, p_owner: ownerId });
  if (error) {
    return {
      error:
        error.code === "42501"
          ? "Seul l'administrateur attribue une fiche."
          : error.code === "PGRST202"
            ? "L'attribution demande la migration 031, pas encore appliquée."
            : error.message,
    };
  }
  revalidatePath("/prospects");
  revalidatePath("/dashboard");
  revalidatePath("/agenda");
  return { n: typeof data === "number" ? data : propres.length };
}

/**
 * « Déjà suivie dans l'équipe ? » — pour l'ajout rapide, à la frappe (031).
 * La base répond par des booléens : rien sur la fiche d'un autre. `peutForcer`
 * dit si le compte (admin) peut créer malgré tout.
 */
export async function doublonEquipeAction(input: {
  telephone?: string | null;
  societe?: string | null;
}): Promise<{ phrase: string | null; peutForcer: boolean }> {
  const { supabase } = await currentUserId();
  const session = await getSession();
  const isAdmin = session?.me?.role === "admin";
  const { doublons } = await doublonsEquipe(supabase, [
    { telephone: input.telephone ?? null, societe: input.societe ?? null },
  ]);
  const d = doublons[0];
  if (!estDoublonEquipe(d) || d.aMoi) return { phrase: null, peutForcer: isAdmin };
  const noms = await nomsDesProprietaires(supabase, [d.proprietaire]);
  return { phrase: phraseDoublon(d, d.proprietaire ? noms.get(d.proprietaire) : null), peutForcer: isAdmin };
}

export async function updateProspectAction(fd: FormData) {
  const { supabase } = await currentUserId();
  const id = str(fd, "id");
  if (!id) throw new Error("Prospect introuvable");

  const { data: before } = await supabase
    .from("prospects")
    .select("status")
    .eq("id", id)
    .maybeSingle();

  const status = normalizeStatus(str(fd, "status"));
  const assign = str(fd, "owner_id");

  // La probabilité n'est plus saisie : la colonne reste en base, intouchée —
  // c'est la confiance estimée par l'IA qui la remplace à l'écran.
  const patch: Record<string, unknown> = {
    company_name: str(fd, "company_name") ?? "Sans nom",
    contact_name: str(fd, "contact_name"),
    email: str(fd, "email")?.toLowerCase() ?? null,
    phone: str(fd, "phone"),
    website: str(fd, "website"),
    sector: normaliserSecteur(str(fd, "sector")),
    // Stockée TELLE QUELLE : adresse libre ou lien Maps, on ne réécrit pas.
    address: str(fd, "address"),
    city: str(fd, "city"),
    source: str(fd, "source"),
    value_estimate: num(fd, "value_estimate"),
    notes: str(fd, "notes"),
    lost_reason: str(fd, "lost_reason"),
  };

  // Le vivier est fermé (migration 016) : une fiche a toujours un propriétaire.
  // Un formulaire qui n'en envoie pas (ou l'ancienne valeur « none » d'un
  // onglet resté ouvert) ne DÉSASSIGNE pas la fiche — il laisse le
  // propriétaire en place. Désassigner rendrait la fiche invisible à son
  // commercial, et à lui seul : exactement le contraire du geste attendu.
  if (assign && assign !== "none") patch.owner_id = assign;

  // Changer l'étape depuis le formulaire est une décision humaine : elle
  // verrouille. La laisser telle quelle ne verrouille rien.
  const statusChanged =
    Boolean(before) && normalizeStatus(before!.status as string) !== status;
  if (statusChanged) {
    Object.assign(patch, manualStatusPatch(status));
  } else {
    patch.status = status;
  }

  // La région (034) : choisie à la main, ou « Automatique » — alors la base
  // la déduit de la commune et de l'adresse (public.lieu_de, la règle écrite
  // une fois). Sans le champ (ancien formulaire), on n'y touche pas.
  if (fd.has("region")) {
    const choisie = str(fd, "region");
    if (estRegion(choisie)) {
      patch.region = choisie;
    } else {
      const sansLieu = !patch.city && !patch.address;
      const { data: lieu } = await supabase
        .rpc("lieu_de", {
          p_ville: patch.city as string | null,
          p_adresse: patch.address as string | null,
          p_nom: sansLieu ? (patch.company_name as string) : null,
        })
        .maybeSingle();
      patch.region = (lieu as { region: string | null } | null)?.region ?? null;
    }
  }

  const { error } = await supabase.from("prospects").update(patch).eq("id", id);
  if (error) throw new Error(error.message);

  // Un changement d'étape est un événement : la confiance se recalcule.
  if (statusChanged) await recalcConfidence(supabase, id);

  revalidateProspect(id);
}

/**
 * Fixer l'étape à la main — depuis la fiche. Verrouille : à partir de là,
 * l'auto-classification ne réécrit plus rien, elle peut seulement suggérer.
 */
export async function setProspectStatusAction(fd: FormData): Promise<ActionState> {
  const { supabase } = await currentUserId();
  const id = str(fd, "id");
  const status = str(fd, "status");
  if (!id || !status) return { error: "Étape introuvable." };

  const { error } = await supabase
    .from("prospects")
    .update(manualStatusPatch(normalizeStatus(status)))
    .eq("id", id);
  if (error) return { error: error.message };

  await recalcConfidence(supabase, id);
  revalidateProspect(id);
  return {};
}

/**
 * Rendre la main à l'IA : l'étape redevient déductible des faits, et on la
 * ré-évalue tout de suite pour que l'effet soit visible immédiatement.
 */
export async function unlockProspectStatusAction(
  fd: FormData
): Promise<ActionState> {
  const { supabase } = await currentUserId();
  const id = str(fd, "id");
  if (!id) return { error: "Prospect introuvable." };

  const { error } = await supabase
    .from("prospects")
    .update(unlockStatusPatch())
    .eq("id", id);
  if (error) return { error: error.message };

  await applyAutoStatus(supabase, id);
  await recalcConfidence(supabase, id);

  revalidateProspect(id);
  return {};
}

/**
 * Accepter la suggestion affichée sur une fiche verrouillée (« un RDV a été
 * posé — passer en Rendez-vous ? »). C'est un clic humain : la fiche reste
 * verrouillée sur ce nouveau choix.
 */
export async function acceptStatusSuggestionAction(
  fd: FormData
): Promise<ActionState> {
  const { supabase } = await currentUserId();
  const id = str(fd, "id");
  const status = str(fd, "status");
  if (!id || !status) return { error: "Étape introuvable." };

  const { error } = await supabase
    .from("prospects")
    .update(manualStatusPatch(normalizeStatus(status)))
    .eq("id", id);
  if (error) return { error: error.message };

  await recalcConfidence(supabase, id);
  revalidateProspect(id);
  return {};
}

// =====================================================================
// Confiance (Chaud / Tiède / Froid) — suggestion IA, dernier mot humain.
// =====================================================================

/**
 * Corriger le niveau à la main. Comme pour l'étape, la correction VERROUILLE :
 * l'assistant ne réécrira plus la confiance par-dessus le choix de Bora.
 */
export async function setConfidenceAction(fd: FormData): Promise<ActionState> {
  const { supabase } = await currentUserId();
  const id = str(fd, "id");
  const level = str(fd, "level");
  if (!id || !isConfidenceLevel(level)) return {};

  const { error } = await supabase
    .from("prospects")
    .update(manualConfidencePatch(level))
    .eq("id", id);
  if (error) return { error: error.message };

  revalidateProspect(id);
  return {};
}

/** Rendre la main à l'assistant : déverrouille et ré-estime tout de suite. */
export async function unlockConfidenceAction(fd: FormData): Promise<ActionState> {
  const { supabase } = await currentUserId();
  const id = str(fd, "id");
  if (!id) return {};

  const { error } = await supabase
    .from("prospects")
    .update(unlockConfidencePatch())
    .eq("id", id);
  if (error) return { error: error.message };

  // Geste explicite : Bora attend le nouveau niveau tout de suite, on n'en
  // diffère pas le calcul (contrairement aux recalculs d'arrière-plan).
  try {
    await evaluateConfidenceCore(supabase, id);
  } catch {
    /* jamais bloquant */
  }
  revalidateProspect(id);
  return {};
}

/** Ré-estimation à la demande (bouton ✨ de la fiche). */
export async function evaluateConfidenceAction(
  fd: FormData
): Promise<ActionState> {
  const { supabase } = await currentUserId();
  const id = str(fd, "id");
  if (!id) return {};

  const result = await evaluateConfidenceCore(supabase, id);
  revalidateProspect(id);

  if (result.outcome === "indisponible") {
    return {
      error:
        "Assistant indisponible — vérifiez la configuration du fournisseur IA.",
    };
  }
  if (result.outcome === "a_evaluer") {
    return {
      error:
        "Pas encore assez d'éléments pour estimer — consignez d'abord un échange.",
    };
  }
  return {};
}

/**
 * « Enregistrer cette adresse sur la fiche ? » — le lieu d'un rendez-vous
 * remonté sur `prospects.address`, d'un clic. JAMAIS un automatisme : un lieu
 * ponctuel (« visio », « chez le comptable ») n'est pas l'adresse du client.
 * Ne remplace jamais une adresse déjà saisie.
 */
export async function setProspectAddressAction(
  fd: FormData
): Promise<ActionState> {
  const { supabase } = await currentUserId();
  const id = str(fd, "id");
  const address = str(fd, "address");
  if (!id || !address) return { error: "Adresse introuvable." };

  // La RLS tranche la permission : un commercial n'atteint que ses fiches.
  const { error } = await supabase
    .from("prospects")
    .update({ address: address.slice(0, ADRESSE_MAX) })
    .eq("id", id);
  if (error) return { error: error.message };

  revalidateProspect(id);
  return { success: "Adresse enregistrée." };
}

/**
 * Le nom de la personne, PROPOSÉ par la pastille « Contact → … » (résultat
 * d'appel, débrief) ou saisi dans « Nom de la personne » — écrit seulement sur
 * ce geste, et seulement `contact_name` (comme l'adresse : un mini-formulaire
 * qui passerait par updateProspectAction viderait le reste de la fiche).
 *
 * `remplace` : le contact que l'écran a montré (« Remplacer « M. Dupont » par
 * … ? »). Si la fiche porte autre chose entre-temps, on refuse plutôt que
 * d'écraser en silence un contact que personne n'a vu.
 */
export async function poserContactAction(input: {
  prospectId: string;
  nom: string;
  remplace?: string | null;
}): Promise<ActionState> {
  const { supabase } = await currentUserId();
  const nom = (input.nom ?? "").replace(/\s+/g, " ").trim().slice(0, CONTACT_MAX);
  if (!input.prospectId || !nom) return { error: "Dites le nom de la personne." };

  const { data: fiche, error: e1 } = await supabase
    .from("prospects")
    .select("contact_name")
    .eq("id", input.prospectId)
    .maybeSingle();
  if (e1) return { error: e1.message };
  if (!fiche) return { error: "Fiche introuvable." };
  const actuel = ((fiche as { contact_name: string | null }).contact_name ?? "").trim();
  if (actuel && actuel !== (input.remplace ?? "").trim()) {
    return { error: `La fiche porte déjà « ${actuel} » : ouvrez-la pour choisir.` };
  }

  // La RLS tranche la permission : on n'écrit que sur ses propres fiches
  // (prospects_update) — un encadrant voit la pastille, la base refuse.
  const { data, error } = await supabase
    .from("prospects")
    .update({ contact_name: nom })
    .eq("id", input.prospectId)
    .select("id");
  if (error) return { error: error.message };
  if (!data || data.length === 0) return { error: "Cette fiche n'est pas à vous." };

  revalidateProspect(input.prospectId);
  return { success: `Contact enregistré : ${nom}.` };
}

/**
 * Supprimer une ou plusieurs fiches (28/10). Une fiche : son responsable ou
 * l'admin ; plusieurs d'un coup : l'admin seul (lib/crm/suppression.ts). La
 * base revérifie (`prospects_delete`), et ce qui suit la fiche part avec elle
 * (journal, relances, rendez-vous — migration 035 —, file et brief de Janet) ;
 * les mails restent, détachés. Ne lève jamais : l'écran dit ce qui s'est passé.
 */
export async function supprimerProspectsAction(
  ids: string[]
): Promise<{ error?: string; ok?: boolean; texte?: string; n?: number }> {
  const { supabase, userId } = await currentUserId();
  const session = await getSession();
  const qui = { userId, isAdmin: session?.me?.role === "admin" };
  const propres = idsPropres(ids);
  if (propres.length === 0) return { error: "Aucune fiche sélectionnée." };
  if (!peutSupprimerEnLot(qui, propres.length)) {
    return {
      error:
        propres.length > LOT_MAX
          ? `${LOT_MAX} fiches au plus d'un coup.`
          : "Supprimer plusieurs fiches d'un coup est réservé à l'administrateur.",
    };
  }
  const { data, error } = await supabase.from("prospects").delete().in("id", propres).select("id");
  if (error) return { error: error.message };
  const n = data?.length ?? 0;
  if (n > 0) {
    revalidatePath("/prospects");
    revalidatePath("/dashboard");
    revalidatePath("/agenda");
  }
  const r = resultatSuppression(propres.length, n);
  return { ok: r.ok, texte: r.texte, n };
}

// =====================================================================
// Noter un échange — le geste central : note + étape + prochaine action.
// Remplace l'ancienne mécanique de résultats d'appel : plus de cadence,
// c'est la date qui décide de tout.
// =====================================================================

export type SaveExchangeState = ActionState & {
  /** Étape avancée automatiquement par les faits, et son motif. */
  autoStatus?: ProspectStatus | null;
  autoReason?: string | null;
  /** Rendez-vous posé qui chevauche un autre créneau — averti, jamais bloquant. */
  conflit?: MeetingConflit | null;
};

export async function saveExchangeAction(
  input: SaveExchangeInput
): Promise<SaveExchangeState> {
  const { supabase, userId } = await currentUserId();

  const result = await saveExchangeCore(supabase, userId, input);
  if (result.error) return { error: result.error };

  revalidateProspect(input.prospectId);
  // Un échange de type rendez-vous vient de créer un créneau dans l'agenda.
  if (input.type === "rendez_vous") revalidatePath("/agenda");
  return {
    autoStatus: result.autoStatus,
    autoReason: result.autoReason,
    conflit: result.conflit ?? null,
  };
}

// =====================================================================
// Le RÉSULTAT d'appel — deux taps, depuis n'importe où
// =====================================================================

export type ResultatAppelState = ActionState & {
  /** L'entrée de journal créée — c'est elle que « préciser » complètera. */
  activiteId?: string | null;
  /**
   * « Pas intéressé » a fait passer la fiche en Perdu (29/10) : ce qu'il faut
   * pour le DÉFAIRE si la pastille était la mauvaise (lib/crm/perdues.ts).
   */
  annulation?: AnnulationRefus | null;
  /**
   * « Pas décroché » / « Suivi par email » : la relance posée toute seule
   * (ISO UTC, 29/10 et 31/10 — lib/crm/relance.ts `decisionRappelAuto`), ou null.
   */
  rappelAuto?: string | null;
  autoStatus?: ProspectStatus | null;
  autoReason?: string | null;
  conflit?: MeetingConflit | null;
};

/**
 * « Pas intéressé » fait passer la fiche en Perdu (29/10, décision de Bora :
 * ce qui est perdu ne s'affiche plus par défaut — lib/crm/perdues.ts). Par le
 * MÊME cœur que tout changement d'étape humain (`saveExchangeCore` avec
 * `statut: "perdu"`) : verrou, raison, relances ouvertes annulées, confiance.
 *
 * Renvoie de quoi DÉFAIRE le geste (étape et verrou d'avant, relances
 * annulées), ou null quand la fiche était déjà perdue — rien à défaire.
 */
async function passerEnPerduApresRefus(
  supabase: Awaited<ReturnType<typeof createClient>>,
  userId: string,
  prospectId: string,
  motif: string | null
): Promise<{ annulation: AnnulationRefus | null; error?: string }> {
  const { data: fiche } = await supabase
    .from("prospects")
    .select("status, status_locked")
    .eq("id", prospectId)
    .maybeSingle();
  if (!fiche) return { annulation: null, error: "Prospect introuvable." };
  if (estPerdue(fiche.status)) return { annulation: null };
  const { data: ouvertes } = await supabase
    .from("tasks")
    .select("id")
    .eq("prospect_id", prospectId)
    .eq("status", "a_faire");
  const res = await saveExchangeCore(supabase, userId, {
    prospectId,
    type: "note",
    statut: "perdu",
    motif,
  });
  if (res.error) return { annulation: null, error: res.error };
  return {
    annulation: {
      etape: fiche.status as string,
      verrou: fiche.status_locked === true,
      relances: (ouvertes ?? []).map((t) => t.id as string),
    },
  };
}

/**
 * Défaire un « Pas intéressé » tapé par erreur : l'étape et le verrou d'avant,
 * les relances que le passage en Perdu avait annulées. Ne touche une fiche
 * que si elle est ENCORE perdue (rien à défaire sinon), et seulement les
 * relances de CETTE fiche, encore annulées.
 */
async function defairePerdu(
  supabase: Awaited<ReturnType<typeof createClient>>,
  prospectId: string,
  annulation: AnnulationRefus
): Promise<void> {
  const { data: fiche } = await supabase
    .from("prospects")
    .select("status")
    .eq("id", prospectId)
    .maybeSingle();
  if (!fiche || !estPerdue(fiche.status)) return;
  await supabase
    .from("prospects")
    .update(
      annulation.verrou
        ? { ...manualStatusPatch(annulation.etape as ProspectStatus), lost_reason: null }
        : { status: annulation.etape, ...unlockStatusPatch(), lost_reason: null }
    )
    .eq("id", prospectId);
  if (annulation.relances.length > 0) {
    await supabase
      .from("tasks")
      .update({ status: "a_faire" })
      .eq("prospect_id", prospectId)
      .eq("status", "annule")
      .in("id", annulation.relances);
  }
}

/**
 * Consigner ce qu'a donné un appel, en un geste : 📵 pas décroché,
 * ↩︎ à rappeler, 👍 intéressé, 📧 suivi par email, ✕ pas intéressé (plus de barrage, 31/10).
 *
 * Mesuré le 02/09 : `outcome` n'était renseigné que sur 2 lignes sur 85, parce
 * que le noter demandait CINQ décisions dans QuickNote. Ici il en faut une.
 *
 * Passe par le MÊME cœur que tout le reste (`saveExchangeCore`) : même
 * journal, même règle d'échange, même cadence de relance, même recalcul de
 * confiance. Deux invariants tenus par le cœur, pas par cet appelant :
 *   · 'sans_reponse' n'est PAS un échange (la fiche reste « À appeler ») ;
 *   · « Pas intéressé » enregistre la RAISON (prospects.lost_reason) ET,
 *     depuis le 29/10, fait passer la fiche en « Perdu » — c'est l'humain qui
 *     a tapé « Pas intéressé », comme il taperait l'étape. Défaisable par une
 *     seconde pastille (`preciserResultatAction` + `annulation`).
 */
export async function enregistrerResultatAction(input: {
  prospectId: string;
  outcome: string;
  /** « En un mot, ce qui s'est dit » — versé dans activities.subject. */
  texte?: string | null;
  /** Relance ou rendez-vous lu dans le texte (« YYYY-MM-DD[THH:mm] »). */
  dateLocale?: string | null;
  /** Le texte porte un rendez-vous complet : c'est l'agenda qui le prend. */
  rendezVous?: boolean;
  rdvLieu?: string | null;
  rdvFin?: string | null;
}): Promise<ResultatAppelState> {
  const { supabase, userId } = await currentUserId();

  if (!estResultatSaisissable(input.outcome)) return { error: "Résultat inconnu." };
  const texte = input.texte?.trim() || null;

  // Le seul résultat qui EXIGE une raison : « pas intéressé » sans pourquoi
  // ne s'exploite pas — ni pour l'apprendre, ni pour le raconter.
  if (input.outcome === "refus" && !texte) {
    return { error: "Dites en un mot pourquoi : c'est ce qui sert plus tard." };
  }

  const result = await saveExchangeCore(supabase, userId, {
    prospectId: input.prospectId,
    type: input.rendezVous ? "rendez_vous" : "note",
    resume: texte,
    outcome: input.outcome,
    // Le cœur décide de l'attestation pour 'sans_reponse' ; pour les quatre
    // autres, on a bien eu quelqu'un au bout du fil.
    isExchange: input.outcome !== "sans_reponse",
    motif: input.outcome === "refus" ? texte : null,
    dateLocale: input.dateLocale ?? null,
    rdvLieu: input.rdvLieu ?? null,
    rdvFin: input.rdvFin ?? null,
  });
  if (result.error) return { error: result.error };

  // « Pas intéressé » → Perdu (29/10). APRÈS l'entrée de journal : la raison
  // et le résultat sont déjà écrits, quoi qu'il arrive ici.
  let annulation: AnnulationRefus | null = null;
  if (input.outcome === "refus") {
    const perdu = await passerEnPerduApresRefus(supabase, userId, input.prospectId, texte);
    if (perdu.error) return { error: perdu.error, activiteId: result.activiteId ?? null };
    annulation = perdu.annulation;
  }

  // « Pas décroché » (29/10) : c'est de toute façon une relance à faire — le
  // prochain jour ouvré, à l'autre moitié de la journée. « Suivi par email »
  // (31/10) : « Vérifier la réponse au mail », 2 jours ouvrés plus tard à 9h.
  // Jamais par-dessus une date dite, une relance déjà prévue ou un RDV.
  const rappelAuto = await poserRappelAuto(supabase, userId, input.prospectId, input.outcome, {
    dateHumaine: Boolean(input.dateLocale),
  });

  revalidateProspect(input.prospectId);
  if (input.rendezVous) revalidatePath("/agenda");
  return {
    annulation,
    rappelAuto,
    activiteId: result.activiteId ?? null,
    autoStatus: result.autoStatus,
    autoReason: result.autoReason,
    conflit: result.conflit ?? null,
  };
}

/**
 * Compléter le résultat qu'on vient d'enregistrer : la phrase dictée après le
 * tap, ou la date de rappel choisie d'un clic. Le tap a déjà écrit — on ne
 * réécrit pas une seconde entrée de journal pour autant.
 *
 * La relance passe par `saveExchangeCore` SANS texte : il ne crée alors
 * aucune activité et se contente de sa cadence (tâche ouverte re-datée,
 * surnuméraires annulées) — un seul endroit sait poser une relance.
 */
export async function preciserResultatAction(input: {
  prospectId: string;
  activiteId: string;
  texte?: string | null;
  /** Une autre pastille tapée juste après : on CORRIGE, on n'empile pas. */
  outcome?: string | null;
  dateLocale?: string | null;
  rendezVous?: boolean;
  rdvLieu?: string | null;
  rdvFin?: string | null;
  /** Ce que le « Pas intéressé » corrigé avait fait — pour le défaire. */
  annulation?: unknown;
  /** La relance posée d'office par le tap corrigé (ISO) : re-datée, pas gardée. */
  rappelAutoPrecedent?: string | null;
}): Promise<ActionState & { annulation?: AnnulationRefus | null; rappelAuto?: string | null }> {
  const { supabase, userId } = await currentUserId();
  const texte = input.texte?.trim().slice(0, 300) || null;
  const correction = estResultatSaisissable(input.outcome) ? input.outcome : null;
  let annulation: AnnulationRefus | null | undefined = undefined;
  let rappelAuto: string | null = null;

  if (texte || correction) {
    // La RLS tranche : un membre ne modifie que ses propres entrées
    // (activities_update : is_admin() ou author_id = auth.uid()).
    const patch: Record<string, unknown> = {};
    if (texte) patch.subject = texte;
    if (correction) {
      patch.outcome = correction;
      // Même règle qu'à l'écriture : seul « pas de réponse » n'atteste rien.
      patch.is_exchange = correction !== "sans_reponse";
    }
    const { data: ligne, error } = await supabase
      .from("activities")
      .update(patch)
      .eq("id", input.activiteId)
      .select("outcome")
      .maybeSingle();
    if (error) return { error: error.message };
    if (!ligne) return { error: "Entrée introuvable." };

    // « Pas intéressé » : la raison vit AUSSI sur la fiche.
    if (ligne.outcome === "refus" && texte) {
      await supabase
        .from("prospects")
        .update({ lost_reason: texte })
        .eq("id", input.prospectId);
    }

    // « Pas intéressé » ↔ autre chose (29/10) : corrigé EN « Pas intéressé »,
    // la fiche passe en Perdu ; corrigé DEPUIS « Pas intéressé », elle revient
    // à son étape d'avant, ses relances avec — avant la réévaluation.
    if (correction === "refus") {
      const perdu = await passerEnPerduApresRefus(supabase, userId, input.prospectId, texte);
      if (perdu.error) return { error: perdu.error };
      annulation = perdu.annulation;
    } else if (correction) {
      const aDefaire = lireAnnulation(input.annulation, STATUS_ORDER);
      if (aDefaire) await defairePerdu(supabase, input.prospectId, aDefaire);
      annulation = null;
    }

    // Une correction change ce que les FAITS disent : l'étape et la confiance
    // se réévaluent, avec les mêmes garde-fous qu'ailleurs (jamais de recul,
    // jamais par-dessus un verrou).
    if (correction) {
      await applyAutoStatus(supabase, input.prospectId);
      await recalcConfidence(supabase, input.prospectId);
    }
  }

  if (input.dateLocale) {
    const res = await saveExchangeCore(supabase, userId, {
      prospectId: input.prospectId,
      type: input.rendezVous ? "rendez_vous" : "note",
      dateLocale: input.dateLocale,
      rdvLieu: input.rdvLieu ?? null,
      rdvFin: input.rdvFin ?? null,
    });
    if (res.error) return { error: res.error };
    if (input.rendezVous) revalidatePath("/agenda");
  } else if (correction) {
    // Corrigé EN « Pas décroché » ou « Suivi par email » : la même relance
    // qu'au tap. Celle que le tap corrigé avait posée ne compte pas comme
    // « déjà prévue » : elle est re-datée (jamais de doublon).
    rappelAuto = await poserRappelAuto(supabase, userId, input.prospectId, correction, {
      remplace: typeof input.rappelAutoPrecedent === "string" ? input.rappelAutoPrecedent : null,
    });
  }

  revalidateProspect(input.prospectId);
  return {
    success: "Enregistré.",
    ...(annulation !== undefined ? { annulation } : {}),
    ...(rappelAuto ? { rappelAuto } : {}),
  };
}

// =====================================================================
// Activités
// =====================================================================

/**
 * Suppression d'une entrée du journal — réservée à l'admin.
 *
 * La RLS reste l'unique garde-fou de sécurité (un commercial n'atteint de
 * toute façon que ses fiches) ; ce contrôle-ci est la règle métier demandée :
 * l'historique d'un échange ne s'efface pas d'un doigt qui glisse. La
 * confirmation est exigée explicitement (`confirm=1`), et le composant
 * client la demande en deux temps.
 */
async function requireAdmin(): Promise<
  { supabase: Awaited<ReturnType<typeof createClient>>; userId: string } | null
> {
  const { supabase, userId } = await currentUserId();
  const { data: me } = await supabase
    .from("crm_users")
    .select("role, is_active")
    .eq("id", userId)
    .maybeSingle();
  if (!me || me.role !== "admin" || !me.is_active) return null;
  return { supabase, userId };
}

export async function deleteActivityAction(fd: FormData): Promise<ActionState> {
  const admin = await requireAdmin();
  if (!admin) return { error: "Suppression réservée à l'administrateur." };

  const id = str(fd, "id");
  const prospectId = str(fd, "prospect_id");
  if (!id) return { error: "Entrée introuvable." };
  if (str(fd, "confirm") !== "1") return { error: "Confirmation requise." };

  const { error } = await admin.supabase.from("activities").delete().eq("id", id);
  if (error) return { error: error.message };

  if (prospectId) revalidatePath(`/prospects/${prospectId}`);
  revalidatePath("/dashboard");
  return { success: "Entrée supprimée." };
}

/**
 * Suppression d'un email du journal — même règle. Un message réellement
 * envoyé ou reçu reste une trace : le composant client prévient plus
 * fermement avant de laisser cliquer.
 */
export async function deleteEmailAction(fd: FormData): Promise<ActionState> {
  const admin = await requireAdmin();
  if (!admin) return { error: "Suppression réservée à l'administrateur." };

  const id = str(fd, "id");
  const prospectId = str(fd, "prospect_id");
  if (!id) return { error: "Message introuvable." };
  if (str(fd, "confirm") !== "1") return { error: "Confirmation requise." };

  const { error } = await admin.supabase.from("emails").delete().eq("id", id);
  if (error) return { error: error.message };

  if (prospectId) revalidatePath(`/prospects/${prospectId}`);
  revalidatePath("/dashboard");
  revalidatePath("/emails");
  return { success: "Message supprimé." };
}

// =====================================================================
// Relances
// =====================================================================

export async function createTaskAction(fd: FormData): Promise<ActionState> {
  const { supabase, userId } = await currentUserId();

  // Une relance se pose sur une FICHE (18/10, migration 028) : le pense-bête
  // libre fabriquait des relances orphelines, sans lien ni « Résultat ». La
  // base le refuse aussi (23514) ; on le dit ici en clair, avant elle.
  if (!str(fd, "prospect_id")) {
    return { error: "Une relance se pose sur une fiche prospect — ouvrez la fiche pour la planifier." };
  }

  const due =
    dateInputToISO(str(fd, "due_local")) ??
    localInputToISO(str(fd, "due_at")) ??
    inDaysAt9(1);

  const assignee = str(fd, "assignee_id");

  // Perdu l'emporte (31/10) : pas de relance sur une fiche perdue.
  const { data: fiche } = await supabase
    .from("prospects")
    .select("status")
    .eq("id", str(fd, "prospect_id"))
    .maybeSingle();
  const refusPerdue = relanceRefuseeSurPerdue(fiche?.status);
  if (refusPerdue) return { error: refusPerdue };

  const { error } = await supabase.from("tasks").insert({
    prospect_id: str(fd, "prospect_id"),
    title: str(fd, "title") ?? "Relance",
    details: str(fd, "details"),
    due_at: due,
    priority: Number(str(fd, "priority") ?? 2),
    assignee_id: assignee === "none" ? null : (assignee ?? userId),
    created_by: userId,
  });
  if (error) return { error: error.message };

  const prospectId = str(fd, "prospect_id");
  // Un fait a pu apparaître (le rendez-vous, lui, vit dans l'agenda) :
  // applyAutoStatus confronte l'étape aux faits, et respecte le verrou.
  if (prospectId) {
    await applyAutoStatus(supabase, prospectId);
    await recalcConfidence(supabase, prospectId);
    revalidatePath(`/prospects/${prospectId}`);
  }
  revalidatePath("/dashboard");
  return { success: "Relance planifiée." };
}

/**
 * Les trois gestes sur une relance renvoient désormais leur issue au lieu de
 * la garder pour eux : l'écran bouge tout de suite (UI optimiste) et n'a le
 * droit de revenir en arrière que si le serveur a vraiment refusé.
 */
export async function completeTaskAction(fd: FormData): Promise<ActionState> {
  const { supabase } = await currentUserId();
  const id = str(fd, "id");
  if (!id) return { error: "Relance introuvable." };

  const done = str(fd, "done") === "1";
  const { error } = await supabase
    .from("tasks")
    .update({ status: done ? "fait" : "a_faire" })
    .eq("id", id);
  if (error) return { error: error.message };

  const prospectId = str(fd, "prospect_id");
  if (prospectId) revalidatePath(`/prospects/${prospectId}`);
  revalidatePath("/dashboard");
  return {};
}

/** Reprogramme une relance à une date précise (champ de date de TaskRow). */
export async function rescheduleTaskAction(fd: FormData): Promise<ActionState> {
  const { supabase } = await currentUserId();
  const id = str(fd, "id");
  const due = dateInputToISO(str(fd, "due_local"));
  if (!id || !due) return { error: "Date invalide." };

  const { error } = await supabase.from("tasks").update({ due_at: due }).eq("id", id);
  if (error) return { error: error.message };

  const prospectId = str(fd, "prospect_id");
  if (prospectId) revalidatePath(`/prospects/${prospectId}`);
  revalidatePath("/dashboard");
  return {};
}

export async function deleteTaskAction(fd: FormData): Promise<ActionState> {
  const { supabase } = await currentUserId();
  const id = str(fd, "id");
  if (!id) return { error: "Relance introuvable." };

  const { error } = await supabase.from("tasks").delete().eq("id", id);
  if (error) return { error: error.message };

  const prospectId = str(fd, "prospect_id");
  if (prospectId) revalidatePath(`/prospects/${prospectId}`);
  revalidatePath("/dashboard");
  return {};
}

// =====================================================================
// Agenda — les trois gestes du rendez-vous (lib/crm/agenda.ts)
// =====================================================================

export type RendezVousState = ActionState & {
  /** Chevauchement détecté — averti, jamais bloquant. */
  conflit?: MeetingConflit | null;
  /** Relances clôturées par la pose du rendez-vous (migration 022) — dites, pas demandées. */
  annulees?: RelanceAnnulee[];
};

function revalidateAgenda(prospectId?: string | null) {
  revalidatePath("/agenda");
  revalidatePath("/dashboard");
  // La prochaine action d'une fiche suit désormais ses rendez-vous (022) : la
  // liste et les colonnes la montrent.
  revalidatePath("/prospects");
  if (prospectId) revalidatePath(`/prospects/${prospectId}`);
}

export async function poserRendezVousAction(input: {
  prospectId?: string | null;
  /** true : rendez-vous personnel, sans prospect. */
  personnel?: boolean;
  title?: string | null;
  /** « YYYY-MM-DDTHH:mm » (Bruxelles) — l'heure est obligatoire. */
  startsAt: string;
  dureeMin?: number | null;
  location?: string | null;
  notes?: string | null;
}): Promise<RendezVousState> {
  const { supabase, userId } = await currentUserId();

  const r = await poserRendezVous(supabase, userId, {
    prospectId: input.personnel ? null : input.prospectId,
    kind: input.personnel ? "perso" : "prospect",
    title: input.title,
    startsAt: input.startsAt,
    dureeMin: input.dureeMin,
    location: input.location,
    notes: input.notes,
  });
  if (r.error) return { error: r.error };

  revalidateAgenda(input.personnel ? null : input.prospectId);
  return { conflit: r.conflit ?? null, annulees: r.annulees ?? [] };
}

export async function deplacerRendezVousAction(input: {
  id: string;
  startsAt: string;
  endsAt?: string | null;
  motif?: string | null;
}): Promise<RendezVousState> {
  const session = await getSession();
  if (!session) redirect("/login");
  const supabase = await createClient();

  // Le rôle est relu en base (getSession), jamais déclaré par le client. La
  // RLS scope de toute façon la lecture ; ce drapeau ne fait qu'autoriser
  // l'admin à déplacer un rendez-vous d'un membre depuis le mode équipe.
  const r = await deplacerRendezVous(supabase, session.userId, {
    ...input,
    isAdmin: session.me?.role === "admin",
  });
  if (r.error) return { error: r.error };

  revalidateAgenda(r.prospectId);
  return { conflit: r.conflit ?? null, annulees: r.annulees ?? [] };
}

export async function cloturerRendezVousAction(input: {
  id: string;
  /** L'issue (lib/crm/debrief.ts) — le débrief de la fiche et du tableau de bord. */
  issue?: IssueDebrief | null;
  /** L'ancien débrief sans issue — encore accepté. */
  resultat?: "honore" | "annule";
  compteRendu?: string | null;
  /** « Pas intéressé » : la raison, exigée. */
  raison?: string | null;
  /** « Et ensuite ? » : « YYYY-MM-DD » (09:00 Bruxelles) ou « YYYY-MM-DDTHH:mm », ou null. Exigée pour « à rappeler ». */
  suite?: string | null;
}): Promise<ActionState & { plusRien?: boolean }> {
  const session = await getSession();
  if (!session) redirect("/login");
  const supabase = await createClient();

  if (input.issue != null && !estIssueDebrief(input.issue)) {
    return { error: "Issue de rendez-vous inconnue." };
  }

  let suite: { dueAt: string } | null = null;
  if (input.suite) {
    const dueAt = dateInputToISO(input.suite);
    if (!dueAt) return { error: "Date de relance invalide." };
    suite = { dueAt };
  }

  const r = await cloturerRendezVous(supabase, session.userId, {
    id: input.id,
    issue: input.issue ?? null,
    resultat: input.resultat,
    compteRendu: input.compteRendu,
    raison: input.raison,
    suite,
    isAdmin: session.me?.role === "admin",
  });
  if (r.error) return { error: r.error };

  revalidateAgenda(r.prospectId);
  return { plusRien: r.plusRien ?? false };
}

// =====================================================================
// Recherche globale (en-tête, ⌘K ou « / »)
// =====================================================================

export type ResultatRecherche = {
  id: string;
  company_name: string;
  contact_name: string | null;
  phone: string | null;
  city: string | null;
  status: ProspectStatus;
};

/**
 * Les fiches qui correspondent au texte tapé — société, contact, email,
 * ville, téléphone (lib/crm/recherche.ts, la même règle que /prospects).
 * Client de l'UTILISATEUR, donc sous la RLS : chacun ne retrouve que ce qu'il
 * voit déjà (commercial seul, porteur d'équipe, encadrant, admin). Aucun
 * périmètre d'affichage ici : chercher une fiche, c'est chercher partout où
 * l'on a le droit de regarder.
 */
export async function rechercherProspectsAction(
  q: string
): Promise<{ resultats: ResultatRecherche[]; error?: string }> {
  const session = await getSession();
  if (!session?.me?.is_active) return { resultats: [] };
  const filtre = filtreRecherche(q);
  if (!filtre) return { resultats: [] };
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("prospects")
    .select("id, company_name, contact_name, phone, city, status")
    .or(filtre)
    .order("company_name", { ascending: true })
    .limit(8);
  if (error) return { resultats: [], error: error.message };
  return {
    resultats: ((data ?? []) as ResultatRecherche[]).map((r) => ({
      ...r,
      status: normalizeStatus(r.status),
    })),
  };
}

// =====================================================================
// Compte
// =====================================================================

export async function updateMyProfileAction(
  _prev: ActionState,
  fd: FormData
): Promise<ActionState> {
  const { supabase, userId } = await currentUserId();

  const { error } = await supabase
    .from("crm_users")
    .update({ full_name: str(fd, "full_name"), phone: str(fd, "phone") })
    .eq("id", userId);

  if (error) return { error: error.message };
  revalidatePath("/compte");
  return { success: "Profil mis à jour." };
}

export async function changeMyPasswordAction(
  _prev: ActionState,
  fd: FormData
): Promise<ActionState> {
  const { supabase, userId } = await currentUserId();

  const password = fd.get("password");
  const confirm = fd.get("confirm");

  if (typeof password !== "string" || password.length < 10) {
    return { error: "Le mot de passe doit contenir au moins 10 caractères." };
  }
  if (password !== confirm) {
    return { error: "Les deux mots de passe ne correspondent pas." };
  }

  const { error } = await supabase.auth.updateUser({ password });
  if (error) return { error: error.message };

  await supabase.from("crm_users").update({ must_change_password: false }).eq("id", userId);

  revalidatePath("/compte");
  return { success: "Mot de passe modifié." };
}

// =====================================================================
// Administration de l'équipe (via edge function crm-admin)
// =====================================================================

async function callAdmin(payload: Record<string, unknown>): Promise<ActionState> {
  const supabase = await createClient();
  const {
    data: { session },
  } = await supabase.auth.getSession();

  if (!session) return { error: "Session expirée, reconnectez-vous." };

  const res = await fetch(
    `${SUPABASE_URL}/functions/v1/crm-admin`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${session.access_token}`,
        apikey: SUPABASE_ANON_KEY,
      },
      body: JSON.stringify(payload),
      cache: "no-store",
    }
  );

  let body: { error?: string } = {};
  try {
    body = await res.json();
  } catch {
    /* réponse non JSON */
  }

  if (!res.ok) return { error: body.error ?? `Erreur ${res.status}` };
  return {};
}

export async function adminCreateUserAction(
  _prev: ActionState,
  fd: FormData
): Promise<ActionState> {
  const password = String(fd.get("password") ?? "");
  if (password.length < 10) {
    return { error: "Le mot de passe provisoire doit faire au moins 10 caractères." };
  }

  const result = await callAdmin({
    action: "create_user",
    email: str(fd, "email"),
    full_name: str(fd, "full_name"),
    role: str(fd, "role") ?? "commercial",
    password,
  });

  if (result.error) return result;
  revalidatePath("/equipe");
  return { success: `Compte créé. Mot de passe provisoire : ${password}` };
}

export async function adminUpdateUserAction(fd: FormData) {
  const action = String(fd.get("op") ?? "");
  const userId = str(fd, "user_id");
  if (!userId) return;

  if (action === "set_active") {
    await callAdmin({
      action: "set_active",
      user_id: userId,
      is_active: str(fd, "is_active") === "1",
    });
  } else if (action === "set_role") {
    await callAdmin({ action: "set_role", user_id: userId, role: str(fd, "role") });
  } else if (action === "delete_user") {
    await callAdmin({ action: "delete_user", user_id: userId });
  } else if (action === "set_voit_equipe") {
    // L'interrupteur « travaille en équipe » (migration 020).
    //
    // Écrit EN DIRECT, pas via l'edge function `crm-admin` : la policy
    // `crm_users_update_admin` autorise déjà un admin à écrire cette colonne
    // (vérifié en base), et le trigger `guard_profile_privileges` refuse la
    // même écriture à un non-admin — y compris sur SA PROPRE ligne, sans quoi
    // un commercial se cocherait lui-même et entrerait dans le partage. Rien à
    // redéployer côté Deno, donc rien à faire dériver du dépôt.
    //
    // Le rôle est quand même revérifié ICI : masquer un bouton n'a jamais
    // interdit d'appeler la route. Deux verrous, comme partout ailleurs.
    const session = await getSession();
    if (session?.me?.role !== "admin" || !session.me.is_active) return;
    const supabase = await createClient();
    await supabase
      .from("crm_users")
      .update({ voit_equipe: str(fd, "voit_equipe") === "1" })
      .eq("id", userId);
  } else if (action === "set_encadrement") {
    // L'encadrement (migration 021) : une LIGNE, pas une colonne.
    //
    // `user_id` est l'ENCADRÉ (c'est sa carte qu'on manipule), `encadrant_id`
    // celui qui gagne le droit de regard. Les deux noms sont pris dans ce
    // sens-là partout — les intervertir donnerait un lien silencieusement
    // inversé, et un lien inversé ne lève aucune erreur : il ouvre juste la
    // mauvaise porte.
    //
    // Écrit EN DIRECT, comme `set_voit_equipe` : les policies de `supervision`
    // réservent déjà l'écriture à `is_admin()` (vérifié en base — un commercial
    // qui tente l'insertion reçoit 42501), donc rien à faire passer par l'edge
    // function `crm-admin`.
    //
    // Le rôle est quand même revérifié ICI. Deux verrous, comme partout :
    // masquer un bouton n'a jamais interdit d'appeler la route, et c'est le
    // seul garde-fou contre quelqu'un qui se nommerait encadrant lui-même.
    const session = await getSession();
    if (session?.me?.role !== "admin" || !session.me.is_active) return;
    const encadrantId = str(fd, "encadrant_id");
    // Une ligne « X encadre X » serait refusée par la contrainte
    // `supervision_pas_soi_meme` ; on ne la propose pas, on ne l'envoie pas.
    if (!encadrantId || encadrantId === userId) return;
    const supabase = await createClient();
    const { error } =
      str(fd, "encadre") === "1"
        ? await supabase
            .from("supervision")
            .upsert(
              { encadrant_id: encadrantId, commercial_id: userId },
              { onConflict: "encadrant_id,commercial_id" }
            )
        : await supabase
            .from("supervision")
            .delete()
            .eq("encadrant_id", encadrantId)
            .eq("commercial_id", userId);
    // Tolérant comme les lectures : tant que la migration 021 n'est pas
    // appliquée, l'écran ne propose plus les cases (encadrementDisponible) ;
    // une requête qui arriverait quand même ne fait rien, et le dit dans les
    // journaux au lieu de lever une erreur brute.
    if (estTableAbsente(error)) {
      console.warn("[equipe] set_encadrement ignoré : table supervision absente (migration 021 non appliquée).");
    } else if (error) {
      console.error(`[equipe] set_encadrement : ${error.message}`);
    }
  }

  revalidatePath("/equipe");
  revalidatePath("/dashboard");
  revalidatePath("/prospects");
  revalidatePath("/agenda");
}

export async function adminResetPasswordAction(
  _prev: ActionState,
  fd: FormData
): Promise<ActionState> {
  const password = String(fd.get("password") ?? "");
  if (password.length < 10) {
    return { error: "Minimum 10 caractères." };
  }

  const result = await callAdmin({
    action: "set_password",
    user_id: str(fd, "user_id"),
    password,
  });

  if (result.error) return result;
  revalidatePath("/equipe");
  return { success: `Nouveau mot de passe : ${password}` };
}

// =====================================================================
// Vue en colonnes — glisser-déposer
// =====================================================================

/**
 * Glisser-déposer d'une colonne à l'autre : c'est une correction humaine,
 * au même titre que le sélecteur de la fiche. Elle verrouille l'étape.
 */
export async function moveProspectAction(id: string, status: ProspectStatus) {
  const { supabase } = await currentUserId();

  const { error } = await supabase
    .from("prospects")
    .update(manualStatusPatch(normalizeStatus(status)))
    .eq("id", id);
  if (error) throw new Error(error.message);

  await recalcConfidence(supabase, id);

  revalidateProspect(id);
}

// =====================================================================
// Import CSV
// =====================================================================

export async function importProspectsAction(
  rows: ImportRow[],
  ownerId: string | null
): Promise<ImportResult> {
  const { supabase, userId } = await currentUserId();
  // Seul l'admin choisit le responsable d'un import (031 : `prospects_insert`
  // refuserait de toute façon une fiche posée au nom d'un autre).
  const session = await getSession();
  const owner = session?.me?.role === "admin" ? ownerId : userId;

  const result = await importProspectsCore(supabase, userId, rows, owner);

  if (result.inserted > 0) {
    revalidatePath("/prospects");
    revalidatePath("/dashboard");
  }
  return result;
}

// =====================================================================
// Objectifs (031) — l'admin seul ; la RLS le revérifie (`objectifs_ecriture`)
// =====================================================================

/**
 * Pose les objectifs d'une SEMAINE (appels, réponses, RDV) et ceux de la
 * PÉRIODE (essais, depuis le début du Sales Trophy) pour une ou plusieurs
 * personnes. Une valeur absente ne crée rien ; la semaine est désignée par
 * son lundi (la base le vérifie aussi).
 */
export async function poserObjectifsAction(input: {
  semaine: string;
  lignes: {
    userId: string;
    appels: number | null;
    reponses: number | null;
    rdv: number | null;
    essais: number | null;
  }[];
}): Promise<ActionState> {
  const ctx = await requireAdmin();
  if (!ctx) return { error: "Seul l'administrateur pose les objectifs." };
  const { supabase, userId } = ctx;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(input.semaine) || lundiDe(input.semaine) !== input.semaine) {
    return { error: "Semaine invalide : elle se désigne par son lundi." };
  }
  const n = (v: number | null) =>
    v === null || v === undefined || !Number.isFinite(v) ? null : Math.max(0, Math.min(10000, Math.round(v)));
  const lignes = (Array.isArray(input.lignes) ? input.lignes : []).slice(0, 100);
  const semaine = lignes
    .filter((l) => [l.appels, l.reponses, l.rdv].some((v) => n(v) !== null))
    .map((l) => ({
      user_id: l.userId,
      semaine: input.semaine,
      appels: n(l.appels) ?? 0,
      reponses: n(l.reponses) ?? 0,
      rdv: Math.min(1000, n(l.rdv) ?? 0),
      updated_by: userId,
      updated_at: new Date().toISOString(),
    }));
  const periode = lignes
    .filter((l) => n(l.essais) !== null)
    .map((l) => ({
      user_id: l.userId,
      debut: DEBUT_SALES_TROPHY,
      essais: Math.min(1000, n(l.essais)!),
      updated_by: userId,
      updated_at: new Date().toISOString(),
    }));
  if (semaine.length === 0 && periode.length === 0) return { error: "Rien à enregistrer." };
  if (semaine.length) {
    const { error } = await supabase.from("objectifs").upsert(semaine, { onConflict: "user_id,semaine" });
    if (error) return { error: estTableAbsente(error) ? "Les objectifs demandent la migration 031." : error.message };
  }
  if (periode.length) {
    const { error } = await supabase.from("objectifs_periode").upsert(periode, { onConflict: "user_id,debut" });
    if (error) return { error: estTableAbsente(error) ? "Les objectifs demandent la migration 031." : error.message };
  }
  revalidatePath("/equipe");
  revalidatePath("/dashboard");
  revalidatePath("/classement");
  const k = new Set([...semaine.map((x) => x.user_id), ...periode.map((x) => x.user_id)]).size;
  return { success: `Objectifs enregistrés pour ${k} personne${k > 1 ? "s" : ""}.` };
}
