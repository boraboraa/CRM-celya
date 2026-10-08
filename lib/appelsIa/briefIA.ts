/**
 * La préparation du brief d'appel par l'IA — SERVEUR.
 *
 * À l'inscription d'une fiche, son brief naît « à préparer » ; le tick le
 * prépare pendant les quelques minutes de `pas_avant`. Sources : la fiche, et
 * le site web DE LA FICHE (lu une fois, borné en délai et en taille). Pas de
 * scraping Google, pas de clé Places : ce qui vient de Maps arrive par Claude
 * (connecteur) ou par Bora.
 *
 * L'IA ne réécrit JAMAIS ce que Claude ou Bora ont écrit (fusion « compléter »).
 * IA indisponible : le brief se réduit à ce que dit la fiche, et Janet appelle
 * quand même — une panne ne bloque jamais la prospection.
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import { aiAvailable, chatJSON } from "@/lib/ai/provider";
import {
  briefDepuisFiche,
  depuisSaisie,
  fusionner,
  normaliserContenu,
  type ContenuBrief,
  type InfoBrief,
} from "@/lib/appelsIa/brief";
import { partiesBruxelles } from "@/lib/appelsIa/calendrier";

const SITE_DELAI_MS = 6_000;
const SITE_MAX_OCTETS = 300_000;
const SITE_TEXTE_MAX = 6_000;
const ESSAIS_IA_MAX = 2;

/** Un nom d'hôte public (pas d'IP littérale, pas de nom local). */
function hotePublic(h: string): boolean {
  const v = h.toLowerCase();
  if (!v.includes(".") || v === "localhost" || v.endsWith(".local") || v.endsWith(".internal")) return false;
  if (/^\d{1,3}(\.\d{1,3}){3}$/.test(v) || v.startsWith("[") || v.includes(":")) return false;
  return true;
}

