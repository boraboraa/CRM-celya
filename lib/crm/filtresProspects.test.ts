// npm run test:filtres — l'URL de /prospects et les puces des filtres actifs.
import assert from "node:assert/strict";
import { depuisValeurEtape, filtresActifs, hrefProspects, lireVue, nettoyerParams, secteurConnu, statutConnu, valeurEtape, VUES } from "./filtresProspects.ts";
import { SECTEURS } from "./secteurs.ts";
import { comptesParSecteur, libelleSecteur } from "./comptesSecteurs.ts";
import { echeance, etoileesDabord, ordonnerProspects, rangPriorite } from "./ordreProspects.ts";

// Une liste vide VOULUE porte le marqueur (3/11) : `/prospects` nu reprendrait
// les filtres retenus (cookie `celya_filtres`).
const VIDE = "/prospects?filtres=aucun";

let ok = 0;
function cas(nom: string, f: () => void) {
  f();
  ok++;
  console.log(`  ✓ ${nom}`);
}

const ETAPES = { a_appeler: "À appeler", a_rappeler: "À rappeler", perdu: "Perdu" };

cas("sans rien : /prospects nu", () => {
  assert.equal(hrefProspects({}), VIDE);
  assert.deepEqual(filtresActifs({}, ETAPES), []);
});

cas("les valeurs par défaut ne s'écrivent pas (tous, priorite)", () => {
  assert.equal(hrefProspects({ statut: "tous", tri: "priorite" }), VIDE);
});

cas("l'affichage : « Liste » s'écrit aussi (il doit l'emporter sur un Pipeline retenu)", () => {
  assert.equal(hrefProspects({ vue: "liste" }), "/prospects?vue=liste");
  assert.equal(hrefProspects({ vue: "colonnes" }), "/prospects?vue=colonnes");
  assert.equal(hrefProspects({ vue: "constructor" }), VIDE);
  assert.deepEqual(Object.values(VUES), ["Liste", "Pipeline"]);
});

cas("l'affichage retenu : l'URL d'abord, puis le dernier choix, puis la liste", () => {
  assert.equal(lireVue("colonnes", "liste"), "colonnes");
  assert.equal(lireVue("liste", "colonnes"), "liste");
  assert.equal(lireVue(undefined, "colonnes"), "colonnes");
  assert.equal(lireVue(undefined, undefined), "liste");
});

cas("un affichage inconnu (URL ou cookie trafiqués) est ignoré", () => {
  assert.equal(lireVue("kanban", "colonnes"), "colonnes");
  assert.equal(lireVue(undefined, "<script>"), "liste");
  assert.equal(lireVue("__proto__", null), "liste");
});

cas("le menu « Étape » porte les étapes ET les deux raccourcis", () => {
  assert.equal(valeurEtape({}), "tous");
  assert.equal(valeurEtape({ statut: "a_rappeler" }), "a_rappeler");
  assert.equal(valeurEtape({ filtre: "a_debriefer", statut: "a_rappeler" }), "f:a_debriefer");
  assert.deepEqual(depuisValeurEtape("f:emails"), { statut: null, filtre: "emails" });
  assert.deepEqual(depuisValeurEtape("f:constructor"), { statut: null, filtre: null });
  assert.deepEqual(depuisValeurEtape("suivi_email"), { statut: "suivi_email", filtre: null });
  assert.deepEqual(depuisValeurEtape("tous"), { statut: null, filtre: null });
});

cas("« Toutes, perdues comprises » : s'écrit dans l'URL, se lit dans le menu, devient une puce retirable", () => {
  assert.equal(hrefProspects({ statut: "avec_perdues" }), "/prospects?statut=avec_perdues");
  assert.equal(valeurEtape({ statut: "avec_perdues" }), "avec_perdues");
  assert.deepEqual(depuisValeurEtape("avec_perdues"), { statut: "avec_perdues", filtre: null });
  const puces = filtresActifs({ statut: "avec_perdues" }, ETAPES);
  assert.deepEqual(puces.map((f) => f.label), ["Toutes, perdues comprises"]);
  assert.equal(puces[0].retirer, VIDE);
});

cas("« Activité récente » n'est plus le défaut : elle s'écrit, et devient une puce", () => {
  assert.equal(hrefProspects({ tri: "recent" }), "/prospects?tri=recent");
  assert.deepEqual(filtresActifs({ tri: "recent" }, ETAPES).map((f) => f.label), ["Tri : Activité récente"]);
});

