/**
 * Dater une relance avec l'heure — sans réseau ni base :
 *
 *   node --experimental-strip-types lib/crm/relance.test.ts
 *
 * (script npm : `npm run test:relance`). Tout en heure de BRUXELLES : l'heure
 * d'été (UTC+2) et l'heure d'hiver (UTC+1), le passage du 25 octobre 2026, la
 * veille de minuit, l'après-17h, et la relance posée avant un rendez-vous.
 */

import {
  JOURS_RELANCE,
  HEURES_RELANCE,
  HEURE_DEFAUT,
  maintenantLocal,
  ajouterJours,
  joursProposes,
  dateDuChoix,
  heuresProposees,
  heureParDefaut,
  heurePlusTard,
  valeurRelance,
  libelleRelance,
  instantRelance,
  relanceAvantRdv,
  estJourRelance,
} from "./relance.ts";

let fautes = 0;
function verifie(nom: string, obtenu: unknown, attendu: unknown) {
  const ok = JSON.stringify(obtenu) === JSON.stringify(attendu);
  if (!ok) fautes++;
  console.log(`${ok ? "✓" : "✗"} ${nom}${ok ? "" : ` — obtenu ${JSON.stringify(obtenu)}, attendu ${JSON.stringify(attendu)}`}`);
}

// Mardi 27/10/2026 à 10h20 à Bruxelles (heure d'hiver : UTC+1).
const MARDI_10H20 = new Date("2026-10-27T09:20:00Z");
// Mardi 27/10/2026 à 17h30.
const MARDI_17H30 = new Date("2026-10-27T16:30:00Z");
// Mardi 27/10/2026 à 15h10.
const MARDI_15H10 = new Date("2026-10-27T14:10:00Z");
// Vendredi 23/10/2026 à 10h00 (heure d'été : UTC+2).
const VENDREDI_ETE = new Date("2026-10-23T08:00:00Z");

console.log("— le jour et l'heure de Bruxelles —");
verifie("hiver : 09:20 UTC = 10h20 à Bruxelles", maintenantLocal(MARDI_10H20), { ymd: "2026-10-27", hm: "10:20" });
verifie("été : 08:00 UTC = 10h00 à Bruxelles", maintenantLocal(VENDREDI_ETE), { ymd: "2026-10-23", hm: "10:00" });
verifie("23h30 UTC le lundi 26/10 = mardi 0h30 à Bruxelles",
  maintenantLocal(new Date("2026-10-26T23:30:00Z")), { ymd: "2026-10-27", hm: "00:30" });
verifie("ajouterJours traverse le mois", ajouterJours("2026-10-30", 3), "2026-11-02");

console.log("\n— les jours proposés —");
verifie("six jours, dans cet ordre",
  JOURS_RELANCE.map((j) => j.label),
  ["Plus tard aujourd'hui", "Demain", "Dans 2 jours", "Dans 3 jours", "Dans 1 semaine", "Autre date…"]);
verifie("à 10h20 : « Plus tard aujourd'hui » est proposé", joursProposes(MARDI_10H20)[0].id, "aujourdhui");
verifie("après 17h : il disparaît, c'est « Demain » qu'on propose",
  joursProposes(MARDI_17H30).map((j) => j.id), ["demain", "2j", "3j", "1sem", "autre"]);
verifie("demain, dans 2 jours, dans 1 semaine",
  [dateDuChoix("demain", MARDI_10H20), dateDuChoix("2j", MARDI_10H20), dateDuChoix("1sem", MARDI_10H20)],
  ["2026-10-28", "2026-10-29", "2026-11-03"]);
verifie("« demain » juste après minuit à Bruxelles (encore lundi en UTC) : mercredi",
  dateDuChoix("demain", new Date("2026-10-26T23:30:00Z")), "2026-10-28");
