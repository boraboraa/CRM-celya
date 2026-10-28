// npm run test:suppression — qui peut supprimer une fiche, et ce qu'on lui dit.
import assert from "node:assert/strict";
import {
  LOT_MAX,
  idsPropres,
  peutSupprimer,
  peutSupprimerEnLot,
  questionSuppression,
  resultatSuppression,
} from "./suppression.ts";

let ok = 0;
function cas(nom: string, f: () => void) {
  f();
  ok++;
  console.log(`  ✓ ${nom}`);
}

const BORA = { userId: "b", isAdmin: true };
const NATHAN = { userId: "n", isAdmin: false };
const PERSONNE = { userId: null, isAdmin: false };

cas("le responsable supprime SA fiche", () => assert.equal(peutSupprimer(NATHAN, "n"), true));
cas("un collègue ou un encadrant ne supprime pas celle d'un autre", () => assert.equal(peutSupprimer(NATHAN, "e"), false));
cas("l'admin supprime n'importe quelle fiche", () => assert.equal(peutSupprimer(BORA, "n"), true));
cas("sans session : rien", () => assert.equal(peutSupprimer(PERSONNE, "n"), false));
cas("une fiche sans responsable : l'admin seul", () => {
  assert.equal(peutSupprimer(NATHAN, null), false);
  assert.equal(peutSupprimer(BORA, null), true);
});

cas("en lot : l'admin seul", () => {
  assert.equal(peutSupprimerEnLot(BORA, 4), true);
  assert.equal(peutSupprimerEnLot(NATHAN, 4), false);
});
cas("une seule fiche : chacun (la base revérifie la propriété)", () => assert.equal(peutSupprimerEnLot(NATHAN, 1), true));
cas("rien, ou trop : refusé", () => {
  assert.equal(peutSupprimerEnLot(BORA, 0), false);
  assert.equal(peutSupprimerEnLot(BORA, LOT_MAX + 1), false);
  assert.equal(peutSupprimerEnLot(BORA, LOT_MAX), true);
});

cas("identifiants : seulement des uuid, sans doublon", () => {
  const u = "41c3da86-635c-4e3e-8d05-3994cbcc018f";
  assert.deepEqual(idsPropres([u, u, "x", 3, null, "41c3da86"]), [u]);
  assert.deepEqual(idsPropres("pas un tableau"), []);
});

cas("la question dit le nom, et ce qui part", () => {
  assert.equal(
    questionSuppression(["API CAR 3000"]),
    "Supprimer définitivement « API CAR 3000 » ? Son journal, ses relances et ses rendez-vous disparaissent. Action définitive."
  );
  assert.match(questionSuppression(["a", "b", "c", "d"]), /^Supprimer définitivement 4 fiches \? Leur journal/);
});

cas("le résultat : tout, une partie, rien", () => {
  assert.deepEqual(resultatSuppression(1, 1), { ok: true, texte: "1 fiche supprimée." });
  assert.deepEqual(resultatSuppression(4, 4), { ok: true, texte: "4 fiches supprimées." });
  assert.deepEqual(resultatSuppression(4, 3), { ok: true, texte: "3 fiches supprimées. 1 n'a pas pu l'être (pas à vous)." });
  assert.deepEqual(resultatSuppression(4, 1), { ok: true, texte: "1 fiche supprimée. 3 n'ont pas pu l'être (pas à vous)." });
  assert.equal(resultatSuppression(1, 0).ok, false);
  assert.match(resultatSuppression(3, 0).texte, /Aucune de ces fiches/);
});

console.log(`\n${ok} OK`);
