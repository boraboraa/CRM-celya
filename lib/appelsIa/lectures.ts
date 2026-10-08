/**
 * Ce que les écrans et le connecteur MCP lisent des appels de Janet.
 *
 * Indifférent au client : sous la session de l'admin, la RLS (`is_admin()`)
 * borne déjà tout ; sous le service_role (connecteur MCP), l'outil a vérifié
 * l'admin en code avant d'appeler. Un non-admin n'obtient RIEN : chaque
 * lecture rend le vide, jamais une erreur qui casserait une page.
 *
 * TOLÉRANT À L'ABSENCE DE LA MIGRATION 025 : une table absente (`PGRST205`)
 * vaut « pas d'appels IA » — les pages qui montrent l'étiquette « Janet »
 * tournent avant comme après la migration.
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import { estTableAbsente } from "@/lib/crm/access";
import { REGLAGES_COLONNES, STATUTS_ACTIFS, type ReglagesAppels } from "@/lib/appelsIa/acces";
import { refusMoteur } from "@/lib/appelsIa/regles";
import { instantBruxelles, partiesBruxelles } from "@/lib/appelsIa/calendrier";
import { normaliserAppris, normaliserContenu, type ContenuBrief, type LigneApprise } from "@/lib/appelsIa/brief";

export type AppelResume = {
  id: string;
  prospect_id: string | null;
  societe: string | null;
  statut: string;
  essai: number;
  mode_test: boolean;
  classement: string | null;
  resultat: string | null;
  resume: string | null;
  interlocuteur: string | null;
  created_at: string;
  decroche_at: string | null;
  fin_at: string | null;
  duree_s: number | null;
  erreur_cote: string | null;
  erreur_message: string | null;
  meeting_id: string | null;
  numero_compose: string;
};

const APPEL_COLONNES =
  "id, prospect_id, statut, essai, mode_test, classement, resultat, resume, interlocuteur, created_at, decroche_at, fin_at, duree_s, erreur_cote, erreur_message, meeting_id, numero_compose, session_id, prospects(company_name)";

type AppelBrut = Omit<AppelResume, "societe"> & { session_id: string | null; prospects: { company_name: string } | null };

function resume(a: AppelBrut): AppelResume {
  const { prospects, session_id: _s, ...reste } = a;
  return { ...reste, societe: prospects?.company_name ?? (a.prospect_id ? null : "Appel de test") };
}

export type LigneFileResume = {
  id: string;
  prospect_id: string;
  societe: string | null;
  statut: string;
  essais: number;
  pas_avant: string;
  mode_test: boolean;
  origine: string;
  priorite: number;
  campagne_id: string;
  campagne: string | null;
  derniere_note: string | null;
  fin_motif: string | null;
  updated_at: string;
};

const FILE_COLONNES =
  "id, prospect_id, statut, essais, pas_avant, mode_test, origine, priorite, campagne_id, derniere_note, fin_motif, updated_at, prospects(company_name), appels_ia_campagnes(nom)";

type FileBrute = Omit<LigneFileResume, "societe" | "campagne"> & {
  prospects: { company_name: string } | null;
  appels_ia_campagnes: { nom: string } | null;
};

function ligne(f: FileBrute): LigneFileResume {
  const { prospects, appels_ia_campagnes, ...reste } = f;
  return { ...reste, societe: prospects?.company_name ?? null, campagne: appels_ia_campagnes?.nom ?? null };
}

export type EtatAppels = {
  /** La migration 025 est appliquée et l'appelant est admin. */
  disponible: boolean;
  reglages: ReglagesAppels | null;
  enCours: AppelResume | null;
  file: { total: number; prochaines: LigneFileResume[] };
  jour: { appeles: number; joints: number; rdv: number };
  derniers: AppelResume[];
  /** Pourquoi le moteur ne compose pas maintenant — ou null. */
  refus: string | null;
};

const VIDE: EtatAppels = {
  disponible: false,
  reglages: null,
  enCours: null,
  file: { total: 0, prochaines: [] },
  jour: { appeles: 0, joints: 0, rdv: 0 },
  derniers: [],
  refus: null,
};

