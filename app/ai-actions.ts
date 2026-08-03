"use server";

/**
 * Saisie assistée par IA — deux actions, toutes deux côté serveur :
 *  - extractProspectAction : texte collé (ou capture d'écran) → champs de fiche
 *  - analyzeCallNoteAction : note d'appel au kilomètre → résultat structuré
 *
 * Règles : l'IA propose, elle n'exécute pas. Rien n'est écrit en base ici —
 * la validation humaine passe par les formulaires. Toute panne du modèle
 * renvoie { unavailable: true } et la saisie manuelle reste possible.
 */

import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { chatJSON, aiAvailable, type UserContent } from "@/lib/ai/provider";
import { isoToLocalInput } from "@/lib/time";
import { CALL_OUTCOMES, SOURCES } from "@/lib/constants";
import type { CallOutcome } from "@/lib/types";

async function requireUser() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");
  return { supabase, userId: user.id };
}

// ---------------------------------------------------------------------------
// Validation — on n'affiche jamais une sortie de modèle non vérifiée.
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

const cleanPhone = (v: unknown): string | null => {
  const s = cleanStr(v, 40);
  if (!s) return null;
  const digits = s.replace(/[^\d+]/g, "");
  return digits.replace(/(?!^)\+/g, "").length >= 8 ? s : null;
};

/** Chiffres significatifs d'un numéro pour la comparaison de doublons. */
const phoneKey = (v?: string | null): string | null => {
  if (!v) return null;
  const d = v.replace(/\D/g, "");
  if (d.length < 8) return null;
  return d.slice(-9); // suffisant pour un numéro belge, préfixe pays ignoré
};

// ---------------------------------------------------------------------------
// B1 — Coller → fiche
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
  duplicates?: DuplicateHit[];
  unavailable?: boolean;
  error?: string;
};

const EXTRACT_SYSTEM = `Tu extrais les coordonnées d'un prospect belge à partir d'un texte collé (résultat Google Maps, signature d'email, ligne d'annuaire, extrait LinkedIn, texte mal formaté) ou d'une capture d'écran.

Réponds UNIQUEMENT avec un objet JSON, sans texte autour, avec exactement ces clés (valeur null si l'information est absente — n'invente jamais rien) :
{
  "company_name": "nom de la société",
  "contact_name": "prénom et nom de la personne de contact",
  "phone": "numéro de téléphone, format d'origine",
  "email": "adresse email",
  "website": "site web",
  "sector": "secteur d'activité en 1-3 mots français",
  "city": "ville",
  "source": une valeur parmi ${JSON.stringify(SOURCES)} qui correspond à la provenance apparente du texte, sinon null
}`;

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
  });
  if (!raw) return { unavailable: true };

  const fields: ExtractedProspect = {
    company_name: cleanStr(raw.company_name),
    contact_name: cleanStr(raw.contact_name, 120),
    phone: cleanPhone(raw.phone),
    email: cleanEmail(raw.email),
    website: cleanStr(raw.website, 200),
    sector: cleanStr(raw.sector, 80),
    city: cleanStr(raw.city, 80),
    source: SOURCES.includes(cleanStr(raw.source) ?? "")
      ? cleanStr(raw.source)
      : null,
  };

  if (Object.values(fields).every((v) => v === null)) {
    return { unavailable: true };
  }

  return { fields, duplicates: await findDuplicates(supabase, fields) };
}

/**
 * Détection de doublon avant création : téléphone, email et nom de société
 * comparés aux prospects existants. On prévient, on ne bloque pas.
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
  const targetName = fields.company_name
    ?.toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/\b(srl|sprl|sa|bv|nv|asbl|sc|scs)\b/g, "")
    .replace(/[^a-z0-9]/g, "");

  for (const r of rows) {
    const reasons: string[] = [];
    if (targetPhone && phoneKey(r.phone) === targetPhone) reasons.push("même téléphone");
    if (targetEmail && r.email?.toLowerCase() === targetEmail) reasons.push("même email");
    if (targetName && targetName.length > 3) {
      const rowName = (r.company_name ?? "")
        .toLowerCase()
        .normalize("NFD")
        .replace(/[̀-ͯ]/g, "")
        .replace(/\b(srl|sprl|sa|bv|nv|asbl|sc|scs)\b/g, "")
        .replace(/[^a-z0-9]/g, "");
      if (rowName && (rowName === targetName || rowName.includes(targetName) || targetName.includes(rowName))) {
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
// B2 — Note d'appel → proposition structurée
// ---------------------------------------------------------------------------

export type CallNoteProposal = {
  resultat: CallOutcome | null;
  /** « YYYY-MM-DD » ou « YYYY-MM-DDTHH:mm », heure de Bruxelles. */
  dateLocale: string | null;
  contact_name: string | null;
  resume: string | null;
};

export type AnalyzeResult = {
  proposal?: CallNoteProposal;
  unavailable?: boolean;
  error?: string;
};

export async function analyzeCallNoteAction(input: {
  note: string;
}): Promise<AnalyzeResult> {
  await requireUser();

  const note = (input.note ?? "").trim().slice(0, 4000);
  if (!note) return { error: "La note est vide." };
  if (!aiAvailable()) return { unavailable: true };

  const today = isoToLocalInput(new Date().toISOString()); // YYYY-MM-DDTHH:mm Bruxelles
  const outcomes = Object.entries(CALL_OUTCOMES)
    .map(([key, c]) => `- "${key}" : ${c.label}`)
    .join("\n");

  const system = `Tu structures la note d'appel d'un commercial belge. Nous sommes le ${today.slice(0, 10)} (heure de Bruxelles).

Résultats d'appel possibles :
${outcomes}

Réponds UNIQUEMENT avec un objet JSON, sans texte autour :
{
  "resultat": une des clés ci-dessus qui correspond le mieux à la note, sinon null,
  "date_rappel": date de rappel ou de RDV déduite de la note, convertie en date réelle au format "YYYY-MM-DD" (ou "YYYY-MM-DDTHH:mm" si l'heure est précisée), sinon null — "après les fêtes" = début janvier, "dans 3 mois" = +3 mois, etc.,
  "contact_name": prénom/nom de l'interlocuteur si mentionné, sinon null,
  "resume": résumé de l'appel en une phrase courte en français, sinon null
}
N'invente jamais : si la note ne dit rien, mets null.`;

  const raw = await chatJSON({ system, user: note, maxTokens: 400 });
  if (!raw) return { unavailable: true };

  const resultatRaw = cleanStr(raw.resultat, 40);
  const resultat =
    resultatRaw && resultatRaw in CALL_OUTCOMES ? (resultatRaw as CallOutcome) : null;

  const dateRaw = cleanStr(raw.date_rappel, 20);
  const dateLocale =
    dateRaw && /^\d{4}-\d{2}-\d{2}(T\d{2}:\d{2})?$/.test(dateRaw) ? dateRaw : null;

  return {
    proposal: {
      resultat,
      dateLocale,
      contact_name: cleanStr(raw.contact_name, 120),
      resume: cleanStr(raw.resume, 300),
    },
  };
}
