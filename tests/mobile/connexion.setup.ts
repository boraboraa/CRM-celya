import { test as setup, expect } from "@playwright/test";
import { identifiants } from "./outils";

/** Une connexion par rôle, gardée pour tous les projets (tests/mobile/.auth). */
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
