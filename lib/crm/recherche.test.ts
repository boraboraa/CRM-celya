/**
 * La recherche de prospects — sans réseau ni base :
 *
 *   node --experimental-strip-types lib/crm/recherche.test.ts
 *
 * (script npm : `npm run test:recherche`). La RLS, elle, se teste en base :
 * la recherche part toujours sur le client de l'utilisateur, elle ne voit que
 * ce qu'il voit — voir lib/crm/recherche.ts.
 */

import {
  nettoyerRecherche,
  chiffresTelephone,
  filtreRecherche,
  correspond,
} from "./recherche.ts";

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

console.log("— la saisie —");
verifie("virgule et parenthèses retirées (elles cassaient le filtre or())",
  nettoyerRecherche("Garage Dupont, Liège (centre)"), "Garage Dupont Liège centre");
verifie("jokers retirés", nettoyerRecherche("50% _x_"), "50 x");
verifie("vide → vide", nettoyerRecherche("   "), "");
verifie("rien à chercher → pas de filtre", filtreRecherche("  ,  "), null);

console.log("\n— le téléphone —");
verifie("format national", chiffresTelephone("081 22 33 44"), "81223344");
verifie("format international", chiffresTelephone("+32 81 22 33 44"), "81223344");
verifie("format 0032", chiffresTelephone("0032 81 22 33 44"), "81223344");
verifie("mobile sans espaces", chiffresTelephone("0478123456"), "478123456");
verifie("un bout de numéro suffit (4 chiffres)", chiffresTelephone("2233"), "2233");
verifie("trop court : pas un numéro", chiffresTelephone("123"), null);
verifie("des lettres : un nom, pas un numéro", chiffresTelephone("Garage 2000"), null);

const fiche = {
  company_name: "Carrosserie carsystem",
  contact_name: "Mounir",
  email: "contact@carsystem.be",
  city: "Liège",
  phone: "+32 4 222 33 44",
};
verifie("société", correspond(fiche, "carsys"), true);
verifie("contact, sans casse", correspond(fiche, "mounir"), true);
verifie("ville", correspond(fiche, "liège"), true);
verifie("téléphone tapé au format national", correspond(fiche, "04 222 33 44"), true);
verifie("téléphone tapé collé", correspond(fiche, "042223344"), true);
verifie("téléphone partiel", correspond(fiche, "3344"), true);
verifie("autre numéro : non", correspond(fiche, "0478 99 88 77"), false);
verifie("autre nom : non", correspond(fiche, "Boetendael"), false);

const filtre = filtreRecherche("04 222 33 44");
verifie("le filtre porte les quatre champs texte et le téléphone",
  filtre?.split(",").map((p) => p.split(".")[0]),
  ["company_name", "contact_name", "email", "city", "phone"]);
verifie("le téléphone en expression régulière, séparateurs libres",
  filtre?.split(",").pop(), "phone.imatch.4[^0-9]*2[^0-9]*2[^0-9]*2[^0-9]*3[^0-9]*3[^0-9]*4[^0-9]*4");
verifie("un nom : pas de critère téléphone", filtreRecherche("Nice Cars")?.includes("phone"), false);

console.log(echecs === 0 ? "\nTous les cas passent." : `\n${echecs} cas en ÉCHEC.`);
process.exit(echecs === 0 ? 0 : 1);
