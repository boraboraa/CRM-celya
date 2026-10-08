/**
 * Le moteur d'appels de Janet — SERVEUR, en service_role (voir acces.ts).
 *
 * `composerSuivant` est le seul chemin qui compose : appelé par le tick
 * (chaque minute, le filet), à la fin d'un appel (à la chaîne, sans attendre
 * la minute) et par le bouton « Appeler avec Janet » de la fiche.
 *
 * Les garanties, et où elles vivent :
 *   · UN appel à la fois : index unique partiel en base — un 23505 à la prise
 *     arrête la boucle, ce n'est pas une erreur ;
 *   · le mode test FIGÉ : on ne prend que les lignes du mode en cours
 *     (`appels_ia_prendre`), et l'appel garde le mode de sa ligne ;
 *   · chaque ligne a son propre try/catch : une ligne en panne ne bloque pas
 *     les autres ;
 *   · les lectures échouent FERMÉES : réglages, opposition, fiche illisibles →
 *     on ne compose pas ;
 *   · une panne de NOTRE côté ne brûle pas la file : la ligne repart plus
 *     tard, sans compter d'essai (lib/appelsIa/planFin.ts) ;
 *   · chaque appel réseau a son délai (AbortSignal).
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import { SUPABASE_URL } from "@/lib/env";
import { STATUTS_ACTIFS, lireReglages, secretInterne, MigrationAbsente, type ReglagesAppels } from "@/lib/appelsIa/acces";
import { refusMoteur, type CompteurAppels } from "@/lib/appelsIa/regles";
import { gardeAvantComposer, type FaitsFiche } from "@/lib/appelsIa/garde";
import { numeroAppelable } from "@/lib/appelsIa/numeros";
import { secteurDe } from "@/lib/appelsIa/secteur";
import { assemblerInstructions, instructionsDelegation, type ScriptSecteur } from "@/lib/appelsIa/instructions";
import { definitionsOutils } from "@/lib/appelsIa/outils";
import { briefDepuisFiche, briefEnTexte, estVide, normaliserAppris, normaliserContenu } from "@/lib/appelsIa/brief";
import { instantBruxelles, jourFr, jourHeureFr, partiesBruxelles } from "@/lib/appelsIa/calendrier";
import { CLASSEMENT_LABEL } from "@/lib/appelsIa/libelles";
import { ecrireFin } from "@/lib/appelsIa/fin";
import { rapportSansAppel } from "../../supabase/functions/_shared/appels/rapport.ts";
import { signer } from "../../supabase/functions/_shared/appels/signature.ts";

export type IssueComposition = { compose: boolean; message: string; appelId?: string };

const DELAI_REVEIL_MS = 10_000;
/** Une ligne « réservée » que l'annexe n'a pas prise en 2 min : panne de notre côté. */
const RESERVE_MAX_MS = 2 * 60_000;
/** Un appel sans fin reçue après 15 min (plafond 330 s + marges) : fin illisible. */
const EN_COURS_MAX_MS = 15 * 60_000;

// ---------------------------------------------------------------------------
// Compter, lire
// ---------------------------------------------------------------------------

/** Les appels réellement placés (une session existe) : la dernière heure, et depuis minuit. */
export async function compterAppels(admin: SupabaseClient, maintenant: Date): Promise<CompteurAppels> {
  const minuit = instantBruxelles(partiesBruxelles(maintenant).ymd, 0);
  const heure = new Date(maintenant.getTime() - 3600_000);
  const depuis = minuit < heure ? minuit : heure;
  const { data, error } = await admin
    .from("appels_ia")
    .select("created_at")
    .not("session_id", "is", null)
    .gte("created_at", depuis.toISOString());
  if (error) throw new Error(`Comptage des appels impossible : ${error.message}`);
  const rows = (data ?? []) as { created_at: string }[];
  return {
    aujourdhui: rows.filter((r) => Date.parse(r.created_at) >= minuit.getTime()).length,
    derniereHeure: rows.filter((r) => Date.parse(r.created_at) >= heure.getTime()).length,
  };
}

type LigneFile = { id: string; prospect_id: string; cycle_debut: string | null };