cas("un tri inconnu (URL trafiquée) n'est pas recopié", () => {
  assert.equal(hrefProspects({ tri: "constructor" }), VIDE);
});

cas("tout est conservé, dans un ordre fixe", () => {
  assert.equal(
    hrefProspects({ perimetre: "equipe", filtre: "emails", vue: "colonnes", tri: "nom", statut: "a_rappeler", q: "garage" }),
    "/prospects?q=garage&statut=a_rappeler&tri=nom&vue=colonnes&filtre=emails&perimetre=equipe"
  );
});

cas("over remplace ou retire un seul paramètre", () => {
  const p = { q: "garage", statut: "a_rappeler", perimetre: "moi" };
  assert.equal(hrefProspects(p, { statut: null }), "/prospects?q=garage&perimetre=moi");
  assert.equal(hrefProspects(p, { vue: "colonnes" }), "/prospects?q=garage&statut=a_rappeler&vue=colonnes&perimetre=moi");
});

cas("un filtre inconnu (URL trafiquée) est ignoré, pas recopié", () => {
  assert.equal(hrefProspects({ filtre: "toString" }), VIDE);
  assert.equal(hrefProspects({ filtre: "<script>" }), VIDE);
  assert.deepEqual(filtresActifs({ filtre: "constructor" }, ETAPES), []);
});

cas("les puces : recherche, étape, raccourci, tri — chacune se retire seule", () => {
  const p = { q: " 081 22 ", statut: "perdu", filtre: "a_debriefer", tri: "relance", perimetre: "equipe" };
  const f = filtresActifs(p, ETAPES);
  assert.deepEqual(f.map((x) => x.label), ["« 081 22 »", "Perdu", "À débriefer", "Tri : Prochaine action"]);
  assert.equal(f[0].retirer, "/prospects?statut=perdu&tri=relance&filtre=a_debriefer&perimetre=equipe");
  assert.equal(f[1].retirer, "/prospects?q=081+22&tri=relance&filtre=a_debriefer&perimetre=equipe");
  // Le périmètre n'est jamais une puce à retirer, et il survit à tous les retraits.
  for (const x of f) assert.ok(x.retirer.includes("perimetre=equipe"));
});

cas("le tri ne compte pas en colonnes ; une étape inconnue n'est pas une puce", () => {
  assert.deepEqual(filtresActifs({ tri: "nom", vue: "colonnes" }, ETAPES), []);
  assert.deepEqual(filtresActifs({ statut: "gagne_peut_etre" }, ETAPES), []);
  assert.deepEqual(filtresActifs({ q: "   " }, ETAPES), []);
});

// --- L'ordre des fiches (lib/crm/ordreProspects.ts) -------------------------
cas("rang : en retard, aujourd'hui, à venir, jamais appelée, rien de prévu", () => {
  const DEBUT = Date.parse("2026-11-01T23:00:00Z"); // lundi 2/11, 0h à Bruxelles
  const FIN_ = Date.parse("2026-11-02T22:59:00Z");
  const r = (next_action_at: string | null, last_contact_at: string | null = null) =>
    rangPriorite({ company_name: "x", next_action_at, last_contact_at }, DEBUT, FIN_);
  assert.equal(r("2026-11-01T08:00:00Z"), 0, "hier : en retard");
  assert.equal(r("2026-11-02T08:00:00Z"), 1, "aujourd'hui, même passé de quelques heures");
  assert.equal(r("2026-11-03T08:00:00Z"), 2, "demain : à venir");
  assert.equal(r(null, null), 3, "rien de prévu, jamais contactée : jamais appelée");
  assert.equal(r(null, "2026-10-20T08:00:00Z"), 4, "rien de prévu après un contact");
});

cas("priorité : en retard AVANT aujourd'hui, jamais appelées avant « plus rien »", () => {
  const DEBUT = Date.parse("2026-11-01T23:00:00Z");
  const FIN_ = Date.parse("2026-11-02T22:59:00Z");
  const g = (company_name: string, next_action_at: string | null, last_contact_at: string | null = null) =>
    ({ company_name, next_action_at, last_contact_at, starred_at: null });
  const rows = [
    g("Plus rien", null, "2026-10-20T08:00:00Z"),
    g("Jamais appelée", null),
    g("Demain", "2026-11-03T08:00:00Z"),
    g("Aujourd'hui tôt", "2026-11-02T07:00:00Z"),
    g("Avant-hier", "2026-10-31T08:00:00Z"),
  ];
  assert.deepEqual(ordonnerProspects(rows, FIN_, DEBUT).map((x) => x.company_name),
    ["Avant-hier", "Aujourd'hui tôt", "Demain", "Jamais appelée", "Plus rien"]);
});

