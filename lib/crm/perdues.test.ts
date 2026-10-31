// npm run test:perdues — les fiches perdues masquées par défaut (29/10).
import assert from "node:assert/strict";
import {
  AVEC_PERDUES,
  estPerdue,
  lireAnnulation,
  masquerPerdues,
  REFUS_RELANCE_PERDUE,
  relanceRefuseeSurPerdue,
  sansPerdues,
} from "./perdues.ts";
import { readFileSync } from "node:fs";

let ok = 0;
function cas(nom: string, f: () => void) {
  f();
  ok++;
  console.log(`  ✓ ${nom}`);
}

const ETAPES = ["a_appeler", "rendez_vous", "a_rappeler", "suivi_email", "gagne", "perdu"];

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
  assert.equal(masquerPerdues("a_rappeler"), false);
  assert.equal(masquerPerdues("gagne"), false);
});

cas("seule « perdu » est une étape masquée — les gagnées restent", () => {
  assert.equal(estPerdue("perdu"), true);
  assert.equal(estPerdue("gagne"), false);
  assert.equal(estPerdue(null), false);
});

cas("« À faire » : les relances des fiches perdues disparaissent, les autres restent", () => {
  const taches = [
    { id: "a", prospects: { status: "a_rappeler" } },
    { id: "b", prospects: { status: "perdu" } },
    { id: "c", prospects: { status: "gagne" } },
    { id: "d", prospects: null },
  ];
  assert.deepEqual(sansPerdues(taches).map((t) => t.id), ["a", "c", "d"]);
});

cas("défaire un « Pas intéressé » : l'étape d'avant, le verrou, les relances", () => {
  const id = "3f2b6c1e-8d4a-4b5e-9c7f-0a1b2c3d4e5f";
  assert.deepEqual(lireAnnulation({ etape: "a_rappeler", verrou: false, relances: [id] }, ETAPES), {
    etape: "a_rappeler",
    verrou: false,
    relances: [id],
  });
});

cas("défaire : une étape inconnue ou « perdu » ne défait rien", () => {
  assert.equal(lireAnnulation({ etape: "perdu", verrou: true, relances: [] }, ETAPES), null);
  assert.equal(lireAnnulation({ etape: "constructor", relances: [] }, ETAPES), null);
  assert.equal(lireAnnulation(null, ETAPES), null);
  assert.equal(lireAnnulation("a_rappeler", ETAPES), null);
});

cas("défaire : seuls des identifiants propres passent, vingt au plus", () => {
  const id = "3f2b6c1e-8d4a-4b5e-9c7f-0a1b2c3d4e5f";
  const a = lireAnnulation({ etape: "a_rappeler", verrou: "oui", relances: [id, "x); drop", 42, ...Array(30).fill(id)] }, ETAPES);
  assert.equal(a?.verrou, false);
  assert.equal(a?.relances.length, 20);
  assert.ok(a?.relances.every((r) => r === id));
});

cas("Perdu l'emporte (31/10) : pas de relance sur une fiche perdue, et seulement sur elle", () => {
  assert.equal(relanceRefuseeSurPerdue("perdu"), REFUS_RELANCE_PERDUE);
  for (const e of ["a_appeler", "a_rappeler", "rendez_vous", "suivi_email", "essai_gratuit", "gagne", null, undefined]) {
    assert.equal(relanceRefuseeSurPerdue(e), null, String(e));
  }
});

cas("la base dit la MÊME phrase que l'écran (migration 044)", () => {
  const sql = readFileSync(new URL("../../supabase/migrations/044_perdu_l_emporte.sql", import.meta.url), "utf8");
  assert.ok(sql.includes(REFUS_RELANCE_PERDUE.replace(/'/g, "''")), "la phrase de tasks_pas_sur_perdue = REFUS_RELANCE_PERDUE");
});

console.log(`\n${ok} cas — tout passe.`);
