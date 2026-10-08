"use server";

/**
 * Les gestes de l'admin sur les appels de Janet — écran Appels IA, fiche
 * prospect, colonne « Appels ». ADMIN SEUL, revérifié ici à chaque geste :
 * masquer un bouton n'a jamais interdit d'appeler une action.
 *
 * Les écritures passent par la session de l'admin (la RLS `is_admin()` borne
 * tout). Seuls les deux gestes qui COMPOSENT — « Appeler avec Janet » et
 * « Appel de test vers mon GSM » — passent par le moteur, en service_role
 * (lib/appelsIa/acces.ts), après la vérification du rôle.
 */

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { getSession } from "@/lib/auth";
import { numeroAppelable } from "@/lib/appelsIa/numeros";
import { composerSuivant, lancerAppelTest } from "@/lib/appelsIa/moteur";
import { campagneSysteme, inscrire } from "@/lib/appelsIa/inscription";
import { depuisSaisie, fusionner, normaliserContenu, CHAMPS_LISTES, CHAMPS_SIMPLES, type SaisieBrief } from "@/lib/appelsIa/brief";
import { preparerBrief } from "@/lib/appelsIa/briefIA";
import { partiesBruxelles } from "@/lib/appelsIa/calendrier";
import { SECTEURS, type Secteur } from "@/lib/appelsIa/secteur";

export type EtatAction = { ok?: boolean; error?: string; message?: string };

async function admin(): Promise<{ id: string } | null> {
  const session = await getSession();
  const me = session?.me;
  if (!me || me.role !== "admin" || !me.is_active) return null;
  return { id: session!.userId };
}

const REFUS = { error: "Réservé à l'administrateur." };

function revalider(prospectId?: string | null) {
  revalidatePath("/appels-ia");
  revalidatePath("/dashboard");
  if (prospectId) revalidatePath(`/prospects/${prospectId}`);
}

const str = (fd: FormData, k: string): string => {
  const v = fd.get(k);
  return typeof v === "string" ? v.trim() : "";
};

// ---------------------------------------------------------------------------
// Réglages
// ---------------------------------------------------------------------------

const HEURE = /^([01]\d|2[0-3]):[0-5]\d$/;

export async function reglerAppelsAction(_prev: EtatAction, fd: FormData): Promise<EtatAction> {
  const moi = await admin();
  if (!moi) return REFUS;
  const patch: Record<string, unknown> = { maj_par: moi.id };

  for (const champ of ["numero_appelant", "gsm_test"] as const) {
    if (!fd.has(champ)) continue;
    const brut = str(fd, champ);
    if (!brut) {
      patch[champ] = null;
      continue;
    }
    const e164 = numeroAppelable(brut);
    if (!e164) return { error: `${champ === "gsm_test" ? "GSM de test" : "Numéro appelant"} : numéro belge invalide.` };
    patch[champ] = e164;
  }
  if (fd.has("trunk_url")) {
    const t = str(fd, "trunk_url");
    if (!/^sips:[a-z0-9.-]+(:[0-9]{2,5})?(;transport=tcp)?$/.test(t)) return { error: "URL du trunk : attendu « sips:hôte:5061 »." };
    patch.trunk_url = t;
  }
  for (const champ of ["fenetre_debut", "fenetre_fin"] as const) {
    if (!fd.has(champ)) continue;
    const h = str(fd, champ);
    if (!HEURE.test(h)) return { error: "Fenêtre d'appel : heures au format HH:MM." };
    patch[champ] = h;
  }
  const entiers: [string, number, number][] = [
    ["plafond_heure", 1, 60],
    ["plafond_jour", 1, 1000],
    ["limite_compte_heure", 1, 1000],
    ["limite_compte_jour", 1, 10000],
    ["duree_max_s", 60, 330],
    ["sonnerie_max_s", 15, 120],
  ];
  for (const [champ, min, max] of entiers) {
    if (!fd.has(champ)) continue;
    const n = Number(str(fd, champ));
    if (!Number.isInteger(n) || n < min || n > max) return { error: `${champ.replace(/_/g, " ")} : entre ${min} et ${max}.` };
    patch[champ] = n;
  }
  for (const champ of ["voix", "modele_delegation"] as const) {
    if (!fd.has(champ)) continue;
    const v = str(fd, champ).toLowerCase();
    if (!/^[a-z0-9.-]{2,60}$/.test(v)) return { error: `${champ === "voix" ? "Voix" : "Modèle"} : valeur invalide.` };
    patch[champ] = v;
  }

  const supabase = await createClient();
  const { error } = await supabase.from("appels_ia_reglages").update(patch).eq("id", 1);
  if (error) {
    if (error.code === "23514") return { error: "Les plafonds doivent rester sous les limites du compte Telnyx, et la fenêtre commencer avant de finir." };
    return { error: error.message };
  }
  revalider();
  return { ok: true, message: "Réglages enregistrés." };
}

