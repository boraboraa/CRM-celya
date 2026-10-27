/**
 * « Ma liste » — les collages RÉELS des étudiants, contre un faux fournisseur
 * HTTP local qui répond comme MiniMax (même harnais que test:ia : un vrai
 * serveur, pas un fetch simulé). Rien ne sort de la machine.
 *
 *   npm run test:ma-liste
 *
 * Ce qui est vérifié : ce que le CODE fait de chaque collage — lecture sans
 * modèle quand c'est possible (et le faux serveur compte qu'il n'a PAS été
 * appelé), « +32 », remarques dans « Ce qu'on sait », numéro implausible
 * signalé, numéro inventé par le modèle retiré, doublons dans le lot et dans
 * l'équipe, assistant indisponible sans blocage, corrections par message.
 * Ce que fait le VRAI modèle se vérifie à part (recette sur le déploiement
 * d'aperçu, collages 1, 3 et 5 — voir le rapport de la PR).
 */

import http from "node:http";
import type { AddressInfo } from "node:net";

// ---------------------------------------------------------------------------
// Le faux fournisseur : il reconnaît le collage et rend ce qu'un modèle rendrait.
// ---------------------------------------------------------------------------
let appels = 0;
let panne = false;
const REPONSES: [RegExp, unknown][] = [
  [
    /Ouvert · Ferme/,
    {
      fiches: [
        {
          company_name: "Cabinet Dentaire Smile",
          phone: "02 640 12 34",
          address: "Avenue Louise 54, 1050 Ixelles",
          city: "Ixelles",
          sector: "Dentiste",
          notes: "la secrétaire décroche jamais, essayer avant 9h",
          website: "https://www.smile-dentaire.be/",
          email: null,
          contact_name: null,
        },
        {
          company_name: "Garage Marchal",
          phone: "04 223 45 67",
          address: "Rue de la Station 12, 4000 Liège",
          city: "Liège",
          sector: "Garage automobile",
          notes: null,
        },
        // Un numéro qui n'est PAS dans le texte : le modèle l'a inventé.
        { company_name: "Optique Lumière", phone: "0499 99 99 99", sector: "Opticien", notes: "rappeler après 14h" },
        // Un nom qui n'est pas dans le texte.
        { company_name: "Société Fantôme", phone: null },
        "pas un objet",
      ],
    },
  ],
];
const serveur = http.createServer((req, res) => {
  let corps = "";
  req.on("data", (c) => (corps += c));
  req.on("end", () => {
    appels++;
    res.writeHead(200, { "content-type": "application/json" });
    if (panne) {
      res.end(JSON.stringify({ base_resp: { status_code: 1008, status_msg: "insufficient balance" } }));
      return;
    }
    const texte = JSON.parse(corps).messages.map((m: { content: string }) => m.content).join("\n");
    const trouve = REPONSES.find(([re]) => re.test(texte.split("Texte :").pop() ?? ""));
    res.end(
      JSON.stringify({
        base_resp: { status_code: 0, status_msg: "success" },
        choices: [{ message: { content: JSON.stringify(trouve ? trouve[1] : { fiches: [] }) } }],
      })
    );
  });
});
await new Promise<void>((r) => serveur.listen(0, () => r()));
process.env.AGENT_PROVIDER = "minimax";
process.env.MINIMAX_API_KEY = "cle-bidon-pour-le-test";
process.env.MINIMAX_BASE_URL = `http://127.0.0.1:${(serveur.address() as AddressInfo).port}/v1`;
process.env.MINIMAX_MODEL = "MiniMax-Text-01";

const { lireCollage } = await import("./maListeIA.ts");
const {
  appliquerCorrection,
  etatsDesFiches,
  lireCorrection,
  lireDeterministe,
  morceaux,
  phraseCorrection,
  recapitulatif,
  PLAFOND_FICHES,
} = await import("./maListe.ts");
const { AUCUN_DOUBLON } = await import("./doublons.ts");

