/**
 * La prochaine action d'une fiche — ce que l'écran DIT, sans réseau ni base :
 *
 *   node --experimental-strip-types lib/crm/prochaineAction.test.ts
 *
 * (script npm : `npm run test:prochaine-action`). Même style que
 * lib/crm/agendaJour.test.ts.
 *
 * La RÈGLE vit en SQL (migration 022 : triggers sur tasks et meetings) et se
 * teste par la recette SQL de la 022, en transaction annulée : poser ou
 * déplacer un RDV CLÔTURE les relances ouvertes qui tombent avant lui. Ici on
 * teste le côté LECTURE : pour chaque état de base que les triggers
 * produisent, ce que la fiche, la liste, les colonnes et le tableau de bord
 * affichent. Cas nommés pareil des deux côtés.
 *
 * La fiche de référence est celle d'Alain docteur, lue en base le 22/09 :
 * RDV le 28/09 à 10:00 UTC (12h à Bruxelles), relance au 25/09 07:00 UTC.
 *
 * Migration 023 (section 9) : une fiche gagnée ou perdue ne réclame jamais
 * rien — seuls ses RDV à venir et ses relances ouvertes comptent. Mêmes cas
 * que supabase/recettes/023_corps.sql.
 *
 * Migration 024 (sections 2, 8 et 10) : tant qu'une fiche a un rendez-vous
 * vivant, c'est LUI la prochaine action — TOUJOURS. L'ancienne exception
 * (« confirmer la veille » passait devant) est retirée ; une relance datée
 * avant le RDV reste une tâche. Mêmes cas que supabase/recettes/024_corps.sql.
 */

import { deriveNextAction, type OpenTask, type NextMeeting } from "./nextAction.ts";
import {
  ficheClose,
  infoRdvPrevu,
  jourAgenda,
  jourHeureCourt,
  jourLong,
  libelleRdv,
  libelleRdvListe,
  lienAgenda,
  lireProchaineAction,
  refusRelanceAvantRdv,
  phraseAnnulees,
  plusRienDePrevu,
  rdvClos,
  rdvQuiCompte,
  rdvVivant,
  PLUS_RIEN,
} from "./prochaineAction.ts";

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

const T = (iso: string) => new Date(iso).getTime();

type Rdv = NextMeeting & { status: string };
type Tache = OpenTask;

const RDV_ALAIN: Rdv = {
  id: "m-alain",
  title: "RDV avec Alain docteur",
  starts_at: "2026-09-28T10:00:00Z",
  ends_at: "2026-09-28T11:00:00Z",
  location: "Square Edmond Machtens 2, 1080 Molenbeek",
  status: "prevu",
};

function tache(id: string, due: string, title = "Relancer Alain docteur"): Tache {
  return { id, title, due_at: due, priority: 2, prospect_id: "p-alain" };
}

/**
 * Ce que la fiche affiche : le même chemin que app/(app)/prospects/[id] —
 * étape de la fiche comprise (023).
 */
function fiche(taches: Tache[], rdvs: Rdv[], now: number, statut: string = "rendez_vous") {
  const ouvertes = [...taches].sort((a, b) => T(a.due_at) - T(b.due_at));
  return deriveNextAction(ouvertes, null, null, rdvQuiCompte(rdvs, statut, now), now);
}

/** Combien de prochaines actions la carte affiche-t-elle ? (0 ou 1, jamais 2.) */
const combien = (v: ReturnType<typeof fiche>) => [v.task, v.meeting].filter(Boolean).length;

const LE_22 = T("2026-09-22T09:00:00Z");
const LE_25 = T("2026-09-25T12:00:00Z");
const LE_30 = T("2026-09-30T09:00:00Z");

// --- Le format ---------------------------------------------------------------
console.log("— le format —");
verifie("10:00 UTC le 28/09 = « RDV le 28/09 à 12h »", libelleRdv(RDV_ALAIN.starts_at), "RDV le 28/09 à 12h");
verifie("les minutes quand il y en a", jourHeureCourt("2026-09-28T12:30:00Z"), "28/09 à 14h30");
verifie("en hiver, UTC+1", jourHeureCourt("2026-12-01T10:00:00Z"), "01/12 à 11h");
verifie("vivants : prévu, confirmé, reporté", ["prevu", "confirme", "reporte"].map(rdvVivant), [true, true, true]);
verifie("clos : honoré, annulé", ["honore", "annule"].map(rdvVivant), [false, false]);

