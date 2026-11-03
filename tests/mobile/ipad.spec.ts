import { test, expect, type Page } from "@playwright/test";
import {
  contexte,
  MARQUE_E2E,
  nettoyer,
  pasDeDefilementHorizontal,
  rienNeDepasse,
  sessionDe,
  zonesTactiles,
  type Role,
} from "./outils";

/**
 * L'iPad (3 novembre 2026) — Colin travaille sur iPad : des taps perdus, posés
 * sur la mauvaise relance, des filtres qui disparaissaient au retour d'une
 * fiche. Fiches « ZZ Test mobile » seulement (donnees.ts) ; les tests qui
 * écrivent créent les leurs (« ZZ Test mobile e2e — … ») et les retirent.
 */

const ALPHA = "ZZ Test mobile — Garage Alpha";
const BETA = "ZZ Test mobile — Garage Beta";
const GAMMA = "ZZ Test mobile — Carrosserie Gamma";

async function idFiche(role: Role, nom: string): Promise<string> {
  const { c } = await sessionDe(role);
  const { data, error } = await c.from("prospects").select("id").eq("company_name", nom).single();
  if (error) throw new Error(error.message);
  return data.id as string;
}

/** Les écrans du jour de Colin — l'admin reste en périmètre « moi » (aucune fiche réelle). */
async function ecrans(role: Role): Promise<string[]> {
  const moi = role === "admin" ? "perimetre=moi" : "";
  const avec = (u: string) => (moi ? `${u}${u.includes("?") ? "&" : "?"}${moi}` : u);
  const fiche = `/prospects/${await idFiche(role, role === "admin" ? "ZZ Test mobile — Admin Thêta" : ALPHA)}`;
  return [avec("/dashboard"), avec("/prospects?vue=liste"), avec("/prospects?vue=colonnes"), fiche, avec("/agenda")];
}

async function charger(page: Page, url: string) {
  await page.goto(url);
  await page.waitForLoadState("networkidle");
  await page.locator("main h1").first().waitFor();
}

test("au doigt, toute cible visible a une zone d'au moins 44 × 44 px", async ({ page }, info) => {
  const { ipad, role, appareil } = contexte(info);
  test.skip(!ipad, "iPad");
  for (const url of await ecrans(role)) {
    await charger(page, url);
    await test.step(url, async () => {
      await zonesTactiles(page.locator("main"));
      if (appareil === "ipad-paysage") await zonesTactiles(page.locator("aside"));
    });
  }
});

test("rien ne déborde, en portrait comme en paysage", async ({ page }, info) => {
  const { ipad, role } = contexte(info);
  test.skip(!ipad, "iPad");
  const urls = await ecrans(role);
  urls.push(role === "admin" ? "/prospects?perimetre=moi&secteur=Autre" : "/prospects?secteur=Garage+%2F+carrosserie&region=Namur");
  for (const url of urls) {
    await charger(page, url);
    await test.step(url, async () => {
      await pasDeDefilementHorizontal(page);
      await rienNeDepasse(page);
    });
  }
});

