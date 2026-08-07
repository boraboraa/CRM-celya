"use server";

/**
 * Saisie assistée par IA — deux actions, toutes deux côté serveur :
 *  - extractProspectAction : texte collé (ou capture d'écran) → champs de fiche
 *  - analyzeNoteAction : note d'échange au kilomètre → proposition structurée
 *
 * Cahier des charges (le contrat, pas une intention) :
 *  - Le modèle extrait, le code range : normalisation des numéros au format
 *    belge, validation des emails, détection de doublons — tout en TypeScript,
 *    de façon déterministe. Rien de tout cela n'est délégué au modèle.
 *  - Ne jamais deviner : un champ absent du texte revient à null.
 *  - L'étape suit une règle écrite dans le prompt : a_appeler, sauf échange
 *    explicitement déjà eu → contacte. Le modèle n'en décide pas librement.
 *  - Sortie validée strictement ; hors format ou panne → le formulaire
 *    s'ouvre vide et la saisie manuelle fonctionne. L'IA propose, elle
 *    n'exécute pas : rien ne s'écrit en base ici.
 */

import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { chatJSON, aiAvailable, type UserContent } from "@/lib/ai/provider";
import { isoToLocalInput } from "@/lib/time";
import { SOURCES, STATUS_ORDER, STATUS_LABEL } from "@/lib/constants";
import type { ProspectStatus } from "@/lib/types";
import {
  normalizeBelgianPhone,
  findDuplicates,
  type DuplicateHit,
} from "@/lib/crm/dedup";

// La normalisation « +32 », les clés de dédup et findDuplicates vivent
// désormais dans lib/crm/dedup — source unique partagée avec les server
// actions et le connecteur MCP. Réexporté ici pour les composants client.
export type { DuplicateHit };

/**
 * Qui agit — sans aller-retour réseau (jetons ES256, signature vérifiée en
 * local contre le JWKS mis en cache). Même raison que dans app/actions.ts.
 */
async function requireUser() {
  const supabase = await createClient();
  const { data, error } = await supabase.auth.getClaims();
  const userId = data?.claims?.sub;
  if (error || !userId) redirect("/login");
  return { supabase, userId };
}

// ---------------------------------------------------------------------------
// Validation & normalisation — déterministes, jamais déléguées au modèle.
// ---------------------------------------------------------------------------

const cleanStr = (v: unknown, max = 200): string | null => {
  if (typeof v !== "string") return null;
  const t = v.replace(/\s+/g, " ").trim();
  if (!t || t.toLowerCase() === "null") return null;
  return t.slice(0, max);
};

const cleanEmail = (v: unknown): string | null => {
  const s = cleanStr(v);
  if (!s) return null;
  return /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(s) ? s.toLowerCase() : null;
};

const cleanWebsite = (v: unknown): string | null => {
  const s = cleanStr(v, 200);
  if (!s) return null;
  const site = s.replace(/\/+$/, "");
  // Un site web contient un point et aucun espace — sinon on n'invente pas.
  return /^\S+\.\S+$/.test(site) ? site : null;
};

const clamp01 = (v: unknown): number | null => {
  if (typeof v !== "number" || !Number.isFinite(v)) return null;
  return Math.min(1, Math.max(0, v));
};

// ---------------------------------------------------------------------------
// Coller → fiche
// ---------------------------------------------------------------------------

export type ExtractedProspect = {
  company_name: string | null;
  contact_name: string | null;
  phone: string | null;
  email: string | null;
  website: string | null;
  sector: string | null;
  city: string | null;
  source: string | null;
  status: Extract<ProspectStatus, "a_appeler" | "contacte">;
  notes: string | null;
};

export type ExtractResult = {
  fields?: ExtractedProspect;
  /** Champs déduits mais à faible confiance — surlignés dans le formulaire. */
  uncertain?: string[];
  duplicates?: DuplicateHit[];
  unavailable?: boolean;
  error?: string;
};