// --- 1. RDV posé alors qu'une relance tombe avant : CLÔTURÉE -----------------
console.log("\n— 1. rdv_pose_relance_avant_cloturee —");
{
  // État produit par le trigger : la relance du 25 est « annule », elle ne
  // figure plus parmi les ouvertes. Seul le RDV reste.
  const v = fiche([], [RDV_ALAIN], LE_22);
  verifie("la carte montre le RDV, seul", [v.isMeeting, v.meeting?.id, v.task, combien(v)], [true, "m-alain", null, 1]);
  verifie("« RDV le 28/09 à 12h »", v.when, "RDV le 28/09 à 12h");
  verifie("jamais en retard", v.overdue, false);
  const l = lireProchaineAction(RDV_ALAIN.starts_at, "rendez_vous", LE_22);
  verifie(
    "liste / colonnes : calendrier, « RDV lun. 28/09 · 12h », pas de retard",
    [l.icone, l.texte, l.retard],
    ["calendrier", "RDV lun. 28/09 · 12h", false]
  );
  verifie(
    "l'écran le DIT, sans rien demander",
    phraseAnnulees([{ id: "t1", title: "Relancer Alain docteur", due_at: "2026-09-25T07:00:00Z" }]),
    "Relance « Relancer Alain docteur » annulée : le rendez-vous devient la prochaine action, la suite se décidera au débrief."
  );
  verifie("rien de clôturé : rien à dire", phraseAnnulees([]), null);
  verifie(
    "plusieurs : on les compte",
    phraseAnnulees([
      { id: "a", title: "x", due_at: "2026-09-25T07:00:00Z" },
      { id: "b", title: "y", due_at: "2026-09-26T07:00:00Z" },
    ])?.startsWith("2 relances annulées"),
    true
  );
}

// --- 2. Relance datée AVANT un RDV à venir : elle reste une tâche (024) ------
console.log("\n— 2. rdv_a_venir_passe_devant_la_relance —");
{
  // Le trigger ne clôture que les relances qui existent à la pose du RDV ;
  // une relance posée ensuite et datée avant lui reste ouverte. Mais c'est le
  // RDV qui est la prochaine action — TOUJOURS (024). La relance remontera
  // dans « À appeler » le jour venu, sans jamais remplacer le RDV ici.
  const v = fiche([tache("t4", "2026-09-27T07:00:00Z", "Confirmer le RDV")], [RDV_ALAIN], LE_22);
  verifie("le RDV est la prochaine action, seul", [v.isMeeting, v.meeting?.id, v.task, combien(v)], [true, "m-alain", null, 1]);
  verifie("pas en retard", v.overdue, false);
  // C'est l'état d'Alain docteur le 22/09 (relance re-datée le 21/09 par une
  // tâche automatique, après la pose du RDV le 19/09) : le RDV, pas la relance.
  const alain = fiche([tache("t1", "2026-09-25T07:00:00Z")], [RDV_ALAIN], LE_22);
  verifie("Alain docteur : le RDV du 28, pas la relance du 25", [alain.isMeeting, alain.meeting?.id, alain.task], [true, "m-alain", null]);
  // Même le 25, relance échue : la fiche dit le RDV, jamais « en retard ».
  const le25 = fiche([tache("t1", "2026-09-25T07:00:00Z")], [RDV_ALAIN], LE_25);
  verifie("le 25, relance échue : toujours le RDV, pas d'ambre", [le25.isMeeting, le25.overdue], [true, false]);
  // Relance seule, sans RDV : elle est la prochaine action.
  const seule = fiche([tache("t8", "2026-09-27T07:00:00Z")], [], LE_22);
  verifie("relance seule : elle est la prochaine action", [seule.isMeeting, seule.task?.id], [false, "t8"]);
  // Une relance après le RDV : le RDV passe devant.
  const apres = fiche([tache("t2", "2026-10-05T07:00:00Z")], [RDV_ALAIN], LE_22);
  verifie("une relance APRÈS le RDV : le RDV passe devant", [apres.isMeeting, combien(apres)], [true, 1]);
}