verifie("autre date : la date saisie", dateDuChoix("autre", MARDI_10H20, "2026-11-14"), "2026-11-14");
verifie("autre date dans le passé : refusée", dateDuChoix("autre", MARDI_10H20, "2026-10-20"), null);
verifie("autre date illisible : refusée", dateDuChoix("autre", MARDI_10H20, "14/11"), null);
verifie("estJourRelance : les six, rien d'autre",
  ["aujourdhui", "demain", "2j", "3j", "1sem", "autre", "constructor", ""].map(estJourRelance),
  [true, true, true, true, true, true, false, false]);

console.log("\n— les heures —");
verifie("un jour à venir : 9h · 11h · 14h · 16h", heuresProposees("2026-10-28", MARDI_10H20), [...HEURES_RELANCE]);
verifie("aujourd'hui à 10h20 : seulement les heures à venir (11h est à 40 min)",
  heuresProposees("2026-10-27", MARDI_10H20), ["11:00", "14:00", "16:00"]);
verifie("aujourd'hui à 15h10 : 16h (à 50 min)", heuresProposees("2026-10-27", MARDI_15H10), ["16:00"]);
verifie("aujourd'hui à 15h40 : plus rien dans la liste → l'heure « plus tard » (17h)",
  heuresProposees("2026-10-27", new Date("2026-10-27T14:40:00Z")), ["17:00"]);
verifie("« plus tard » : l'heure pleine après maintenant + 1 h", heurePlusTard(MARDI_15H10), "17:00");
verifie("sans heure choisie, un autre jour : 9h", heureParDefaut("2026-10-28", MARDI_10H20), "09:00");
verifie("sans heure choisie, aujourd'hui : la première heure à venir", heureParDefaut("2026-10-27", MARDI_10H20), "11:00");
verifie("la valeur sans heure : 9h", valeurRelance("2026-10-28"), "2026-10-28T09:00");
verifie("la valeur avec une heure invalide : 9h", valeurRelance("2026-10-28", "25:00"), `2026-10-28T${HEURE_DEFAUT}`);
verifie("la valeur avec l'heure", valeurRelance("2026-10-28", "14:00"), "2026-10-28T14:00");

console.log("\n— ce qui part au serveur (UTC) —");
verifie("hiver : mercredi 28/10 à 9h = 08:00 UTC",
  instantRelance("2026-10-28T09:00"), "2026-10-28T08:00:00.000Z");
verifie("été : vendredi 23/10 à 9h = 07:00 UTC",
  instantRelance("2026-10-23T09:00"), "2026-10-23T07:00:00.000Z");
verifie("le jour du changement d'heure (25/10, 14h) : UTC+1",
  instantRelance("2026-10-25T14:00"), "2026-10-25T13:00:00.000Z");

console.log("\n— ce que dit le bouton —");
verifie("aujourd'hui à 16h", libelleRelance("2026-10-27T16:00", MARDI_10H20), "aujourd'hui à 16h");
verifie("demain à 9h", libelleRelance("2026-10-28T09:00", MARDI_10H20), "demain à 9h");
verifie("jeu. 05/11 à 14h30", libelleRelance("2026-11-05T14:30", MARDI_10H20), "jeu. 05/11 à 14h30");

console.log("\n— avant un rendez-vous à venir (024 : on informe, on ne bloque pas) —");
const RDV_JEUDI_12H = "2026-10-29T11:00:00Z"; // jeudi 29/10 à 12h
verifie("une relance mercredi à 9h tombe AVANT le RDV de jeudi : signalée",
  relanceAvantRdv("2026-10-28T09:00", RDV_JEUDI_12H), true);
verifie("une relance vendredi tombe après : rien à signaler",
  relanceAvantRdv("2026-10-30T09:00", RDV_JEUDI_12H), false);
verifie("jeudi à 11h, une heure avant le RDV : signalée",
  relanceAvantRdv("2026-10-29T11:00", RDV_JEUDI_12H), true);
verifie("sans RDV : rien", relanceAvantRdv("2026-10-28T09:00", null), false);

if (fautes > 0) {
  console.log(`\n${fautes} cas en échec.`);
  process.exit(1);
}
console.log("\nTous les cas passent.");
