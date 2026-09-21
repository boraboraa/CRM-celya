/**
 * La zone « Aujourd'hui » du tableau de bord, sans réseau ni base :
 *
 *   node --experimental-strip-types lib/crm/agendaJour.test.ts
 *
 * (script npm : `npm run test:agenda`). Même style que lib/crm/maps.test.ts.
 *
 * Les cas marqués « réel » sont la ligne EXACTE lue en base le 21/09/2026 :
 * « Rdv Ephec », `kind='perso'`, `prospect_id` NULL, `location` NULL, 12:45–
 * 14:45 UTC. C'est le premier rendez-vous personnel jamais affiché par ce bloc
 * — jusque-là il n'avait vu qu'un rendez-vous de test, rattaché à une fiche et
 * pourvu d'un lieu. Une branche qu'aucun test ne parcourt n'est pas une branche
 * sûre, c'est une branche dont on ignore l'état.
 *
 * Ce test ne visait PAS juste : le crash du 21/09 venait d'ailleurs (une prop
 * fonction franchissant la frontière serveur → client, voir
 * lib/rsc-frontiere.test.ts). Le bloc encaissait déjà ce rendez-vous. Il est
 * gardé parce qu'une branche non testée reste une branche non testée.
 */

import {
  ligneAgendaJour,
  heureBruxelles,
  type FicheDuRendezVous,
} from "./agendaJour.ts";

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

const AUCUNE = new Map<string, FicheDuRendezVous>();

// --- L'heure : stockée en UTC, lue à Bruxelles ------------------------------
console.log("— l'heure —");

// Le 21 septembre, Bruxelles est à UTC+2 (heure d'été).
verifie("12:45 UTC → 14:45 à Bruxelles", heureBruxelles("2026-09-21T12:45:00Z"), "14:45");
verifie("minuit UTC → 02:00", heureBruxelles("2026-09-21T00:00:00Z"), "02:00");
// … et en janvier à UTC+1, pour que le décalage ne soit pas codé en dur.
verifie("hiver : 12:45 UTC → 13:45", heureBruxelles("2026-01-21T12:45:00Z"), "13:45");

// --- RÉEL : le rendez-vous PERSO, sans prospect ni lieu ---------------------
console.log("\n— le rendez-vous perso (réel, 21/09/2026) —");

const ephec = ligneAgendaJour(
  {
    id: "m-ephec",
    prospect_id: null,
    title: "Rdv Ephec",
    starts_at: "2026-09-21T12:45:00Z",
    ends_at: "2026-09-21T14:45:00Z",
    location: null,
  },
  AUCUNE
);

verifie("il s'affiche, en entier — c'est le nôtre", ephec.titre, "Rdv Ephec");
verifie("son créneau se lit à Bruxelles", ephec.creneau, "14:45–16:45");
verifie("aucun lien de fiche : il n'y en a pas", ephec.lienFiche, null);
verifie(
  "ni contact, ni téléphone, ni lien d'appel",
  [ephec.contact, ephec.telephone, ephec.telHref],
  [null, null, null]
);
verifie(
  "aucun lieu : pas de bouton Maps, et surtout pas un bouton vide",
  [ephec.lieu, ephec.ville],
  [null, null]
);

// --- Le cas nominal : un rendez-vous chez un prospect -----------------------
console.log("\n— le rendez-vous chez un prospect —");

const FICHES = new Map<string, FicheDuRendezVous>([
  [
    "p-1",
    {
      id: "p-1",
      company_name: "Garage Boetendael",
      contact_name: "Sébastien",
      phone: "+32 2 345 67 89",
      city: "Uccle",
    },
  ],
]);

const chezLui = ligneAgendaJour(
  {
    id: "m-1",
    prospect_id: "p-1",
    title: "RDV Garage Boetendael",
    starts_at: "2026-09-21T08:00:00Z",
    ends_at: "2026-09-21T09:00:00Z",
    location: "Rue Xavier de Bue 12",
  },
  FICHES
);

verifie("la fiche s'ouvre d'un clic", chezLui.lienFiche, "/prospects/p-1");
verifie("le contact se lit", chezLui.contact, "Sébastien");
verifie(
  "le numéro se compose, espaces retirés",
  [chezLui.telephone, chezLui.telHref],
  ["+32 2 345 67 89", "tel:+3223456789"]
);
verifie(
  "le lieu part en bouton, la ville désambiguïse",
  [chezLui.lieu, chezLui.ville],
  ["Rue Xavier de Bue 12", "Uccle"]
);

// --- Les entre-deux, qui sont ceux qui cassent ------------------------------
console.log("\n— les entre-deux —");

// Une fiche rattachée mais ABSENTE de la requête groupée (supprimée, ou hors
// portée) : on ne fabrique pas un lien mort.
const orphelin = ligneAgendaJour(
  {
    id: "m-2",
    prospect_id: "p-disparu",
    title: "RDV fiche disparue",
    starts_at: "2026-09-21T08:00:00Z",
    ends_at: "2026-09-21T09:00:00Z",
    location: null,
  },
  FICHES
);
verifie("fiche introuvable : aucun lien mort", orphelin.lienFiche, null);
verifie("… et le titre reste affiché", orphelin.titre, "RDV fiche disparue");

// Un rendez-vous PROSPECT sans lieu, chez une fiche sans téléphone : chaque
// morceau manque indépendamment, aucun ne doit en entraîner un autre.
const partiel = ligneAgendaJour(
  {
    id: "m-3",
    prospect_id: "p-2",
    title: "Visio",
    starts_at: "2026-09-21T08:00:00Z",
    ends_at: "2026-09-21T09:00:00Z",
    location: null,
  },
  new Map([
    [
      "p-2",
      {
        id: "p-2",
        company_name: "Sans Téléphone SPRL",
        contact_name: null,
        phone: null,
        city: null,
      },
    ],
  ])
);
verifie(
  "le lien reste, le reste s'efface proprement",
  [partiel.lienFiche, partiel.contact, partiel.telHref, partiel.lieu],
  ["/prospects/p-2", null, null, null]
);

// Une chaîne vide n'est pas une valeur : « Occupé » sans lieu, un contact vidé
// par une saisie — rien ne doit s'afficher.
const vide = ligneAgendaJour(
  {
    id: "m-4",
    prospect_id: "p-3",
    title: "Occupé",
    starts_at: "2026-09-21T08:00:00Z",
    ends_at: "2026-09-21T09:00:00Z",
    location: "",
  },
  new Map([
    [
      "p-3",
      { id: "p-3", company_name: "X", contact_name: "", phone: "", city: "" },
    ],
  ])
);
verifie(
  "chaîne vide = rien, jamais un bouton ou un lien vides",
  [vide.lieu, vide.contact, vide.telephone, vide.telHref, vide.ville],
  [null, null, null, null, null]
);

console.log(
  echecs === 0 ? "\nTous les cas passent." : `\n${echecs} cas en ÉCHEC.`
);
process.exit(echecs === 0 ? 0 : 1);