// --- 3. RDV passé, pas débriefé : « À débriefer », rien d'autre -------------
console.log("\n— 3. rdv_passe_non_debriefe —");
{
  const v = fiche([], [RDV_ALAIN], LE_30);
  verifie("c'est le RDV qui a la main", [v.isMeeting, v.task, combien(v)], [true, null, 1]);
  verifie("à débriefer", v.aDebriefer, true);
  verifie("JAMAIS en retard", v.overdue, false);
  verifie("la carte le dit", v.when, "à débriefer — RDV le 28/09 à 12h");
  const l = lireProchaineAction(RDV_ALAIN.starts_at, "rendez_vous", LE_30);
  verifie(
    "liste / colonnes / tableau de bord : « À débriefer », pas d'ambre",
    [l.texte, l.retard, l.aDebriefer],
    ["À débriefer — RDV du 28/09 à 12h", false, true]
  );
  // Une relance posée après le RDV mais qui tombe après sa date : le RDV non
  // débriefé garde la main — rien d'autre ne réclame la fiche.
  const avecSuite = fiche([tache("t5", "2026-10-05T07:00:00Z")], [RDV_ALAIN], LE_30);
  verifie("une relance plus tardive ne le double pas", [avecSuite.isMeeting, avecSuite.aDebriefer], [true, true]);
  // Une relance EN RETARD datée avant le RDV passé : le RDV non débriefé garde
  // la main (024) — la fiche dit « À débriefer », la relance reste dans « À
  // appeler ». Jamais la fiche ne bascule en « en retard » au moment du débrief.
  const retardAvant = fiche([tache("t5b", "2026-09-25T07:00:00Z")], [RDV_ALAIN], LE_30);
  verifie(
    "relance en retard avant un RDV passé : « à débriefer », pas « en retard »",
    [retardAvant.isMeeting, retardAvant.aDebriefer, retardAvant.overdue, retardAvant.task],
    [true, true, false, null]
  );
  // Un RDV REPORTÉ puis passé aussi — c'est le bug de la zone débrief
  // (Garage Boetendael, 02/09, invisible trois semaines).
  const reportePasse: Rdv = { ...RDV_ALAIN, status: "reporte" };
  verifie("reporté puis passé : à débriefer aussi", fiche([], [reportePasse], LE_30).aDebriefer, true);
}

// --- 4. RDV déplacé plus tard : la relance qui tombe avant est clôturée ----
console.log("\n— 4. rdv_deplace_plus_tard_relance_cloturee —");
{
  // Le 28/09 → vendredi 09/10. La relance du 05/10 tombe désormais avant :
  // le trigger la clôture. Il ne reste que le RDV reporté.
  const reporte: Rdv = { ...RDV_ALAIN, starts_at: "2026-10-09T10:00:00Z", ends_at: "2026-10-09T11:00:00Z", status: "reporte" };
  const v = fiche([], [reporte], LE_22);
  verifie("« RDV le 09/10 à 12h »", [v.when, combien(v)], ["RDV le 09/10 à 12h", 1]);
  verifie("un RDV reporté reste vivant", rdvVivant("reporte"), true);
}

// --- 5. RDV annulé au débrief sans suite : la fiche n'a plus de prochaine action
console.log("\n— 5. rdv_annule_sans_suite —");
{
  // C'est LE cas que le filet couvrait. Les relances d'avant ont été clôturées
  // à la pose, le RDV est clos : sans suite choisie, il ne reste rien.
  const annule: Rdv = { ...RDV_ALAIN, status: "annule" };
  const v = fiche([], [annule], LE_30);
  verifie("aucune prochaine action", [combien(v), v.when, v.overdue], [0, null, false]);
  const l = lireProchaineAction(null, null, LE_30);
  verifie("liste : « — », rien en retard", [l.texte, l.retard], [null, false]);
  // Avec une suite choisie (« +3 j ») : une relance, et une seule.
  const suite = fiche([tache("t6", "2026-10-03T07:00:00Z")], [annule], LE_30);
  verifie("avec « Et ensuite ? » : UNE relance", [combien(suite), suite.task?.id], [1, "t6"]);
}