/** Les faits d'une fiche au moment de composer. Lève si une lecture échoue (fermé). */
export async function lireFaitsFiche(admin: SupabaseClient, ligne: LigneFile): Promise<FaitsFiche> {
  const maintenant = new Date().toISOString();
  const { data: p, error } = await admin
    .from("prospects")
    .select("id, status, phone, status_locked_at")
    .eq("id", ligne.prospect_id)
    .maybeSingle();
  if (error) throw new Error(`Fiche illisible : ${error.message}`);
  if (!p) return { existe: false, statut: null, phone: null, rdvAVenir: false, enOpposition: () => false, depuis: null };
  const fiche = p as { id: string; status: string; phone: string | null; status_locked_at: string | null };
  const numero = numeroAppelable(fiche.phone);
  const [opp, rdv] = await Promise.all([
    numero
      ? admin.from("appels_ia_opposition").select("numero").eq("numero", numero).maybeSingle()
      : Promise.resolve({ data: null, error: null }),
    admin
      .from("meetings")
      .select("id")
      .eq("prospect_id", fiche.id)
      .eq("kind", "prospect")
      .in("status", ["prevu", "confirme", "reporte"])
      .gt("starts_at", maintenant)
      .limit(1),
  ]);
  if (opp.error) throw new Error(`Liste d'opposition illisible : ${opp.error.message}`);
  if (rdv.error) throw new Error(`Agenda illisible : ${rdv.error.message}`);
  const enOpposition = Boolean(opp.data);

  let depuis: FaitsFiche["depuis"] = null;
  if (ligne.cycle_debut) {
    const [janet, acts, mails, rdvs] = await Promise.all([
      admin.from("appels_ia").select("activite_id, meeting_id").eq("prospect_id", fiche.id),
      admin.from("activities").select("id").eq("prospect_id", fiche.id).eq("is_draft", false).gt("occurred_at", ligne.cycle_debut),
      admin
        .from("emails")
        .select("id", { count: "exact", head: true })
        .eq("prospect_id", fiche.id)
        .eq("direction", "entrant")
        .gt("received_at", ligne.cycle_debut),
      admin.from("meetings").select("id").eq("prospect_id", fiche.id).gt("created_at", ligne.cycle_debut),
    ]);
    for (const r of [janet, acts, mails, rdvs]) {
      if (r.error) throw new Error(`Fiche illisible : ${r.error.message}`);
    }
    const parJanet = (janet.data ?? []) as { activite_id: string | null; meeting_id: string | null }[];
    const activitesJanet = new Set(parJanet.map((a) => a.activite_id).filter(Boolean));
    const rdvJanet = new Set(parJanet.map((a) => a.meeting_id).filter(Boolean));
    depuis = {
      activitesHumaines: ((acts.data ?? []) as { id: string }[]).filter((a) => !activitesJanet.has(a.id)).length,
      emailsEntrants: mails.count ?? 0,
      rdvPosesHorsJanet: ((rdvs.data ?? []) as { id: string }[]).filter((m) => !rdvJanet.has(m.id)).length,
      etapeChangeeALaMain: Boolean(fiche.status_locked_at && fiche.status_locked_at > ligne.cycle_debut),
    };
  }
  return {
    existe: true,
    statut: fiche.status,
    phone: fiche.phone,
    rdvAVenir: (rdv.data?.length ?? 0) > 0,
    enOpposition: (n) => enOpposition && n === numero,
    depuis,
  };
}

// ---------------------------------------------------------------------------
// La session : ce que Janet reçoit
// ---------------------------------------------------------------------------

const LIBELLE_ESSAI: Record<string, string> = {
  sans_reponse: "personne n'a décroché",
  occupe_echec: "c'était occupé",
  repondeur: "un répondeur a répondu",
  standard_ivr: "un standard automatique a répondu",
  repondu_humain: "quelqu'un a décroché",
};

