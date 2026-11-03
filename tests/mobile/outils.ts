import { expect, type Locator, type Page, type TestInfo } from "@playwright/test";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { SUPABASE_URL, SUPABASE_ANON_KEY } from "../../lib/env";
import { controlerCadres } from "./cadres";

export type Role = "commercial" | "admin";
export type Appareil = "iphone" | "android" | "ipad-portrait" | "ipad-paysage" | "ordinateur";

export function identifiants(role: Role): { email: string; password: string } {
  const prefixe = role === "admin" ? "E2E_ADMIN" : "E2E_COMMERCIAL";
  const email = process.env[`${prefixe}_EMAIL`];
  const password = process.env[`${prefixe}_PASSWORD`];
  if (!email || !password) {
    throw new Error(`${prefixe}_EMAIL / ${prefixe}_PASSWORD manquants (voir playwright.config.ts)`);
  }
  return { email, password };
}

/**
 * Le projet courant : quel appareil, quel rôle — et deux questions qu'on ne
 * confond plus (3/11) :
 * - `mobile` : la mise en page ÉTROITE (sous `lg`, 1024 px) — barre du bas,
 *   cartes, feuilles. L'iPad en portrait l'a, l'iPad en paysage non ;
 * - `tactile` : un DOIGT — cibles de 44 px, pas de glisser-déposer. Tout
 *   sauf l'ordinateur.
 */
export function contexte(info: TestInfo): {
  appareil: Appareil;
  role: Role;
  mobile: boolean;
  tactile: boolean;
  ipad: boolean;
  /** Un TÉLÉPHONE (sous `sm`, agent mobile) : vue Jour de l'agenda, recherche plein écran. */
  telephone: boolean;
} {
  const m = info.project.metadata as { appareil: Appareil; role: Role };
  const ipad = m.appareil === "ipad-portrait" || m.appareil === "ipad-paysage";
  return {
    ...m,
    mobile: m.appareil !== "ordinateur" && m.appareil !== "ipad-paysage",
    tactile: m.appareil !== "ordinateur",
    ipad,
    telephone: m.appareil === "iphone" || m.appareil === "android",
  };
}

/**
 * Au DOIGT, toute cible du conteneur a une ZONE d'au moins `min` × `min` px :
 * sa boîte, élargie de sa pseudo-zone `::after` (le filet de globals.css).
 * Renvoie la liste des fautes (« libellé (l×h) »).
 */
export async function zonesTactiles(conteneur: Locator, min = 44): Promise<void> {
  const fautes = await conteneur.evaluate((racine, min) => {
    const sel = 'a[href], button, [role="button"], summary, select, label[for]';
    const els = Array.from(racine.querySelectorAll<HTMLElement>(sel));
    for (const l of Array.from(racine.querySelectorAll<HTMLElement>("label"))) {
      if (Array.from(l.children).some((c) => c.tagName === "INPUT")) els.push(l);
    }
    const out: string[] = [];
    const px = (v: string) => (v.endsWith("px") ? parseFloat(v) : 0);
    for (const el of els) {
      const r = el.getBoundingClientRect();
      if (r.width === 0 || r.height === 0) continue;
      const s = getComputedStyle(el);
      if (s.visibility === "hidden" || s.display === "none") continue;
      // Hors champ visuel (texte pour lecteur d'écran seulement).
      if (s.clip === "rect(0px, 0px, 0px, 0px)" || (r.width <= 1 && r.height <= 1)) continue;
      // Caché par un ancêtre (bloc replié, onglet fermé).
      if (!el.checkVisibility?.({ checkOpacity: false, checkVisibilityCSS: true })) continue;
      const a = getComputedStyle(el, "::after");
      let l = r.width;
      let h = r.height;
      if (a.content && a.content !== "none" && a.position === "absolute") {
        l = Math.max(l, r.width - Math.min(0, px(a.left)) - Math.min(0, px(a.right)));
        h = Math.max(h, r.height - Math.min(0, px(a.top)) - Math.min(0, px(a.bottom)));
      }
      // Un lien ÉTIRÉ (`before:absolute inset-0`, la ligne d'une liste) répond
      // sur toute sa ligne : sa zone est celle de son bloc conteneur.
      const avant = getComputedStyle(el, "::before");
      if (avant.content && avant.content !== "none" && avant.position === "absolute" && el.offsetParent) {
        const c = (el.offsetParent as HTMLElement).getBoundingClientRect();
        l = Math.max(l, c.width);
        h = Math.max(h, c.height);
      }
      if (l < min - 0.5 || h < min - 0.5) {
        const nom = (el.getAttribute("aria-label") ?? el.textContent ?? el.tagName).trim().replace(/\s+/g, " ").slice(0, 30);
        out.push(`${nom} (${Math.round(l)}×${Math.round(h)})`);
      }
    }
    return out;
  }, min);
  expect(fautes, `zones tactiles de moins de ${min} px`).toEqual([]);
}

