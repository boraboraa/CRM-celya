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
import { REFUS_REEL_SANS_TEST, SECRETS_JANET, refusAppelTest, refusLancement } from "@/lib/appelsIa/ecran";
import { lireTestReussi } from "@/lib/appelsIa/lectures";
import { numeroLisible } from "@/lib/appelsIa/numeros";
import { secteurDe } from "@/lib/appelsIa/secteur";
import { normalizeStatus } from "@/lib/constants";
import type { ProspectStatus } from "@/lib/types";

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
  const supabase = await createClient();
  // Sortir du mode test, c'est appeler de vrais prospects : seulement après un
  // appel de test décroché et terminé sans erreur. Revérifié ICI — l'écran
  // masque le geste, la règle vit côté serveur.
  if (champ === "mode_test" && !valeur && !(await lireTestReussi(supabase))) return { error: REFUS_REEL_SANS_TEST };
  const patch: Record<string, unknown> = { [champ]: valeur, maj_par: moi.id };
  // L'inscription automatique inscrit les fiches DE L'ADMIN QUI L'ALLUME.
  if (champ === "inscription_auto" && valeur) patch.inscription_auto_par = moi.id;
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
  if (!(SECRETS_JANET as readonly string[]).includes(nom)) return { error: "Secret inconnu." };
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

// ---------------------------------------------------------------------------
// L'assistant « Nouvelle campagne »
// ---------------------------------------------------------------------------

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
/** Ce que l'assistant affiche au plus d'un coup : au-delà, il demande de filtrer. */
const FICHES_MAX = 500;

export type FicheCampagne = {
  id: string;
  societe: string;
  contact: string | null;
  email: string | null;
  telephone: string | null;
  ville: string | null;
  secteur: ReturnType<typeof secteurDe>;
  etape: ProspectStatus;
  proprietaireId: string | null;
  /** La raison de la règle 025 (`appels_ia_simuler_inscription`), ou null : Janet pourra l'appeler. */
  refus: string | null;
};

/**
 * La simulation, par la règle EN BASE (migration 029 → `appels_ia_refus_inscription`,
 * la même que l'inscription réelle) : jamais une copie en TypeScript. Sous la
 * session de l'admin — la fonction le vérifie. Absente (029 non appliquée) :
 * on le dit, et rien ne se lance.
 */
async function simuler(
  supabase: Awaited<ReturnType<typeof createClient>>,
  ids: string[]
): Promise<{ refus: Map<string, string | null> } | { error: string }> {
  if (ids.length === 0) return { refus: new Map() };
  const { data, error } = await supabase.rpc("appels_ia_simuler_inscription", { p_prospects: ids });
  if (error) {
    if (error.code === "PGRST202" || error.code === "42883") {
      return { error: "La vérification des fiches n'est pas encore disponible (migration 029 non appliquée) : rien n'est lancé." };
    }
    return { error: error.code === "42501" ? REFUS.error : `Vérification impossible : ${error.message}` };
  }
  return { refus: new Map(((data ?? []) as { prospect_id: string; refus: string | null }[]).map((r) => [r.prospect_id, r.refus])) };
}

/**
 * Les fiches que l'assistant propose, avec, pour chacune, la raison pour
 * laquelle Janet ne l'appellerait pas (ou rien). L'étape et le propriétaire
 * filtrent en base ; le secteur, la ville et la recherche se filtrent à
 * l'écran, sur ces lignes (`correspond`, la règle de ⌘K).
 */
export async function fichesPourCampagneAction(f: {
  etape: string;
  proprietaire: string;
}): Promise<{ error?: string; fiches?: FicheCampagne[]; tronque?: boolean }> {
  const moi = await admin();
  if (!moi) return REFUS;
  const supabase = await createClient();
  let q = supabase
    .from("prospects")
    .select("id, company_name, contact_name, email, phone, city, sector, status, owner_id")
    .order("company_name", { ascending: true })
    .limit(FICHES_MAX + 1);
  if (f.etape === "ouvertes") q = q.not("status", "in", "(gagne,perdu)");
  else if (f.etape !== "toutes") q = q.eq("status", f.etape);
  if (f.proprietaire === "moi") q = q.eq("owner_id", moi.id);
  else if (UUID.test(f.proprietaire)) q = q.eq("owner_id", f.proprietaire);
  const { data, error } = await q;
  if (error) return { error: error.message };
  const lignes = (data ?? []) as {
    id: string;
    company_name: string;
    contact_name: string | null;
    email: string | null;
    phone: string | null;
    city: string | null;
    sector: string | null;
    status: string;
    owner_id: string | null;
  }[];
  const tronque = lignes.length > FICHES_MAX;
  const montrees = lignes.slice(0, FICHES_MAX);
  const sim = await simuler(
    supabase,
    montrees.map((l) => l.id)
  );
  // Simulation impossible : les fiches se listent quand même, toutes
  // « écartées » — rien ne se lance sans la règle, mais l'écran reste lisible.
  const indisponible = "error" in sim ? sim.error : null;
  const refus = "error" in sim ? new Map<string, string | null>() : sim.refus;
  return {
    error: indisponible ?? undefined,
    tronque,
    fiches: montrees.map((l) => ({
      id: l.id,
      societe: l.company_name,
      contact: l.contact_name,
      email: l.email,
      telephone: l.phone ? (numeroAppelable(l.phone) ? numeroLisible(numeroAppelable(l.phone)!) : l.phone) : null,
      ville: l.city,
      secteur: secteurDe(l.sector),
      etape: normalizeStatus(l.status),
      proprietaireId: l.owner_id,
      refus: refus.has(l.id) ? (refus.get(l.id) ?? null) : "Vérification impossible.",
    })),
  };
}

