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

async function requireUser() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");
  return { supabase, userId: user.id };
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

/**
 * Normalise un numéro au format belge « +32 … ». Déterministe :
 *  - « 0470 12 34 56 », « 04/223.45.67 », « 0032 470 … », « +32(0)470 … »
 *    deviennent « +32 470 12 34 56 » / « +32 4 223 45 67 » ;
 *  - un numéro étranger (+33…, +49…) est conservé tel quel, compacté ;
 *  - tout ce qui ne ressemble pas à un numéro plausible revient à null —
 *    un numéro inventé coûte une relance perdue.
 */
function normalizeBelgianPhone(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  let s = raw.trim();
  if (!s) return null;

  // « +32(0)470… » → « +32470… »
  s = s.replace(/\(0\)/g, "");
  // On ne garde que les chiffres et un éventuel + de tête.
  const plus = s.startsWith("+");
  let digits = s.replace(/\D/g, "");
  if (!plus && digits.startsWith("00")) {
    digits = digits.slice(2);
    return formatInternational(digits);
  }
  if (plus) return formatInternational(digits);

  // Format national belge : 0 + 8 ou 9 chiffres.
  if (digits.startsWith("0") && (digits.length === 9 || digits.length === 10)) {
    return formatBelgianNSN(digits.slice(1));
  }
  return null;
}

function formatInternational(digits: string): string | null {
  if (digits.startsWith("32")) return formatBelgianNSN(digits.slice(2));
  // Numéro étranger : plausible entre 8 et 15 chiffres (E.164), sinon null.
  if (digits.length < 8 || digits.length > 15) return null;
  return `+${digits}`;
}

function formatBelgianNSN(nsn: string): string | null {
  if (nsn.length === 9) {
    // Mobile (4XX XX XX XX)
    return `+32 ${nsn.slice(0, 3)} ${nsn.slice(3, 5)} ${nsn.slice(5, 7)} ${nsn.slice(7)}`;
  }
  if (nsn.length === 8) {
    // Fixe : zone à un chiffre (Bruxelles 2, Anvers 3, Liège 4, Gand 9)…
    if ("2349".includes(nsn[0])) {
      return `+32 ${nsn[0]} ${nsn.slice(1, 4)} ${nsn.slice(4, 6)} ${nsn.slice(6)}`;
    }
    // …ou zone à deux chiffres (065 Mons, 081 Namur…).
    return `+32 ${nsn.slice(0, 2)} ${nsn.slice(2, 4)} ${nsn.slice(4, 6)} ${nsn.slice(6)}`;
  }
  return null;
}

/** Chiffres significatifs d'un numéro pour la comparaison de doublons. */
const phoneKey = (v?: string | null): string | null => {
  if (!v) return null;
  const d = v.replace(/\D/g, "");
  if (d.length < 8) return null;
  return d.slice(-9); // suffisant pour un numéro belge, préfixe pays ignoré
};

/** Nom de société normalisé (accents, formes juridiques, ponctuation). */
const companyKey = (v?: string | null): string | null => {
  if (!v) return null;
  const k = v
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/\b(srl|sprl|sa|bv|bvba|nv|asbl|vzw|sc|scs|snc|gmbh)\b/g, "")
    .replace(/[^a-z0-9]/g, "");
  return k.length > 3 ? k : null;
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

export type DuplicateHit = {
  id: string;
  company_name: string;
  phone: string | null;
  email: string | null;
  status: string;
  reason: string;
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

  // Champs présents mais peu sûrs (confiance basse, ou numéro/email fourni
  // par le modèle mais rejeté par la validation) → l'œil doit aller dessus.
  const uncertain: string[] = [];
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
    if (fields[key] === null) continue;
    const c = clamp01(confidence[key]);
    if (c !== null && c < CONFIDENCE_FLOOR) uncertain.push(key);
  }

  return {
    fields,
    uncertain,
    duplicates: await findDuplicates(supabase, fields),
  };
}

/**
 * Détection de doublon avant création : téléphone, email et nom de société
 * normalisés, comparés aux prospects existants. On prévient, on ne bloque pas.
 */
async function findDuplicates(
  supabase: Awaited<ReturnType<typeof createClient>>,
  fields: Pick<ExtractedProspect, "company_name" | "phone" | "email">
): Promise<DuplicateHit[]> {
  const { data } = await supabase
    .from("prospects")
    .select("id, company_name, phone, email, status")
    .limit(2000);

  const rows = data ?? [];
  const hits: DuplicateHit[] = [];
  const targetPhone = phoneKey(fields.phone);
  const targetEmail = fields.email?.toLowerCase() ?? null;
  const targetName = companyKey(fields.company_name);

  for (const r of rows) {
    const reasons: string[] = [];
    if (targetPhone && phoneKey(r.phone) === targetPhone) reasons.push("même téléphone");
    if (targetEmail && r.email?.toLowerCase() === targetEmail) reasons.push("même email");
    if (targetName) {
      const rowName = companyKey(r.company_name);
      if (
        rowName &&
        (rowName === targetName ||
          rowName.includes(targetName) ||
          targetName.includes(rowName))
      ) {
        reasons.push("nom de société proche");
      }
    }
    if (reasons.length > 0) {
      hits.push({
        id: r.id,
        company_name: r.company_name,
        phone: r.phone,
        email: r.email,
        status: r.status,
        reason: reasons.join(", "),
      });
    }
    if (hits.length >= 5) break;
  }
  return hits;
}

// ---------------------------------------------------------------------------
// Note d'échange → proposition structurée
// ---------------------------------------------------------------------------

export type NoteProposal = {
  /** Étape proposée — null si la note ne l'implique pas clairement. */
  statut: ProspectStatus | null;
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
2. "etape" uniquement si la note l'implique clairement (rendez-vous fixé → "rendez_vous", refus net → "perdu", devis/offre à envoyer → "proposition", accord conclu → "gagne", échange qui a eu lieu → "contacte"), sinon null — l'étape actuelle reste inchangée.
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
{"etape":null,"date_relance":"2027-01-04","contact_name":null,"resume":"À relancer début janvier, à la demande de la secrétaire."}`;

  const raw = await chatJSON({ system, user: note, maxTokens: 400 });
  if (!raw) return { unavailable: true };

  const etapeRaw = cleanStr(raw.etape, 40);
  const statut =
    etapeRaw && (STATUS_ORDER as string[]).includes(etapeRaw)
      ? (etapeRaw as ProspectStatus)
      : null;

  const dateRaw = cleanStr(raw.date_relance, 20);
  const dateLocale =
    dateRaw && /^\d{4}-\d{2}-\d{2}(T\d{2}:\d{2})?$/.test(dateRaw) ? dateRaw : null;

  return {
    proposal: {
      statut,
      dateLocale,
      contact_name: cleanStr(raw.contact_name, 120),
      resume: cleanStr(raw.resume, 300),
    },
  };
}