// --- 5 bis. Le garde-fou zéro tap : « Plus rien de prévu sur cette fiche » --
console.log("\n— 5bis. plus_rien_de_prevu —");
{
  verifie("le message", PLUS_RIEN, "Plus rien de prévu sur cette fiche");
  verifie(
    "RDV annulé sans suite : la fiche le DIT",
    plusRienDePrevu({ nextActionAt: null, status: "rendez_vous", aEuUnRdvClos: true }),
    true
  );
  verifie(
    "honoré sans suite : pareil",
    plusRienDePrevu({ nextActionAt: null, status: "contacte", aEuUnRdvClos: [ "honore" ].some(rdvClos) }),
    true
  );
  verifie(
    "avec une suite choisie : non (la fiche a sa relance)",
    plusRienDePrevu({ nextActionAt: "2026-10-03T07:00:00Z", status: "rendez_vous", aEuUnRdvClos: true }),
    false
  );
  verifie(
    "fiche « À appeler » jamais planifiée : non (elle n'a encore rien eu)",
    plusRienDePrevu({ nextActionAt: null, status: "a_appeler", aEuUnRdvClos: false }),
    false
  );
  verifie(
    "fiche Gagné / Perdu : non (close)",
    [plusRienDePrevu({ nextActionAt: null, status: "gagne", aEuUnRdvClos: true }),
     plusRienDePrevu({ nextActionAt: null, status: "perdu", aEuUnRdvClos: true })],
    [false, false]
  );
  verifie("un RDV vivant n'est pas clos", ["prevu", "confirme", "reporte"].map(rdvClos), [false, false, false]);
}

// --- 6. Plusieurs RDV à venir : le plus proche compte ------------------------
console.log("\n— 6. plusieurs_rdv_le_plus_proche —");
{
  const loin: Rdv = { ...RDV_ALAIN, id: "m-loin", starts_at: "2026-10-12T08:00:00Z", ends_at: "2026-10-12T09:00:00Z" };
  const annuleProche: Rdv = { ...RDV_ALAIN, id: "m-annule", starts_at: "2026-09-24T08:00:00Z", ends_at: "2026-09-24T09:00:00Z", status: "annule" };
  verifie("le plus proche des vivants", rdvQuiCompte([loin, RDV_ALAIN, annuleProche])?.id, "m-alain");
  verifie("un RDV annulé ne compte pas", rdvQuiCompte([annuleProche]), null);
}

// --- 7. RDV perso : hors règle -----------------------------------------------
console.log("\n— 7. rdv_perso_hors_regle —");
{
  // Un RDV perso n'a pas de fiche : la base ne le lit pas
  // (recalc_next_action : kind='prospect'), le trigger ne clôture rien.
  const v = fiche([tache("t3", "2026-09-25T07:00:00Z")], [], LE_22);
  verifie("la fiche reste sur sa relance", [v.isMeeting, v.task?.id], [false, "t3"]);
}

// --- 8. Fiche gagnée ou perdue : on ne touche à rien -------------------------
console.log("\n— 8. fiche_gagnee_ou_perdue —");
{
  // Le trigger ne clôture rien sur une fiche close. Mais le RDV à venir
  // (installation) est la prochaine action (024) ; la relance reste une tâche.
  const v = fiche([tache("t7", "2026-09-25T07:00:00Z")], [RDV_ALAIN], LE_22, "gagne");
  verifie("gagne + RDV à venir + relance avant : le RDV", [v.isMeeting, v.meeting?.id, v.task], [true, "m-alain", null]);
}

