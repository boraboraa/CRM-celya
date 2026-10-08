/**
 * Numéros, calendrier, gardes générales du moteur — sans réseau ni base :
 *
 *   node --experimental-strip-types lib/appelsIa/regles.test.ts
 *
 * Les cas de numéros sont ceux de numeros.cas.json : la recette SQL de la 025
 * joue EXACTEMENT les mêmes contre `public.appels_ia_numero`.
 */

import { readFileSync } from "node:fs";
import { numeroAppelable, numeroLisible } from "./numeros.ts";
import {
  dansFenetre,
  estOuvre,
  ferieDe,
  instantBruxelles,
  lendemainOuvre,
  partiesBruxelles,
  prochaineOuverture,
  jourHeureFr,
} from "./calendrier.ts";
import { refusMoteur, type ReglagesMoteur } from "./regles.ts";
import { verifie, vrai, bilan } from "./verifie.ts";

// ---------------------------------------------------------------- numéros
const { cas } = JSON.parse(readFileSync(new URL("./numeros.cas.json", import.meta.url), "utf8")) as {
  cas: [string | null, string | null, string][];
};
for (const [saisie, attendu, pourquoi] of cas) {
  verifie(`numéro « ${saisie} » — ${pourquoi}`, numeroAppelable(saisie), attendu);
}
verifie("lisible : fixe namurois", numeroLisible("+3281223344"), "081 22 33 44");
verifie("lisible : fixe liégeois", numeroLisible("+3242223344"), "04 222 33 44");
verifie("lisible : mobile", numeroLisible("+32470123456"), "0470 12 34 56");

// ---------------------------------------------------------------- calendrier
verifie("8 octobre 2026 est un jeudi", partiesBruxelles(new Date("2026-10-08T08:00:00Z")).jourSemaine, 4);
verifie("10h à Bruxelles en octobre = 08:00 UTC (heure d'été)", instantBruxelles("2026-10-08", 600).toISOString(), "2026-10-08T08:00:00.000Z");
verifie("10h à Bruxelles en novembre = 09:00 UTC (heure d'hiver)", instantBruxelles("2026-11-03", 600).toISOString(), "2026-11-03T09:00:00.000Z");
verifie("passage à l'heure d'hiver : 25/10 10h = 09:00 UTC", instantBruxelles("2026-10-25", 600).toISOString(), "2026-10-25T09:00:00.000Z");
verifie("Toussaint 2026", ferieDe("2026-11-01"), "Toussaint");
verifie("Armistice 2026 (mercredi)", ferieDe("2026-11-11"), "Armistice");
verifie("Noël 2026", ferieDe("2026-12-25"), "Noël");
verifie("lundi de Pâques 2026 (6 avril)", ferieDe("2026-04-06"), "lundi de Pâques");
verifie("Ascension 2026 (14 mai)", ferieDe("2026-05-14"), "Ascension");
verifie("lundi de Pentecôte 2026 (25 mai)", ferieDe("2026-05-25"), "lundi de Pentecôte");
verifie("lundi de Pâques 2027 (29 mars)", ferieDe("2027-03-29"), "lundi de Pâques");
verifie("fête nationale", ferieDe("2027-07-21"), "fête nationale");
vrai("le mercredi 11/11 n'est pas ouvré", !estOuvre("2026-11-11"));
vrai("le samedi 10/10 n'est pas ouvré", !estOuvre("2026-10-10"));
vrai("le jeudi 08/10 est ouvré", estOuvre("2026-10-08"));

