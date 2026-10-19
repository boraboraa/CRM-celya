import { test, expect, type Page } from "@playwright/test";
import { ciblesTactiles, contexte, MARQUE_E2E, nettoyer, sessionDe } from "./outils";

/**
 * Lot D — saisir vite : l'ajout rapide du « ＋ ». Ces tests ÉCRIVENT : un seul
 * projet (iPhone, commercial), des fiches « ZZ Test mobile e2e — … » aux
 * numéros fictifs, retirées à la fin.
 */
test.beforeEach(async ({}, info) => {
  const { appareil, role } = contexte(info);
  test.skip(appareil !== "iphone" || role !== "commercial", "écrit : un seul projet");
});
test.afterAll(async () => {
  await nettoyer("commercial");
});

async function ouvrirAjout(page: Page) {
  await page.goto("/dashboard");
  await page.getByRole("navigation", { name: "Navigation principale" }).getByRole("button", { name: "Nouveau prospect" }).click();
  const feuille = page.getByRole("dialog", { name: "Nouveau prospect" });
  await expect(feuille).toBeVisible();
  return feuille;
}

async function ficheEnBase(nom: string) {
  const { c } = await sessionDe("commercial");
  const { data } = await c.from("prospects").select("*").eq("company_name", nom).single();
  return { c, fiche: data! };
}

test("créer un prospect en trois champs, et arriver sur sa fiche", async ({ page }) => {
  const feuille = await ouvrirAjout(page);
  await ciblesTactiles(feuille);
  // Le clavier qu'il faut à chaque champ.
  await expect(feuille.getByLabel("Téléphone")).toHaveAttribute("type", "tel");
  await expect(feuille.getByLabel("Société")).toHaveAttribute("autocapitalize", "words");
  await expect(feuille.getByLabel("Société")).toBeFocused();

  const nom = `${MARQUE_E2E} — Trois champs`;
  await feuille.getByLabel("Société").fill(nom);
  await feuille.getByLabel("Contact").fill("Contact Fictif");
  await feuille.getByLabel("Téléphone").fill("+32 000 99 11 01");
  await page.getByRole("button", { name: "Créer la fiche" }).click();

  await expect(page).toHaveURL(/\/prospects\/[0-9a-f-]{36}$/);
  await expect(page.locator("main h1")).toHaveText(nom);
  const { fiche } = await ficheEnBase(nom);
  expect(fiche.status).toBe("a_appeler");
  expect(fiche.phone).toBe("+32 000 99 11 01");
  expect(fiche.contact_name).toBe("Contact Fictif");
  expect([fiche.email, fiche.address, fiche.city, fiche.website, fiche.value_estimate]).toEqual([null, null, null, null, null]);
});

test("« rdv mardi 11h » pose un vrai rendez-vous", async ({ page }) => {
  const feuille = await ouvrirAjout(page);
  const nom = `${MARQUE_E2E} — Rdv mardi`;
  await feuille.getByLabel("Société").fill(nom);
  await feuille.getByLabel("Ce qui s'est passé").fill("rdv mardi 11h");
  await expect(feuille.getByText(/^Rendez-vous mar\. \d\d\/\d\d à 11h$/)).toBeVisible();
  await page.getByRole("button", { name: "Créer la fiche" }).click();
  await expect(page).toHaveURL(/\/prospects\/[0-9a-f-]{36}$/);

  const { c, fiche } = await ficheEnBase(nom);
  const { data: rdv } = await c.from("meetings").select("starts_at, kind, status").eq("prospect_id", fiche.id);
  expect(rdv).toHaveLength(1);
  const debut = new Date(rdv![0].starts_at);
  const local = new Intl.DateTimeFormat("fr-BE", { timeZone: "Europe/Brussels", weekday: "long", hour: "2-digit", minute: "2-digit" }).format(debut);
  expect(local).toBe("mardi 11:00");
  // L'étape a suivi le fait (jamais demandée).
  expect(fiche.status).toBe("rendez_vous");
});

test("un rendez-vous sans heure n'est pas posé, et l'écran le dit", async ({ page }) => {
  const feuille = await ouvrirAjout(page);
  await feuille.getByLabel("Société").fill(`${MARQUE_E2E} — Sans heure`);
  await feuille.getByLabel("Ce qui s'est passé").fill("rdv jeudi");
  await expect(feuille.getByText(/Aucun rendez-vous ne sera posé sans son heure/)).toBeVisible();
  await expect(page.getByRole("button", { name: "Créer la fiche" })).toBeDisabled();
  await feuille.getByRole("button", { name: "Créer sans le rendez-vous" }).click();
  await expect(page.getByRole("button", { name: "Créer la fiche" })).toBeEnabled();
});