// --- 9. Une fiche close ne réclame jamais rien (migration 023) ---------------
console.log("\n— 9. fiche_close_ne_reclame_rien —");
{
  verifie("close : gagné, perdu", ["gagne", "perdu"].map(ficheClose), [true, true]);
  verifie(
    "ouvertes : les quatre autres",
    ["a_appeler", "contacte", "rendez_vous", "proposition"].map(ficheClose),
    [false, false, false, false]
  );

  // gagne + RDV à venir (installation) : il s'affiche, comme sur une fiche ouverte.
  const installe = fiche([], [RDV_ALAIN], LE_22, "gagne");
  verifie("gagne + RDV à venir : il s'affiche", [installe.isMeeting, installe.when], [true, "RDV le 28/09 à 12h"]);
  const lInstalle = lireProchaineAction(RDV_ALAIN.starts_at, "rendez_vous", LE_22, "gagne");
  verifie("…et la liste le dit pareil", [lInstalle.rien, lInstalle.texte], [false, "RDV lun. 28/09 · 12h"]);

  // gagne + RDV passé non débriefé : rien, nulle part.
  const gPasse = fiche([], [RDV_ALAIN], LE_30, "gagne");
  verifie("gagne + RDV passé non débriefé : la fiche ne réclame rien", [combien(gPasse), gPasse.aDebriefer, gPasse.when], [0, false, null]);
  const lPasse = lireProchaineAction(RDV_ALAIN.starts_at, "rendez_vous", LE_30, "gagne");
  verifie(
    "…la liste non plus (état d'avant la tâche horaire)",
    [lPasse.rien, lPasse.texte, lPasse.aDebriefer, lPasse.retard],
    [true, null, false, false]
  );

  // gagne + RDV passé + relance planifiée (« rappeler dans 6 mois ») : la relance.
  const suivi = fiche([tache("t10", "2027-03-28T07:00:00Z", "Rappeler dans 6 mois")], [RDV_ALAIN], LE_30, "gagne");
  verifie("gagne + RDV passé + relance planifiée : la relance", [suivi.task?.id, suivi.isMeeting], ["t10", false]);

  // perdu + relance ouverte EN RETARD : elle s'affiche, en retard — c'est un
  // rappel que l'utilisateur a posé (perdu sert aussi de vivier).
  const vivier = fiche([tache("t11", "2026-09-15T07:00:00Z")], [], LE_22, "perdu");
  verifie("perdu + relance en retard : elle s'affiche, en retard", [vivier.task?.id, vivier.overdue], ["t11", true]);
  const lVivier = lireProchaineAction("2026-09-15T07:00:00Z", "relance", LE_22, "perdu");
  verifie("…la liste aussi, en ambre", [lVivier.rien, lVivier.retard], [false, true]);

  // perdu + RDV passé : rien.
  const pPasse = fiche([], [RDV_ALAIN], LE_30, "perdu");
  verifie("perdu + RDV passé : rien", [combien(pPasse), pPasse.aDebriefer], [0, false]);

  // Garage Boetendael, réel : gagné, RDV REPORTÉ du 02/09 jamais débriefé.
  const boetendael: Rdv = { ...RDV_ALAIN, id: "m-boetendael", starts_at: "2026-09-02T09:00:00Z", ends_at: "2026-09-02T10:00:00Z", status: "reporte" };
  const LE_23 = T("2026-09-23T09:00:00Z");
  verifie("Garage Boetendael (gagné) : plus de « À débriefer — RDV du 02/09 »", combien(fiche([], [boetendael], LE_23, "gagne")), 0);
  verifie(
    "…ni dans la liste",
    lireProchaineAction("2026-09-02T09:00:00Z", "rendez_vous", LE_23, "gagne").rien,
    true
  );
  // ZZ Test délivrabilité, réel : perdu, relance du 15/09.
  verifie(
    "ZZ Test (perdu) : sa relance du 15/09 reste, en retard",
    [lireProchaineAction("2026-09-15T07:00:00Z", "relance", LE_23, "perdu").rien,
     lireProchaineAction("2026-09-15T07:00:00Z", "relance", LE_23, "perdu").retard],
    [false, true]
  );

  // Changer l'étape change ce que dit la fiche, dans les deux sens.
  verifie(
    "ouverte → gagne : le débrief disparaît ; gagne → ouverte : il revient",
    [fiche([], [boetendael], LE_23, "contacte").aDebriefer, fiche([], [boetendael], LE_23, "gagne").aDebriefer],
    [true, false]
  );

  // Un RDV qui commence à l'instant : commencé (miroir de `starts_at > now()`).
  const pile = T(RDV_ALAIN.starts_at);
  verifie("RDV qui commence à l'instant, fiche close : il ne compte plus", rdvQuiCompte([RDV_ALAIN], "gagne", pile), null);
  verifie("…une minute avant, si", rdvQuiCompte([RDV_ALAIN], "gagne", pile - 60_000)?.id, "m-alain");
  verifie("sans étape (appel d'avant la 023) : la règle 022", rdvQuiCompte([RDV_ALAIN], undefined, LE_30)?.id, "m-alain");
}

