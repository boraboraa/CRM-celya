// npm run test:perdues — les fiches perdues masquées par défaut (29/10).
import assert from "node:assert/strict";
import {
  AVEC_PERDUES,
  estPerdue,
  lireAnnulation,
  masquerPerdues,
  sansPerdues,
} from "./perdues.ts";

let ok = 0;
function cas(nom: string, f: () => void) {
  f();
  ok++;
  console.log(`  ✓ ${nom}`);
}

const ETAPES = ["a_appeler", "contacte", "rendez_vous", "a_rappeler", "proposition", "gagne", "perdu"];

cas("par défaut (aucune étape choisie), les perdues sont masquées", () => {
  assert.equal(masquerPerdues(undefined), true);
  assert.equal(masquerPerdues(null), true);
  assert.equal(masquerPerdues(""), true);
  assert.equal(masquerPerdues("tous"), true);
});

cas("« Perdu » choisi, ou « Toutes, perdues comprises » : rien n'est masqué", () => {
  assert.equal(masquerPerdues("perdu"), false);
  assert.equal(masquerPerdues(AVEC_PERDUES), false);
});

cas("une autre étape choisie : le filtre d'étape suffit (rien de plus à masquer)", () => {
  assert.equal(masquerPerdues("contacte"), false);
  assert.equal(masquerPerdues("gagne"), false);
});

cas("seule « perdu » est une étape masquée — les gagnées restent", () => {
  assert.equal(estPerdue("perdu"), true);
  assert.equal(estPerdue("gagne"), false);
  assert.equal(estPerdue(null), false);
});

cas("« À faire » : les relances des fiches perdues disparaissent, les autres restent", () => {
  const taches = [
    { id: "a", prospects: { status: "contacte" } },
    { id: "b", prospects: { status: "perdu" } },
    { id: "c", prospects: { status: "gagne" } },
    { id: "d", prospects: null },
  ];
  assert.deepEqual(sansPerdues(taches).map((t) => t.id), ["a", "c", "d"]);
});

cas("défaire un « Pas intéressé » : l'étape d'avant, le verrou, les relances", () => {
  const id = "3f2b6c1e-8d4a-4b5e-9c7f-0a1b2c3d4e5f";
  assert.deepEqual(lireAnnulation({ etape: "contacte", verrou: false, relances: [id] }, ETAPES), {
    etape: "contacte",
    verrou: false,
    relances: [id],
  });
});

cas("défaire : une étape inconnue ou « perdu » ne défait rien", () => {
  assert.equal(lireAnnulation({ etape: "perdu", verrou: true, relances: [] }, ETAPES), null);
  assert.equal(lireAnnulation({ etape: "constructor", relances: [] }, ETAPES), null);
  assert.equal(lireAnnulation(null, ETAPES), null);
  assert.equal(lireAnnulation("contacte", ETAPES), null);
});

cas("défaire : seuls des identifiants propres passent, vingt au plus", () => {
  const id = "3f2b6c1e-8d4a-4b5e-9c7f-0a1b2c3d4e5f";
  const a = lireAnnulation({ etape: "contacte", verrou: "oui", relances: [id, "x); drop", 42, ...Array(30).fill(id)] }, ETAPES);
  assert.equal(a?.verrou, false);
  assert.equal(a?.relances.length, 20);
  assert.ok(a?.relances.every((r) => r === id));
});

console.log(`\n${ok} cas — tout passe.`);