/** L'interrupteur général, le mode test, l'inscription automatique. */
export async function basculerAppelsAction(champ: "actif" | "mode_test" | "inscription_auto", valeur: boolean): Promise<EtatAction> {
  const moi = await admin();
  if (!moi) return REFUS;
  if (!["actif", "mode_test", "inscription_auto"].includes(champ)) return { error: "Réglage inconnu." };
  const patch: Record<string, unknown> = { [champ]: valeur, maj_par: moi.id };
  // L'inscription automatique inscrit les fiches DE L'ADMIN QUI L'ALLUME.
  if (champ === "inscription_auto" && valeur) patch.inscription_auto_par = moi.id;
  const supabase = await createClient();
  const { error } = await supabase.from("appels_ia_reglages").update(patch).eq("id", 1);
  if (error) return { error: error.message };
  revalider();
  return { ok: true };
}

export async function leverPauseAction(): Promise<EtatAction> {
  const moi = await admin();
  if (!moi) return REFUS;
  const supabase = await createClient();
  const { error } = await supabase.from("appels_ia_reglages").update({ pause_cause: null, pause_at: null, maj_par: moi.id }).eq("id", 1);
  if (error) return { error: error.message };
  revalider();
  return { ok: true, message: "Pause levée." };
}

/** Un secret, posé dans le Vault. Il ne ressort jamais, ni ici ni ailleurs. */
export async function poserSecretAction(_prev: EtatAction, fd: FormData): Promise<EtatAction> {
  const moi = await admin();
  if (!moi) return REFUS;
  const nom = str(fd, "nom");
  const valeur = typeof fd.get("valeur") === "string" ? String(fd.get("valeur")) : "";
  if (!["openai_api_key", "sip_identifiant", "sip_mot_de_passe"].includes(nom)) return { error: "Secret inconnu." };
  if (!valeur.trim()) return { error: "La valeur est vide." };
  const supabase = await createClient();
  const { error } = await supabase.rpc("appels_ia_poser_secret", { p_nom: nom, p_valeur: valeur });
  if (error) return { error: error.code === "42501" ? REFUS.error : error.message };
  revalider();
  return { ok: true, message: "Secret enregistré." };
}

// ---------------------------------------------------------------------------
// Scripts
// ---------------------------------------------------------------------------

export async function enregistrerScriptAction(_prev: EtatAction, fd: FormData): Promise<EtatAction> {
  const moi = await admin();
  if (!moi) return REFUS;
  const secteur = str(fd, "secteur") as Secteur;
  if (!SECTEURS.includes(secteur)) return { error: "Secteur inconnu." };
  const champs = ["accueil", "presentation", "objectif", "questions", "objections"] as const;
  const patch: Record<string, unknown> = { maj_par: moi.id };
  for (const c of champs) patch[c] = str(fd, c).slice(0, 2000);
  const supabase = await createClient();
  const { error } = await supabase.from("appels_ia_scripts").update(patch).eq("secteur", secteur);
  if (error) return { error: error.message };
  revalider();
  return { ok: true, message: "Script enregistré." };
}

// ---------------------------------------------------------------------------
// La file, les campagnes, l'opposition
// ---------------------------------------------------------------------------

/** Sans `confirmer` : compte seulement. Pas de rattrapage silencieux. */
export async function rattrapageAction(confirmer: boolean): Promise<EtatAction & { nombre?: number }> {
  const moi = await admin();
  if (!moi) return REFUS;
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("appels_ia_rattrapage", { p_confirmer: confirmer });
  if (error) return { error: error.message };
  const nombre = typeof data === "number" ? data : 0;
  if (confirmer) revalider();
  return {
    ok: true,
    nombre,
    message: confirmer ? `${nombre} fiche${nombre > 1 ? "s" : ""} inscrite${nombre > 1 ? "s" : ""} dans la file.` : undefined,
  };
}

