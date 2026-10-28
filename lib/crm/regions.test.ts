// npm run test:regions — la liste des régions (034), le filtre et l'affichage.
// La RÈGLE commune → région est en SQL (public.lieu_de) : elle se teste par la
// recette supabase/recettes/034_assembler.sh, sur lib/crm/lieux.cas.json.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  BRUXELLES_A_PRECISER,
  COMMUNES_BRUXELLES,
  GROUPES_REGION,
  HORS_BELGIQUE,
  REGIONS,
  estRegion,
  lieuAffiche,
  lireFiltreRegion,
  optionsFiltreRegion,
  valeurFiltreRegion,
} from "./regions.ts";

let ok = 0;
function cas(nom: string, f: () => void) {
  f();
  ok++;
  console.log(`  ✓ ${nom}`);
}

cas("31 régions : 19 communes de Bruxelles, « à préciser », 10 provinces, hors Belgique", () => {
  assert.equal(COMMUNES_BRUXELLES.length, 19);
  assert.equal(REGIONS.length, 31);
  assert.equal(new Set(REGIONS).size, 31);
});

cas("les groupes couvrent chaque région exactement une fois", () => {
  const toutes = GROUPES_REGION.flatMap((g) => [...g.regions]);
  assert.deepEqual([...toutes].sort(), [...REGIONS].sort());
});

cas("le jeu de cas de la recette n'attend que des régions de la liste", () => {
  const { cas: lignes } = JSON.parse(readFileSync(new URL("./lieux.cas.json", import.meta.url), "utf8")) as {
    cas: [string | null, string | null, string | null, string | null, string | null, string][];
  };
  assert.ok(lignes.length >= 40);
  for (const l of lignes) assert.ok(l[4] === null || estRegion(l[4]), `${l[5]} → ${l[4]}`);
});

cas("estRegion : la liste, à la lettre", () => {
  assert.ok(estRegion("Ixelles"));
  assert.ok(estRegion("Brabant wallon"));
  assert.ok(!estRegion("ixelles"));
  assert.ok(!estRegion("Bruxelles"));
  assert.ok(!estRegion(""));
  assert.ok(!estRegion(null));
  assert.ok(!estRegion("constructor"));
});

cas("filtre : une région, un groupe, « aucune » ; le reste vaut rien", () => {
  assert.deepEqual(lireFiltreRegion("Uccle"), { type: "regions", regions: ["Uccle"], label: "Uccle" });
  const bxl = lireFiltreRegion("g:bruxelles");
  assert.equal(bxl?.type, "regions");
  assert.equal(bxl?.type === "regions" && bxl.regions.length, 20);
  assert.ok(bxl?.type === "regions" && bxl.regions.includes(BRUXELLES_A_PRECISER));
  assert.equal(lireFiltreRegion("g:flandre")?.label, "Toute la Flandre");
  assert.deepEqual(lireFiltreRegion("aucune"), { type: "aucune", label: "Région inconnue" });
  for (const v of [null, undefined, "", "g:", "g:paris", "Lyon", "g:constructor"]) {
    assert.equal(lireFiltreRegion(v), null, String(v));
    assert.equal(valeurFiltreRegion(v), null, String(v));
  }
});

cas("le menu : chaque valeur se relit comme un filtre, « Tout … » en tête des groupes", () => {
  const groupes = optionsFiltreRegion();
  assert.deepEqual(groupes.map(([g]) => g), ["Bruxelles", "Wallonie", "Flandre", "Hors Belgique", "À compléter"]);
  for (const [, options] of groupes) for (const [v] of options) assert.ok(lireFiltreRegion(v), v);
  assert.deepEqual(groupes[0][1][0], ["g:bruxelles", "Tout Bruxelles"]);
  assert.ok(groupes[0][1].some(([v, l]) => v === BRUXELLES_A_PRECISER && l === "Commune à préciser"));
  assert.deepEqual(groupes[3][1], [[HORS_BELGIQUE, HORS_BELGIQUE]]);
  // Les valeurs passent la frontière serveur → client : des chaînes seulement.
  assert.ok(groupes.flatMap(([, o]) => o.flat()).every((x) => typeof x === "string"));
});

cas("l'affichage : la commune, et la région quand elle apprend quelque chose", () => {
  assert.equal(lieuAffiche("Ixelles", "Ixelles"), "Ixelles");
  assert.equal(lieuAffiche("Laeken", "Bruxelles-Ville"), "Laeken (Bruxelles-Ville)");
  assert.equal(lieuAffiche("Éghezée", "Namur"), "Éghezée (Namur)");
  assert.equal(lieuAffiche("Namur", "Namur"), "Namur");
  assert.equal(lieuAffiche("Bruxelles", BRUXELLES_A_PRECISER), "Bruxelles");
  assert.equal(lieuAffiche("Lille", HORS_BELGIQUE), "Lille");
  assert.equal(lieuAffiche(null, "Hainaut"), "Hainaut");
  assert.equal(lieuAffiche("  ", BRUXELLES_A_PRECISER), "Bruxelles");
  assert.equal(lieuAffiche("Lyon", null), "Lyon");
  assert.equal(lieuAffiche(null, null), null);
});

console.log(`\n${ok} OK`);
