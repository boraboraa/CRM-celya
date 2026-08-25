/**
 * Normalisation et détection de doublons — déterministe, jamais déléguée au
 * modèle. Ce module est neutre (ni "use server", ni "use client") : c'est la
 * *seule* source de vérité, partagée par la saisie assistée (app/ai-actions.ts),
 * les server actions (app/actions.ts) et le connecteur MCP (app/[transport]).
 *
 * Déplacé depuis app/ai-actions.ts le 4 août sans changement de comportement :
 * un prospect créé par le connecteur applique exactement la même normalisation
 * « +32 » et la même dédup qu'un prospect créé à la main.
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import { scopeProspects, canSeeProspect, type Viewer } from "./access";

/**
 * Normalise un numéro au format belge « +32 … ». Déterministe :
 *  - « 0470 12 34 56 », « 04/223.45.67 », « 0032 470 … », « +32(0)470 … »
 *    deviennent « +32 470 12 34 56 » / « +32 4 223 45 67 » ;
 *  - un numéro étranger (+33…, +49…) est conservé tel quel, compacté ;
 *  - tout ce qui ne ressemble pas à un numéro plausible revient à null —
 *    un numéro inventé coûte une relance perdue.
 */
export function normalizeBelgianPhone(raw: unknown): string | null {
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
  if (digits.startsWith("32")) {
    // « +32 0470 12 34 56 » : le 0 national ne se garde pas après l'indicatif.
    const nsn = digits.slice(2).replace(/^0/, "");
    return formatBelgianNSN(nsn);
  }
  // Numéro étranger : plausible entre 8 et 15 chiffres (E.164), sinon null.
  if (digits.length < 8 || digits.length > 15) return null;
  return `+${digits}`;
}

function formatBelgianNSN(nsn: string): string | null {
  if (nsn.length === 9) {
    // Mobile — toujours 4XX en Belgique. Tout autre préfixe (ex. un 06
    // français collé en format national) n'est PAS transformé en +32 :
    // on n'invente jamais un numéro.
    if (nsn[0] !== "4") return null;
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
export const phoneKey = (v?: string | null): string | null => {
  if (!v) return null;
  const d = v.replace(/\D/g, "");
  if (d.length < 8) return null;
  return d.slice(-9); // suffisant pour un numéro belge, préfixe pays ignoré
};

/** Nom de société normalisé (accents, formes juridiques, ponctuation). */
export const companyKey = (v?: string | null): string | null => {
  if (!v) return null;
  const k = v
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/\b(srl|sprl|sa|bv|bvba|nv|asbl|vzw|sc|scs|snc|gmbh)\b/g, "")
    .replace(/[^a-z0-9]/g, "");
  return k.length > 3 ? k : null;
};

export type DuplicateHit = {
  id: string;
  company_name: string;
  phone: string | null;
  email: string | null;
  status: string;
  reason: string;
};

/**
 * Détection de doublon avant création : téléphone, email et nom de société
 * normalisés, comparés aux prospects existants. On prévient, on ne bloque pas.
 *
 * `scope` n'est renseigné que par le connecteur MCP, qui agit en service_role
 * (RLS contournée) : sans lui, l'avertissement de doublon renvoyé à un
 * commercial nommerait les sociétés de Bora — une fuite par le canal le plus
 * discret qui soit. Depuis l'interface, le client Supabase de l'utilisateur
 * applique déjà `can_see_prospect`, et `scope` reste absent.
 */
export async function findDuplicates(
  supabase: SupabaseClient,
  fields: { company_name: string | null; phone: string | null; email: string | null },
  scope?: Viewer | null
): Promise<DuplicateHit[]> {
  let q = supabase
    .from("prospects")
    .select("id, company_name, phone, email, status, owner_id")
    .limit(2000);
  if (scope) q = scopeProspects(q, scope);
  const { data } = await q;

  const rows = data ?? [];
  const hits: DuplicateHit[] = [];
  const targetPhone = phoneKey(fields.phone);
  const targetEmail = fields.email?.toLowerCase() ?? null;
  const targetName = companyKey(fields.company_name);

  for (const r of rows) {
    // Dernier verrou : même si le filtre de requête n'avait pas mordu, une
    // fiche qui ne regarde pas l'appelant ne franchit pas cette porte.
    if (scope && !canSeeProspect(scope, (r.owner_id as string | null) ?? null)) {
      continue;
    }
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