const at = (ymd: string, hhmm: string) => {
  const [h, m] = hhmm.split(":").map(Number);
  return instantBruxelles(ymd, h * 60 + m);
};
vrai("jeudi 9h29 : hors fenêtre", !dansFenetre(at("2026-10-08", "09:29")));
vrai("jeudi 9h30 : dans la fenêtre", dansFenetre(at("2026-10-08", "09:30")));
vrai("jeudi 17h29 : dans la fenêtre", dansFenetre(at("2026-10-08", "17:29")));
vrai("jeudi 17h30 : hors fenêtre", !dansFenetre(at("2026-10-08", "17:30")));
vrai("samedi 11h : hors fenêtre", !dansFenetre(at("2026-10-10", "11:00")));
vrai("11 novembre 11h : hors fenêtre (férié)", !dansFenetre(at("2026-11-11", "11:00")));
verifie("vendredi 18h → reprise lundi 9h30", jourHeureFr(prochaineOuverture(at("2026-10-09", "18:00"))), "lundi 12 octobre à 9h30");
verifie("mardi 10/11 18h → reprise jeudi 12/11 (le 11 est férié)", jourHeureFr(prochaineOuverture(at("2026-11-10", "18:00"))), "jeudi 12 novembre à 9h30");
verifie("jeudi 7h → reprise le jour même à 9h30", jourHeureFr(prochaineOuverture(at("2026-10-08", "07:00"))), "jeudi 8 octobre à 9h30");
verifie("lendemain ouvré d'un vendredi = lundi", lendemainOuvre(at("2026-10-09", "16:00")), "2026-10-12");
verifie("lendemain ouvré du 10/11 = 12/11", lendemainOuvre(at("2026-11-10", "10:00")), "2026-11-12");
verifie("lendemain ouvré du 24/12/2026 = 28/12 (Noël vendredi)", lendemainOuvre(at("2026-12-24", "10:00")), "2026-12-28");

// ---------------------------------------------------------------- gardes du moteur
const R: ReglagesMoteur = {
  actif: true,
  mode_test: false,
  gsm_test: "+32470000000",
  numero_appelant: "+32480000000",
  fenetre_debut: "09:30:00",
  fenetre_fin: "17:30:00",
  plafond_heure: 8,
  plafond_jour: 40,
  pause_cause: null,
};
const jeudi10h = at("2026-10-08", "10:00");
const zero = { derniereHeure: 0, aujourdhui: 0 };
verifie("tout est réglé, jeudi 10h : on compose", refusMoteur(R, jeudi10h, zero), null);
verifie("interrupteur coupé", refusMoteur({ ...R, actif: false }, jeudi10h, zero), "L'interrupteur général est coupé.");
verifie("numéro appelant vide : refus, et il le dit", refusMoteur({ ...R, numero_appelant: null }, jeudi10h, zero), "Le numéro appelant n'est pas réglé : le moteur refuse de composer.");
verifie("en pause : la cause est dite", refusMoteur({ ...R, pause_cause: "OpenAI refuse la clé API (401)." }, jeudi10h, zero), "Moteur en pause : OpenAI refuse la clé API (401).");
verifie("mode test sans GSM", refusMoteur({ ...R, mode_test: true, gsm_test: null }, jeudi10h, zero), "Mode test : le GSM de test n'est pas réglé.");
verifie("samedi : hors fenêtre, reprise lundi", refusMoteur(R, at("2026-10-10", "11:00"), zero), "Hors de la fenêtre d'appel — reprise lundi 12 octobre à 9h30.");
verifie("plafond du jour", refusMoteur(R, jeudi10h, { derniereHeure: 0, aujourdhui: 40 }), "Plafond du jour atteint (40 appels).");
verifie("plafond de l'heure", refusMoteur(R, jeudi10h, { derniereHeure: 8, aujourdhui: 12 }), "Plafond de l'heure atteint (8 appels).");
verifie("appel de test : ignore l'interrupteur et la fenêtre", refusMoteur({ ...R, actif: false }, at("2026-10-10", "11:00"), zero, { test: true }), null);
verifie("appel de test : jamais sans numéro appelant", refusMoteur({ ...R, numero_appelant: null }, jeudi10h, zero, { test: true }), "Le numéro appelant n'est pas réglé : le moteur refuse de composer.");
verifie("appel de test : jamais au-delà du plafond", refusMoteur(R, jeudi10h, { derniereHeure: 8, aujourdhui: 8 }, { test: true }), "Plafond de l'heure atteint (8 appels).");

bilan("Règles (numéros, calendrier, moteur)");
