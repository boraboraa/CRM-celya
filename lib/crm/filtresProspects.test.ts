// npm run test:filtres — l'URL de /prospects et les puces des filtres actifs.
import assert from "node:assert/strict";
import { filtresActifs, hrefProspects } from "./filtresProspects.ts";

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

cas("les valeurs par défaut ne s'écrivent pas (tous, recent, liste)", () => {
  assert.equal(hrefProspects({ statut: "tous", tri: "recent", vue: "liste" }), "/prospects");
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

console.log(`\n${ok} OK`);