const EXTRACT_SYSTEM = `Tu extrais les coordonnées d'un prospect belge à partir d'un texte collé (fiche Google Maps, signature d'email, ligne d'annuaire, extrait LinkedIn, texte mal formaté) ou d'une capture d'écran.

Règles absolues :
1. N'invente JAMAIS rien. Un champ absent du texte vaut null — jamais une supposition, jamais une reconstruction plausible. Recopie les valeurs telles qu'elles apparaissent (le numéro de téléphone dans son format d'origine).
2. "status" suit une règle, pas ton jugement : "a_appeler" dans tous les cas, SAUF si le texte indique explicitement qu'un échange a déjà eu lieu avec ce prospect (il a répondu, on s'est parlé, rencontré, il a demandé à être recontacté…) — alors "contacte".
3. "source" : une valeur de ${JSON.stringify(SOURCES)} uniquement si le texte la mentionne explicitement (ex. « rencontré au salon », « recommandé par »), sinon null.
4. "confidence" : pour chaque champ non null, ta confiance entre 0 et 1 (1 = lu tel quel dans le texte ; plus bas si le texte est ambigu ou la capture peu lisible).
5. "raw_notes" : ce qui est utile mais n'entre dans aucun champ (horaires, avis, contexte), sinon null.

Réponds UNIQUEMENT avec un objet JSON, sans texte autour :
{
  "company_name": ..., "contact_name": ..., "phone": ..., "email": ...,
  "website": ..., "sector": ..., "city": ..., "source": ...,
  "status": "a_appeler" | "contacte",
  "confidence": { "company_name": 0.98, ... },
  "raw_notes": ...
}

Exemples :

Texte :
Garage Marchal
4,6 ★ (87 avis) · Garage automobile
Rue de la Station 12, 4000 Liège
Fermé · Ouvre à 08:00 ven.
04 223 45 67
garagemarchal.be
Réponse :
{"company_name":"Garage Marchal","contact_name":null,"phone":"04 223 45 67","email":null,"website":"garagemarchal.be","sector":"Garage automobile","city":"Liège","source":null,"status":"a_appeler","confidence":{"company_name":0.99,"phone":0.97,"website":0.95,"sector":0.95,"city":0.97},"raw_notes":"4,6 ★ (87 avis) sur Google"}

Texte :
Bien à vous,
Sophie Willems
Office Manager — Cabinet dentaire Willems & Associés
sophie@dentiste-willems.be | +32 2 345 67 89
Chaussée de Waterloo 145, 1060 Bruxelles
Réponse :
{"company_name":"Cabinet dentaire Willems & Associés","contact_name":"Sophie Willems","phone":"+32 2 345 67 89","email":"sophie@dentiste-willems.be","website":null,"sector":"Cabinet dentaire","city":"Bruxelles","source":null,"status":"a_appeler","confidence":{"company_name":0.97,"contact_name":0.98,"phone":0.97,"email":0.98,"sector":0.85,"city":0.95},"raw_notes":"Contact : Office Manager"}

Texte :
Toitures Vandenberghe bvba — Kortrijksesteenweg 210, 9000 Gand — 09 225 11 33 — info@toitures-vdb.be (rencontré au salon Batibouw, m'a demandé de le recontacter en septembre)
Réponse :
{"company_name":"Toitures Vandenberghe bvba","contact_name":null,"phone":"09 225 11 33","email":"info@toitures-vdb.be","website":null,"sector":"Toiture","city":"Gand","source":"Salon / événement","status":"contacte","confidence":{"company_name":0.98,"phone":0.97,"email":0.97,"sector":0.9,"city":0.97,"source":0.95},"raw_notes":"Rencontré au salon Batibouw, à recontacter en septembre"}`;

/** Seuil sous lequel un champ déduit est signalé « à vérifier ». */
const CONFIDENCE_FLOOR = 0.7;

