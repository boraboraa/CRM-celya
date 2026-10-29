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
  HEURES_TACTILES,
  HEURE_DEFAUT,
  maintenantLocal,
  ajouterJours,
  heurePlusTard,
  heureDisponible,
  jourMinimum,
  decalerJour,
  jourSaisi,
  libelleJour,
  heurePourJour,
  choixParDefaut,
  valeurRelance,
  libelleRelance,
  instantRelance,
  relanceAvantRdv,
  rappelAutomatique,
  decisionRappelAuto,
  declencheRappelAuto,
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

console.log("\n— le jour, au « − / + » (28/10 : plus tactile) —");
verifie("d'office : demain à 9h", choixParDefaut(MARDI_10H20), { ymd: "2026-10-28", hm: "09:00" });
verifie("d'office juste après minuit à Bruxelles (encore lundi en UTC) : mercredi 9h",
  choixParDefaut(new Date("2026-10-26T23:30:00Z")), { ymd: "2026-10-28", hm: "09:00" });
verifie("à 10h20, on peut encore relancer aujourd'hui", jourMinimum(MARDI_10H20), "2026-10-27");
verifie("à 17h30, la journée est finie : le premier jour est demain", jourMinimum(MARDI_17H30), "2026-10-28");
verifie("« − » depuis demain à 10h20 : aujourd'hui", decalerJour("2026-10-28", -1, MARDI_10H20), "2026-10-27");
verifie("« − » depuis demain à 17h30 : on reste à demain", decalerJour("2026-10-28", -1, MARDI_17H30), "2026-10-28");
verifie("« − » ne recule jamais avant aujourd'hui", decalerJour("2026-10-27", -5, MARDI_10H20), "2026-10-27");
verifie("« + » traverse le mois", decalerJour("2026-10-31", 2, MARDI_10H20), "2026-11-02");
verifie("« + » passe le dimanche comme un autre jour", decalerJour("2026-10-31", 1, MARDI_10H20), "2026-11-01");
verifie("un jour illisible repart du premier jour", decalerJour("n'importe quoi", 1, MARDI_10H20), "2026-10-28");
verifie("le calendrier : une date à venir passe", jourSaisi("2026-11-14", MARDI_10H20), "2026-11-14");
verifie("le calendrier : une date passée est refusée", jourSaisi("2026-10-20", MARDI_10H20), null);
verifie("le calendrier : aujourd'hui après 17h est refusé", jourSaisi("2026-10-27", MARDI_17H30), null);
verifie("le calendrier : illisible, refusé", jourSaisi("14/11", MARDI_10H20), null);

console.log("\n— ce que dit le jour —");
verifie("aujourd'hui", libelleJour("2026-10-27", MARDI_10H20), { principal: "Aujourd'hui", detail: "mardi 27 oct." });
verifie("demain", libelleJour("2026-10-28", MARDI_10H20), { principal: "Demain", detail: "mercredi 28 oct." });
verifie("après-demain", libelleJour("2026-10-29", MARDI_10H20), { principal: "Après-demain", detail: "jeudi 29 oct." });
verifie("plus loin : le nom du jour et la date", libelleJour("2026-11-02", MARDI_10H20), { principal: "Lundi 2 nov.", detail: null });

console.log("\n— les heures en pastilles —");
verifie("sept pastilles", HEURES_TACTILES.map((h) => h), ["09:00", "10:00", "11:00", "14:00", "15:00", "16:00", "17:00"]);
verifie("un jour à venir : toutes possibles",
  HEURES_TACTILES.map((h) => heureDisponible("2026-10-28", h, MARDI_10H20)), [true, true, true, true, true, true, true]);
verifie("aujourd'hui à 10h20 : 9h et 10h grisées, 11h (à 40 min) possible",
  HEURES_TACTILES.map((h) => heureDisponible("2026-10-27", h, MARDI_10H20)), [false, false, true, true, true, true, true]);
