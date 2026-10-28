import { test, expect } from "@playwright/test";
import {
  ciblesTactiles,
  contexte,
  dansLePremierEcran,
  ficheAvecRdvPasse,
  nettoyer,
  sessionDe,
} from "./outils";

/** Lot B — lire vite : À faire, Prospects, Fiche. */

test.describe("À faire", () => {
  test("la première relance : dans le premier écran, ou à un défilement", async ({ page }, info) => {
    const { role } = contexte(info);
    await page.goto(role === "admin" ? "/dashboard?perimetre=moi" : "/dashboard");
    const premiere = page.getByRole("button", { name: "Marquer comme faite" }).first();
    await expect(premiere).toBeVisible();
    await dansLePremierEcran(page, premiere, 2);
  });

  test("débriefs en lignes compactes — téléphone ET ordinateur", async ({ page }, info) => {
    const { mobile, role } = contexte(info);
    test.skip(role !== "commercial", "commercial (4 RDV de test)");
    await page.goto("/dashboard");
    await page.waitForLoadState("networkidle");
    if (mobile) {
      await expect(page.getByText("Trois états, jamais mélangés")).toBeHidden();
      await expect(page.locator("main").getByRole("link", { name: "+ Nouveau prospect" })).toBeHidden();
    }
    // Trois lignes, puis « Voir les N » — sur les deux écrans (28/10).
    const lignes = page.locator("#a-debriefer").getByRole("button", { name: /Débriefer$/ });
    await expect(lignes).toHaveCount(3);
    const voir = page.getByRole("button", { name: /^Voir les \d+$/ });
    await expect(voir).toBeVisible();
    await voir.click();
    expect(await lignes.count()).toBeGreaterThan(3);
    await ciblesTactiles(page.locator("#a-debriefer"));
    // Aucune issue affichée tant qu'on n'a rien ouvert.
    await expect(page.locator("#a-debriefer").getByRole("group", { name: "Ce qu'a donné le rendez-vous" })).toHaveCount(0);
    if (!mobile) {
      // Ordinateur : le clic DÉPLIE l'issue sous la ligne, sans feuille.
      await lignes.first().click();
      await expect(page.locator("#a-debriefer").getByRole("group", { name: "Ce qu'a donné le rendez-vous" })).toBeVisible();
      await expect(page.getByRole("dialog")).toHaveCount(0);
      await page.locator("#a-debriefer").getByRole("button", { name: /Replier$/ }).click();
      await expect(page.locator("#a-debriefer").getByRole("group", { name: "Ce qu'a donné le rendez-vous" })).toHaveCount(0);
    }
  });

  test("téléphone : une ligne d'actions sous le titre de la relance", async ({ page }, info) => {
    const { mobile, role } = contexte(info);
    test.skip(!mobile || role !== "commercial", "commercial sur téléphone");
    await page.goto("/dashboard");
    const ligne = page.locator("li", { hasText: "Relancer Anne Sonde" }).first();
    await expect(ligne.getByRole("link", { name: "Appeler" })).toHaveAttribute("href", /^tel:\+32000100005$/);
    const date = ligne.getByRole("button", { name: /^Reprogrammer —/ });
    await expect(date).toBeVisible();
    // Le titre a la largeur de la ligne : rien à côté de lui.
    const titre = (await ligne.getByText("Relancer Anne Sonde").boundingBox())!;
    expect(titre.width).toBeGreaterThan(page.viewportSize()!.width * 0.6);
    // Le choix du jour et de l'heure ne s'ouvre qu'au tap sur la date.
    await expect(ligne.getByRole("group", { name: "Reprogrammer" })).toBeHidden();
    await date.click();
    await expect(ligne.getByRole("group", { name: "Reprogrammer" })).toBeVisible();
    await expect(ligne.getByRole("button", { name: "Jour suivant" })).toBeVisible();
  });

  test("débriefer un RDV depuis la feuille du bas", async ({ page }, info) => {
    const { mobile, role, appareil } = contexte(info);
    test.skip(!mobile || role !== "commercial" || appareil !== "iphone", "écrit : un seul projet");
    const { rdv } = await ficheAvecRdvPasse("commercial", "Débrief feuille");
    try {
      await page.goto("/dashboard");
      await page.waitForLoadState("networkidle");
      const ligne = page.locator("#a-debriefer").getByRole("button", { name: /Débrief feuille/ });
      const voir = page.getByRole("button", { name: /^Voir les \d+$/ });
      // « Voir les N » n'agit qu'une fois la page hydratée : on réessaie le
      // geste jusqu'à ce que la ligne apparaisse.
      await expect(async () => {
        if (!(await ligne.isVisible()) && (await voir.isVisible())) await voir.click();
        await expect(ligne).toBeVisible({ timeout: 1000 });
      }).toPass({ timeout: 15_000 });
      await ligne.click();
      const feuille = page.getByRole("dialog");
      await expect(feuille).toBeVisible();
      await ciblesTactiles(feuille.getByRole("group", { name: "Ce qu'a donné le rendez-vous" }));
      // Grille 2 × 2 sous sm : deux issues par rangée.
      const issues = feuille.getByRole("group", { name: "Ce qu'a donné le rendez-vous" }).getByRole("button");
      const [a, b, c] = await Promise.all([0, 1, 2].map((i) => issues.nth(i).boundingBox()));
      expect(Math.round(a!.y)).toBe(Math.round(b!.y));
      expect(c!.y).toBeGreaterThan(a!.y);
      await feuille.getByRole("button", { name: "Proposition envoyée" }).click();
      await expect(page.getByRole("dialog")).toHaveCount(0);
      await expect(page.locator("#a-debriefer").getByRole("button", { name: /Débrief feuille/ })).toHaveCount(0);
      // En base : le RDV est clos, avec son issue.
      const { c: client } = await sessionDe("commercial");
      await expect
        .poll(async () => (await client.from("meetings").select("status, debrief_issue").eq("id", rdv).single()).data)
        .toEqual({ status: "honore", debrief_issue: "proposition" });
    } finally {
      await nettoyer("commercial");
    }
  });
});