export async function preparerSession(
  admin: SupabaseClient,
  appel: { id: string; prospect_id: string | null; essai: number; file_id: string | null },
  r: ReglagesAppels,
  maintenant: Date
): Promise<Record<string, unknown>> {
  type Fiche = {
    company_name: string;
    contact_name: string | null;
    sector: string | null;
    city: string | null;
    address: string | null;
    website: string | null;
    notes: string | null;
    status: string;
    last_contact_at: string | null;
  };
  let fiche: Fiche = {
    company_name: "Entreprise de test",
    contact_name: null,
    sector: null,
    city: null,
    address: null,
    website: null,
    notes: null,
    status: "a_appeler",
    last_contact_at: null,
  };
  if (appel.prospect_id) {
    const { data, error } = await admin
      .from("prospects")
      .select("company_name, contact_name, sector, city, address, website, notes, status, last_contact_at")
      .eq("id", appel.prospect_id)
      .maybeSingle();
    if (error || !data) throw new Error(`Fiche illisible : ${error?.message ?? "introuvable"}`);
    fiche = data as Fiche;
  }
  const secteur = secteurDe(fiche.sector);
  const jour = partiesBruxelles(maintenant).ymd;

  const [scriptRes, briefRes, precedents] = await Promise.all([
    admin.from("appels_ia_scripts").select("accueil, presentation, objectif, questions, objections").eq("secteur", secteur).maybeSingle(),
    appel.prospect_id
      ? admin.from("appels_ia_briefs").select("contenu, appris").eq("prospect_id", appel.prospect_id).maybeSingle()
      : Promise.resolve({ data: null, error: null }),
    appel.file_id
      ? admin
          .from("appels_ia")
          .select("classement, created_at")
          .eq("file_id", appel.file_id)
          .neq("id", appel.id)
          .eq("statut", "termine")
          .order("created_at", { ascending: true })
      : Promise.resolve({ data: [], error: null }),
  ]);

  // Une panne de lecture du brief ne bloque jamais l'appel : la fiche suffit.
  const briefLu = (briefRes.data ?? null) as { contenu: unknown; appris: unknown } | null;
  let contenu = normaliserContenu(briefLu?.contenu, jour);
  if (estVide(contenu)) contenu = briefDepuisFiche(fiche, jour);
  const appris = normaliserAppris(briefLu?.appris);

  const essaisPrecedents = ((precedents.data ?? []) as { classement: string | null; created_at: string }[]).map(
    (a) => `${LIBELLE_ESSAI[a.classement ?? ""] ?? CLASSEMENT_LABEL[a.classement ?? ""] ?? "appel sans suite"} le ${jourHeureFr(new Date(a.created_at))}`
  );

  const instructions = assemblerInstructions({
    script: (scriptRes.data ?? null) as ScriptSecteur | null,
    brief: briefEnTexte(contenu, appris),
    variables: {
      societe: fiche.company_name,
      secteur,
      ville: fiche.city,
      contact: fiche.contact_name,
      essai: appel.essai,
      essaisPrecedents,
      dejaContacte: Boolean(fiche.last_contact_at) || fiche.status !== "a_appeler",
      aujourdhui: `${jourFr(maintenant)} ${partiesBruxelles(maintenant).annee}`,
    },
  });

  // Pas de `type: "live"` : il n'existe qu'à l'accept d'un appel ENTRANT ; le
  // schéma de création (POST /v1/live/sessions) ne l'a pas (doc du 07/10).
  return {
    model: r.modele,
    instructions,
    audio: { output: { voice: r.voix } },
    delegation: {
      type: "responses",
      responses: {
        model: r.modele_delegation,
        instructions: instructionsDelegation(),
        tools: definitionsOutils(),
        tool_choice: "auto",
        parallel_tool_calls: false,
      },
    },
  };
}

// ---------------------------------------------------------------------------
// Réveiller l'annexe
// ---------------------------------------------------------------------------

type Reveil =
  | { etat: "lance" }
  | { etat: "report"; dansS: number }
  | { etat: "deja" }
  | { etat: "refus"; message: string }
  | { etat: "incertain"; message: string };

async function reveillerAnnexe(admin: SupabaseClient, appelId: string): Promise<Reveil> {
  const corps = JSON.stringify({ appel_id: appelId });
  try {
    const secret = await secretInterne(admin);
    const res = await fetch(`${SUPABASE_URL}/functions/v1/appels-ia-annexe`, {
      method: "POST",
      headers: { "Content-Type": "application/json", ...(await signer(secret, corps)) },
      body: corps,
      signal: AbortSignal.timeout(DELAI_REVEIL_MS),
    });
    const j = (await res.json().catch(() => ({}))) as { raison?: string; reessayer_dans_s?: number };
    if (res.status === 202) return { etat: "lance" };
    if (res.status === 503 && j.raison === "worker_vieux") return { etat: "report", dansS: Number(j.reessayer_dans_s) || 120 };
    if (res.status === 409) return { etat: "deja" };
    return { etat: "refus", message: `l'annexe répond ${res.status}${j.raison ? ` (${j.raison})` : ""}` };
  } catch (e) {
    return { etat: "incertain", message: String((e as Error)?.message ?? e) };
  }
}