verifie("un jour passé : rien", heureDisponible("2026-10-26", "14:00", MARDI_10H20), false);
verifie("une heure illisible : refusée", heureDisponible("2026-10-28", "25:00", MARDI_10H20), false);
verifie("en passant à aujourd'hui, 9h devient la première heure possible (11h)",
  heurePourJour("2026-10-27", "09:00", MARDI_10H20), "11:00");
verifie("une heure encore possible est gardée", heurePourJour("2026-10-27", "15:00", MARDI_10H20), "15:00");
verifie("à 15h40 il ne reste que 17h", heurePourJour("2026-10-27", "09:00", new Date("2026-10-27T14:40:00Z")), "17:00");
verifie("« plus tard » : l'heure pleine après maintenant + 1 h", heurePlusTard(MARDI_15H10), "17:00");
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

console.log("\n— le rappel automatique après « Pas décroché » / « Barrage » (29/10) —");
verifie("seuls « Pas décroché » et « Barrage » le déclenchent",
  ["sans_reponse", "barrage", "rappeler", "interesse", "suivi_email", "refus", null].map(declencheRappelAuto),
  [true, true, false, false, false, false, false]);
verifie("appelé mardi matin (10h20) → mercredi 14h", rappelAutomatique(MARDI_10H20), "2026-10-28T14:00");
verifie("appelé mardi après-midi (15h10) → mercredi 10h", rappelAutomatique(MARDI_15H10), "2026-10-28T10:00");
verifie("13h pile, c'est l'après-midi → lendemain 10h",
  rappelAutomatique(new Date("2026-10-27T12:00:00Z")), "2026-10-28T10:00");
verifie("appelé vendredi matin → lundi 14h (jamais le week-end)",
  rappelAutomatique(new Date("2026-10-30T10:00:00Z")), "2026-11-02T14:00");
verifie("appelé mardi 10/11 l'après-midi → jeudi 12/11 10h (le 11 novembre est férié)",
  rappelAutomatique(new Date("2026-11-10T15:00:00Z")), "2026-11-12T10:00");
verifie("heure d'été : vendredi 23/10 à 10h → lundi 26/10 14h", rappelAutomatique(VENDREDI_ETE), "2026-10-26T14:00");

const base = { outcome: "sans_reponse", dateHumaine: false, statut: "a_appeler", rdvAVenir: false, relancesOuvertes: [] as string[], now: MARDI_10H20 };
verifie("fiche sans relance : rappel posé", decisionRappelAuto(base), { poser: "2026-10-28T14:00" });
verifie("« Barrage » : pareil", decisionRappelAuto({ ...base, outcome: "barrage" }), { poser: "2026-10-28T14:00" });
verifie("relance d'aujourd'hui (9h, en cours) : re-datée",
  decisionRappelAuto({ ...base, relancesOuvertes: ["2026-10-27T08:00:00Z"] }), { poser: "2026-10-28T14:00" });
verifie("relance en retard (lundi) : re-datée",
  decisionRappelAuto({ ...base, relancesOuvertes: ["2026-10-26T08:00:00Z"] }), { poser: "2026-10-28T14:00" });
verifie("relance déjà prévue jeudi : on n'y touche pas",
  decisionRappelAuto({ ...base, relancesOuvertes: ["2026-10-29T08:00:00Z"] }), { poser: null, raison: "relance_prevue" });
verifie("une date dite par l'humain (« rappeler jeudi ») : elle gagne",
  decisionRappelAuto({ ...base, dateHumaine: true }), { poser: null, raison: "date_humaine" });
verifie("un RDV à venir : rien d'automatique (024)",
  decisionRappelAuto({ ...base, rdvAVenir: true }), { poser: null, raison: "rdv_a_venir" });
verifie("fiche perdue ou gagnée : rien",
  ["perdu", "gagne"].map((statut) => decisionRappelAuto({ ...base, statut }).poser), [null, null]);
verifie("un autre résultat : rien",
  decisionRappelAuto({ ...base, outcome: "interesse" }), { poser: null, raison: "pas_concerne" });

if (fautes > 0) {
  console.log(`\n${fautes} cas en échec.`);
  process.exit(1);
}
console.log("\nTous les cas passent.");