export async function creerCampagneAction(_prev: EtatAction, fd: FormData): Promise<EtatAction> {
  const moi = await admin();
  if (!moi) return REFUS;
  const nom = str(fd, "nom").slice(0, 120);
  if (!nom) return { error: "Donnez un nom à la campagne." };
  const supabase = await createClient();
  const { error } = await supabase.from("appels_ia_campagnes").insert({ nom, cree_par: moi.id });
  if (error) return { error: error.message };
  revalider();
  return { ok: true, message: "Campagne créée." };
}

export async function statutCampagneAction(id: string, statut: "active" | "pause" | "terminee"): Promise<EtatAction> {
  const moi = await admin();
  if (!moi) return REFUS;
  if (!["active", "pause", "terminee"].includes(statut)) return { error: "Statut inconnu." };
  const supabase = await createClient();
  const { error } = await supabase.from("appels_ia_campagnes").update({ statut }).eq("id", id);
  if (error) return { error: error.code === "23514" ? "Une campagne système se met en pause, elle ne se termine pas." : error.message };
  // Une campagne terminée ne garde rien en attente : aucune relance orpheline.
  if (statut === "terminee") {
    await supabase
      .from("appels_ia_file")
      .update({ statut: "arrete", fin_motif: "campagne terminée", fin_at: new Date().toISOString() })
      .eq("campagne_id", id)
      .eq("statut", "en_attente");
  }
  revalider();
  return { ok: true };
}

export async function retirerDeLaFileAction(fileId: string): Promise<EtatAction> {
  const moi = await admin();
  if (!moi) return REFUS;
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("appels_ia_file")
    .update({ statut: "arrete", fin_motif: "retirée à la main", fin_at: new Date().toISOString() })
    .eq("id", fileId)
    .eq("statut", "en_attente")
    .select("prospect_id")
    .maybeSingle();
  if (error) return { error: error.message };
  if (!data) return { error: "Cette ligne n'est plus en attente." };
  revalider((data as { prospect_id: string }).prospect_id);
  return { ok: true };
}

/** Vider la file de TEST : une file de test ne devient jamais de vrais appels. */
export async function viderFileTestAction(): Promise<EtatAction> {
  const moi = await admin();
  if (!moi) return REFUS;
  const supabase = await createClient();
  const { error } = await supabase
    .from("appels_ia_file")
    .update({ statut: "arrete", fin_motif: "file de test vidée", fin_at: new Date().toISOString() })
    .eq("mode_test", true)
    .eq("statut", "en_attente");
  if (error) return { error: error.message };
  revalider();
  return { ok: true, message: "File de test vidée." };
}

export async function ajouterOppositionAction(_prev: EtatAction, fd: FormData): Promise<EtatAction> {
  const moi = await admin();
  if (!moi) return REFUS;
  const numero = numeroAppelable(str(fd, "numero"));
  if (!numero) return { error: "Numéro belge invalide." };
  const supabase = await createClient();
  const { error } = await supabase
    .from("appels_ia_opposition")
    .upsert({ numero, motif: str(fd, "motif").slice(0, 300) || null, source: "manuel", cree_par: moi.id }, { onConflict: "numero", ignoreDuplicates: true });
  if (error) return { error: error.message };
  revalider();
  return { ok: true, message: "Numéro ajouté à la liste d'opposition." };
}

export async function retirerOppositionAction(numero: string): Promise<EtatAction> {
  const moi = await admin();
  if (!moi) return REFUS;
  const supabase = await createClient();
  const { error } = await supabase.from("appels_ia_opposition").delete().eq("numero", numero);
  if (error) return { error: error.message };
  revalider();
  return { ok: true };
}

// ---------------------------------------------------------------------------
// Composer
// ---------------------------------------------------------------------------

/**
 * « Appeler avec Janet », depuis la fiche : la fiche entre dans la file en
 * tête (ou y remonte), et le moteur compose tout de suite s'il en a le droit
 * — sinon il dit pourquoi, et la fiche attend son tour.
 */