test.describe("écrit", () => {
  test.beforeEach(async ({}, info) => {
    const { ipad, role } = contexte(info);
    test.skip(!ipad || role !== "commercial", "iPad, commercial (ses propres fiches de test)");
  });
  test.afterEach(async () => {
    await nettoyer("commercial");
  });

  test("double tap sur la case : la relance est faite, jamais rouverte, et la suivante n'est pas touchée", async ({ page }) => {
    const { c, uid } = await sessionDe("commercial");
    const { data: p } = await c
      .from("prospects")
      .insert({ company_name: `${MARQUE_E2E} — Double tap`, contact_name: "Contact Fictif", phone: "+32 000 99 33 01", status: "a_rappeler" })
      .select("id")
      .single();
    const ilYa = (h: number) => new Date(Date.now() - h * 3_600_000).toISOString();
    const { data: taches } = await c
      .from("tasks")
      .insert([
        { prospect_id: p!.id, title: "ZZ double tap — première", due_at: ilYa(30), status: "a_faire", priority: 2, assignee_id: uid, created_by: uid },
        { prospect_id: p!.id, title: "ZZ double tap — seconde", due_at: ilYa(29), status: "a_faire", priority: 2, assignee_id: uid, created_by: uid },
      ])
      .select("id, title");
    const premiere = taches!.find((t) => t.title.endsWith("première"))!;
    const seconde = taches!.find((t) => t.title.endsWith("seconde"))!;

    await charger(page, "/dashboard");
    const ligne1 = page.locator("li", { hasText: "ZZ double tap — première" }).first();
    const ligne2 = page.locator("li", { hasText: "ZZ double tap — seconde" }).first();
    const caseUn = ligne1.getByRole("button", { name: "Marquer comme faite" });
    await expect(caseUn).toBeEnabled();
    const avant = (await ligne2.boundingBox())!;
    const b = (await caseUn.boundingBox())!;
    // DEUX taps au même endroit, rapprochés — le doigt de Colin.
    await page.touchscreen.tap(b.x + b.width / 2, b.y + b.height / 2);
    await page.waitForTimeout(80);
    await page.touchscreen.tap(b.x + b.width / 2, b.y + b.height / 2);

    // La ligne reste à sa place, barrée, avec « Annuler » ; la suivante n'a pas bougé.
    await expect(ligne1.getByText("Faite")).toBeVisible();
    await expect(ligne1.getByRole("button", { name: "Annuler" })).toBeVisible();
    const apres = (await ligne2.boundingBox())!;
    expect(Math.abs(apres.y - avant.y)).toBeLessThan(1);
    await expect(ligne2.getByRole("button", { name: "Marquer comme faite" })).toBeEnabled();

    // Puis elle se replie ; la base dit : faite, une fois — la seconde intacte.
    await expect(ligne1).toHaveCount(0, { timeout: 5_000 });
    await expect(async () => {
      const { data } = await c.from("tasks").select("id, status").in("id", [premiere.id, seconde.id]);
      const statut = Object.fromEntries((data ?? []).map((t) => [t.id, t.status]));
      expect(statut[premiere.id]).toBe("fait");
      expect(statut[seconde.id]).toBe("a_faire");
    }).toPass({ timeout: 10_000 });
    // Elle ne revient pas au rechargement serveur.
    await page.waitForTimeout(800);
    await expect(page.locator("li", { hasText: "ZZ double tap — première" })).toHaveCount(0);
  });

  test("« Annuler » juste après la case : la relance est rouverte, à sa place", async ({ page }) => {
    const { c, uid } = await sessionDe("commercial");
    const { data: p } = await c
      .from("prospects")
      .insert({ company_name: `${MARQUE_E2E} — Annuler`, contact_name: "Contact Fictif", phone: "+32 000 99 33 02", status: "a_rappeler" })
      .select("id")
      .single();
    const { data: t } = await c
      .from("tasks")
      .insert({ prospect_id: p!.id, title: "ZZ annuler — relance", due_at: new Date(Date.now() - 30 * 3_600_000).toISOString(), status: "a_faire", priority: 2, assignee_id: uid, created_by: uid })
      .select("id")
      .single();
    await charger(page, "/dashboard");
    const ligne = page.locator("li", { hasText: "ZZ annuler — relance" }).first();
    await ligne.getByRole("button", { name: "Marquer comme faite" }).tap();
    await ligne.getByRole("button", { name: "Annuler" }).tap();
    await expect(ligne.getByRole("button", { name: "Annuler" })).toHaveCount(0);
    await page.waitForTimeout(2_500);
    await expect(page.locator("li", { hasText: "ZZ annuler — relance" }).first()).toBeVisible();
    await expect(async () => {
      const { data } = await c.from("tasks").select("status").eq("id", t!.id).single();
      expect(data!.status).toBe("a_faire");
    }).toPass({ timeout: 10_000 });
  });
});

test("les filtres gardés au retour : lien, bouton retour, onglet — et « Tout effacer »", async ({ page, context }, info) => {
  const { ipad, role, appareil } = contexte(info);
  test.skip(!ipad || role !== "commercial", "iPad, commercial");
  const filtree = "/prospects?region=Namur&secteur=Garage+%2F+carrosserie";
  await charger(page, filtree);
  const liste = page.locator("main ul.card");
  await expect(liste.getByText(ALPHA)).toBeVisible();
  await expect(liste.getByText(BETA)).toHaveCount(0); // Liège
  await expect(liste.getByText(GAMMA)).toHaveCount(0); // un autre métier
  await expect(page.getByRole("link", { name: "Retirer le filtre Garage / carrosserie" })).toBeVisible();
  await page.waitForTimeout(300); // le cookie est écrit au montage
  expect((await context.cookies()).find((c) => c.name === "celya_filtres")?.sameSite).toBe("Lax");

  // 1. Le lien « Tous les prospects » de la fiche.
  await liste.getByRole("link", { name: ALPHA }).click();
  await page.waitForURL(/\/prospects\/[0-9a-f-]{36}/);
  const retour = page.getByRole("link", { name: "Tous les prospects" });
  await expect(retour).toHaveAttribute("href", /secteur=Garage\+%2F\+carrosserie/);
  await expect(retour).toHaveAttribute("href", /region=Namur/);
  await retour.click();
  await page.waitForURL(/secteur=/);
  await expect(page.locator("main ul.card").getByText(ALPHA)).toBeVisible();
  await expect(page.locator("main ul.card").getByText(BETA)).toHaveCount(0);

  // 2. Le bouton retour du navigateur.
  await page.locator("main ul.card").getByRole("link", { name: ALPHA }).click();
  await page.waitForURL(/\/prospects\/[0-9a-f-]{36}/);
  await page.goBack();
  await page.waitForURL(/secteur=/);
  await expect(page.locator("main ul.card").getByText(ALPHA)).toBeVisible();
  await expect(page.locator("main ul.card").getByText(BETA)).toHaveCount(0);

  // 3. L'onglet Prospects, depuis un autre écran — et `/prospects` nu.
  await charger(page, "/dashboard");
  const nav = appareil === "ipad-paysage" ? page.locator("aside") : page.getByRole("navigation", { name: "Navigation principale" });
  await expect(nav.getByRole("link", { name: "Prospects" })).toHaveAttribute("href", /secteur=Garage\+%2F\+carrosserie/);
  await charger(page, "/prospects");
  await expect(page).toHaveURL(/region=Namur/);
  await expect(page.locator("main ul.card").getByText(BETA)).toHaveCount(0);

  // 4. « Tout effacer » vide le cookie lui-même ; `/prospects` nu repart propre.
  await page.getByRole("button", { name: "Tout effacer" }).tap();
  await expect.poll(async () => (await context.cookies()).some((c) => c.name === "celya_filtres")).toBe(false);
  await charger(page, "/prospects");
  await expect(page).not.toHaveURL(/secteur=/);
  await expect(page.locator("main ul.card").getByText(BETA)).toBeVisible();
});

