// npm run test:non-reponse — une note « À rappeler » qui décrit une
// non-réponse (05/11/2026). Le jeu `nonReponse.cas.json` porte les 32 notes
// réelles de la production (la liste soumise à Bora pour la 047) et les bords.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { lireNoteRappeler, normaliserNote, proposerPasDecroche } from "./nonReponse.ts";

type Jeu = {
  reel: { societe: string; note: string; verdict: string | null }[];
  synthetique: { note: string; verdict: string | null }[];
};
const jeu = JSON.parse(readFileSync(new URL("./nonReponse.cas.json", import.meta.url), "utf8")) as Jeu;

let ok = 0;
const cas = (nom: string, f: () => void) => {
  f();
  ok++;
  console.log(`  ✓ ${nom}`);
};

for (const c of jeu.reel) {
  cas(`réel — ${c.societe} : « ${c.note.slice(0, 50)} » → ${c.verdict}`, () =>
    assert.equal(lireNoteRappeler(c.note), c.verdict, c.note)
  );
}
for (const c of jeu.synthetique) {
  cas(`bord — « ${c.note} » → ${c.verdict}`, () => assert.equal(lireNoteRappeler(c.note), c.verdict, c.note));
}

cas("normalisation : accents, casse, apostrophe typographique, espaces", () => {
  assert.equal(normaliserNote("  N’a  pas RÉPONDU "), "n'a pas repondu");
  assert.equal(normaliserNote(null), "");
});

cas("le garde-fou de l'écran : seulement avec « À rappeler » et une non-réponse franche", () => {
  assert.equal(proposerPasDecroche("rappeler", "Pas répondu"), true);
  assert.equal(proposerPasDecroche("rappeler", "Messager"), true);
  assert.equal(proposerPasDecroche("interesse", "Pas répondu"), false, "pas sous un autre résultat");
  assert.equal(proposerPasDecroche("sans_reponse", "Pas répondu"), false, "déjà « Pas décroché »");
  assert.equal(proposerPasDecroche("rappeler", "a rappeler pas avant 19 h car en consultation"), false, "ambigu : jamais proposé");
  assert.equal(proposerPasDecroche("rappeler", "Rappeler Claudio le matin"), false);
  assert.equal(proposerPasDecroche("rappeler", ""), false, "sans note : rien");
  assert.equal(proposerPasDecroche(null, "Pas répondu"), false);
});

const compte = (v: string | null) => jeu.reel.filter((c) => c.verdict === v).length;
cas("la liste réelle : 9 non-réponses, 3 à trancher, 1 « intéressé »", () => {
  assert.deepEqual([compte("non_reponse"), compte("a_trancher"), compte("interesse")], [9, 3, 1]);
});

console.log(`\n${ok} cas — tout passe.`);
