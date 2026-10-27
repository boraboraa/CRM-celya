// npm run test:doublons — les clés de doublon, les doublons d'un même lot, et
// la phrase qui les dit. Les cas des clés viennent de doublons.cas.json, joués
// AUSSI par la recette SQL de la 031 contre `cle_telephone` / `cle_societe`.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  AUCUN_DOUBLON,
  cleSociete,
  cleTelephone,
  doublonsDansLeLot,
  estDoublonEquipe,
  phraseDoublon,
} from "./doublons.ts";

let ok = 0;
function cas(nom: string, f: () => void) {
  f();
  ok++;
  console.log(`  ✓ ${nom}`);
}

const jeu = JSON.parse(readFileSync(new URL("./doublons.cas.json", import.meta.url), "utf8")) as {
  telephone: [string | null, string | null, string][];
  societe: [string | null, string | null, string][];
};

for (const [saisie, attendu, pourquoi] of jeu.telephone) {
  cas(`tél ${JSON.stringify(saisie)} → ${JSON.stringify(attendu)} (${pourquoi})`, () =>
    assert.equal(cleTelephone(saisie), attendu)
  );
}
for (const [saisie, attendu, pourquoi] of jeu.societe) {
  cas(`société ${JSON.stringify(saisie)} → ${JSON.stringify(attendu)} (${pourquoi})`, () =>
    assert.equal(cleSociete(saisie), attendu)
  );
}

cas("un fixe en national et en international ont la MÊME clé (le bug de l'ancienne clé)", () => {
  assert.equal(cleTelephone("081 22 33 44"), cleTelephone("+32 81 22 33 44"));
});

cas("Charleroi et un mobile 0471 ne se confondent pas", () => {
  assert.notEqual(cleTelephone("071 22 33 44"), cleTelephone("0471 22 33 44"));
});

cas("dans un lot : la première occurrence reste, les suivantes sont signalées", () => {
  const d = doublonsDansLeLot([
    { societe: "Cabinet dentaire Smile", telephone: "02 640 12 34" },
    { societe: "Garage Dupont", telephone: "0470 12 34 56" },
    { societe: "Smile (dentiste)", telephone: "+32 2 640 12 34" }, // même numéro
    { societe: "garage dupont sprl", telephone: null }, // même nom
    { societe: "Boulangerie Marie", telephone: "081 22 33 44" },
  ]);
  assert.deepEqual([...d.entries()], [
    [2, { premier: 0, raison: "telephone" }],
    [3, { premier: 1, raison: "societe" }],
  ]);
});

cas("dans un lot : sans téléphone ni nom exploitable, rien n'est rapproché", () => {
  assert.equal(doublonsDansLeLot([{ societe: "Bar" }, { societe: "Bar" }, {}]).size, 0);
});

cas("dans un lot : un doublon d'un doublon renvoie à la PREMIÈRE entrée", () => {
  const d = doublonsDansLeLot([
    { societe: "Garage Dupont", telephone: "0470 12 34 56" },
    { societe: "Garage Dupont", telephone: "0470 12 34 56" },
    { societe: "Garage Dupont", telephone: "0470 12 34 56" },
  ]);
  assert.deepEqual([...d.values()].map((v) => v.premier), [0, 0]);
});

cas("la phrase d'un commercial ne nomme JAMAIS personne", () => {
  const p = phraseDoublon({ ...AUCUN_DOUBLON, parTelephone: true });
  assert.equal(p, "déjà suivie dans l'équipe (même téléphone)");
  // Même si on lui passe un nom par erreur : sans `proprietaire` (que la base
  // ne remplit que pour l'admin), il n'est pas affiché.
  assert.equal(phraseDoublon({ ...AUCUN_DOUBLON, parSociete: true }, "Nathan"), "déjà suivie dans l'équipe (même nom)");
});

cas("la phrase de l'admin nomme le responsable", () => {
  assert.equal(
    phraseDoublon({ ...AUCUN_DOUBLON, parSociete: true, proprietaire: "u1" }, "Nathan"),
    "déjà suivie dans l'équipe — par Nathan (même nom)"
  );
});

cas("ma propre fiche : « déjà dans vos fiches »", () => {
  assert.equal(
    phraseDoublon({ ...AUCUN_DOUBLON, parTelephone: true, aMoi: true, ficheId: "f1" }),
    "déjà dans vos fiches (même téléphone)"
  );
});

cas("estDoublonEquipe : vrai dès qu'une clé a mordu", () => {
  assert.equal(estDoublonEquipe(AUCUN_DOUBLON), false);
  assert.equal(estDoublonEquipe(null), false);
  assert.equal(estDoublonEquipe({ ...AUCUN_DOUBLON, parSociete: true }), true);
});

console.log(`\n${ok} cas OK`);