const FIN = Date.parse("2026-11-02T22:59:00Z"); // lundi 2/11, 23h59 à Bruxelles
const f = (company_name: string, next_action_at: string | null, starred_at: string | null = null) => ({
  company_name,
  next_action_at,
  starred_at,
});

cas("priorité : étoilées, puis dû (retard + aujourd'hui), puis plus tard, puis rien", () => {
  const rows = [
    f("Rien", null),
    f("Demain", "2026-11-03T08:00:00Z"),
    f("Aujourd'hui", "2026-11-02T15:00:00Z"),
    f("En retard", "2026-10-30T08:00:00Z"),
    f("Étoilée demain", "2026-11-03T08:00:00Z", "2026-10-27T10:00:00Z"),
    f("Étoilée sans rien", null, "2026-10-27T10:00:00Z"),
    f("Étoilée en retard", "2026-10-29T08:00:00Z", "2026-10-28T10:00:00Z"),
  ];
  assert.deepEqual(ordonnerProspects(rows, FIN).map((r) => r.company_name), [
    "Étoilée en retard",
    "Étoilée demain",
    "Étoilée sans rien",
    "En retard",
    "Aujourd'hui",
    "Demain",
    "Rien",
  ]);
});

cas("priorité : à égalité, le nom — le même ordre à chaque affichage", () => {
  const rows = [f("Zèbre", null), f("Abeille", null), f("Écureuil", null)];
  assert.deepEqual(ordonnerProspects(rows, FIN).map((r) => r.company_name), ["Abeille", "Écureuil", "Zèbre"]);
});

cas("priorité : la liste d'origine n'est pas modifiée", () => {
  const rows = [f("B", null), f("A", null)];
  ordonnerProspects(rows, FIN);
  assert.equal(rows[0].company_name, "B");
});

cas("échéance : 23h59 du jour est « dû », minuit le lendemain non", () => {
  assert.equal(echeance("2026-11-02T22:59:00Z", FIN), 0);
  assert.equal(echeance("2026-11-02T23:00:00Z", FIN), 1);
  assert.equal(echeance(null, FIN), 2);
  assert.equal(echeance("pas une date", FIN), 2);
});

cas("« À faire » : les étoilées en tête de la zone, l'ordre de la zone conservé", () => {
  const zone = [
    { id: 1, e: false },
    { id: 2, e: true },
    { id: 3, e: false },
    { id: 4, e: true },
  ];
  assert.deepEqual(etoileesDabord(zone, (r) => r.e).map((r) => r.id), [2, 4, 1, 3]);
});

// --- La région (034) ---------------------------------------------------------
cas("région : une commune, un groupe ou « aucune » s'écrivent dans l'URL", () => {
  assert.equal(hrefProspects({ region: "Ixelles" }), "/prospects?region=Ixelles");
  assert.equal(hrefProspects({ region: "g:bruxelles" }), "/prospects?region=g%3Abruxelles");
  assert.equal(hrefProspects({ region: "aucune" }), "/prospects?region=aucune");
  assert.equal(hrefProspects({ region: "Namur", statut: "a_appeler" }), "/prospects?statut=a_appeler&region=Namur");
});

cas("région inconnue ou trafiquée : jamais recopiée dans une URL ni montrée", () => {
  for (const r of ["Lyon", "g:paris", "g:", "constructor", "<script>", "ixelles"]) {
    assert.equal(hrefProspects({ region: r }), VIDE, r);
    assert.deepEqual(filtresActifs({ region: r }, ETAPES), [], r);
  }
});

cas("région : une puce retirable, qui garde les autres filtres", () => {
  const a = filtresActifs({ region: "g:wallonie", statut: "a_rappeler" }, ETAPES);
  const r = a.find((f) => f.cle === "region")!;
  assert.equal(r.label, "Toute la Wallonie");
  assert.equal(r.retirer, "/prospects?statut=a_rappeler");
  assert.equal(filtresActifs({ region: "aucune" }, ETAPES)[0].label, "Région inconnue");
  assert.equal(filtresActifs({ region: "Uccle" }, ETAPES)[0].label, "Uccle");
});

