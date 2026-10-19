/**
 * « Fiche suivante » — sans réseau ni base :
 *
 *   node --experimental-strip-types lib/crm/ficheSuivante.test.ts
 *
 * (script npm : `npm run test:fiche-suivante`).
 */

import { ordreAFaire, ficheSuivante, lireListe, lienDepuisAFaire } from "./ficheSuivante.ts";

let echecs = 0;

function verifie(nom: string, obtenu: unknown, attendu: unknown) {
  const o = JSON.stringify(obtenu);
  const a = JSON.stringify(attendu);
  if (o !== a) {
    echecs++;
    console.error(`  ✗ ${nom}\n      attendu ${a}\n      obtenu  ${o}`);
  } else {
    console.log(`✓ ${nom}`);
  }
}

// L'écran : débrief, en retard, aujourd'hui, en attente, réponses.
const liste = ordreAFaire([
  ["carsystem", "nice"],
  ["briand", "carsystem", null],
  ["vivier"],
  [],
  ["boetendael", "briand"],
]);
verifie("l'ordre de l'écran, chaque fiche une fois, à sa première place",
  liste, ["carsystem", "nice", "briand", "vivier", "boetendael"]);

verifie("depuis la première : la deuxième", ficheSuivante(liste, "carsystem"),
  { suivante: "nice", position: 1, total: 5 });
verifie("au milieu : la suivante dans l'ordre", ficheSuivante(liste, "briand")?.suivante, "vivier");
verifie("la dernière : s'arrête proprement (aucune suivante)", ficheSuivante(liste, "boetendael"),
  { suivante: null, position: 5, total: 5 });
verifie("une fiche hors de la liste : rien", ficheSuivante(liste, "inconnue"), null);
verifie("liste vide : rien", ficheSuivante([], "carsystem"), null);

verifie("mémoire abîmée : liste vide, jamais d'erreur",
  [lireListe(null), lireListe("{pas du json"), lireListe('{"a":1}'), lireListe('["x",2,"y"]')],
  [[], [], [], ["x", "y"]]);
verifie("le lien porte « depuis »", lienDepuisAFaire("nice"), "/prospects/nice?depuis=a-faire");

console.log(echecs === 0 ? "\nTous les cas passent." : `\n${echecs} cas en ÉCHEC.`);
process.exit(echecs === 0 ? 0 : 1);
