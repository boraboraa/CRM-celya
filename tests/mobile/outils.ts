import { expect, type Locator, type Page, type TestInfo } from "@playwright/test";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { SUPABASE_URL, SUPABASE_ANON_KEY } from "../../lib/env";

export type Role = "commercial" | "admin";
export type Appareil = "iphone" | "android" | "ordinateur";

export function identifiants(role: Role): { email: string; password: string } {
  const prefixe = role === "admin" ? "E2E_ADMIN" : "E2E_COMMERCIAL";
  const email = process.env[`${prefixe}_EMAIL`];
  const password = process.env[`${prefixe}_PASSWORD`];
  if (!email || !password) {
    throw new Error(`${prefixe}_EMAIL / ${prefixe}_PASSWORD manquants (voir playwright.config.ts)`);
  }
  return { email, password };
}

/** Le projet courant : quel appareil, quel rôle. */
export function contexte(info: TestInfo): { appareil: Appareil; role: Role; mobile: boolean } {
  const m = info.project.metadata as { appareil: Appareil; role: Role };
  return { ...m, mobile: m.appareil !== "ordinateur" };
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
  commercial: ["/dashboard", "/prospects", "/prospects?vue=colonnes", "/agenda", "/compte", "/prospects/nouveau"],
  admin: ["/dashboard", "/prospects", "/prospects?vue=colonnes", "/agenda", "/compte", "/equipe", "/appels-ia", "/prospects/nouveau"],
};
