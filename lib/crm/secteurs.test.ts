// npm run test:secteurs — la liste fixe des secteurs et sa normalisation.
// Les cas viennent de secteurs.cas.json, joués AUSSI par la recette SQL de la
// 031 contre `public.normaliser_secteur` : une seule vérité pour deux copies.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { SECTEURS, REGLES_SECTEUR, estSecteurFixe, normaliserSecteur, secteurDuNom } from "./secteurs.ts";

let ok = 0;
function cas(nom: string, f: () => void) {
  f();
  ok++;
  console.log(`  ✓ ${nom}`);
}

const { cas: jeu } = JSON.parse(readFileSync(new URL("./secteurs.cas.json", import.meta.url), "utf8")) as {
  cas: [string | null, string | null, string][];
};

for (const [saisie, attendu, pourquoi] of jeu) {
  cas(`${JSON.stringify(saisie)} → ${JSON.stringify(attendu)} (${pourquoi})`, () => {
    assert.equal(normaliserSecteur(saisie), attendu);
  });
}

cas("la liste a quinze secteurs, « Autre » en dernier, sans doublon", () => {
  assert.equal(SECTEURS.length, 15);
  assert.equal(SECTEURS[SECTEURS.length - 1], "Autre");
  assert.equal(new Set(SECTEURS).size, SECTEURS.length);
});

cas("chaque secteur de la liste se normalise en lui-même (idempotence)", () => {
  for (const s of SECTEURS) assert.equal(normaliserSecteur(s), s);
  for (const s of SECTEURS) assert.equal(normaliserSecteur(normaliserSecteur(s)), s);
});

cas("chaque règle vise un secteur de la liste, et chaque secteur sauf « Autre » a sa règle", () => {
  const vises = new Set(REGLES_SECTEUR.map(([s]) => s));
  for (const s of vises) assert.ok(estSecteurFixe(s));
  for (const s of SECTEURS) if (s !== "Autre") assert.ok(vises.has(s), s);
});

cas("secteurDuNom : le métier que dit le nom, sinon RIEN (jamais « Autre »)", () => {
  assert.equal(secteurDuNom("Garage du Midi Anderlecht"), "Garage / carrosserie");
  assert.equal(secteurDuNom("Carrosserie Van Damme"), "Garage / carrosserie");
  assert.equal(secteurDuNom("Pneus Express Wiels"), "Garage / carrosserie");
  assert.equal(secteurDuNom("Auto-école Midi"), "Auto-école");
  assert.equal(secteurDuNom("Cabinet dentaire Louise"), "Cabinet dentaire");
  assert.equal(secteurDuNom("Delta Motors"), null);
  assert.equal(secteurDuNom("Auto Clinic Anderlecht"), null);
  assert.equal(secteurDuNom(""), null);
  assert.equal(secteurDuNom(null), null);
});

cas("undefined vaut null", () => {
  assert.equal(normaliserSecteur(undefined), null);
});

cas("estSecteurFixe refuse ce qui n'est pas dans la liste", () => {
  assert.equal(estSecteurFixe("garage"), false);
  assert.equal(estSecteurFixe("toString"), false);
  assert.equal(estSecteurFixe(null), false);
});

cas("le jeu de cas couvre les quatorze valeurs relevées en base", () => {
  assert.ok(jeu.filter(([, , p]) => p.startsWith("base")).length >= 13);
});

console.log(`\n${ok} cas OK`);
