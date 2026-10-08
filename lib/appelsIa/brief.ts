/**
 * Le brief d'appel d'une fiche — forme, fusion, lecture pour Janet. Pur, testé.
 *
 * Un brief par fiche (table `appels_ia_briefs`). Chaque information porte sa
 * SOURCE et sa DATE : ce que dit la fiche, ce que l'IA a lu sur le site, ce que
 * Claude a apporté par le connecteur, ce que Bora a écrit, ce que Janet a
 * appris en appelant. Pas de validation : le brief se modifie à tout moment,
 * et c'est la dernière version qui sert.
 *
 * Sans IA, le brief se réduit à ce que dit la fiche (`briefDepuisFiche`), et
 * Janet appelle quand même : une panne ne bloque jamais la prospection.
 */

export type SourceBrief = "fiche" | "site" | "ia" | "claude" | "bora" | "janet";

export const SOURCE_LABEL: Record<SourceBrief, string> = {
  fiche: "fiche",
  site: "site web",
  ia: "IA",
  claude: "Claude",
  bora: "saisie",
  janet: "Janet",
};

export type InfoBrief = { texte: string; source: SourceBrief; date: string };

export type ContenuBrief = {
  activite?: InfoBrief;
  qui_demander?: InfoBrief;
  ce_qu_on_sait?: InfoBrief[];
  accroche?: InfoBrief;
  solution?: InfoBrief;
  questions?: InfoBrief[];
};

export type LigneApprise = { date: string; texte: string; essai?: number; appel_id?: string };

export const CHAMPS_SIMPLES = ["activite", "qui_demander", "accroche", "solution"] as const;
export const CHAMPS_LISTES = ["ce_qu_on_sait", "questions"] as const;
export type ChampSimple = (typeof CHAMPS_SIMPLES)[number];
export type ChampListe = (typeof CHAMPS_LISTES)[number];

export const CHAMP_LABEL: Record<ChampSimple | ChampListe, string> = {
  activite: "Ce que fait l'entreprise",
  qui_demander: "Qui demander",
  ce_qu_on_sait: "Ce qu'on sait",
  accroche: "L'accroche",
  solution: "La solution à proposer",
  questions: "Les questions à poser",
};

const SOURCES = new Set<string>(["fiche", "site", "ia", "claude", "bora", "janet"]);
const TEXTE_MAX = 600;
const LISTE_MAX = 12;
const APPRIS_MAX = 30;

function nettoie(v: unknown, max = TEXTE_MAX): string {
  return typeof v === "string" ? v.replace(/\s+/g, " ").trim().slice(0, max) : "";
}

function dateValide(v: unknown, defaut: string): string {
  return typeof v === "string" && /^\d{4}-\d{2}-\d{2}$/.test(v) ? v : defaut;
}

function lireInfo(v: unknown, defautDate: string): InfoBrief | undefined {
  if (!v || typeof v !== "object") return undefined;
  const o = v as Record<string, unknown>;
  const texte = nettoie(o.texte);
  if (!texte) return undefined;
  const source = SOURCES.has(String(o.source)) ? (o.source as SourceBrief) : "bora";
  return { texte, source, date: dateValide(o.date, defautDate) };
}

/** Lecture TOLÉRANTE d'un contenu stocké : ce qui n'a pas la bonne forme est ignoré. */
export function normaliserContenu(brut: unknown, defautDate = "1970-01-01"): ContenuBrief {
  const c: ContenuBrief = {};
  if (!brut || typeof brut !== "object") return c;
  const o = brut as Record<string, unknown>;
  for (const k of CHAMPS_SIMPLES) {
    const i = lireInfo(o[k], defautDate);
    if (i) c[k] = i;
  }
  for (const k of CHAMPS_LISTES) {
    const v = o[k];
    if (Array.isArray(v)) {
      const l = v.map((x) => lireInfo(x, defautDate)).filter((x): x is InfoBrief => Boolean(x)).slice(0, LISTE_MAX);
      if (l.length) c[k] = l;
    }
  }
  return c;
}

export function normaliserAppris(brut: unknown): LigneApprise[] {
  if (!Array.isArray(brut)) return [];
  return brut
    .map((x) => {
      if (!x || typeof x !== "object") return null;
      const o = x as Record<string, unknown>;
      const texte = nettoie(o.texte);
      if (!texte) return null;
      const l: LigneApprise = { date: dateValide(o.date, "1970-01-01"), texte };
      if (typeof o.essai === "number") l.essai = o.essai;
      if (typeof o.appel_id === "string") l.appel_id = o.appel_id;
      return l;
    })
    .filter((x): x is LigneApprise => Boolean(x))
    .slice(-APPRIS_MAX);
}

/** Une saisie à plat (formulaire, connecteur MCP) → contenu sourcé. */
export type SaisieBrief = Partial<Record<ChampSimple, string | null>> & Partial<Record<ChampListe, string[] | string | null>>;