test("doublon : « Existe déjà — ouvrir la fiche », par le nom et par le numéro", async ({ page }) => {
  const feuille = await ouvrirAjout(page);
  await feuille.getByLabel("Société").fill("ZZ Test mobile — Garage Beta");
  await expect(feuille.getByText(/Existe déjà —/)).toBeVisible();
  await expect(page.getByRole("button", { name: "Créer quand même" })).toBeVisible();

  await feuille.getByLabel("Société").fill("Une autre société");
  await feuille.getByLabel("Téléphone").fill("+32 000 10 00 02");
  await expect(feuille.getByText("(même numéro)")).toBeVisible();
  await feuille.getByRole("link", { name: "Ouvrir la fiche" }).first().click();
  await expect(page.locator("main h1")).toHaveText("ZZ Test mobile — Garage Beta");
});

test("géolocalisation refusée : la fiche se crée quand même, sans erreur", async ({ page }) => {
  // Le refus de l'utilisateur, tel que le navigateur le rend (code 1) — le
  // Chromium du banc laisse sinon l'invite en attente, sans réponse.
  await page.addInitScript(() => {
    navigator.geolocation.getCurrentPosition = (_ok, ko) =>
      ko?.({ code: 1, message: "User denied Geolocation", PERMISSION_DENIED: 1, POSITION_UNAVAILABLE: 2, TIMEOUT: 3 } as GeolocationPositionError);
  });
  const feuille = await ouvrirAjout(page);
  const nom = `${MARQUE_E2E} — Sans position`;
  await feuille.getByLabel("Société").fill(nom);
  await feuille.getByRole("button", { name: "Ma position" }).click();
  await expect(feuille.getByRole("button", { name: "Ma position" })).toBeVisible();
  await expect(feuille.getByRole("alert")).toHaveCount(0);
  await page.getByRole("button", { name: "Créer la fiche" }).click();
  await expect(page).toHaveURL(/\/prospects\/[0-9a-f-]{36}$/);
  expect((await ficheEnBase(nom)).fiche.address).toBeNull();
});

test("« Ma position » : un point GPS, dit comme tel sur la fiche", async ({ page, context }) => {
  await context.grantPermissions(["geolocation"]);
  await context.setGeolocation({ latitude: 50.4669, longitude: 4.8675 });
  const feuille = await ouvrirAjout(page);
  const nom = `${MARQUE_E2E} — Position`;
  await feuille.getByLabel("Société").fill(nom);
  await feuille.getByRole("button", { name: "Ma position" }).click();
  await expect(feuille.getByText("Position GPS — adresse à compléter")).toBeVisible();
  await page.getByRole("button", { name: "Créer la fiche" }).click();
  await expect(page).toHaveURL(/\/prospects\/[0-9a-f-]{36}$/);
  expect((await ficheEnBase(nom)).fiche.address).toBe("https://www.google.com/maps/search/?api=1&query=50.466900,4.867500");
  // Sur la fiche : jamais « Lien Google Maps reconnu ». Et l'itinéraire part des coordonnées.
  await expect(page.getByRole("link", { name: "Itinéraire" })).toHaveAttribute("href", /destination=50\.4669,4\.8675/);
  await page.getByRole("button", { name: "Adresse et confiance" }).click();
  await expect(page.getByText("Position GPS — adresse à compléter").filter({ visible: true }).first()).toBeVisible();
  await expect(page.getByRole("button", { name: "Compléter l'adresse" })).toBeVisible();
  await expect(page.getByText("Lien Google Maps reconnu")).toHaveCount(0);
});

test("« Repéré, pas encore contacté » : la fiche reste « À appeler »", async ({ page }) => {
  const feuille = await ouvrirAjout(page);
  const nom = `${MARQUE_E2E} — Repéré`;
  await feuille.getByLabel("Société").fill(nom);
  await feuille.getByLabel("Ce qui s'est passé").fill("Atelier ouvert le samedi");
  await feuille.getByRole("button", { name: "Repéré, pas encore contacté" }).click();
  await page.getByRole("button", { name: "Créer la fiche" }).click();
  await expect(page).toHaveURL(/\/prospects\/[0-9a-f-]{36}$/);
  const { c, fiche } = await ficheEnBase(nom);
  expect(fiche.status).toBe("a_appeler");
  const { data: notes } = await c.from("activities").select("body, is_exchange").eq("prospect_id", fiche.id);
  expect(notes).toEqual([{ body: "Atelier ouvert le samedi", is_exchange: false }]);
});

test("« Ce qui s'est passé » grandit avec le texte dicté", async ({ page }) => {
  const feuille = await ouvrirAjout(page);
  const champ = feuille.getByLabel("Ce qui s'est passé");
  const avant = (await champ.boundingBox())!.height;
  await champ.fill(
    "Passé au garage ce matin, le gérant était là. Il cherche une solution pour les appels manqués le samedi. Rappeler jeudi pour une démo."
  );
  expect((await champ.boundingBox())!.height).toBeGreaterThan(avant + 20);
  // Le geste principal reste au-dessus, dans le pied de la feuille.
  await expect(page.getByRole("button", { name: "Créer la fiche" })).toBeInViewport();
});