cas("tri « Commune » : dans l'URL, et en puce (en liste seulement)", () => {
  assert.equal(hrefProspects({ tri: "commune" }), "/prospects?tri=commune");
  assert.equal(filtresActifs({ tri: "commune" }, ETAPES)[0].label, "Tri : Commune");
  assert.deepEqual(filtresActifs({ tri: "commune", vue: "colonnes" }, ETAPES), []);
});

cas("une étape RETIRÉE dans l'URL (?statut=contacte, ?statut=proposition) vaut « toutes » (29/10)", () => {
  assert.equal(statutConnu("contacte"), undefined);
  assert.equal(statutConnu("proposition"), undefined);
  assert.equal(statutConnu("n'importe quoi"), undefined);
  assert.equal(statutConnu("tous"), undefined);
  assert.equal(statutConnu("a_rappeler"), "a_rappeler");
  assert.equal(statutConnu("avec_perdues"), "avec_perdues");
  const p = nettoyerParams({ q: "garage", statut: "contacte", perimetre: "moi" });
  assert.deepEqual(p, { q: "garage", perimetre: "moi" });
  assert.equal(hrefProspects(p), "/prospects?q=garage&perimetre=moi");
  assert.equal(valeurEtape(p), "tous");
  assert.equal(filtresActifs(p, ETAPES).some((f) => f.cle === "statut"), false, "aucune puce d'étape");
  const intact = { statut: "suivi_email" };
  assert.equal(nettoyerParams(intact), intact, "une étape connue : les paramètres ne sont pas recopiés");
});

cas("métier (3/11) : seules les quinze valeurs de SECTEURS passent", () => {
  for (const s of SECTEURS) assert.equal(secteurConnu(s), s, s);
  for (const faux of ["garage", "Garage", "GARAGE / CARROSSERIE", "constructor", "<script>", "", " Autre", "Autre "]) {
    assert.equal(secteurConnu(faux), undefined, JSON.stringify(faux));
  }
  assert.equal(secteurConnu(null), undefined);
  assert.equal(secteurConnu(undefined), undefined);
});

cas("métier : dans l'URL (encodé), combiné aux autres filtres, à sa place", () => {
  assert.equal(
    hrefProspects({ secteur: "Garage / carrosserie" }),
    "/prospects?secteur=Garage+%2F+carrosserie"
  );
  assert.equal(
    hrefProspects({ q: "dupont", statut: "a_rappeler", tri: "nom", vue: "colonnes", perimetre: "moi", region: "Namur", secteur: "Kiné / paramédical" }),
    "/prospects?q=dupont&statut=a_rappeler&tri=nom&vue=colonnes&perimetre=moi&region=Namur&secteur=Kin%C3%A9+%2F+param%C3%A9dical"
  );
  // Changer un autre filtre GARDE le métier ; le retirer garde les autres.
  assert.equal(hrefProspects({ secteur: "Auto-école" }, { statut: "a_appeler" }), "/prospects?statut=a_appeler&secteur=Auto-%C3%A9cole");
  assert.equal(hrefProspects({ secteur: "Auto-école", statut: "a_appeler" }, { secteur: null }), "/prospects?statut=a_appeler");
});

cas("métier inconnu dans l'URL : ni filtre, ni puce, ni recopie", () => {
  assert.equal(hrefProspects({ secteur: "Boulangerie" }), VIDE);
  assert.equal(hrefProspects({ secteur: "garage", statut: "a_appeler" }), "/prospects?statut=a_appeler");
  assert.deepEqual(filtresActifs({ secteur: "Boulangerie" }, ETAPES), []);
  const p = nettoyerParams({ secteur: "Boulangerie", statut: "contacte", q: "x" });
  assert.deepEqual(p, { q: "x" });
  assert.deepEqual(nettoyerParams({ secteur: "Autre", region: "Namur" }), { secteur: "Autre", region: "Namur" });
});

cas("métier : la puce « Garage / carrosserie ✕ » et son retrait", () => {
  const a = filtresActifs({ secteur: "Garage / carrosserie", region: "Namur", statut: "a_appeler" }, ETAPES);
  const m = a.find((f) => f.cle === "secteur")!;
  assert.equal(m.label, "Garage / carrosserie");
  assert.equal(m.retirer, "/prospects?statut=a_appeler&region=Namur");
  // L'ordre de lecture : étape, région, métier.
  assert.deepEqual(a.map((f) => f.cle), ["statut", "region", "secteur"]);
  // La dernière puce retirée : la liste vide VOULUE porte le marqueur.
  assert.equal(filtresActifs({ secteur: "Autre" }, ETAPES)[0].retirer, VIDE);
});

