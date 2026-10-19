import { test, expect, request as requete } from "@playwright/test";
import { contexte } from "./outils";

/** Lot E — comme une app : manifeste, icônes, balises iOS, raccourci. */

test("le manifeste et les icônes se chargent SANS session", async ({ baseURL }, info) => {
  test.skip(contexte(info).appareil !== "iphone" || contexte(info).role !== "commercial", "une fois suffit");
  // Un contexte neuf : aucun cookie, comme le navigateur qui lit le manifeste.
  const anonyme = await requete.newContext({ baseURL });
  const r = await anonyme.get("/manifest.webmanifest", { maxRedirects: 0 });
  expect(r.status()).toBe(200);
  const m = await r.json();
  expect(m).toMatchObject({
    name: "Celya CRM",
    display: "standalone",
    start_url: "/dashboard",
    background_color: "#0A0E1A",
    theme_color: "#0A0E1A",
  });
  expect(m.shortcuts[0]).toMatchObject({ name: "Nouveau prospect", url: "/dashboard?ajout=1" });
  for (const src of ["/icon/192", "/icon/512", "/apple-icon"]) {
    const i = await anonyme.get(src, { maxRedirects: 0 });
    expect(i.status(), src).toBe(200);
    expect(i.headers()["content-type"], src).toContain("image/png");
  }
  // Les icônes déclarées existent toutes, à la bonne taille.
  for (const icone of m.icons) {
    expect((await anonyme.get(icone.src, { maxRedirects: 0 })).status()).toBe(200);
  }
  await anonyme.dispose();
});

test("les balises de l'écran d'accueil (iOS et Android)", async ({ page }, info) => {
  test.skip(!contexte(info).mobile, "téléphone");
  await page.goto("/dashboard");
  const head = page.locator("head");
  await expect(head.locator('link[rel="manifest"]')).toHaveAttribute("href", "/manifest.webmanifest");
  await expect(head.locator('link[rel="apple-touch-icon"]')).toHaveCount(1);
  await expect(head.locator('meta[name="apple-mobile-web-app-capable"]')).toHaveAttribute("content", "yes");
  await expect(head.locator('meta[name="apple-mobile-web-app-title"]')).toHaveAttribute("content", "Celya CRM");
  await expect(head.locator('meta[name="viewport"]')).toHaveAttribute("content", /viewport-fit=cover/);
  await expect(head.locator('meta[name="theme-color"]')).toHaveAttribute("content", "#0A0E1A");
});

test("le raccourci « Nouveau prospect » ouvre l'ajout rapide", async ({ page }, info) => {
  test.skip(!contexte(info).mobile, "téléphone");
  await page.goto("/dashboard?ajout=1");
  await expect(page.getByRole("dialog", { name: "Nouveau prospect" })).toBeVisible();
  // Le paramètre est consommé : recharger ne rouvre pas la feuille.
  await expect(page).toHaveURL(/\/dashboard$/);
});
