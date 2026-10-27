import { test, expect } from "@playwright/test";
import { ciblesTactiles, contexte, MARQUE_E2E, nettoyer, pasDeDefilementHorizontal, sessionDe } from "./outils";

/**
 * « Ma liste » (27/10) — coller sa liste, Janet range. La lecture se vérifie
 * sur tous les projets (elle n'écrit rien) ; l'import ÉCRIT : un seul projet
 * (iPhone, commercial), deux fiches « ZZ Test mobile e2e — … » aux numéros
 * fictifs, retirées à la fin.
 *
 * Le collage est au format « nom + numéro » : lu SANS modèle, le test ne
 * dépend donc pas de l'assistant (absent du banc local).
 */
const COLLAGE = `${MARQUE_E2E} — Ma liste A +32 000 00 00 91
la secrétaire décroche jamais
${MARQUE_E2E} — Ma liste B : +32 000 00 00 92`;

test.afterAll(async ({}, info) => {
  const { appareil, role } = contexte(info);
  if (appareil === "iphone" && role === "commercial") await nettoyer("commercial");
});

test("lire une liste collée : le récapitulatif, sans rien écrire", async ({ page }) => {
  await page.goto("/prospects/ma-liste");
  await pasDeDefilementHorizontal(page);
  await page.getByLabel("Votre liste, ou une correction").fill(COLLAGE);
  await page.getByRole("button", { name: "Lire ma liste" }).click();
  await expect(page.getByRole("heading", { name: /2 fiches à créer/ })).toBeVisible();
  // La remarque est allée dans « Ce qu'on sait », pas dans un champ.
  await expect(page.getByLabel("Ce qu'on sait, ligne 1")).toHaveValue("la secrétaire décroche jamais");
  await expect(page.getByLabel("Téléphone, ligne 2")).toHaveValue("+32 00 00 00 92");
  await pasDeDefilementHorizontal(page);
  await ciblesTactiles(page.locator("main form"));
  // Une correction lue par le code.
  await page.getByLabel("Votre liste, ou une correction").fill("enlève la 2");
  await page.getByRole("button", { name: "Corriger" }).click();
  await expect(page.getByRole("heading", { name: /^1 fiche à créer/ })).toBeVisible();
});

test("importer : la fiche existe, en « À appeler », avec « Ce qu'on sait »", async ({ page }, info) => {
  const { appareil, role } = contexte(info);
  test.skip(appareil !== "iphone" || role !== "commercial", "écrit : un seul projet");
  await page.goto("/prospects/ma-liste");
  await page.getByLabel("Votre liste, ou une correction").fill(COLLAGE);
  await page.getByRole("button", { name: "Lire ma liste" }).click();
  await page.getByRole("button", { name: /Importer 2 fiches/ }).click();
  await expect(page.getByRole("status").filter({ hasText: /2 fiches créées/ })).toBeVisible();
  const { c } = await sessionDe("commercial");
  const { data } = await c
    .from("prospects")
    .select("company_name, status, notes, source")
    .ilike("company_name", `${MARQUE_E2E} — Ma liste%`)
    .order("company_name");
  expect(data?.map((p) => [p.company_name, p.status, p.notes, p.source])).toEqual([
    [`${MARQUE_E2E} — Ma liste A`, "a_appeler", "la secrétaire décroche jamais", "Ma liste"],
    [`${MARQUE_E2E} — Ma liste B`, "a_appeler", null, "Ma liste"],
  ]);
});

test("le classement : des chiffres, sans défilement de page", async ({ page }) => {
  await page.goto("/classement");
  await expect(page.getByRole("heading", { name: "Classement" })).toBeVisible();
  await pasDeDefilementHorizontal(page);
  await ciblesTactiles(page.getByRole("navigation", { name: "Période" }));
});
