// npm run test:filtres — l'URL de /prospects et les puces des filtres actifs.
import assert from "node:assert/strict";
import { filtresActifs, hrefProspects } from "./filtresProspects.ts";
import { echeance, etoileesDabord, ordonnerProspects } from "./ordreProspects.ts";

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

cas("les valeurs par défaut ne s'écrivent pas (tous, priorite, liste)", () => {
  assert.equal(hrefProspects({ statut: "tous", tri: "priorite", vue: "liste" }), "/prospects");
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

console.log(`\n${ok} OK`);
