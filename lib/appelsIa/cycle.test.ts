/**
 * Le cycle d'appels — chaque ligne du tableau de la phase 1, le week-end, les
 * fériés, les deux machines, le standard, les humains :
 *
 *   node --experimental-strip-types lib/appelsIa/cycle.test.ts
 */

import { instantBruxelles, jourHeureFr } from "./calendrier.ts";
import { creneauEssai, jourDeRelance, prochainEssai, suiteDuCycle, type EntreeCycle } from "./cycle.ts";
import { verifie, bilan } from "./verifie.ts";

const at = (ymd: string, hhmm: string) => {
  const [h, m] = hhmm.split(":").map(Number);
  return instantBruxelles(ymd, h * 60 + m);
};
const fr = (d: Date) => jourHeureFr(d);

// ---------------------------------------------------------------- le tableau de la phase 1
// Essai 1 → essai 2 (16h–17h, ≥ 3 h après) → essai 3 (17h–17h30, autre jour) → relance.
const tableau: [string, string, string, string, string][] = [
  ["2026-10-07", "10:00", "mercredi 7 octobre à 16h", "jeudi 8 octobre à 17h", "2026-10-09"],
  ["2026-10-07", "13:30", "mercredi 7 octobre à 16h30", "jeudi 8 octobre à 17h", "2026-10-09"],
  ["2026-10-07", "15:00", "jeudi 8 octobre à 16h", "vendredi 9 octobre à 17h", "2026-10-12"],
  ["2026-10-09", "16:30", "lundi 12 octobre à 16h", "mardi 13 octobre à 17h", "2026-10-14"],
  ["2026-10-05", "09:30", "lundi 5 octobre à 16h", "mardi 6 octobre à 17h", "2026-10-07"],
];
for (const [jour, heure, e2, e3, relance] of tableau) {
  const fin1 = at(jour, heure);
  const d2 = prochainEssai(2, fin1);
  verifie(`essai 1 ${fr(fin1)} → essai 2`, fr(d2), e2);
  const d3 = prochainEssai(3, d2);
  verifie(`essai 2 ${fr(d2)} → essai 3`, fr(d3), e3);
  const fin = suiteDuCycle(base({ essai: 3, finEssai: d3 }));
  verifie(`essai 3 ${fr(d3)} sans réponse → relance`, fin.type === "fin" ? fin.relance?.jour : null, relance);
}

verifie("essai 2 fini à 16h40 → essai 3 le lendemain 17h", fr(prochainEssai(3, at("2026-10-07", "16:40"))), "jeudi 8 octobre à 17h");
verifie("essai 1 un vendredi à 17h15 → essai 2 lundi 16h", fr(prochainEssai(2, at("2026-10-09", "17:15"))), "lundi 12 octobre à 16h");
verifie("essai 1 le mardi 10/11 à 15h → essai 2 jeudi 12/11 16h (le 11 est férié)", fr(prochainEssai(2, at("2026-11-10", "15:00"))), "jeudi 12 novembre à 16h");
verifie("essai 2 le jeudi 24/12 à 16h → essai 3 lundi 28/12 17h (Noël vendredi)", fr(prochainEssai(3, at("2026-12-24", "16:00"))), "lundi 28 décembre à 17h");
verifie("créneau de l'essai 2, fenêtre 9h30–17h30", creneauEssai(2), [960, 1020]);
verifie("créneau de l'essai 3, fenêtre 9h30–17h30", creneauEssai(3), [1020, 1050]);
verifie("fenêtre 9h–15h : essai 2 dans la dernière heure", creneauEssai(2, { debut: "09:00", fin: "15:00" }), [840, 900]);

// ---------------------------------------------------------------- la suite, cas par cas
function base(p: Partial<EntreeCycle>): EntreeCycle {
  return {
    classement: "sans_reponse",
    resultat: "sans_reponse",
    essai: 1,
    finEssai: at("2026-10-07", "10:00"),
    machinesAnterieures: [],
    dejaHumain: false,
    campagneStatut: "active",
    opposition: false,
    rdvAVenir: false,
    rappelerLe: null,
    resume: null,
    ...p,
  };
}

const s1 = suiteDuCycle(base({}));
verifie("pas de réponse à l'essai 1 → nouvel essai", s1.type === "nouvel_essai" ? [s1.essai, fr(s1.pasAvant)] : s1, [2, "mercredi 7 octobre à 16h"]);

const occ = suiteDuCycle(base({ classement: "occupe_echec" }));
verifie("occupé à l'essai 1 → nouvel essai", occ.type, "nouvel_essai");

const rep1 = suiteDuCycle(base({ classement: "repondeur" }));
verifie("un seul répondeur → nouvel essai", rep1.type, "nouvel_essai");

const rep2 = suiteDuCycle(
  base({
    classement: "repondeur",
    essai: 2,
    finEssai: at("2026-10-07", "16:00"),
    machinesAnterieures: [{ classement: "repondeur", at: at("2026-10-07", "10:00") }],
  })
);
verifie(
  "répondeur à 10h puis à 16h → stop, « deux répondeurs », relance le lendemain ouvré",
  rep2.type === "fin" ? [rep2.motif, rep2.relance?.jour, rep2.relance?.minutes, rep2.relance?.titre] : rep2,
  ["deux réponses de machine à deux heures différentes", "2026-10-08", 540, "Janet : deux répondeurs (10h, 16h), à contacter autrement"]
);

