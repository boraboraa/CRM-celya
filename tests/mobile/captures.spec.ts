import { test } from "@playwright/test";
import { contexte, sessionDe } from "./outils";

/**
 * Captures à 390 px pour la relecture de Bora — seulement si CAPTURES_DIR est
 * posé (`CAPTURES_DIR=… npx playwright test captures --project=iphone-commercial`).
 * Premier écran ET page entière : le premier écran est ce qu'on voit en
 * sortant le téléphone de la poche.
 */
test.skip(!process.env.CAPTURES_DIR, "CAPTURES_DIR non posé");

test("captures des écrans", async ({ page }, info) => {
  test.setTimeout(180_000);
  const { appareil, role } = contexte(info);
  test.skip(appareil !== "iphone", "390 px seulement");
  const dir = `${process.env.CAPTURES_DIR}/${role}`;

  const { c } = await sessionDe(role);
  const { data: fiche } = await c
    .from("prospects")
    .select("id")
    .ilike("company_name", role === "admin" ? "ZZ Test mobile — Admin Thêta" : "ZZ Test mobile — Garage Alpha")
    .single();

  // L'admin est capturé sur SON périmètre : aucune fiche réelle à l'image.
  const p = role === "admin" ? "perimetre=moi" : "";
  const ecrans: [string, string][] = [
    ["a-faire", `/dashboard?${p}`],
    ["prospects", `/prospects?${p}`],
    ["colonnes", `/prospects?vue=colonnes&${p}`],
    ["fiche", `/prospects/${fiche!.id}`],
    ["agenda", `/agenda?${p}`],
    ["nouveau", "/prospects/nouveau"],
  ];
  for (const [nom, url] of ecrans) {
    await page.goto(url);
    await page.waitForLoadState("networkidle");
    await page.locator("main h1").first().waitFor();
    await page.waitForTimeout(300);
    await page.screenshot({ path: `${dir}/${nom}-ecran.png` });
    await page.screenshot({ path: `${dir}/${nom}-page.png`, fullPage: true });
  }
});
