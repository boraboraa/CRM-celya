// npm run test:filtres — l'URL de /prospects et les puces des filtres actifs.
import assert from "node:assert/strict";
import { depuisValeurEtape, filtresActifs, hrefProspects, lireVue, valeurEtape, VUES } from "./filtresProspects.ts";
import { echeance, etoileesDabord, ordonnerProspects, rangPriorite } from "./ordreProspects.ts";

let ok = 0;
function cas(nom: string, f: () => void) {
  f();
  ok++;
  console.log(`  ✓ ${nom}`);
}

const ETAPES = { a_appeler: "À appeler", contacte: "Contacté", perdu: "Perdu" };

cas("sans rien : /prospects nu", () => {
  assert.equal(hrefProspects({}), "/prospects");
  assert.deepEqual(filtresActifs({}, ETAPES), []);
});

cas("les valeurs par défaut ne s'écrivent pas (tous, priorite)", () => {
  assert.equal(hrefProspects({ statut: "tous", tri: "priorite" }), "/prospects");
});

cas("l'affichage : « Liste » s'écrit aussi (il doit l'emporter sur un Pipeline retenu)", () => {
  assert.equal(hrefProspects({ vue: "liste" }), "/prospects?vue=liste");
  assert.equal(hrefProspects({ vue: "colonnes" }), "/prospects?vue=colonnes");
  assert.equal(hrefProspects({ vue: "constructor" }), "/prospects");
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
  assert.equal(valeurEtape({ statut: "contacte" }), "contacte");
  assert.equal(valeurEtape({ filtre: "a_debriefer", statut: "contacte" }), "f:a_debriefer");
  assert.deepEqual(depuisValeurEtape("f:emails"), { statut: null, filtre: "emails" });
  assert.deepEqual(depuisValeurEtape("f:constructor"), { statut: null, filtre: null });
  assert.deepEqual(depuisValeurEtape("suivi_email"), { statut: "suivi_email", filtre: null });
  assert.deepEqual(depuisValeurEtape("tous"), { statut: null, filtre: null });
});

cas("« Activité récente » n'est plus le défaut : elle s'écrit, et devient une puce", () => {
  assert.equal(hrefProspects({ tri: "recent" }), "/prospects?tri=recent");
  assert.deepEqual(filtresActifs({ tri: "recent" }, ETAPES).map((f) => f.label), ["Tri : Activité récente"]);
});

cas("un tri inconnu (URL trafiquée) n'est pas recopié", () => {
  assert.equal(hrefProspects({ tri: "constructor" }), "/prospects");
});

cas("tout est conservé, dans un ordre fixe", () => {
  assert.equal(
    hrefProspects({ perimetre: "equipe", filtre: "emails", vue: "colonnes", tri: "nom", statut: "contacte", q: "garage" }),
    "/prospects?q=garage&statut=contacte&tri=nom&vue=colonnes&filtre=emails&perimetre=equipe"
  );
});

cas("over remplace ou retire un seul paramètre", () => {
  const p = { q: "garage", statut: "contacte", perimetre: "moi" };
  assert.equal(hrefProspects(p, { statut: null }), "/prospects?q=garage&perimetre=moi");
  assert.equal(hrefProspects(p, { vue: "colonnes" }), "/prospects?q=garage&statut=contacte&vue=colonnes&perimetre=moi");
});

cas("un filtre inconnu (URL trafiquée) est ignoré, pas recopié", () => {
  assert.equal(hrefProspects({ filtre: "toString" }), "/prospects");
  assert.equal(hrefProspects({ filtre: "<script>" }), "/prospects");
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
    assert.equal(hrefProspects({ region: r }), "/prospects", r);
    assert.deepEqual(filtresActifs({ region: r }, ETAPES), [], r);
  }
});

cas("région : une puce retirable, qui garde les autres filtres", () => {
  const a = filtresActifs({ region: "g:wallonie", statut: "contacte" }, ETAPES);
  const r = a.find((f) => f.cle === "region")!;
  assert.equal(r.label, "Toute la Wallonie");
  assert.equal(r.retirer, "/prospects?statut=contacte");
  assert.equal(filtresActifs({ region: "aucune" }, ETAPES)[0].label, "Région inconnue");
  assert.equal(filtresActifs({ region: "Uccle" }, ETAPES)[0].label, "Uccle");
});

cas("tri « Commune » : dans l'URL, et en puce (en liste seulement)", () => {
  assert.equal(hrefProspects({ tri: "commune" }), "/prospects?tri=commune");
  assert.equal(filtresActifs({ tri: "commune" }, ETAPES)[0].label, "Tri : Commune");
  assert.deepEqual(filtresActifs({ tri: "commune", vue: "colonnes" }, ETAPES), []);
});

console.log(`\n${ok} OK`);