export function depuisSaisie(s: SaisieBrief, source: SourceBrief, date: string): ContenuBrief {
  const c: ContenuBrief = {};
  for (const k of CHAMPS_SIMPLES) {
    const t = nettoie(s[k]);
    if (t) c[k] = { texte: t, source, date };
  }
  for (const k of CHAMPS_LISTES) {
    const v = s[k];
    const lignes = (Array.isArray(v) ? v : typeof v === "string" ? v.split(/\n+/) : [])
      .map((x) => nettoie(String(x).replace(/^[-•*]\s*/, "")))
      .filter(Boolean)
      .slice(0, LISTE_MAX);
    if (lignes.length) c[k] = lignes.map((texte) => ({ texte, source, date }));
  }
  return c;
}

/**
 * Fusion. « completer » : ne remplit que ce qui manque (l'IA ne réécrit jamais
 * ce que Bora ou Claude ont écrit). « remplacer » : chaque champ fourni
 * remplace l'ancien ; un champ non fourni est gardé.
 */
export function fusionner(existant: ContenuBrief, propose: ContenuBrief, mode: "completer" | "remplacer"): ContenuBrief {
  const r: ContenuBrief = { ...existant };
  for (const k of CHAMPS_SIMPLES) {
    if (propose[k] && (mode === "remplacer" || !existant[k])) r[k] = propose[k];
  }
  for (const k of CHAMPS_LISTES) {
    const p = propose[k];
    if (!p?.length) continue;
    if (mode === "remplacer" || !existant[k]?.length) {
      r[k] = p;
    } else {
      const deja = new Set(existant[k]!.map((i) => i.texte.toLowerCase()));
      r[k] = [...existant[k]!, ...p.filter((i) => !deja.has(i.texte.toLowerCase()))].slice(0, LISTE_MAX);
    }
  }
  return r;
}

export type FichePourBrief = {
  company_name: string;
  contact_name?: string | null;
  sector?: string | null;
  city?: string | null;
  address?: string | null;
  website?: string | null;
  notes?: string | null;
};

/** Le brief minimal : ce que dit la fiche, et rien d'inventé. */
export function briefDepuisFiche(f: FichePourBrief, date: string): ContenuBrief {
  const c: ContenuBrief = {};
  const secteur = nettoie(f.sector, 120);
  if (secteur) c.activite = { texte: `${secteur}${f.city ? ` à ${nettoie(f.city, 80)}` : ""}`, source: "fiche", date };
  const contact = nettoie(f.contact_name, 120);
  if (contact) c.qui_demander = { texte: contact, source: "fiche", date };
  const sait: InfoBrief[] = [];
  const notes = nettoie(f.notes, 400);
  if (notes) sait.push({ texte: notes, source: "fiche", date });
  const site = nettoie(f.website, 200);
  if (site) sait.push({ texte: `Site : ${site}`, source: "fiche", date });
  if (sait.length) c.ce_qu_on_sait = sait;
  return c;
}

export function estVide(c: ContenuBrief): boolean {
  return CHAMPS_SIMPLES.every((k) => !c[k]) && CHAMPS_LISTES.every((k) => !c[k]?.length);
}

/**
 * La ligne apprise après un appel — DÉTERMINISTE, tirée de `noter_resultat`.
 * Rien si Janet n'a rien déclaré (répondeur, pas de réponse).
 */
export function ligneApprise(e: {
  date: string;
  essai: number;
  interlocuteur: string | null;
  decideur: boolean;
  appris: string | null;
  resultatLibelle: string;
}): LigneApprise | null {
  const morceaux: string[] = [];
  if (e.interlocuteur) morceaux.push(`${e.decideur ? "Décideur" : "Interlocuteur"} : ${e.interlocuteur}`);
  if (e.appris) morceaux.push(e.appris);
  if (morceaux.length === 0) return null;
  return { date: e.date, essai: e.essai, texte: `${e.resultatLibelle}. ${morceaux.join(". ")}`.slice(0, TEXTE_MAX) };
}

function infoTexte(i: InfoBrief): string {
  return `${i.texte} (${SOURCE_LABEL[i.source]}, ${i.date.split("-").reverse().join("/")})`;
}

/** Le brief, en texte, pour les instructions de Janet. */
export function briefEnTexte(c: ContenuBrief, appris: LigneApprise[]): string {
  const l: string[] = [];
  for (const k of ["activite", "qui_demander"] as const) {
    if (c[k]) l.push(`${CHAMP_LABEL[k]} : ${infoTexte(c[k]!)}`);
  }
  if (c.ce_qu_on_sait?.length) {
    l.push(`${CHAMP_LABEL.ce_qu_on_sait} :`);
    for (const i of c.ce_qu_on_sait) l.push(`- ${infoTexte(i)}`);
  }
  for (const k of ["accroche", "solution"] as const) {
    if (c[k]) l.push(`${CHAMP_LABEL[k]} : ${infoTexte(c[k]!)}`);
  }
  if (c.questions?.length) {
    l.push(`${CHAMP_LABEL.questions} :`);
    for (const i of c.questions) l.push(`- ${infoTexte(i)}`);
  }
  if (appris.length) {
    l.push("Ce que Janet a appris aux appels précédents :");
    for (const a of appris) l.push(`- ${a.date.split("-").reverse().join("/")}${a.essai ? ` (essai ${a.essai})` : ""} : ${a.texte}`);
  }
  return l.length ? l.join("\n") : "Rien de plus que le nom de l'entreprise : découvre-la par tes questions.";
}