// Les erreurs du fournisseur (attendues dans les cas de panne) ne polluent pas la sortie.
console.error = () => {};

let echecs = 0;
let ok = 0;
function verifie(nom: string, obtenu: unknown, attendu: unknown) {
  const o = JSON.stringify(obtenu);
  const a = JSON.stringify(attendu);
  if (o !== a) {
    echecs++;
    console.log(`  ✗ ${nom}\n      attendu ${a}\n      obtenu  ${o}`);
  } else {
    ok++;
    console.log(`  ✓ ${nom}`);
  }
}
const SANS = { secteur: null, ville: null };
const champs = (f: { company_name: string; phone: string | null; notes: string | null }) => [
  f.company_name,
  f.phone,
  f.notes,
];

// --- 1. Une ligne par commerce, « nom + numéro » ---------------------------
console.log("— 1. nom + numéro —");
appels = 0;
let r = await lireCollage(
  `Cabinet dentaire Smile 02 640 12 34
Garage Dupont 0470 12 34 56
Vétérinaire des Étangs 081 22 33 44`,
  { secteur: "Cabinet dentaire", ville: "Bruxelles" }
);
verifie("lu SANS le modèle (aucun appel)", [r.source, appels], ["lecture", 0]);
verifie("trois fiches, numéros au format +32", r.fiches.map(champs), [
  ["Cabinet dentaire Smile", "+32 2 640 12 34", null],
  ["Garage Dupont", "+32 470 12 34 56", null],
  ["Vétérinaire des Étangs", "+32 81 22 33 44", null],
]);
verifie("secteur et ville par défaut du collage", [r.fiches[0].sector, r.fiches[0].city], ["Cabinet dentaire", "Bruxelles"]);

// --- 2. Séparateurs variés --------------------------------------------------
console.log("\n— 2. séparateurs —");
appels = 0;
r = await lireCollage(
  `1. Cabinet dentaire Smile - 02 640 12 34
2) Garage Dupont : 0470 12 34 56
Vétérinaire des Étangs\t081 22 33 44
Kiné Louise; 02/538.11.22
- Optique Lumière – 0032 2 640 99 88`,
  SANS
);
verifie("lu sans le modèle", [r.source, appels], ["lecture", 0]);
verifie("« - », « : », tabulation, « ; », « – », puces et numéros de liste", r.fiches.map((f) => [f.company_name, f.phone]), [
  ["Cabinet dentaire Smile", "+32 2 640 12 34"],
  ["Garage Dupont", "+32 470 12 34 56"],
  ["Vétérinaire des Étangs", "+32 81 22 33 44"],
  ["Kiné Louise", "+32 2 538 11 22"],
  ["Optique Lumière", "+32 2 640 99 88"],
]);

// --- 3. Un tableau markdown sorti d'un ChatGPT ------------------------------
console.log("\n— 3. tableau markdown —");
appels = 0;
r = await lireCollage(
  `Voici la liste demandée :

| Nom | Téléphone | Adresse | Remarque |
|-----|-----------|---------|----------|
| Cabinet dentaire Smile | 02 640 12 34 | Avenue Louise 54, 1050 Ixelles | ouvert le samedi |
| Garage Dupont | 0470 12 34 56 | Rue de la Station 12, 4000 Liège | - |
| Kiné Louise | 02/538.11.22 | | |`,
  { secteur: null, ville: "Bruxelles" }
);
verifie("lu sans le modèle, le titre ignoré", [r.source, appels, r.fiches.length], ["lecture", 0, 3]);
verifie("colonnes reconnues à l'en-tête ; « Remarque » → Ce qu'on sait", r.fiches.map((f) => [f.company_name, f.phone, f.address, f.notes]), [
  ["Cabinet dentaire Smile", "+32 2 640 12 34", "Avenue Louise 54, 1050 Ixelles", "ouvert le samedi"],
  ["Garage Dupont", "+32 470 12 34 56", "Rue de la Station 12, 4000 Liège", null],
  ["Kiné Louise", "+32 2 538 11 22", null, null],
]);