/** L'état du moteur : la colonne « Appels » du tableau de bord, et l'outil MCP `etat_appels`. */
export async function lireEtatAppels(client: SupabaseClient, o: { derniers?: number } = {}): Promise<EtatAppels> {
  const maintenant = new Date();
  const minuit = instantBruxelles(partiesBruxelles(maintenant).ymd, 0).toISOString();
  const [reg, actifs, file, jour, derniers] = await Promise.all([
    client.from("appels_ia_reglages").select(REGLAGES_COLONNES).eq("id", 1).maybeSingle(),
    client.from("appels_ia").select(APPEL_COLONNES).in("statut", [...STATUTS_ACTIFS]).limit(1),
    client
      .from("appels_ia_file")
      .select(FILE_COLONNES, { count: "exact" })
      .in("statut", ["en_attente", "en_cours"])
      .order("priorite", { ascending: false })
      .order("pas_avant", { ascending: true })
      .limit(5),
    client.from("appels_ia").select("classement, meeting_id, session_id, created_at").gte("created_at", minuit),
    client.from("appels_ia").select(APPEL_COLONNES).order("created_at", { ascending: false }).limit(o.derniers ?? 8),
  ]);
  if (estTableAbsente(reg.error) || reg.error || !reg.data) return VIDE;
  const reglages = reg.data as unknown as ReglagesAppels;
  const duJour = (jour.data ?? []) as { classement: string | null; meeting_id: string | null; session_id: string | null; created_at: string }[];
  const places = duJour.filter((a) => a.session_id);
  const heure = maintenant.getTime() - 3600_000;
  return {
    disponible: true,
    reglages,
    enCours: ((actifs.data ?? []) as unknown as AppelBrut[]).map(resume)[0] ?? null,
    file: { total: file.count ?? 0, prochaines: ((file.data ?? []) as unknown as FileBrute[]).map(ligne) },
    jour: {
      appeles: places.length,
      joints: duJour.filter((a) => a.classement === "repondu_humain").length,
      rdv: duJour.filter((a) => a.meeting_id).length,
    },
    derniers: ((derniers.data ?? []) as unknown as AppelBrut[]).map(resume),
    refus: refusMoteur(reglages, maintenant, {
      aujourdhui: places.length,
      derniereHeure: places.filter((a) => Date.parse(a.created_at) >= heure).length,
    }),
  };
}

export type SuiviFiche = {
  disponible: boolean;
  appel: AppelResume | null;
  file: LigneFileResume | null;
};

/** Le suivi d'appel d'une fiche (bouton « Appeler avec Janet », sondé par la fiche). */
export async function lireSuiviFiche(client: SupabaseClient, prospectId: string): Promise<SuiviFiche> {
  const [a, f] = await Promise.all([
    client.from("appels_ia").select(APPEL_COLONNES).eq("prospect_id", prospectId).order("created_at", { ascending: false }).limit(1),
    client.from("appels_ia_file").select(FILE_COLONNES).eq("prospect_id", prospectId).order("created_at", { ascending: false }).limit(1),
  ]);
  if (estTableAbsente(a.error) || a.error) return { disponible: false, appel: null, file: null };
  return {
    disponible: true,
    appel: ((a.data ?? []) as unknown as AppelBrut[]).map(resume)[0] ?? null,
    file: ((f.data ?? []) as unknown as FileBrute[]).map(ligne)[0] ?? null,
  };
}

/** Les fiches qu'un appel RÉEL de Janet a touchées : l'étiquette « Janet » des listes. */
export async function fichesAppeleesParJanet(client: SupabaseClient, ids: string[]): Promise<Set<string>> {
  if (!ids.length) return new Set();
  const { data, error } = await client
    .from("appels_ia")
    .select("prospect_id")
    .eq("mode_test", false)
    .eq("statut", "termine")
    .in("prospect_id", ids.slice(0, 500));
  if (error) return new Set();
  return new Set(((data ?? []) as { prospect_id: string | null }[]).map((r) => r.prospect_id).filter((x): x is string => Boolean(x)));
}

/** Les rendez-vous posés par Janet : « posé par Janet » dans l'agenda. */
export async function rdvPosesParJanet(client: SupabaseClient, meetingIds: string[]): Promise<Set<string>> {
  if (!meetingIds.length) return new Set();
  const { data, error } = await client.from("appels_ia").select("meeting_id").in("meeting_id", meetingIds.slice(0, 500));
  if (error) return new Set();
  return new Set(((data ?? []) as { meeting_id: string | null }[]).map((r) => r.meeting_id).filter((x): x is string => Boolean(x)));
}