/** Échec automatique : la page ne doit jamais être plus large que l'écran. */
export async function pasDeDefilementHorizontal(page: Page): Promise<void> {
  const { largeur, ecran, coupables } = await page.evaluate(() => {
    const ecran = document.documentElement.clientWidth;
    const largeur = Math.max(document.documentElement.scrollWidth, document.body.scrollWidth);
    // Les éléments qui dépassent, pour que l'échec dise QUOI corriger. Un
    // élément dans un conteneur qui défile de lui-même n'est pas coupable.
    const coupables: string[] = [];
    for (const el of Array.from(document.querySelectorAll<HTMLElement>("body *"))) {
      const r = el.getBoundingClientRect();
      if (r.width === 0 || r.right <= ecran + 1) continue;
      let p = el.parentElement;
      let cache = false;
      while (p && p !== document.body) {
        const s = getComputedStyle(p);
        if (["auto", "scroll", "hidden", "clip"].includes(s.overflowX)) {
          cache = true;
          break;
        }
        p = p.parentElement;
      }
      if (!cache) {
        const id = `${el.tagName.toLowerCase()}${el.className && typeof el.className === "string" ? "." + el.className.split(" ").slice(0, 3).join(".") : ""}`;
        coupables.push(`${id} → ${Math.round(r.right)} px`);
      }
      if (coupables.length >= 5) break;
    }
    return { largeur, ecran, coupables };
  });
  expect(largeur, `page plus large que l'écran (${ecran} px) : ${coupables.join(" ; ")}`).toBeLessThanOrEqual(ecran);
}

/**
 * Échec automatique : rien ne dépasse de son CADRE (carte, ligne, pastille,
 * bouton) — pas seulement de la page. La règle vit dans `cadres.ts`.
 */
export async function rienNeDepasse(page: Page, selecteur = "main"): Promise<void> {
  const fautes = await page.evaluate(controlerCadres, selecteur);
  expect(fautes, `contenu hors de son cadre (${page.url()})`).toEqual([]);
}

/** Toutes les cibles VISIBLES du conteneur mesurent au moins `min` px de haut et de large. */
export async function ciblesTactiles(conteneur: Locator, min = 44): Promise<void> {
  const trop = await conteneur.evaluate((racine, min) => {
    const sel = "a[href], button, input:not([type=hidden]), select, textarea, [role=button], [role=tab]";
    const fautes: string[] = [];
    for (const el of Array.from(racine.querySelectorAll<HTMLElement>(sel))) {
      const r = el.getBoundingClientRect();
      if (r.width === 0 || r.height === 0) continue;
      if (r.height < min - 0.5 || r.width < min - 0.5) {
        fautes.push(`${(el.getAttribute("aria-label") ?? el.textContent ?? el.tagName).trim().slice(0, 30)} (${Math.round(r.width)}×${Math.round(r.height)})`);
      }
    }
    return fautes;
  }, min);
  expect(trop, `cibles de moins de ${min} px`).toEqual([]);
}

/** L'élément est-il entièrement dans le premier écran (sans défiler) ? */
export async function dansLePremierEcran(page: Page, loc: Locator, ecrans = 1): Promise<void> {
  await loc.scrollIntoViewIfNeeded({ timeout: 1 }).catch(() => {});
  await page.evaluate(() => window.scrollTo(0, 0));
  const box = await loc.boundingBox();
  const h = page.viewportSize()!.height;
  expect(box, "élément introuvable").not.toBeNull();
  expect(box!.y + Math.min(box!.height, 40), `hors des ${ecrans} premier(s) écran(s)`).toBeLessThanOrEqual(h * ecrans);
}

/** Une session Supabase du compte de test — pour poser ou retirer ses propres fixtures. */
export async function sessionDe(role: Role): Promise<{ c: SupabaseClient; uid: string }> {
  const c = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, { auth: { persistSession: false } });
  const { data, error } = await c.auth.signInWithPassword(identifiants(role));
  if (error) throw new Error(error.message);
  return { c, uid: data.user.id };
}

/** Le marqueur des fiches créées PAR un test (retirées en fin de test). */
export const MARQUE_E2E = "ZZ Test mobile e2e";

/** Retire les fiches créées par les tests (et leurs RDV, qui ne suivent pas en cascade). */
export async function nettoyer(role: Role): Promise<void> {
  const { c } = await sessionDe(role);
  const { data } = await c.from("prospects").select("id").ilike("company_name", `${MARQUE_E2E}%`);
  const ids = (data ?? []).map((p) => p.id as string);
  if (ids.length === 0) return;
  await c.from("meetings").delete().in("prospect_id", ids);
  await c.from("prospects").delete().in("id", ids);
}

/** Une fiche de test avec un RDV passé qui attend son débrief. */
export async function ficheAvecRdvPasse(role: Role, nom: string): Promise<{ id: string; rdv: string }> {
  const { c, uid } = await sessionDe(role);
  const { data: p, error } = await c
    .from("prospects")
    .insert({ company_name: `${MARQUE_E2E} — ${nom}`, contact_name: "Contact Fictif", phone: "+32 000 99 00 01", status: "a_appeler" })
    .select("id")
    .single();
  if (error) throw new Error(error.message);
  const debut = new Date(Date.now() - 2 * 86400000);
  const { data: m, error: e2 } = await c
    .from("meetings")
    .insert({
      prospect_id: p.id, owner_id: uid, created_by: uid, kind: "prospect",
      title: `RDV ${nom}`, starts_at: debut.toISOString(),
      ends_at: new Date(debut.getTime() + 3600000).toISOString(), status: "prevu",
    })
    .select("id")
    .single();
  if (e2) throw new Error(e2.message);
  return { id: p.id as string, rdv: m.id as string };
}

/** Les pages internes à parcourir pour le test de largeur. */
export const PAGES: Record<Role, string[]> = {
  commercial: ["/dashboard", "/prospects", "/prospects?vue=colonnes", "/agenda", "/compte", "/prospects/nouveau", "/prospects/ma-liste", "/classement"],
  admin: ["/dashboard", "/prospects", "/prospects?vue=colonnes", "/agenda", "/compte", "/equipe", "/appels-ia", "/prospects/nouveau", "/prospects/ma-liste", "/classement"],
};