// --- 4. Un copier-coller Google Maps bruité → le modèle ----------------------
console.log("\n— 4. Google Maps bruité —");
const MAPS = `Cabinet Dentaire Smile
4,8 ★ (52) · Dentiste
Avenue Louise 54, 1050 Ixelles
Ouvert · Ferme à 18:00
02 640 12 34
la secrétaire décroche jamais, essayer avant 9h

Garage Marchal
4,6 ★ (87 avis) · Garage automobile
Rue de la Station 12, 4000 Liège
Fermé · Ouvre à 08:00 ven.
04 223 45 67

Optique Lumière
Opticien · Rue Neuve 3
rappeler après 14h`;
appels = 0;
r = await lireCollage(MAPS, SANS);
verifie("le code ne sait pas tout lire : le modèle est passé", [r.source, appels > 0], ["assistant", true]);
verifie("le code range : +32, secteur de la liste, site nettoyé", [r.fiches[0].phone, r.fiches[0].sector, r.fiches[0].website, r.fiches[1].sector], [
  "+32 2 640 12 34",
  "Cabinet dentaire",
  "www.smile-dentaire.be",
  "Garage / carrosserie",
]);
verifie("la remarque de l'étudiant reste dans Ce qu'on sait", r.fiches[0].notes, "la secrétaire décroche jamais, essayer avant 9h");
const optique = r.fiches.find((f) => f.company_name === "Optique Lumière");
verifie("un numéro ABSENT du collage est retiré, jamais inventé", [optique?.phone, optique?.aVerifier], [
  null,
  ["numéro introuvable dans le texte — retiré"],
]);
verifie("un nom absent du collage est signalé", r.fiches.find((f) => f.company_name === "Société Fantôme")?.aVerifier, ["nom à vérifier"]);
verifie("une entrée qui n'est pas un objet est ignorée", r.fiches.length, 4);

// --- 5. Des remarques mêlées ------------------------------------------------
console.log("\n— 5. remarques mêlées —");
appels = 0;
r = await lireCollage(
  `Cabinet dentaire Smile 02 640 12 34
la secrétaire décroche jamais
Garage Dupont - 0470 12 34 56 - rappeler après 14h
Kiné Centre Louise ; 02/538.11.22
→ ont déjà un logiciel, à creuser
NB : le gérant s'appelle Marc`,
  SANS
);
verifie("lu sans le modèle", [r.source, appels], ["lecture", 0]);
verifie("les remarques vont dans Ce qu'on sait, jamais dans les champs", r.fiches.map(champs), [
  ["Cabinet dentaire Smile", "+32 2 640 12 34", "la secrétaire décroche jamais"],
  ["Garage Dupont", "+32 470 12 34 56", "rappeler après 14h"],
  ["Kiné Centre Louise", "+32 2 538 11 22", "ont déjà un logiciel, à creuser\nNB : le gérant s'appelle Marc"],
]);
verifie("aucun contact deviné à partir d'une remarque", r.fiches.map((f) => f.contact_name), [null, null, null]);

// --- 6. Les formats de numéros ----------------------------------------------
console.log("\n— 6. formats de numéros —");
r = await lireCollage(
  `Garage A 0470 12 34 56
Garage B +32 470 12 34 57
Garage C 0032 2 640 12 34
Garage D 02/640.12.35
Garage E 02 640 12
Garage F +32 (0)2 640 12 36`,
  SANS
);
verifie("tous rangés au format +32", r.fiches.map((f) => f.phone), [
  "+32 470 12 34 56",
  "+32 470 12 34 57",
  "+32 2 640 12 34",
  "+32 2 640 12 35",
  null,
  "+32 2 640 12 36",
]);
verifie("le numéro implausible est gardé tel que lu, pour être signalé", r.fiches[4].phone_lu, "02 640 12");
const etats6 = etatsDesFiches(r.fiches, []);
verifie("…et la ligne le dit", etats6[4], {
  statut: "a_creer",
  phrase: "numéro « 02 640 12 » implausible — à compléter sur la fiche",
  sansNumero: true,
});

