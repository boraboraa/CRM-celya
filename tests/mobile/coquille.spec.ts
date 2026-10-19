import { test, expect } from "@playwright/test";
import { ciblesTactiles, contexte, pasDeDefilementHorizontal, PAGES } from "./outils";

/** Lot A — la coquille : largeur, barre du bas, en-tête, recherche. */

test("aucune page plus large que l'écran", async ({ page }, info) => {
  const { role } = contexte(info);
  for (const url of PAGES[role]) {
    await page.goto(url);
    await page.waitForLoadState("networkidle");
    await page.locator("main h1").first().waitFor();
    await test.step(url, () => pasDeDefilementHorizontal(page));
  }
});

test("la barre d'onglets : en bas, sous le pouce, ≥ 44 px", async ({ page }, info) => {
  const { role, mobile } = contexte(info);
  await page.goto("/dashboard");
  const barre = page.getByRole("navigation", { name: "Navigation principale" });
  if (!mobile) {
    await expect(barre).toBeHidden();
    await expect(page.locator("aside").getByRole("link", { name: "À faire" })).toBeVisible();
    return;
  }
  await expect(barre).toBeVisible();
  const box = (await barre.boundingBox())!;
  expect(box.y + box.height).toBeGreaterThanOrEqual(page.viewportSize()!.height - 1);

  const attendus = role === "admin"
    ? ["À faire", "Prospects", "Nouveau prospect", "Agenda", "Plus"]
    : ["À faire", "Prospects", "Nouveau prospect", "Agenda"];
  const libelles = await barre.locator("a, button").evaluateAll((els) =>
    els.map((e) => (e.getAttribute("aria-label") ?? e.textContent ?? "").trim())
  );
  expect(libelles).toEqual(attendus);
  await ciblesTactiles(barre);
  // Les écrans d'admin ne sont jamais des onglets de terrain.
  await expect(barre.getByRole("link", { name: "Équipe" })).toHaveCount(0);

  // L'onglet courant est marqué.
  await expect(barre.getByRole("link", { name: "À faire" })).toHaveAttribute("aria-current", "page");
});

test("« Plus » (admin) : Équipe, Appels IA, Compte, Se déconnecter", async ({ page }, info) => {
  const { role, mobile } = contexte(info);
  test.skip(!mobile || role !== "admin", "admin sur téléphone");
  await page.goto("/dashboard");
  await page.getByRole("button", { name: "Plus" }).click();
  const feuille = page.getByRole("dialog", { name: "Plus" });
  await expect(feuille).toBeVisible();
  for (const nom of ["Équipe", "Appels IA", "Compte"]) {
    await expect(feuille.getByRole("link", { name: nom })).toBeVisible();
  }
  await expect(feuille.getByRole("button", { name: "Se déconnecter" })).toBeVisible();
  await ciblesTactiles(feuille);
  await feuille.getByRole("link", { name: "Équipe" }).click();
  await page.waitForURL(/\/equipe/);
  await expect(page.getByRole("dialog", { name: "Plus" })).toHaveCount(0);
});

test("en-tête compact : loupe et compte, pas de « Se déconnecter »", async ({ page }, info) => {
  const { mobile } = contexte(info);
  test.skip(!mobile, "téléphone");
  await page.goto("/dashboard");
  const entete = page.locator("header").first();
  await expect(entete.getByRole("button", { name: /Rechercher/ })).toBeVisible();
  await expect(entete.getByRole("link", { name: "Mon compte" })).toBeVisible();
  await expect(entete.getByText("Se déconnecter")).toHaveCount(0);
  await ciblesTactiles(entete);

  // « Se déconnecter » est sur Compte.
  await entete.getByRole("link", { name: "Mon compte" }).click();
  await page.waitForURL(/\/compte/);
  await expect(page.getByRole("button", { name: "Se déconnecter" })).toBeVisible();
});

test("la recherche prend tout l'écran sur téléphone", async ({ page }, info) => {
  const { mobile } = contexte(info);
  test.skip(!mobile, "téléphone");
  await page.goto("/dashboard");
  await page.locator("header").getByRole("button", { name: /Rechercher/ }).click();
  const fenetre = page.getByRole("dialog", { name: "Rechercher une fiche" });
  const boite = fenetre.locator(".card");
  await expect(boite).toBeVisible();
  const b = (await boite.boundingBox())!;
  const v = page.viewportSize()!;
  expect(Math.round(b.width)).toBe(v.width);
  expect(b.height).toBeGreaterThanOrEqual(v.height - 1);
  await fenetre.getByRole("searchbox").fill("ZZ Test mobile");
  await expect(fenetre.getByRole("option").first()).toBeVisible();
  await fenetre.getByRole("button", { name: "Annuler" }).click();
  await expect(fenetre).toHaveCount(0);
});