test.describe("Prospects", () => {
  test("la première fiche est dans le premier écran", async ({ page }, info) => {
    const { mobile, role } = contexte(info);
    await page.goto(role === "admin" ? "/prospects?perimetre=moi" : "/prospects");
    // UNE ligne par fiche, dans un seul cadre, depuis le 27/10 au soir.
    const premiere = page.locator("main ul.card > li").first();
    await expect(premiere).toBeVisible();
    await dansLePremierEcran(page, premiere);
    if (mobile) {
      // Des cartes, pas un tableau : il est absent du téléphone.
      await expect(page.locator("main table")).toBeHidden();
      await expect(premiere.getByText(/ZZ Test mobile/)).toBeVisible();
    }
  });

  test("« Liste | Pipeline » : visible pour tous, et le dernier choix est retenu", async ({ page }) => {
    await page.goto("/prospects?perimetre=moi");
    const bascule = page.getByRole("group", { name: "Affichage" }).filter({ visible: true }).first();
    await expect(bascule.getByRole("link", { name: "Pipeline" })).toHaveAttribute("href", /vue=colonnes/);
    // Choisir le pipeline (on charge l'URL du lien — voir la note plus bas),
    // puis revenir sur /prospects sans paramètre : c'est le pipeline qui revient.
    await page.goto("/prospects?vue=colonnes&perimetre=moi");
    await expect(page.locator("main section h2").first()).toBeVisible();
    await page.waitForTimeout(300); // le cookie est écrit au montage
    await page.goto("/prospects?perimetre=moi");
    await expect(page.locator("main section h2").first()).toBeVisible();
    await expect(page.locator("main ul.card")).toHaveCount(0);
    // Et « Liste » l'emporte, explicitement.
    await page.goto("/prospects?vue=liste&perimetre=moi");
    await expect(page.locator("main ul.card > li").first()).toBeVisible();
  });

  test("téléphone : la feuille « Filtres » et les puces retirables", async ({ page }, info) => {
    const { mobile } = contexte(info);
    test.skip(!mobile, "téléphone");
    await page.goto("/prospects?perimetre=moi");
    await page.getByRole("button", { name: /^Filtres/ }).click();
    const feuille = page.getByRole("dialog", { name: "Filtres" });
    await expect(feuille).toBeVisible();
    await ciblesTactiles(feuille);
    // Les liens sont construits par la page (hrefProspects) : on vérifie
    // l'URL qu'ils portent, puis l'écran qu'elle donne. (Sur le banc local,
    // une navigation qui ne change que les paramètres de la même page ne
    // s'applique pas toujours — y compris sur `main` ; en production, si.
    // Voir CLAUDE.md, « Le téléphone d'abord ».)
    const lien = feuille.getByRole("link", { name: "À appeler" });
    await expect(lien).toHaveAttribute("href", "/prospects?statut=a_appeler&perimetre=moi");
    await page.goto((await lien.getAttribute("href"))!);
    const puce = page.getByRole("link", { name: "Retirer le filtre À appeler" });
    await expect(puce).toBeVisible();
    await expect(puce).toHaveAttribute("href", "/prospects?perimetre=moi");
    await ciblesTactiles(page.getByRole("list", { name: "Filtres actifs" }));
    await page.goto("/prospects?perimetre=moi");
    await expect(page.getByRole("link", { name: "Retirer le filtre À appeler" })).toHaveCount(0);
  });

  test("téléphone : les colonnes, une étape à la fois", async ({ page }, info) => {
    const { mobile } = contexte(info);
    test.skip(!mobile, "téléphone");
    await page.goto("/prospects?vue=colonnes&perimetre=moi");
    const etapes = page.getByRole("group", { name: "Étape affichée" });
    await expect(etapes).toBeVisible();
    await expect(page.locator("main section h2:visible")).toHaveCount(1);
    await etapes.getByRole("button", { name: /Gagné/ }).click();
    await expect(page.locator("main section h2:visible")).toHaveText(/Gagné/);
    await ciblesTactiles(etapes);
  });
});