const rep2memeHeure = suiteDuCycle(
  base({
    classement: "repondeur",
    essai: 2,
    finEssai: at("2026-10-08", "10:40"),
    machinesAnterieures: [{ classement: "repondeur", at: at("2026-10-07", "10:05") }],
  })
);
verifie("deux répondeurs à la MÊME heure → on continue (la règle exige deux heures)", rep2memeHeure.type, "nouvel_essai");

const rep2humain = suiteDuCycle(
  base({
    classement: "repondeur",
    essai: 2,
    finEssai: at("2026-10-07", "16:00"),
    machinesAnterieures: [{ classement: "repondeur", at: at("2026-10-07", "10:00") }],
    dejaHumain: true,
  })
);
verifie("deux répondeurs mais un humain a déjà décroché → on continue", rep2humain.type, "nouvel_essai");

const std = suiteDuCycle(base({ classement: "standard_ivr", resultat: "barrage" }));
verifie(
  "standard automatique → stop immédiat, relance le lendemain ouvré",
  std.type === "fin" ? [std.motif, std.relance?.jour, std.relance?.titre] : std,
  ["standard automatique", "2026-10-08", "Janet : standard automatique, à contacter autrement"]
);

const trois = suiteDuCycle(base({ essai: 3, finEssai: at("2026-10-09", "17:00") }));
verifie(
  "3 essais sans réponse, le vendredi → relance le lundi 9h",
  trois.type === "fin" ? [trois.motif, trois.relance?.jour, trois.relance?.minutes, trois.relance?.titre] : trois,
  ["3 essais sans joindre personne", "2026-10-12", 540, "Janet : 3 essais sans réponse. À vous de voir"]
);

const orphelin = suiteDuCycle(base({ campagneStatut: "terminee" }));
verifie("campagne terminée → aucun nouvel essai (pas de relance orpheline)", orphelin.type === "fin" ? [orphelin.motif, orphelin.relance] : orphelin, ["campagne terminée", null]);

const pause = suiteDuCycle(base({ campagneStatut: "pause" }));
verifie("campagne en pause → le nouvel essai est programmé (il attendra)", pause.type, "nouvel_essai");

const opp = suiteDuCycle(base({ classement: "repondu_humain", resultat: "refus", opposition: true }));
verifie("opposition → fin, aucune relance", opp.type === "fin" ? [opp.motif, opp.relance] : opp, ["opposition : ne plus appeler", null]);

const refus = suiteDuCycle(base({ classement: "repondu_humain", resultat: "refus" }));
verifie("refus → fin, aucune relance", refus.type === "fin" ? refus.relance : refus, null);

const rdv = suiteDuCycle(base({ classement: "repondu_humain", resultat: "interesse", rdvAVenir: true }));
verifie("intéressé AVEC rendez-vous → fin, aucune relance (le RDV est la prochaine action)", rdv.type === "fin" ? [rdv.motif, rdv.relance] : rdv, ["rendez-vous posé", null]);

const interesse = suiteDuCycle(base({ classement: "repondu_humain", resultat: "interesse", resume: "Veut voir la démo après les vacances" }));
verifie(
  "intéressé SANS rendez-vous → relance le lendemain ouvré à 9h",
  interesse.type === "fin" ? [interesse.relance?.jour, interesse.relance?.minutes, interesse.relance?.titre] : interesse,
  ["2026-10-08", 540, "Janet : intéressé, sans rendez-vous — Veut voir la démo après les vacances"]
);

const rappeler = suiteDuCycle(base({ classement: "repondu_humain", resultat: "rappeler", rappelerLe: "2026-10-20", resume: "Le gérant est là le mardi" }));
verifie(
  "« rappelez-moi le 20 » → relance le 20 à 9h",
  rappeler.type === "fin" ? [rappeler.relance?.jour, rappeler.relance?.titre] : rappeler,
  ["2026-10-20", "Janet : à rappeler — Le gérant est là le mardi"]
);

const rappelerPasse = suiteDuCycle(base({ classement: "repondu_humain", resultat: "rappeler", rappelerLe: "2026-10-01" }));
verifie("date de rappel dans le passé → lendemain ouvré, jamais dans le passé", rappelerPasse.type === "fin" ? rappelerPasse.relance?.jour : rappelerPasse, "2026-10-08");

const barrage = suiteDuCycle(base({ classement: "repondu_humain", resultat: "barrage", resume: "Secrétaire : envoyer un mail" }));
verifie("barrage humain → relance le lendemain ouvré", barrage.type === "fin" ? barrage.relance?.titre : barrage, "Janet : barrage — Secrétaire : envoyer un mail");

verifie("jourDeRelance : aujourd'hui avant 9h → aujourd'hui", jourDeRelance("2026-10-08", at("2026-10-08", "08:00")), "2026-10-08");
verifie("jourDeRelance : aujourd'hui après 9h → lendemain ouvré", jourDeRelance("2026-10-08", at("2026-10-08", "11:00")), "2026-10-09");
verifie("jourDeRelance : date illisible → lendemain ouvré", jourDeRelance("bientôt", at("2026-10-08", "11:00")), "2026-10-09");

bilan("Cycle");