export type BriefLu = {
  contenu: ContenuBrief;
  appris: LigneApprise[];
  etat: "a_preparer" | "pret" | "minimal";
  prepare_at: string | null;
  updated_at: string | null;
};

export async function lireBrief(client: SupabaseClient, prospectId: string): Promise<BriefLu | null> {
  const { data, error } = await client
    .from("appels_ia_briefs")
    .select("contenu, appris, etat, prepare_at, updated_at")
    .eq("prospect_id", prospectId)
    .maybeSingle();
  if (error || !data) return null;
  const b = data as { contenu: unknown; appris: unknown; etat: BriefLu["etat"]; prepare_at: string | null; updated_at: string | null };
  return {
    contenu: normaliserContenu(b.contenu),
    appris: normaliserAppris(b.appris),
    etat: b.etat,
    prepare_at: b.prepare_at,
    updated_at: b.updated_at,
  };
}

export type ScriptLu = {
  secteur: "garage" | "restaurant" | "cabinet" | "autre";
  accueil: string;
  presentation: string;
  objectif: string;
  questions: string;
  objections: string;
  updated_at: string | null;
};

export type CampagneLue = {
  id: string;
  nom: string;
  statut: "active" | "pause" | "terminee";
  systeme: string | null;
  created_at: string;
  enAttente: number;
  termine: number;
};

export type PageAppels = {
  disponible: boolean;
  etat: EtatAppels;
  secrets: { nom: string; pose_le: string | null }[];
  scripts: ScriptLu[];
  campagnes: CampagneLue[];
  file: LigneFileResume[];
  appels: AppelResume[];
  opposition: { numero: string; motif: string | null; source: string; created_at: string }[];
  /** Combien de fiches « À appeler » de l'admin le rattrapage inscrirait. */
  rattrapage: number | null;
};

/** Tout l'écran « Appels IA » (admin, sous sa session). */
export async function lirePageAppels(client: SupabaseClient): Promise<PageAppels> {
  const etat = await lireEtatAppels(client, { derniers: 50 });
  if (!etat.disponible) {
    return { disponible: false, etat, secrets: [], scripts: [], campagnes: [], file: [], appels: [], opposition: [], rattrapage: null };
  }
  const [secrets, scripts, campagnes, lignes, opposition, rattrapage] = await Promise.all([
    client.rpc("appels_ia_secrets_poses"),
    client.from("appels_ia_scripts").select("secteur, accueil, presentation, objectif, questions, objections, updated_at"),
    client.from("appels_ia_campagnes").select("id, nom, statut, systeme, created_at").order("created_at", { ascending: false }),
    client.from("appels_ia_file").select(FILE_COLONNES).order("updated_at", { ascending: false }).limit(200),
    client.from("appels_ia_opposition").select("numero, motif, source, created_at").order("created_at", { ascending: false }).limit(500),
    client.rpc("appels_ia_rattrapage", { p_confirmer: false }),
  ]);
  const toutesLignes = ((lignes.data ?? []) as unknown as FileBrute[]).map(ligne);
  const ordre = ["garage", "restaurant", "cabinet", "autre"];
  return {
    disponible: true,
    etat,
    secrets: ((secrets.data ?? []) as { nom: string; pose_le: string | null }[]) ?? [],
    scripts: ((scripts.data ?? []) as ScriptLu[]).sort((a, b) => ordre.indexOf(a.secteur) - ordre.indexOf(b.secteur)),
    campagnes: ((campagnes.data ?? []) as Omit<CampagneLue, "enAttente" | "termine">[]).map((c) => ({
      ...c,
      enAttente: toutesLignes.filter((l) => l.campagne_id === c.id && (l.statut === "en_attente" || l.statut === "en_cours")).length,
      termine: toutesLignes.filter((l) => l.campagne_id === c.id && (l.statut === "termine" || l.statut === "arrete")).length,
    })),
    file: toutesLignes,
    appels: etat.derniers,
    opposition: (opposition.data ?? []) as PageAppels["opposition"],
    rattrapage: typeof rattrapage.data === "number" ? rattrapage.data : null,
  };
}