async function preparerEtReveiller(
  admin: SupabaseClient,
  appel: { id: string; prospect_id: string | null; essai: number; file_id: string | null },
  r: ReglagesAppels
): Promise<IssueComposition> {
  let session: Record<string, unknown>;
  try {
    session = await preparerSession(admin, appel, r, new Date());
  } catch (e) {
    await ecrireFin(admin, rapportSansAppel(appel.id, "preparation", `Préparation impossible : ${String((e as Error)?.message ?? e)}`));
    return { compose: false, message: "La préparation de l'appel a échoué." };
  }
  const { error } = await admin.from("appels_ia").update({ session_prete: session }).eq("id", appel.id);
  if (error) {
    await ecrireFin(admin, rapportSansAppel(appel.id, "preparation", `Écriture de la session impossible : ${error.message}`));
    return { compose: false, message: "La préparation de l'appel a échoué." };
  }
  const reveil = await reveillerAnnexe(admin, appel.id);
  switch (reveil.etat) {
    case "lance":
      return { compose: true, message: "Appel lancé.", appelId: appel.id };
    case "deja":
      return { compose: true, message: "L'appel est déjà lancé.", appelId: appel.id };
    case "report": {
      // L'annexe se renouvelle : rien n'a été composé. La réservation s'efface,
      // la ligne repart quand le worker sera neuf — sans essai, sans panne.
      await admin.from("appels_ia").delete().eq("id", appel.id).eq("statut", "reserve");
      if (appel.file_id) {
        await admin
          .from("appels_ia_file")
          .update({
            statut: "en_attente",
            pas_avant: new Date(Date.now() + reveil.dansS * 1000).toISOString(),
            derniere_note: "l'annexe se renouvelle — appel repoussé",
          })
          .eq("id", appel.file_id)
          .eq("statut", "en_cours");
      }
      return { compose: false, message: `L'annexe se renouvelle : appel repoussé de ${reveil.dansS} s.` };
    }
    case "refus":
      await ecrireFin(admin, rapportSansAppel(appel.id, "preparation", `Annexe injoignable : ${reveil.message}.`));
      return { compose: false, message: `Annexe injoignable : ${reveil.message}.` };
    case "incertain":
      // Peut-être lancée : on ne rejoue rien (chaque création compose un appel).
      // Le filet tranchera : prise → la fin arrivera ; jamais prise → panne.
      return { compose: false, message: `Annexe sans réponse claire (${reveil.message}) : le filet tranchera.` };
  }
}

// ---------------------------------------------------------------------------
// Composer
// ---------------------------------------------------------------------------

export async function appelEnCours(admin: SupabaseClient): Promise<boolean> {
  const { data, error } = await admin.from("appels_ia").select("id").in("statut", [...STATUTS_ACTIFS]).limit(1);
  if (error) throw new Error(`Lecture des appels impossible : ${error.message}`);
  return (data?.length ?? 0) > 0;
}

export async function composerSuivant(admin: SupabaseClient): Promise<IssueComposition> {
  let r: ReglagesAppels;
  try {
    r = await lireReglages(admin);
  } catch (e) {
    return { compose: false, message: e instanceof MigrationAbsente ? e.message : "Réglages illisibles : je ne compose pas." };
  }
  const maintenant = new Date();
  try {
    if (await appelEnCours(admin)) return { compose: false, message: "Un appel est déjà en cours." };
    const refus = refusMoteur(r, maintenant, await compterAppels(admin, maintenant));
    if (refus) return { compose: false, message: refus };
  } catch (e) {
    return { compose: false, message: `${String((e as Error)?.message ?? e)} — je ne compose pas.` };
  }

  const { data: lignes, error } = await admin
    .from("appels_ia_file")
    .select("id, prospect_id, cycle_debut, appels_ia_campagnes!inner(statut)")
    .eq("statut", "en_attente")
    .eq("mode_test", r.mode_test)
    .lte("pas_avant", maintenant.toISOString())
    .eq("appels_ia_campagnes.statut", "active")
    .order("priorite", { ascending: false })
    .order("pas_avant", { ascending: true })
    .limit(5);
  if (error) return { compose: false, message: `File illisible (${error.message}) : je ne compose pas.` };
  if (!lignes?.length) return { compose: false, message: "Rien à composer pour l'instant." };

  for (const brute of lignes) {
    const ligne = brute as unknown as LigneFile;
    try {
      const faits = await lireFaitsFiche(admin, ligne);
      const garde = gardeAvantComposer(faits);
      if (!garde.ok) {
        await admin
          .from("appels_ia_file")
          .update({ statut: "arrete", fin_motif: garde.motif, fin_at: new Date().toISOString(), derniere_note: garde.motif })
          .eq("id", ligne.id)
          .eq("statut", "en_attente");
        continue;
      }
      // En mode test, tout appel part vers le GSM de test.
      const numero = r.mode_test ? r.gsm_test! : garde.numero;
      const { data: appelId, error: ep } = await admin.rpc("appels_ia_prendre", {
        p_file: ligne.id,
        p_numero: numero,
        p_mode_test: r.mode_test,
        p_lance_par: null,
      });
      if (ep) {
        // Un autre appel tient la ligne : la boucle s'arrête, ce n'est pas une erreur.
        if (ep.code === "23505") return { compose: false, message: "Un appel est déjà en cours." };
        throw new Error(ep.message);
      }
      if (!appelId) continue;
      const { data: appel } = await admin
        .from("appels_ia")
        .select("id, prospect_id, essai, file_id")
        .eq("id", appelId as string)
        .single();
      return await preparerEtReveiller(admin, appel as { id: string; prospect_id: string | null; essai: number; file_id: string | null }, r);
    } catch (e) {
      // Une ligne en panne ne bloque pas les autres. Rien n'est composé pour
      // elle : les lectures échouent fermées.
      console.error("[appels-ia] ligne", ligne.id, String((e as Error)?.message ?? e));
      continue;
    }
  }
  return { compose: false, message: "Aucune fiche composable pour l'instant." };
}

