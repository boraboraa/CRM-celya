import { test, expect } from "@playwright/test";
import { ciblesTactiles, contexte, MARQUE_E2E, nettoyer, sessionDe } from "./outils";

/** Lot C — l'agenda au téléphone. */

test("vue par défaut : Jour sur téléphone, Semaine sur ordinateur", async ({ page }, info) => {
  const { mobile, role } = contexte(info);
  await page.goto(role === "admin" ? "/agenda?perimetre=moi" : "/agenda");
  const jour = page.getByRole("link", { name: "Jour", exact: true });
  const semaine = page.getByRole("link", { name: "Semaine", exact: true });
  const actif = "bg-white/[0.09]";
  if (mobile) {
    await expect(jour).toHaveClass(new RegExp(actif.replace(/[[\]./]/g, "\\$&")));
    await expect(page.getByRole("button", { name: "RDV" })).toBeVisible();
    // La grille est repliée ; un tap la montre.
    await page.getByRole("button", { name: "Grille horaire" }).click();
    await expect(page.getByRole("button", { name: "Grille horaire" })).toHaveAttribute("aria-expanded", "true");
  } else {
    await expect(semaine).toHaveClass(new RegExp(actif.replace(/[[\]./]/g, "\\$&")));
    await expect(page.getByRole("button", { name: "RDV" })).toBeHidden();
  }
  // ?vue= explicite l'emporte toujours.
  await page.goto("/agenda?vue=semaine");
  await expect(semaine).toHaveClass(new RegExp(actif.replace(/[[\]./]/g, "\\$&")));
});

test("téléphone : la liste du jour, au pouce", async ({ page }, info) => {
  const { mobile, role } = contexte(info);
  test.skip(!mobile || role !== "commercial", "le RDV de test du jour est au commercial");
  await page.goto("/agenda");
  const liste = page.getByRole("list", { name: "Rendez-vous du jour" });
  await expect(liste.getByText("ZZ Test mobile — Garage Zêta")).toBeVisible();
  await expect(liste.getByRole("link", { name: /Appeler/ })).toHaveAttribute("href", "tel:+32000100006");
  await ciblesTactiles(liste);
  await ciblesTactiles(page.locator("main").getByRole("link", { name: /Jour précédent|Jour suivant/ }).first().locator(".."));
});

test.describe("écrit", () => {
  test.beforeEach(async ({}, info) => {
    const { appareil, role } = contexte(info);
    test.skip(appareil !== "iphone" || role !== "commercial", "écrit : un seul projet");
  });
  test.afterAll(async () => {
    await nettoyer("commercial");
  });

  test("poser un RDV depuis l'agenda en vue Jour, puis le reporter et l'annuler", async ({ page }) => {
    const nom = `${MARQUE_E2E} — Agenda`;
    const { c } = await sessionDe("commercial");
    const { data: fiche } = await c
      .from("prospects")
      .insert({ company_name: nom, contact_name: "Contact Fictif", phone: "+32 000 99 22 01", status: "a_appeler" })
      .select("id")
      .single();

    await page.goto("/agenda");
    await page.getByRole("button", { name: "RDV" }).click();
    const feuille = page.getByRole("dialog", { name: "Nouveau rendez-vous" });
    await expect(feuille).toBeVisible();
    await feuille.getByRole("button", { name: /Avec un prospect/ }).click();
    await feuille.getByPlaceholder(/Chercher une fiche/).fill("Agenda");
    await feuille.getByRole("button", { name: new RegExp(nom) }).click();
    await feuille.getByLabel("Heure").fill("20:30");
    await ciblesTactiles(feuille);
    await feuille.getByRole("button", { name: "Poser le rendez-vous" }).click();
    await expect(page.getByRole("dialog", { name: "Nouveau rendez-vous" })).toHaveCount(0);

    const { data: rdv } = await c.from("meetings").select("id, starts_at, status").eq("prospect_id", fiche!.id).single();
    const heure = new Intl.DateTimeFormat("fr-BE", { timeZone: "Europe/Brussels", hour: "2-digit", minute: "2-digit" }).format(new Date(rdv!.starts_at));
    expect(heure).toBe("20:30");

    // La feuille du RDV : reporter, puis annuler (deux temps).
    await page.reload();
    await page.getByRole("list", { name: "Rendez-vous du jour" }).getByRole("button", { name: new RegExp(nom) }).click();
    const sienne = page.getByRole("dialog", { name: nom });
    await expect(sienne).toBeVisible();
    await ciblesTactiles(sienne);
    const demain = new Date(Date.now() + 86400000);
    const ymd = new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Brussels" }).format(demain);
    await sienne.getByLabel("Reporter au").fill(`${ymd}T10:00`);
    await sienne.getByRole("button", { name: "Reporter" }).click();
    await expect
      .poll(async () => (await c.from("meetings").select("status").eq("id", rdv!.id).single()).data?.status)
      .toBe("reporte");

    await page.goto(`/agenda?vue=jour&jour=${ymd}`);
    await page.getByRole("list", { name: "Rendez-vous du jour" }).getByRole("button", { name: new RegExp(nom) }).click();
    await page.getByRole("button", { name: "Annuler le rendez-vous" }).click();
    await page.getByRole("button", { name: "Confirmer l'annulation" }).click();
    await expect
      .poll(async () => (await c.from("meetings").select("status").eq("id", rdv!.id).single()).data?.status)
      .toBe("annule");
  });

  test("un RDV sans heure ne se pose pas", async ({ page }) => {
    await page.goto("/agenda");
    await page.getByRole("button", { name: "RDV" }).click();
    const feuille = page.getByRole("dialog", { name: "Nouveau rendez-vous" });
    await feuille.getByRole("button", { name: /Personnel/ }).click();
    await feuille.getByPlaceholder(/Titre du rendez-vous/).fill("ZZ Test mobile e2e — perso");
    await feuille.getByLabel("Heure").fill("");
    await expect(feuille.getByRole("button", { name: "Poser le rendez-vous" })).toBeDisabled();
  });
});