test.describe("Fiche", () => {
  test("« Appeler » et PROCHAINE ACTION sans défiler", async ({ page }, info) => {
    const { mobile, role } = contexte(info);
    const { c } = await sessionDe(role);
    const { data } = await c
      .from("prospects")
      .select("id")
      .ilike("company_name", role === "admin" ? "ZZ Test mobile — Admin Thêta" : "ZZ Test mobile — Garage Alpha")
      .single();
    await page.goto(`/prospects/${data!.id}`);
    const carte = page.getByLabel("Prochaine action");
    await expect(carte).toBeVisible();
    await dansLePremierEcran(page, carte);
    if (mobile) {
      const appeler = page.getByRole("link", { name: "Appeler", exact: true });
      await expect(appeler).toBeVisible();
      await dansLePremierEcran(page, appeler);
      await ciblesTactiles(appeler.locator(".."));
      // Adresse et confiance : repliées, à un tap.
      const repli = page.getByRole("button", { name: "Adresse et confiance" });
      await expect(repli).toHaveAttribute("aria-expanded", "false");
    }
  });

  test("téléphone : la chronologie montre cinq entrées, puis « Voir plus »", async ({ page }, info) => {
    const { mobile, role } = contexte(info);
    test.skip(!mobile || role !== "commercial", "Garage Alpha a 7 notes");
    const { c } = await sessionDe("commercial");
    const { data } = await c.from("prospects").select("id").ilike("company_name", "ZZ Test mobile — Garage Alpha").single();
    await page.goto(`/prospects/${data!.id}`);
    await expect(page.getByText(/^Note de test n° \d$/).filter({ visible: true })).toHaveCount(5);
    await page.getByRole("button", { name: /^Voir plus \(\d+\)$/ }).click();
    await expect(page.getByText(/^Note de test n° \d$/).filter({ visible: true })).toHaveCount(7);
  });
});