/** Le bouton « Appel de test vers mon GSM » : hors file, toujours en mode test. */
export async function lancerAppelTest(
  admin: SupabaseClient,
  o: { prospectId: string | null; parId: string }
): Promise<IssueComposition> {
  let r: ReglagesAppels;
  try {
    r = await lireReglages(admin);
  } catch (e) {
    return { compose: false, message: e instanceof MigrationAbsente ? e.message : "Réglages illisibles." };
  }
  try {
    if (await appelEnCours(admin)) return { compose: false, message: "Un appel est déjà en cours." };
    const refus = refusMoteur(r, new Date(), await compterAppels(admin, new Date()), { test: true });
    if (refus) return { compose: false, message: refus };
  } catch (e) {
    return { compose: false, message: String((e as Error)?.message ?? e) };
  }
  const { data: appelId, error } = await admin.rpc("appels_ia_prendre_test", {
    p_prospect: o.prospectId,
    p_numero: r.gsm_test,
    p_lance_par: o.parId,
  });
  if (error) {
    if (error.code === "23505") return { compose: false, message: "Un appel est déjà en cours." };
    return { compose: false, message: `Appel de test impossible : ${error.message}` };
  }
  return await preparerEtReveiller(admin, { id: appelId as string, prospect_id: o.prospectId, essai: 1, file_id: null }, r);
}

// ---------------------------------------------------------------------------
// Le filet
// ---------------------------------------------------------------------------

/**
 * Libère ce qui est resté bloqué : réservation jamais prise par l'annexe
 * (panne de notre côté), appel sans fin reçue (fin illisible — rien n'est
 * deviné), ligne de file « en cours » sans appel vivant.
 */
export async function filet(admin: SupabaseClient): Promise<number> {
  const maintenant = Date.now();
  let n = 0;
  const [reserves, figes] = await Promise.all([
    admin.from("appels_ia").select("id").eq("statut", "reserve").lt("created_at", new Date(maintenant - RESERVE_MAX_MS).toISOString()),
    admin
      .from("appels_ia")
      .select("id")
      .in("statut", ["composition", "sonnerie", "en_ligne"])
      .lt("created_at", new Date(maintenant - EN_COURS_MAX_MS).toISOString()),
  ]);
  for (const a of (reserves.data ?? []) as { id: string }[]) {
    try {
      await ecrireFin(admin, rapportSansAppel(a.id, "preparation", "L'annexe n'a jamais pris l'appel (edge function non déployée ou injoignable ?)."));
      n++;
    } catch (e) {
      console.error("[appels-ia] filet réservé", a.id, String(e));
    }
  }
  for (const a of (figes.data ?? []) as { id: string }[]) {
    try {
      await ecrireFin(admin, rapportSansAppel(a.id, "annexe", "aucune fin reçue de l'annexe"));
      n++;
    } catch (e) {
      console.error("[appels-ia] filet figé", a.id, String(e));
    }
  }
  // Lignes « en cours » orphelines (l'annexe a pu écrire son échec seule).
  const [enCours, vivants] = await Promise.all([
    admin.from("appels_ia_file").select("id, updated_at").eq("statut", "en_cours"),
    admin.from("appels_ia").select("file_id").in("statut", [...STATUTS_ACTIFS]),
  ]);
  const tenues = new Set(((vivants.data ?? []) as { file_id: string | null }[]).map((v) => v.file_id));
  for (const f of (enCours.data ?? []) as { id: string; updated_at: string }[]) {
    if (tenues.has(f.id) || Date.parse(f.updated_at) > maintenant - RESERVE_MAX_MS) continue;
    await admin
      .from("appels_ia_file")
      .update({ statut: "en_attente", pas_avant: new Date(maintenant + 30 * 60_000).toISOString(), derniere_note: "relâchée par le filet" })
      .eq("id", f.id)
      .eq("statut", "en_cours");
    n++;
  }
  return n;
}