export async function extractProspectAction(input: {
  text?: string | null;
  imageBase64?: string | null;
  imageMime?: string | null;
}): Promise<ExtractResult> {
  const { supabase } = await requireUser();

  const text = (input.text ?? "").trim().slice(0, 6000);
  const hasImage = Boolean(input.imageBase64);

  if (!text && !hasImage) return { error: "Rien à analyser." };
  if (hasImage) {
    const size = input.imageBase64!.length;
    if (size > 6_000_000) return { error: "Capture trop lourde (max ~4 Mo)." };
    if (!/^[A-Za-z0-9+/=]+$/.test(input.imageBase64!)) {
      return { error: "Image illisible." };
    }
  }

  if (!aiAvailable(hasImage)) return { unavailable: true };

  let user: UserContent;
  if (hasImage) {
    const mime = ["image/png", "image/jpeg", "image/webp"].includes(
      input.imageMime ?? ""
    )
      ? input.imageMime!
      : "image/png";
    user = [
      {
        type: "text",
        text: text
          ? `Voici une capture d'écran et éventuellement du texte :\n${text}`
          : "Voici une capture d'écran contenant les informations du prospect.",
      },
      {
        type: "image_url",
        image_url: { url: `data:${mime};base64,${input.imageBase64}` },
      },
    ];
  } else {
    user = text;
  }

  const raw = await chatJSON({
    system: EXTRACT_SYSTEM,
    user,
    vision: hasImage,
    maxTokens: 700,
  });
  // Hors format ou panne → le formulaire s'ouvre vide, saisie manuelle.
  if (!raw) return { unavailable: true };

  const confidence =
    typeof raw.confidence === "object" && raw.confidence !== null
      ? (raw.confidence as Record<string, unknown>)
      : {};

  const fields: ExtractedProspect = {
    company_name: cleanStr(raw.company_name),
    contact_name: cleanStr(raw.contact_name, 120),
    phone: normalizeBelgianPhone(raw.phone),
    email: cleanEmail(raw.email),
    website: cleanWebsite(raw.website),
    sector: cleanStr(raw.sector, 80),
    city: cleanStr(raw.city, 80),
    source: SOURCES.includes(cleanStr(raw.source) ?? "")
      ? cleanStr(raw.source)
      : null,
    status: raw.status === "contacte" ? "contacte" : "a_appeler",
    notes: cleanStr(raw.raw_notes, 1000),
  };

  if (
    Object.entries(fields).every(
      ([k, v]) => k === "status" || v === null
    )
  ) {
    return { unavailable: true };
  }

  // Champs présents mais peu sûrs (confiance basse), ou fournis par le
  // modèle mais rejetés par la validation (le champ vide est alors surligné :
  // l'assistant a vu quelque chose ici, à ressaisir à la main) → l'œil doit
  // aller droit dessus.
  const uncertain: string[] = [];
  const rejected: Partial<Record<string, unknown>> = {
    phone: raw.phone,
    email: raw.email,
    website: raw.website,
  };
  for (const key of [
    "company_name",
    "contact_name",
    "phone",
    "email",
    "website",
    "sector",
    "city",
    "source",
  ] as const) {
    if (fields[key] === null) {
      if (key in rejected && cleanStr(rejected[key], 200) !== null) {
        uncertain.push(key);
      }
      continue;
    }
    const c = clamp01(confidence[key]);
    if (c !== null && c < CONFIDENCE_FLOOR) uncertain.push(key);
  }

  return {
    fields,
    uncertain,
    duplicates: await findDuplicates(supabase, fields),
  };
}

// ---------------------------------------------------------------------------
// Note d'échange → proposition structurée
// ---------------------------------------------------------------------------

export type NoteProposal = {
  /** Étape proposée — null si la note ne l'implique pas clairement. */
  statut: ProspectStatus | null;
  /**
   * Pourquoi l'étape proposée reste une simple suggestion, à confirmer d'un
   * clic — le fait correspondant manque, ou l'étape est réservée à l'humain.
   * null quand rien n'est proposé.
   */
  statutReserve: string | null;
  /** « YYYY-MM-DD » ou « YYYY-MM-DDTHH:mm », heure de Bruxelles. */
  dateLocale: string | null;
  contact_name: string | null;
  resume: string | null;
};

export type AnalyzeResult = {
  proposal?: NoteProposal;
  unavailable?: boolean;
  error?: string;
};