test("pipeline au doigt : la carte est un lien, un appui long ne déplace rien", async ({ page }, info) => {
  const { ipad, role } = contexte(info);
  test.skip(!ipad || role !== "commercial", "iPad, commercial");
  await charger(page, "/prospects?vue=colonnes");
  const carte = page.locator("article", { hasText: ALPHA }).first();
  await expect(carte).toBeVisible();
  await expect(carte).toHaveAttribute("draggable", "false");
  await expect(carte).not.toHaveClass(/cursor-grab/);
  // L'étape se change par le menu de la carte — au doigt, à toute largeur.
  const menu = carte.getByRole("combobox", { name: `Étape de ${ALPHA}` });
  await expect(menu).toBeVisible();
  expect((await menu.boundingBox())!.height).toBeGreaterThanOrEqual(44);

  // Un appui long (800 ms) : aucun déplacement ne démarre.
  await page.evaluate(() => {
    (window as unknown as { glisses: number }).glisses = 0;
    document.addEventListener("dragstart", () => ((window as unknown as { glisses: number }).glisses += 1), true);
  });
  const lien = carte.getByRole("link").first();
  const b = (await lien.boundingBox())!;
  const cdp = await page.context().newCDPSession(page);
  const point = [{ x: b.x + b.width / 2, y: b.y + 12 }];
  await cdp.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: point });
  await page.waitForTimeout(800);
  await cdp.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
  expect(await page.evaluate(() => (window as unknown as { glisses: number }).glisses)).toBe(0);

  // Un tap ouvre la fiche.
  await charger(page, "/prospects?vue=colonnes");
  await page.locator("article", { hasText: ALPHA }).first().getByRole("link").first().tap();
  await page.waitForURL(/\/prospects\/[0-9a-f-]{36}/);
});

test("ordinateur, à la souris : cibles compactes, survol et glisser-déposer intacts", async ({ page }, info) => {
  const { tactile, role } = contexte(info);
  test.skip(tactile || role !== "commercial", "ordinateur, commercial");
  expect(await page.evaluate(() => matchMedia("(hover: hover) and (pointer: fine)").matches)).toBe(true);
  await charger(page, "/dashboard");
  const ligne = page.locator("li", { hasText: "Relancer Anne Sonde" }).first();
  const caseFaite = ligne.getByRole("button", { name: "Marquer comme faite" });
  const b = (await caseFaite.boundingBox())!;
  expect(Math.round(b.width)).toBe(20);
  expect(Math.round(b.height)).toBe(20);
  // Les commandes compactes à droite du titre ; la rangée tactile, absente.
  await expect(ligne.getByRole("button", { name: "Supprimer la relance" }).first()).toBeVisible();
  await expect(ligne.getByRole("link", { name: "Appeler" })).toBeHidden();
  // Le survol existe (et n'existe qu'à la souris).
  const survol = await page.evaluate(() =>
    Array.from(document.styleSheets).some((s) => {
      try {
        return Array.from(s.cssRules).some((r) => r.cssText.includes("(hover: hover) and (pointer: fine)") && r.cssText.includes(":hover"));
      } catch {
        return false;
      }
    })
  );
  expect(survol).toBe(true);
  // Le pipeline se glisse toujours.
  await charger(page, "/prospects?vue=colonnes");
  await expect(page.locator("article", { hasText: ALPHA }).first()).toHaveAttribute("draggable", "true");
  await expect(page.locator("article", { hasText: ALPHA }).first()).toHaveClass(/cursor-grab/);
});