// ─── Le nombre de fiches par métier (le menu « Métier ») ──────────────────
// Un FAUX client qui enregistre chaque requête : on vérifie qu'aucune fiche
// n'est rapatriée (head: true, count exact), que les quinze comptages partent
// ensemble, et que CHACUN passe par le périmètre de la liste.
type Appel = { colonnes: string; options: unknown; filtres: [string, string, string][] };
function fauxClient(comptes: Record<string, number>, erreurSur?: string) {
  const appels: Appel[] = [];
  let enVol = 0;
  let maxEnVol = 0;
  const client = {
    from(table: "prospects") {
      assert.equal(table, "prospects");
      return {
        select(colonnes: string, options: { count: "exact"; head: true }) {
          const appel: Appel = { colonnes, options, filtres: [] };
          appels.push(appel);
          const requete = {
            eq(col: string, val: string) {
              appel.filtres.push(["eq", col, val]);
              if (col !== "sector") return requete;
              enVol++;
              maxEnVol = Math.max(maxEnVol, enVol);
              return new Promise<{ count: number | null; error: unknown }>((ok) =>
                setTimeout(() => {
                  enVol--;
                  ok(val === erreurSur ? { count: null, error: { message: "refus" } } : { count: comptes[val] ?? 0, error: null });
                }, 1)
              );
            },
            not(col: string, op: string, val: string) {
              appel.filtres.push(["not", col, `${op} ${val}`]);
              return requete;
            },
          };
          return requete;
        },
      };
    },
  };
  return { client, appels, maxEnVol: () => maxEnVol };
}

await (async () => {
  const { client, appels, maxEnVol } = fauxClient({ "Garage / carrosserie": 1234, "Autre": 3 });
  // Le périmètre d'un commercial : ses fiches seules (filtrerProspects pose owner_id).
  const borner = <Q extends { eq(c: string, v: string): unknown }>(q: Q) => q.eq("owner_id", "uid-colin") as Q;
  const comptes = await comptesParSecteur(client as never, borner as never);
  assert.equal(appels.length, SECTEURS.length, "quinze comptages, un par métier");
  for (const a of appels) {
    assert.equal(a.colonnes, "id");
    assert.deepEqual(a.options, { count: "exact", head: true }, "jamais une fiche rapatriée");
    assert.deepEqual(a.filtres[0], ["eq", "owner_id", "uid-colin"], "le périmètre du commercial, sur CHAQUE comptage");
  }
  assert.deepEqual(appels.map((a) => a.filtres.at(-1)![2]), [...SECTEURS]);
  assert.equal(maxEnVol(), SECTEURS.length, "les quinze partent en parallèle");
  assert.equal(comptes!["Garage / carrosserie"], 1234, "au-delà de 1 000 : le compte de la base, pas une liste tronquée");
  assert.equal(comptes!["Auto-école"], 0);
  assert.equal(libelleSecteur("Garage / carrosserie", comptes), "Garage / carrosserie (1234)");
  ok++;
  console.log("  ✓ métier : quinze comptages head:true en parallèle, bornés au périmètre");
})();

await (async () => {
  const { client } = fauxClient({}, "Vétérinaire");
  const comptes = await comptesParSecteur(client as never, ((q: unknown) => q) as never);
  assert.equal(comptes, null, "un comptage refusé : pas de chiffres plutôt que des faux");
  assert.equal(libelleSecteur("Vétérinaire", comptes), "Vétérinaire");
  ok++;
  console.log("  ✓ métier : un comptage en échec → menu sans chiffres");
})();

await (async () => {
  // Les perdues masquées en liste : le même `borner` que la liste.
  const { client, appels } = fauxClient({});
  const borner = <Q extends { not(c: string, o: string, v: string): unknown }>(q: Q) => q.not("status", "in", "(perdu)") as Q;
  await comptesParSecteur(client as never, borner as never, ["Autre"]);
  assert.deepEqual(appels[0].filtres, [["not", "status", "in (perdu)"], ["eq", "sector", "Autre"]]);
  ok++;
  console.log("  ✓ métier : les comptes suivent le même bornage que la liste");
})();

console.log(`\n${ok} OK`);
