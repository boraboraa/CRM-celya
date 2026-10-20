import { test, expect, type Page } from "@playwright/test";
import { ciblesTactiles, contexte, identifiants, pasDeDefilementHorizontal } from "./outils";

/**
 * L'écran Appels IA (admin) — Numéro & test → Campagnes → Suivi, et la
 * connexion posée une fois dans les réglages avancés.
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
  expect(libelles[0]).toMatch(/^1\.\s*Numéro & test/);
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

test("à l'ouverture : « Campagnes » dès que le numéro appelant est réglé", async ({ page }) => {
  await page.goto("/appels-ia?onglet=numero-test");
  const regle = await page.getByRole("radio", { checked: true }).count();
  await page.goto("/appels-ia");
  const onglets = page.getByRole("navigation", { name: "Étapes des appels IA" });
  const attendu = regle > 0 ? /Campagnes/ : /Numéro & test/;
  await expect(onglets.getByRole("link", { name: attendu })).toHaveAttribute("aria-current", "page");
});

test("numéro & test : rien que le numéro, le GSM et l'appel de test — le test grisé dit TOUT", async ({ page }) => {
  await page.goto("/appels-ia?onglet=numero-test");
  const bouton = page.getByRole("button", { name: "Appeler mon GSM (test)" });
  await expect(bouton).toBeVisible();
  await expect(page.getByRole("radiogroup", { name: "Numéro appelant" }).or(page.getByLabel("Autre numéro appelant"))).toBeVisible();
  await expect(page.getByText("GSM de test", { exact: true })).toBeVisible();
  // Les secrets NE sont PAS sur cet onglet (ils vivent, repliés, dans Réglages avancés → Connexion).
  for (const s of ["Clé OpenAI", "Identifiant SIP", "Mot de passe SIP"]) {
    await expect(page.getByLabel(s, { exact: true })).toBeHidden();
  }

  const ligne = page.getByRole("link", { name: /Connexion technique à finaliser \(une seule fois\)/ });
  const connexionManque = (await ligne.count()) > 0;
  if (connexionManque) {
    await expect(bouton).toBeDisabled();
    const phrase = (await page.locator("#appel-test-bloque").textContent()) ?? "";
    expect(phrase).toContain("Réglages avancés → Connexion");
    expect(phrase).toMatch(/Il manque .*(la clé OpenAI|l'identifiant SIP|le mot de passe SIP)/);
  }
  await pasDeDefilementHorizontal(page);
});

test("connexion : UNE ligne discrète tant qu'elle manque, qui ouvre le panneau — rien n'est enregistré", async ({ page }) => {
  await page.goto("/appels-ia?onglet=campagnes");
  const ligne = page.getByRole("link", { name: /Connexion technique à finaliser \(une seule fois\)/ });
  if ((await ligne.count()) === 0) {
    test.info().annotations.push({ type: "info", description: "connexion déjà posée : plus rien n'en parle" });
    await expect(page.getByText(/Connexion technique/)).toHaveCount(0);
    return;
  }
  await expect(ligne).toHaveCount(1);
  await ligne.click();
  await page.waitForURL(/connexion=1/);
  const panneau = page.locator("#connexion");
  await expect(panneau).toBeVisible();

  // Les secrets manquants se REMPLISSENT (valeurs factices), mais rien n'est
  // envoyé : le Vault est commun, un secret factice écraserait le vrai.
  const suivi = compterPosts(page);
  const champs = panneau.locator("input[type=password]");
  const n = await champs.count();
  expect(n, "au moins un secret à poser").toBeGreaterThan(0);
  for (let i = 0; i < n; i++) await champs.nth(i).fill("factice-test-jamais-envoye");
  await page.waitForTimeout(500);
  expect(suivi.posts, "aucune server action ne doit partir").toEqual([]);
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
  const lancer = zone.getByRole("button", { name: "Lancer la campagne" });
  // Bloqué tant que la connexion ou un test réussi manquent — et il dit pourquoi.
  const refus = zone.locator("#lancer-bloque");
  if ((await refus.count()) > 0) {
    await expect(lancer).toBeDisabled();
    await expect(refus).toContainText(/connexion technique|appel de test réussi|numéro appelant/);
  } else {
    await expect(lancer).toBeEnabled();
  }
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