// --- Bout en bout : une seule prochaine action à chaque étape ----------------
console.log("\n— bout_en_bout_une_seule_prochaine_action —");
{
  // Avant : une relance au 25.
  const avant = fiche([tache("t1", "2026-09-25T07:00:00Z")], [], LE_22);
  verifie("avant le RDV : la relance", [avant.task?.id, combien(avant)], ["t1", 1]);

  // On pose le RDV → le trigger clôture la relance du 25.
  const pose = fiche([], [RDV_ALAIN], LE_22);
  verifie("RDV posé : UNE prochaine action, le RDV", [combien(pose), pose.isMeeting], [1, true]);

  // Le 25 : rien n'est réclamé, la fiche attend son RDV.
  const le25 = fiche([], [RDV_ALAIN], LE_25);
  verifie("le 25 : le RDV, pas « en retard »", [le25.isMeeting, le25.overdue], [true, false]);

  // Le 30, sans débrief : à débriefer.
  const le30 = fiche([], [RDV_ALAIN], LE_30);
  verifie("le 30 : à débriefer", [le30.aDebriefer, le30.overdue, combien(le30)], [true, false, 1]);

  // Débrief « Ça s'est fait » + « +3 j » : une relance neuve, et une seule.
  const honore: Rdv = { ...RDV_ALAIN, status: "honore" };
  const apres = fiche([tache("t9", "2026-10-03T07:00:00Z")], [honore], LE_30);
  verifie("après le débrief : UNE prochaine action, la suite", [combien(apres), apres.task?.id, apres.isMeeting], [1, "t9", false]);
}

// --- 10. 024 : le RDV bien visible, et aucune relance automatique avant lui --
console.log("\n— 10. rdv_visible_et_refus —");
{
  verifie("liste : « RDV lun. 28/09 · 12h »", libelleRdvListe(RDV_ALAIN.starts_at), "RDV lun. 28/09 · 12h");
  verifie("liste : les minutes", libelleRdvListe("2026-09-28T12:30:00Z"), "RDV lun. 28/09 · 14h30");
  verifie("liste : en hiver, UTC+1", libelleRdvListe("2026-12-01T10:00:00Z"), "RDV mar. 01/12 · 11h");
  verifie("fiche : « Lundi 28 septembre à 12h »", jourLong(RDV_ALAIN.starts_at), "Lundi 28 septembre à 12h");
  verifie("fiche : minuit de Bruxelles tombe le bon jour", jourLong("2026-10-04T22:00:00Z"), "Lundi 5 octobre à 0h");
  verifie("agenda : le jour de Bruxelles", jourAgenda("2026-10-04T22:30:00Z"), "2026-10-05");
  verifie("agenda : le lien", lienAgenda(RDV_ALAIN.starts_at), "/agenda?vue=jour&jour=2026-09-28");
  verifie("écran : la ligne d'information", infoRdvPrevu(RDV_ALAIN.starts_at), "Un rendez-vous est prévu le 28/09 à 12h");
  verifie(
    "MCP : relance avant le RDV → refus, message exact",
    refusRelanceAvantRdv("2026-09-25T07:00:00Z", RDV_ALAIN.starts_at),
    "Un rendez-vous est déjà prévu le 28/09 à 12h : c'est lui la prochaine action. Aucune relance posée."
  );
  verifie("MCP : relance après le RDV → acceptée", refusRelanceAvantRdv("2026-10-05T07:00:00Z", RDV_ALAIN.starts_at), null);
  verifie("MCP : au moment même du RDV → acceptée", refusRelanceAvantRdv(RDV_ALAIN.starts_at, RDV_ALAIN.starts_at), null);
  verifie("MCP : pas de RDV à venir → acceptée", refusRelanceAvantRdv("2026-09-25T07:00:00Z", null), null);
}

console.log(echecs === 0 ? "\nTous les cas passent." : `\n${echecs} cas en ÉCHEC.`);
process.exit(echecs === 0 ? 0 : 1);
