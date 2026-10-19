import { test as setup, expect } from "@playwright/test";
import { identifiants } from "./outils";
import { peupler } from "./donnees";

/**
 * Avant tout : les fiches de test, recréées (dates relatives au jour), puis
 * une connexion par rôle, gardée pour tous les projets (tests/mobile/.auth).
 */
setup("données de test", async () => {
  setup.setTimeout(120_000);
  await peupler("commercial");
  await peupler("admin");
});

for (const role of ["commercial", "admin"] as const) {
  setup(`connexion ${role}`, async ({ page }) => {
    const { email, password } = identifiants(role);
    await page.goto("/login");
    await page.locator("#email").fill(email);
    await page.locator("#password").fill(password);
    await page.getByRole("button", { name: "Se connecter" }).click();
    await page.waitForURL(/\/dashboard/);
    await expect(page.locator("main")).toBeVisible();
    await page.context().storageState({ path: `tests/mobile/.auth/${role}.json` });
  });
}