/** Le texte lisible du site de la fiche — ou null. Jamais plus de 6 s ni 300 Ko. */
export async function lireSite(brut: string): Promise<string | null> {
  let url: URL;
  try {
    url = new URL(/^https?:\/\//i.test(brut) ? brut : `https://${brut}`);
  } catch {
    return null;
  }
  for (let saut = 0; saut < 3; saut++) {
    if ((url.protocol !== "https:" && url.protocol !== "http:") || url.port || !hotePublic(url.hostname)) return null;
    let res: Response;
    try {
      res = await fetch(url, {
        redirect: "manual",
        headers: { "User-Agent": "CelyaCRM/1.0 (preparation de brief)", Accept: "text/html" },
        signal: AbortSignal.timeout(SITE_DELAI_MS),
      });
    } catch {
      return null;
    }
    if (res.status >= 300 && res.status < 400) {
      const loc = res.headers.get("location");
      if (!loc) return null;
      try {
        url = new URL(loc, url);
      } catch {
        return null;
      }
      continue;
    }
    if (!res.ok || !(res.headers.get("content-type") ?? "").includes("text/html") || !res.body) return null;
    const lecteur = res.body.getReader();
    const morceaux: Uint8Array[] = [];
    let total = 0;
    while (total < SITE_MAX_OCTETS) {
      const { done, value } = await lecteur.read();
      if (done || !value) break;
      morceaux.push(value);
      total += value.length;
    }
    await lecteur.cancel().catch(() => {});
    const html = new TextDecoder().decode(Buffer.concat(morceaux.map((m) => Buffer.from(m))).subarray(0, SITE_MAX_OCTETS));
    const titre = /<title[^>]*>([^<]{0,200})<\/title>/i.exec(html)?.[1] ?? "";
    const description = /<meta[^>]+name=["']description["'][^>]+content=["']([^"']{0,400})/i.exec(html)?.[1] ?? "";
    const corps = html
      .replace(/<script[\s\S]*?<\/script>/gi, " ")
      .replace(/<style[\s\S]*?<\/style>/gi, " ")
      .replace(/<[^>]+>/g, " ")
      .replace(/&nbsp;/g, " ")
      .replace(/&amp;/g, "&")
      .replace(/&#39;|&apos;/g, "'")
      .replace(/&quot;/g, '"')
      .replace(/\s+/g, " ")
      .trim();
    return `${titre}\n${description}\n${corps}`.slice(0, SITE_TEXTE_MAX);
  }
  return null;
}

const SYSTEME = `Tu prépares le brief d'un appel de prospection pour Janet, une intelligence artificielle de Celya (Belgique) qui propose aux petites entreprises une réceptionniste téléphonique (elle décroche quand personne ne peut, prend les rendez-vous et les messages).
On te donne la fiche du prospect et, parfois, le texte de son site web.
Règles :
- N'invente RIEN. Une information absente de la fiche et du site reste absente (null ou liste vide).
- Pas de prix, pas de nom de client de Celya.
- Phrases courtes, en français.
Réponds UNIQUEMENT par un objet JSON :
{"activite": string|null, "qui_demander": string|null, "ce_qu_on_sait": [{"texte": string, "source": "site"|"fiche"}], "accroche": string|null, "solution": string|null, "questions": [string]}
- activite : ce que fait l'entreprise, en une phrase ;
- qui_demander : le rôle (et le nom s'il est connu) de la personne à demander ;
- ce_qu_on_sait : horaires, réservation en ligne, avis, services — seulement ce qui est écrit ;
- accroche : une première phrase d'intérêt liée à leur activité, après la présentation obligatoire ;
- solution : comment la réceptionniste les aiderait, concrètement ;
- questions : trois questions de découverte au plus.`;

function versContenu(j: Record<string, unknown>, jour: string): ContenuBrief {
  const saisie = depuisSaisie(
    {
      activite: typeof j.activite === "string" ? j.activite : null,
      qui_demander: typeof j.qui_demander === "string" ? j.qui_demander : null,
      accroche: typeof j.accroche === "string" ? j.accroche : null,
      solution: typeof j.solution === "string" ? j.solution : null,
      questions: Array.isArray(j.questions) ? j.questions.filter((q): q is string => typeof q === "string").slice(0, 3) : null,
    },
    "ia",
    jour
  );
  const sait: InfoBrief[] = Array.isArray(j.ce_qu_on_sait)
    ? (j.ce_qu_on_sait as unknown[])
        .map((x) => {
          const o = (x ?? {}) as Record<string, unknown>;
          const texte = typeof o.texte === "string" ? o.texte.replace(/\s+/g, " ").trim().slice(0, 400) : "";
          if (!texte) return null;
          return { texte, source: o.source === "site" ? "site" : "fiche", date: jour } as InfoBrief;
        })
        .filter((x): x is InfoBrief => Boolean(x))
        .slice(0, 8)
    : [];
  if (sait.length) saisie.ce_qu_on_sait = sait;
  return saisie;
}

type Fiche = {
  company_name: string;
  contact_name: string | null;
  sector: string | null;
  city: string | null;
  address: string | null;
  website: string | null;
  notes: string | null;
};

/** Prépare UN brief : « pret » (IA) ou « minimal » (la fiche seule). */
export async function preparerBrief(admin: SupabaseClient, prospectId: string): Promise<"pret" | "minimal"> {
  const jour = partiesBruxelles(new Date()).ymd;
  const [{ data: f }, { data: b }] = await Promise.all([
    admin.from("prospects").select("company_name, contact_name, sector, city, address, website, notes").eq("id", prospectId).maybeSingle(),
    admin.from("appels_ia_briefs").select("contenu, essais_ia").eq("prospect_id", prospectId).maybeSingle(),
  ]);
  if (!f) return "minimal";
  const fiche = f as Fiche;
  const existant = normaliserContenu((b as { contenu?: unknown } | null)?.contenu, jour);
  const essais = Number((b as { essais_ia?: number } | null)?.essais_ia ?? 0);
  const minimal = fusionner(existant, briefDepuisFiche(fiche, jour), "completer");

  let ia: Record<string, unknown> | null = null;
  if (aiAvailable()) {
    const site = fiche.website ? await lireSite(fiche.website) : null;
    ia = await chatJSON({
      system: SYSTEME,
      user: JSON.stringify({
        fiche: {
          societe: fiche.company_name,
          contact: fiche.contact_name,
          secteur: fiche.sector,
          ville: fiche.city,
          adresse: fiche.address,
          notes: fiche.notes,
        },
        site,
      }),
      maxTokens: 900,
    });
  }
  if (!ia && aiAvailable() && essais + 1 < ESSAIS_IA_MAX) {
    // Panne passagère : on réessaiera au tick suivant, sans rien perdre.
    await admin.from("appels_ia_briefs").update({ essais_ia: essais + 1 }).eq("prospect_id", prospectId);
    return "minimal";
  }
  const contenu = ia ? fusionner(minimal, versContenu(ia, jour), "completer") : minimal;
  const etat = ia ? "pret" : "minimal";
  await admin
    .from("appels_ia_briefs")
    .upsert({ prospect_id: prospectId, contenu, etat, prepare_at: new Date().toISOString(), essais_ia: essais + 1 }, { onConflict: "prospect_id" });
  return etat;
}

/** Les briefs en attente, quelques-uns par tick. Une panne n'arrête pas les autres. */
export async function preparerBriefs(admin: SupabaseClient, max = 2): Promise<number> {
  const { data, error } = await admin
    .from("appels_ia_briefs")
    .select("prospect_id")
    .eq("etat", "a_preparer")
    .order("updated_at", { ascending: true })
    .limit(max);
  if (error) return 0;
  let n = 0;
  for (const b of (data ?? []) as { prospect_id: string }[]) {
    try {
      await preparerBrief(admin, b.prospect_id);
      n++;
    } catch (e) {
      console.error("[appels-ia] brief", b.prospect_id, String((e as Error)?.message ?? e));
    }
  }
  return n;
}