// --- 7. Les doublons — dans le collage et avec la base ------------------------
console.log("\n— 7. doublons —");
r = await lireCollage(
  `Cabinet dentaire Smile 02 640 12 34
Garage Dupont 0470 12 34 56
Smile (dentiste) +32 2 640 12 34
Garage Dupont SPRL 0470 99 88 77
Boulangerie Marie 081 22 33 44`,
  SANS
);
// La base répond (031) : la Boulangerie est suivie par un autre membre —
// des booléens, sans nom pour un commercial.
const equipe = [null, null, null, null, { ...AUCUN_DOUBLON, parTelephone: true }];
const etats = etatsDesFiches(r.fiches, equipe);
verifie("le lot : même numéro, puis même nom (forme juridique ignorée)", etats.map((e) => [e.statut, e.phrase]), [
  ["a_creer", null],
  ["a_creer", null],
  ["doublon_lot", "répète la ligne 1 (même téléphone)"],
  ["doublon_lot", "répète la ligne 2 (même nom)"],
  ["doublon_equipe", "déjà suivie dans l'équipe (même téléphone)"],
]);
verifie("le récapitulatif", recapitulatif(etats), "2 fiches à créer · 1 déjà suivie dans l'équipe · 2 en double dans la liste");
const etatsAdmin = etatsDesFiches(r.fiches, [null, null, null, null, { ...AUCUN_DOUBLON, parSociete: true, proprietaire: "u-hakim" }], (id) =>
  id === "u-hakim" ? "Hakim" : null
);
verifie("l'admin apprend QUI la suit", etatsAdmin[4].phrase, "déjà suivie dans l'équipe — par Hakim (même nom)");
const mienne = etatsDesFiches(r.fiches, [{ ...AUCUN_DOUBLON, parTelephone: true, aMoi: true, ficheId: "f1" }]);
verifie("une de MES fiches : « déjà dans vos fiches »", [mienne[0].statut, mienne[0].phrase], ["a_moi", "déjà dans vos fiches (même téléphone)"]);

// --- 8. L'assistant indisponible ne bloque rien --------------------------------
console.log("\n— 8. assistant indisponible —");
panne = true;
r = await lireCollage(MAPS, SANS);
verifie("modèle en panne (solde épuisé) : la lecture du code, et l'écran le dit", [r.source, r.assistantIndisponible, r.nonLues.length > 0], [
  "lecture",
  true,
  true,
]);
panne = false;
const modele = process.env.MINIMAX_MODEL;
delete process.env.MINIMAX_MODEL;
appels = 0;
r = await lireCollage(MAPS + "\nGarage Zed 0470 11 22 33", SANS);
verifie("sans configuration : aucun appel, la ligne lisible est gardée", [appels, r.assistantIndisponible, r.fiches.map((f) => f.company_name)], [
  0,
  true,
  ["Garage Zed"],
]);
process.env.MINIMAX_MODEL = modele;
r = await lireCollage("   ", SANS);
verifie("un collage vide : on le dit", r.error, "Rien à lire : collez votre liste.");

// --- 9. Les plafonds et les morceaux -------------------------------------------
console.log("\n— 9. plafonds —");
const long = Array.from({ length: 120 }, (_, i) => `Garage ${String.fromCharCode(65 + (i % 26))}${i} 0470 ${String(100000 + i).slice(0, 2)} ${String(100000 + i).slice(2, 4)} ${String(100000 + i).slice(4, 6)}`).join("\n");
r = await lireCollage(long, SANS);
verifie(`au plus ${PLAFOND_FICHES} fiches, et l'écran dit que la fin n'est pas lue`, [r.fiches.length, r.tronque], [PLAFOND_FICHES, true]);
const m = morceaux(MAPS + "\n\n" + MAPS, 400);
verifie("les morceaux coupent aux lignes vides : chaque bloc Maps reste entier", m.every((x) => x.length <= 400) && m.length >= 2, true);
verifie("aucune ligne perdue au découpage", m.join("\n\n").replace(/\s/g, ""), (MAPS + "\n\n" + MAPS).replace(/\s/g, ""));

