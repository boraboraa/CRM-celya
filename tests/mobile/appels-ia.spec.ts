import { test, expect, type Page } from "@playwright/test";
import { ciblesTactiles, contexte, identifiants, pasDeDefilementHorizontal } from "./outils";

/**
 * L'écran Appels IA (admin) — Mise en route → Campagnes → Suivi.
 *
 * AUCUN APPEL N'EST COMPOSÉ, RIEN N'EST ENREGISTRÉ. Les secrets du Vault sont
 * COMMUNS à tout le projet : un test qui « poserait » une clé factice
 * écraserait la vraie. Les champs se remplissent, aucun formulaire ne
 * s'envoie — et le test le PROUVE : il compte les requêtes POST (une server
 * action est un POST) et exige zéro, hors la lecture des fiches de
 * l'assistant. « Le bouton s'active quand tout est posé » est prouvé par le
 * test pur (`npm run test:appels-ecran`, les 32 combinaisons). L'assistant de
 * campagne va jusqu'au récapitulatif et ne lance rien.
 *
 * Il se connecte lui-même (compte admin de test, E2E_ADMIN_*) : il tourne avec
 * `--no-deps`, sans recréer les fiches de test des autres specs.
 *
 *   npx playwright test appels-ia --project=iphone-admin --project=ordinateur-admin --no-deps
 */

test.use({ storageState: { cookies: [], origins: [] } });

async function connecter(page: Page) {
  const { email, password } = identifiants("admin");
  await page.goto("/login");
  await page.locator("#email").fill(email);
  await page.locator("#password").fill(password);
  await page.getByRole("button", { name: "Se connecter" }).click();
  await page.waitForURL(/\/dashboard/);
}

/** Les POST émis après l'appel — une server action en est un. */
function compterPosts(page: Page): { posts: string[] } {
  const etat = { posts: [] as string[] };
  page.on("request", (r) => {
    if (r.method() === "POST") etat.posts.push(`${r.url()} ${r.headers()["next-action"] ?? ""}`);
  });
  return etat;
}

test.beforeEach(async ({ page }, info) => {
  test.skip(contexte(info).role !== "admin", "écran réservé à l'administrateur");
  await connecter(page);
});

test("trois onglets dans l'ordre, chacun avec son état, ≥ 44 px", async ({ page }) => {
  await page.goto("/appels-ia");
  const onglets = page.getByRole("navigation", { name: "Étapes des appels IA" });
  await expect(onglets).toBeVisible();
  const libelles = await onglets.getByRole("link").evaluateAll((els) => els.map((e) => (e.textContent ?? "").trim()));
  expect(libelles).toHaveLength(3);
  expect(libelles[0]).toMatch(/^1\.\s*Mise en route/);
  expect(libelles[1]).toMatch(/^2\.\s*Campagnes/);
  expect(libelles[2]).toMatch(/^3\.\s*Suivi/);
  await ciblesTactiles(onglets);
  await pasDeDefilementHorizontal(page);
  for (const o of ["campagnes", "suivi"]) {
    await page.goto(`/appels-ia?onglet=${o}`);
    await expect(onglets.getByRole("link", { name: new RegExp(o === "suivi" ? "Suivi" : "Campagnes") })).toHaveAttribute(
      "aria-current",
      "page"
    );
    await pasDeDefilementHorizontal(page);
  }
});

test("mise en route : le test grisé dit TOUT ce qui manque, rien n'est enregistré", async ({ page }) => {
  await page.goto("/appels-ia?onglet=mise-en-route");
  const bouton = page.getByRole("button", { name: "Appeler mon GSM (test)" });
  await expect(bouton).toBeVisible();

  // Les lignes encore ouvertes sont celles qui manquent : la phrase sous le
  // bouton doit les nommer TOUTES.
  const manquantes = await page.locator("li:has(form) label").evaluateAll((els) => els.map((e) => (e.textContent ?? "").trim()));
  const NOM: Record<string, string> = {
    "Numéro appelant": "le numéro appelant",
    "GSM de test": "le GSM de test",
    "Clé OpenAI": "la clé OpenAI",
    "Identifiant SIP": "l'identifiant SIP",
    "Mot de passe SIP": "le mot de passe SIP",
  };
  if (manquantes.length === 0) {
    test.info().annotations.push({ type: "info", description: "mise en route déjà complète : rien à griser" });
    return;
  }
  await expect(bouton).toBeDisabled();
  const phrase = (await page.locator("#appel-test-bloque").textContent()) ?? "";
  for (const m of manquantes) expect(phrase, `« ${m} » doit être nommé`).toContain(NOM[m]);

  // Les champs se REMPLISSENT (valeurs factices), mais rien n'est envoyé.
  const suivi = compterPosts(page);
  for (const m of manquantes) {
    const champ = page.getByLabel(m, { exact: true });
    await champ.fill(m.includes("Numéro") || m.includes("GSM") ? "0470 00 00 00" : "factice-test-jamais-envoye");
  }
  await page.waitForTimeout(500);
  expect(suivi.posts, "aucune server action ne doit partir").toEqual([]);
  await expect(bouton).toBeDisabled();
  await pasDeDefilementHorizontal(page);
});

test("campagnes : l'assistant jusqu'au récapitulatif, sans lancer", async ({ page }, info) => {
  const { mobile } = contexte(info);
  await page.goto("/appels-ia?onglet=campagnes");
  await expect(page.getByRole("status", { name: "Où en est Janet" })).toBeVisible();
  await page.getByRole("button", { name: "Nouvelle campagne" }).click();
  const zone = mobile ? page.getByRole("dialog") : page.getByRole("region", { name: "Assistant de campagne" });
  await expect(zone).toBeVisible();

  await zone.getByLabel("Nom de la campagne").fill("ZZ Test mobile e2e — jamais lancée");
  await zone.getByRole("button", { name: "Suivant →" }).click();
  await zone.getByLabel("Propriétaire").selectOption("tous");
  await expect(zone.getByText(/Tout sélectionner \([1-9]\d*\)/)).toBeVisible();
  await expect(zone.getByText("Vérification des fiches…")).toHaveCount(0);

  const indisponible = zone.getByText(/migration 029 non appliquée/);
  test.skip((await indisponible.count()) > 0, "migration 029 non appliquée : l'assistant liste les fiches mais ne peut rien compter");

  await zone.getByText(/Tout sélectionner/).click();
  await expect(zone.getByText(/fiches? (peu|peuvent) être appelées?|Aucune fiche ne peut être appelée/)).toBeVisible();
  await pasDeDefilementHorizontal(page);

  const suivant = zone.getByRole("button", { name: "Suivant →" });
  test.skip(await suivant.isDisabled(), "aucune fiche appelable dans la base de test");
  await suivant.click();
  await expect(zone.getByText("Durée estimée")).toBeVisible();
  await expect(zone.getByRole("button", { name: "Lancer la campagne" })).toBeEnabled();
  // On s'arrête là : « Lancer la campagne » n'est JAMAIS cliqué.
  await pasDeDefilementHorizontal(page);
});

test("suivi : l'appel en ce moment, la file, les derniers appels, l'opposition", async ({ page }) => {
  await page.goto("/appels-ia?onglet=suivi");
  await expect(page.getByRole("region", { name: "En ce moment" })).toBeVisible();
  for (const t of ["File d'appels", "Derniers appels", "Liste d'opposition"]) {
    await expect(page.getByText(t, { exact: true })).toBeVisible();
  }
  await pasDeDefilementHorizontal(page);
});