export async function analyzeNoteAction(input: {
  note: string;
}): Promise<AnalyzeResult> {
  await requireUser();

  const note = (input.note ?? "").trim().slice(0, 4000);
  if (!note) return { error: "La note est vide." };
  if (!aiAvailable()) return { unavailable: true };

  const today = isoToLocalInput(new Date().toISOString()); // YYYY-MM-DDTHH:mm Bruxelles
  const etapes = STATUS_ORDER.map((s) => `- "${s}" : ${STATUS_LABEL[s]}`).join("\n");

  const system = `Tu structures la note d'un commercial belge après un échange avec un prospect. Nous sommes le ${today.slice(0, 10)} (heure de Bruxelles).

Étapes possibles :
${etapes}

Règles absolues :
1. N'invente JAMAIS : si la note ne dit rien, mets null.
2. "etape" ne se déduit JAMAIS des mots employés, mais du fait correspondant :
   - "rendez_vous" UNIQUEMENT si la note donne une date de rendez-vous réelle
     (jour, et heure si elle est dite). Un « RDV à planifier », « il faudrait
     se voir », « je le rappelle pour caler un RDV » n'est PAS un rendez-vous :
     mets null.
   - "proposition" UNIQUEMENT si la note dit qu'un devis / une offre a été
     ENVOYÉ. « Je dois lui envoyer un devis » n'est pas une proposition envoyée.
   - "contacte" si un échange a réellement eu lieu (on s'est parlé, il a
     répondu).
   - "gagne" et "perdu" : tu peux les proposer, mais ce sont des décisions
     humaines — elles ne seront jamais appliquées sans un clic.
   Dans le doute, mets null : l'étape actuelle reste inchangée.
3. "date_relance" : la date de relance ou de rendez-vous déduite de la note, convertie en date réelle "YYYY-MM-DD" (ou "YYYY-MM-DDTHH:mm" si l'heure est précisée) — « après les fêtes » = début janvier, « dans 3 mois » = +3 mois. null si la note ne mentionne aucune échéance.
4. Ce sont des propositions : un humain valide avant tout enregistrement.

Réponds UNIQUEMENT avec un objet JSON, sans texte autour :
{ "etape": ..., "date_relance": ..., "contact_name": ..., "resume": "une phrase courte en français" }

Exemples (en supposant que nous sommes le 2026-08-03) :

Note : « rdv fixé mardi prochain 14h au garage, le gérant c'est Marc »
{"etape":"rendez_vous","date_relance":"2026-08-11T14:00","contact_name":"Marc","resume":"Rendez-vous fixé mardi 11/08 à 14h au garage avec Marc, le gérant."}

Note : « pas intéressé, bosse déjà avec un concurrent »
{"etape":"perdu","date_relance":null,"contact_name":null,"resume":"Pas intéressé : travaille déjà avec un concurrent."}

Note : « la secrétaire dit de revoir ça après les fêtes »
{"etape":null,"date_relance":"2027-01-04","contact_name":null,"resume":"À relancer début janvier, à la demande de la secrétaire."}

Note : « bien accroché au téléphone, RDV à planifier, je le rappelle la semaine prochaine »
{"etape":"contacte","date_relance":"2026-08-10","contact_name":null,"resume":"Échange positif par téléphone, rendez-vous à planifier au prochain appel."}`;

  const raw = await chatJSON({ system, user: note, maxTokens: 400 });
  if (!raw) return { unavailable: true };

  const etapeRaw = cleanStr(raw.etape, 40);
  let statut =
    etapeRaw && (STATUS_ORDER as string[]).includes(etapeRaw)
      ? (etapeRaw as ProspectStatus)
      : null;

  const dateRaw = cleanStr(raw.date_relance, 20);
  const dateLocale =
    dateRaw && /^\d{4}-\d{2}-\d{2}(T\d{2}:\d{2})?$/.test(dateRaw) ? dateRaw : null;

  // ------------------------------------------------------------------
  // Le garde-fou côté code : le modèle propose, les faits arbitrent.
  // C'est ici qu'on empêche la régression du 4 août — une note qui parle
  // d'un « RDV » sans date ne fait plus passer la fiche en « Rendez-vous ».
  // ------------------------------------------------------------------
  let statutReserve: string | null = null;

  if (statut === "rendez_vous" && !dateLocale) {
    // « Rendez-vous » exige une date réelle. Sans elle, le fait n'existe pas.
    statut = "contacte";
    statutReserve =
      "Aucune date de rendez-vous dans la note : l'étape « Rendez-vous » demande une date réelle.";
  } else if (statut === "rendez_vous") {
    statutReserve =
      "Vérifiez la date : l'étape passera en « Rendez-vous » une fois l'échange enregistré.";
  } else if (statut === "gagne" || statut === "perdu") {
    statutReserve =
      "« Gagné » et « Perdu » ne s'obtiennent jamais automatiquement — à vous de confirmer.";
  } else if (statut === "proposition") {
    statutReserve =
      "Cochez « j'ai envoyé une proposition » si le devis est bien parti : c'est ce geste qui fait foi.";
  }

  return {
    proposal: {
      statut,
      statutReserve,
      dateLocale,
      contact_name: cleanStr(raw.contact_name, 120),
      resume: cleanStr(raw.resume, 300),
    },
  };
}