export type IssueLancement = EtatAction & {
  inscrites?: number;
  refusees?: { societe: string; raison: string }[];
};

/**
 * « Lancer la campagne » — dans cet ordre, et l'écran le dit :
 *
 *   0. ce qui doit être prêt : le numéro appelant, la connexion (les trois
 *      secrets), un appel de test réussi (`refusLancement`) ;
 *   1. la sélection est revérifiée par la règle en base (rien ne part si
 *      aucune fiche ne peut être appelée : pas de campagne vide) ;
 *   2. le MODE est posé AVANT l'inscription — une ligne de file garde le mode
 *      de son entrée : inscrire en test puis passer en réel laisserait des
 *      fiches que le moteur ne prendrait jamais. Le réel exige un appel de
 *      test réussi (revérifié ici) ;
 *   3. la campagne naît (ou repart, pour « Ajouter des fiches »), active ;
 *   4. chaque fiche passe par `appels_ia_inscrire` — le chemin du bouton de
 *      la fiche et du connecteur MCP ;
 *   5. l'inscription automatique, si elle est demandée (ses fiches vont dans
 *      la campagne « Inscription automatique », pas dans celle-ci) ;
 *   6. l'interrupteur général s'allume.
 */
export async function lancerCampagneAction(e: {
  nom?: string;
  campagneId?: string | null;
  ids: string[];
  reel: boolean;
  inscriptionAuto: boolean;
}): Promise<IssueLancement> {
  const moi = await admin();
  if (!moi) return REFUS;
  const ids = [...new Set((e.ids ?? []).filter((x) => typeof x === "string" && UUID.test(x)))];
  if (ids.length === 0) return { error: "Cochez au moins une fiche." };
  if (ids.length > 1000) return { error: "1 000 fiches au plus d'un coup." };
  const nom = (e.nom ?? "").trim().slice(0, 120);
  if (!e.campagneId && !nom) return { error: "Donnez un nom à la campagne." };

  const supabase = await createClient();
  const [{ data: reg, error: er }, sec, reussi] = await Promise.all([
    supabase.from("appels_ia_reglages").select("mode_test, pause_cause, numero_appelant, gsm_test").eq("id", 1).maybeSingle(),
    supabase.rpc("appels_ia_secrets_poses"),
    lireTestReussi(supabase),
  ]);
  if (er || !reg || sec.error) return { error: "Réglages illisibles : rien n'est lancé." };
  const r = reg as { mode_test: boolean; pause_cause: string | null; numero_appelant: string | null; gsm_test: string | null };

  // 0. Ce qui doit être prêt : le numéro appelant, la connexion, un test
  //    réussi. La même phrase que l'écran (`refusLancement`), revérifiée ici.
  const bloque = refusLancement({
    numeroAppelant: r.numero_appelant,
    gsmTest: r.gsm_test,
    secretsPoses: ((sec.data ?? []) as { nom: string }[]).map((x) => x.nom),
    testReussi: reussi,
  });
  if (bloque) return { error: bloque };

  // 1. La sélection, revérifiée.
  const sim = await simuler(supabase, ids);
  if ("error" in sim) return { error: sim.error };
  const appelables = ids.filter((id) => sim.refus.has(id) && sim.refus.get(id) === null);
  if (appelables.length === 0) return { error: "Aucune des fiches cochées ne peut être appelée : rien n'est lancé." };

  // 2. Le mode, avant l'inscription.
  //    (Le réel exige un test réussi : c'est déjà acquis à l'étape 0.)
  if (e.reel === r.mode_test) {
    const { error } = await supabase.from("appels_ia_reglages").update({ mode_test: !e.reel, maj_par: moi.id }).eq("id", 1);
    if (error) return { error: `Mode impossible à régler : ${error.message}` };
  }

  // 3. La campagne.
  let campagneId: string;
  let creee = false;
  if (e.campagneId) {
    if (!UUID.test(e.campagneId)) return { error: "Campagne inconnue." };
    const { data: c } = await supabase.from("appels_ia_campagnes").select("id, statut").eq("id", e.campagneId).maybeSingle();
    if (!c) return { error: "Campagne introuvable." };
    if ((c as { statut: string }).statut === "terminee") return { error: "Cette campagne est terminée : créez-en une nouvelle." };
    const { error } = await supabase.from("appels_ia_campagnes").update({ statut: "active" }).eq("id", e.campagneId);
    if (error) return { error: error.message };
    campagneId = e.campagneId;
  } else {
    const { data: c, error } = await supabase
      .from("appels_ia_campagnes")
      .insert({ nom, cree_par: moi.id, statut: "active" })
      .select("id")
      .single();
    if (error || !c) return { error: error?.message ?? "Campagne impossible à créer." };
    campagneId = (c as { id: string }).id;
    creee = true;
  }

  // 4. L'inscription, fiche par fiche, par la règle en base. Une fiche qui a
  //    bougé depuis la simulation est refusée avec SA raison du moment.
  const noms = new Map<string, string>();
  {
    const { data } = await supabase.from("prospects").select("id, company_name").in("id", ids);
    for (const p of (data ?? []) as { id: string; company_name: string }[]) noms.set(p.id, p.company_name);
  }
  let inscrites = 0;
  const refusees: { societe: string; raison: string }[] = [];
  // Par paquets de dix : 300 fiches ne doivent pas attendre 300 allers-retours en série.
  for (let i = 0; i < ids.length; i += 10) {
    const paquet = ids.slice(i, i + 10);
    const raisons = await Promise.all(
      paquet.map((id) => {
        const avant = sim.refus.get(id);
        return avant === null
          ? inscrire(supabase, { prospectId: id, campagneId, origine: "manuel", parId: moi.id })
          : Promise.resolve(avant ?? "Fiche introuvable.");
      })
    );
    raisons.forEach((raison, j) => {
      if (raison) refusees.push({ societe: noms.get(paquet[j]) ?? "Fiche introuvable", raison });
      else inscrites++;
    });
  }
  if (inscrites === 0) {
    if (creee) await supabase.from("appels_ia_campagnes").delete().eq("id", campagneId);
    revalider();
    return { error: "Aucune fiche n'est entrée dans la file : rien n'est lancé.", refusees };
  }

  // 5. L'inscription automatique (dans SA campagne système).
  if (e.inscriptionAuto) {
    await supabase.from("appels_ia_reglages").update({ inscription_auto: true, inscription_auto_par: moi.id, maj_par: moi.id }).eq("id", 1);
  }

  // 6. L'interrupteur général.
  const { error: ea } = await supabase.from("appels_ia_reglages").update({ actif: true, maj_par: moi.id }).eq("id", 1);
  revalider();
  const tete = `${inscrites} fiche${inscrites > 1 ? "s" : ""} inscrite${inscrites > 1 ? "s" : ""}${
    refusees.length ? `, ${refusees.length} écartée${refusees.length > 1 ? "s" : ""}` : ""
  }.`;
  if (ea) return { ok: true, inscrites, refusees, message: `${tete} L'interrupteur général n'a pas pu s'allumer (${ea.message}) : allumez-le à la main.` };
  return {
    ok: true,
    inscrites,
    refusees,
    message: `${tete} La campagne est lancée, l'interrupteur général est allumé.${
      r.pause_cause ? ` Attention : le moteur est en pause (${r.pause_cause}) — levez la pause pour que Janet appelle.` : ""
    }`,
  };
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

/**
 * Un appel de test vers le GSM de l'admin, avec le brief d'une fiche (ou une
 * fiche fictive). Refusé AVANT de réserver quoi que ce soit si la mise en
 * route n'est pas complète — la même phrase que l'écran (`refusAppelTest`) :
 * sans secret, l'annexe échouerait après coup et mettrait le moteur en pause.
 * Renvoie l'identifiant de l'appel, que l'écran suit en direct.
 */
export async function appelTestAction(prospectId: string | null): Promise<EtatAction & { appelId?: string }> {
  const moi = await admin();
  if (!moi) return REFUS;
  const supabase = await createClient();
  const [reg, sec] = await Promise.all([
    supabase.from("appels_ia_reglages").select("numero_appelant, gsm_test").eq("id", 1).maybeSingle(),
    supabase.rpc("appels_ia_secrets_poses"),
  ]);
  if (reg.error || !reg.data || sec.error) return { error: "Réglages illisibles : l'appel de test ne part pas." };
  const r = reg.data as { numero_appelant: string | null; gsm_test: string | null };
  const refus = refusAppelTest({
    numeroAppelant: r.numero_appelant,
    gsmTest: r.gsm_test,
    secretsPoses: ((sec.data ?? []) as { nom: string }[]).map((x) => x.nom),
    // Le moteur revérifie l'appel en cours (index unique en base) : ici, pas besoin.
    appelEnCours: false,
  });
  if (refus) return { error: refus };
  const issue = await lancerAppelTest(createAdminClient(), { prospectId: prospectId || null, parId: moi.id });
  revalider(prospectId);
  return issue.compose
    ? { ok: true, message: "Appel de test lancé vers votre GSM.", appelId: issue.appelId }
    : { error: issue.message, appelId: issue.appelId };
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