// --- 10. Les corrections par message --------------------------------------------
console.log("\n— 10. corrections —");
verifie("« enlève la 3 »", lireCorrection("enlève la 3", 5), { op: "retirer", lignes: [3] });
verifie("« retire 2 et 5 »", lireCorrection("retire 2 et 5", 5), { op: "retirer", lignes: [2, 5] });
verifie("« supprime les lignes 2 à 4 »", lireCorrection("supprime les lignes 2 à 4", 5), { op: "retirer", lignes: [2, 3, 4] });
verifie("« enlève la 9 » sur 5 fiches : rien", lireCorrection("enlève la 9", 5), null);
verifie("« le secteur c'est kiné »", lireCorrection("le secteur c'est kiné", 5), {
  op: "modifier",
  lignes: "toutes",
  champ: "sector",
  valeur: "Kiné / paramédical",
});
verifie("« la ville c'est Namur pour la 2 »", lireCorrection("la ville c'est Namur pour la 2", 5), {
  op: "modifier",
  lignes: [2],
  champ: "city",
  valeur: "Namur",
});
verifie("une phrase libre n'est pas une correction (le modèle tentera)", lireCorrection("merci Janet !", 5), null);
const avant = lireDeterministe("A Garage 0470 11 22 33\nB Garage 0470 11 22 34\nC Garage 0470 11 22 35", SANS).fiches;
const c = lireCorrection("enlève la 2", avant.length)!;
const apres = appliquerCorrection(avant, c);
verifie("appliquée : la 2 disparaît", apres.map((f) => f.company_name), ["A Garage", "C Garage"]);
verifie("et Janet le dit", phraseCorrection(c, avant.length, apres.length), "C'est fait : 1 fiche retirée. Il en reste 2.");

const { validerCorrectionsModele } = await import("./maListe.ts");
const v = validerCorrectionsModele(
  {
    operations: [
      { op: "modifier", ligne: 1, champ: "sector", valeur: "dentiste" },
      { op: "modifier", ligne: 3, champ: "phone", valeur: "0470 55 66 77" },
      { op: "modifier", ligne: 2, champ: "owner_id", valeur: "u-autre" }, // hors liste blanche
      { op: "retirer", lignes: [2, 99] }, // 99 n'existe pas
      { op: "detruire_tout" },
    ],
    reponse: "J'ai rangé la 1, corrigé le numéro de la 3 et retiré la 2.",
  },
  avant
);
verifie("modèle : les opérations valides seulement, rangées comme le reste", v.fiches.map((f) => [f.company_name, f.sector, f.phone]), [
  ["A Garage", "Cabinet dentaire", "+32 470 11 22 33"],
  ["C Garage", null, "+32 470 55 66 77"],
]);
verifie("modèle : un champ hors liste blanche n'est jamais écrit", v.fiches.some((f) => "owner_id" in f), false);

const { estUnCollage } = await import("./maListe.ts");
verifie("liste ou correction ?", [
  estUnCollage("Garage A 0470 11 22 33", 0),
  estUnCollage("enlève la 3", 5),
  estUnCollage("le secteur c'est kiné", 5),
  estUnCollage("Garage B 0470 11 22 34", 5),
  estUnCollage("Garage B\nGarage C", 5),
  estUnCollage("mets-les toutes à Namur stp", 5),
], [true, false, false, true, true, false]);

serveur.close();
console.log(echecs === 0 ? `\nTous les cas passent (${ok}).` : `\n${echecs} cas en ÉCHEC.`);
process.exit(echecs === 0 ? 0 : 1);