export async function appelerAvecJanetAction(prospectId: string): Promise<EtatAction> {
  const moi = await admin();
  if (!moi) return REFUS;
  const supabase = await createClient();
  const { data: deja } = await supabase
    .from("appels_ia_file")
    .select("id, statut")
    .eq("prospect_id", prospectId)
    .in("statut", ["en_attente", "en_cours"])
    .maybeSingle();
  if ((deja as { statut?: string } | null)?.statut === "en_cours") return { ok: true, message: "Janet est déjà en train d'appeler cette fiche." };
  if (deja) {
    await supabase
      .from("appels_ia_file")
      .update({ priorite: 1, pas_avant: new Date().toISOString() })
      .eq("id", (deja as { id: string }).id)
      .eq("statut", "en_attente");
  } else {
    let camp: string;
    try {
      camp = await campagneSysteme(supabase, "fiche", moi.id);
    } catch (e) {
      return { error: String((e as Error)?.message ?? e) };
    }
    const refus = await inscrire(supabase, { prospectId, campagneId: camp, origine: "fiche", parId: moi.id, priorite: 1, pasAvant: new Date() });
    if (refus) return { error: refus };
  }
  const issue = await composerSuivant(createAdminClient());
  revalider(prospectId);
  return { ok: true, message: issue.compose ? "Janet appelle." : `En file. ${issue.message}` };
}

/** Un appel de test vers le GSM de l'admin, avec le brief d'une fiche (ou une fiche fictive). */
export async function appelTestAction(prospectId: string | null): Promise<EtatAction> {
  const moi = await admin();
  if (!moi) return REFUS;
  const issue = await lancerAppelTest(createAdminClient(), { prospectId: prospectId || null, parId: moi.id });
  revalider(prospectId);
  return issue.compose ? { ok: true, message: "Appel de test lancé vers votre GSM." } : { error: issue.message };
}

// ---------------------------------------------------------------------------
// Le brief d'appel
// ---------------------------------------------------------------------------

export async function enregistrerBriefAction(prospectId: string, _prev: EtatAction, fd: FormData): Promise<EtatAction> {
  const moi = await admin();
  if (!moi) return REFUS;
  const jour = partiesBruxelles(new Date()).ymd;
  const saisie: SaisieBrief = {};
  for (const k of CHAMPS_SIMPLES) saisie[k] = str(fd, k);
  for (const k of CHAMPS_LISTES) saisie[k] = str(fd, k);
  const supabase = await createClient();
  const { data: b, error: el } = await supabase.from("appels_ia_briefs").select("contenu").eq("prospect_id", prospectId).maybeSingle();
  if (el) return { error: el.message };
  const existant = normaliserContenu((b as { contenu?: unknown } | null)?.contenu, jour);
  const propose = depuisSaisie(saisie, "bora", jour);
  // Un champ vidé à la main est retiré ; un champ inchangé garde sa source.
  const contenu = { ...fusionner(existant, propose, "remplacer") } as Record<string, unknown>;
  for (const k of [...CHAMPS_SIMPLES, ...CHAMPS_LISTES]) {
    if (!saisie[k]) delete contenu[k];
    else {
      const avant = (existant as Record<string, unknown>)[k];
      const texteAvant = Array.isArray(avant)
        ? (avant as { texte: string }[]).map((i) => i.texte).join("\n")
        : (avant as { texte?: string } | undefined)?.texte ?? "";
      if (texteAvant.trim() === String(saisie[k]).trim()) contenu[k] = avant;
    }
  }
  const { error } = await supabase
    .from("appels_ia_briefs")
    .upsert({ prospect_id: prospectId, contenu, etat: "pret", maj_par: moi.id }, { onConflict: "prospect_id" });
  if (error) return { error: error.message };
  revalider(prospectId);
  return { ok: true, message: "Brief enregistré." };
}

export async function preparerBriefAction(prospectId: string): Promise<EtatAction> {
  const moi = await admin();
  if (!moi) return REFUS;
  const etat = await preparerBrief(createAdminClient(), prospectId);
  revalider(prospectId);
  return etat === "pret" ? { ok: true, message: "Brief préparé par l'IA." } : { ok: true, message: "IA indisponible : le brief reprend ce que dit la fiche." };
}
