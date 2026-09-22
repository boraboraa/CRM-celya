/**
 * La prochaine action d'une fiche — ce que l'écran DIT, sans réseau ni base :
 *
 *   node --experimental-strip-types lib/crm/prochaineAction.test.ts
 *
 * (script npm : `npm run test:prochaine-action`). Même style que
 * lib/crm/agendaJour.test.ts.
 *
 * La RÈGLE vit en SQL (migration 022 : triggers sur tasks et meetings) et se
 * teste par la recette SQL de la 022, en transaction annulée. Ici on teste le
 * côté LECTURE : pour chaque état de base que les triggers produisent, ce que
 * la fiche, la liste, les colonnes et le tableau de bord affichent. Un cas par
 * ligne du cycle validé par Bora le 22/09, nommés pareil des deux côtés.
 *
 * La fiche de référence est celle d'Alain docteur, lue en base le 22/09 :
 * RDV le 28/09 à 10:00 UTC (12h à Bruxelles), relance au 25/09 07:00 UTC.
 */

import { deriveNextAction, type OpenTask, type NextMeeting } from "./nextAction.ts";
import {
  estEnSommeil,
  jourHeureCourt,
  libelleRdv,
  lireProchaineAction,
  phraseReportees,
  rdvQuiCompte,
  rdvVivant,
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
type Tache = OpenTask & { meeting_id: string | null };

const RDV_ALAIN: Rdv = {
  id: "m-alain",
  title: "RDV avec Alain docteur",
  starts_at: "2026-09-28T10:00:00Z",
  ends_at: "2026-09-28T11:00:00Z",
  location: "Square Edmond Machtens 2, 1080 Molenbeek",
  status: "prevu",
};

function tache(id: string, due: string, meetingId: string | null = null): Tache {
  return {
    id,
    title: "Relancer Alain docteur",
    due_at: due,
    priority: 2,
    prospect_id: "p-alain",
    meeting_id: meetingId,
  };
}

/** Ce que la fiche affiche : le même chemin que app/(app)/prospects/[id]. */
function fiche(taches: Tache[], rdvs: Rdv[], now: number) {
  const eveillees = taches
    .filter((t) => !estEnSommeil(t, rdvs))
    .sort((a, b) => T(a.due_at) - T(b.due_at));
  return deriveNextAction(eveillees, null, null, rdvQuiCompte(rdvs), now);
}

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

// --- 1. RDV posé alors qu'une relance tombe AVANT ---------------------------
console.log("\n— 1. rdv_pose_relance_avant_reportee —");
{
  // État produit par le trigger : la relance du 25 est devenue le filet du
  // RDV, re-datée au mardi 29/09 09:00 Bruxelles (07:00 UTC).
  const v = fiche([tache("t1", "2026-09-29T07:00:00Z", "m-alain")], [RDV_ALAIN], LE_22);
  verifie("la carte montre le RDV", [v.isMeeting, v.meeting?.id, v.task], [true, "m-alain", null]);
  verifie("« RDV le 28/09 à 12h »", v.when, "RDV le 28/09 à 12h");
  verifie("jamais en retard", v.overdue, false);
  verifie("le filet dort", estEnSommeil(tache("t1", "x", "m-alain"), [RDV_ALAIN]), true);
  const l = lireProchaineAction(RDV_ALAIN.starts_at, "rendez_vous", LE_22);
  verifie(
    "liste / colonnes : calendrier, texte, pas de retard",
    [l.icone, l.texte, l.retard],
    ["calendrier", "RDV le 28/09 à 12h", false]
  );
  verifie(
    "l'écran le DIT, sans rien demander",
    phraseReportees([{ id: "t1", title: "Relancer Alain docteur", due_at: "2026-09-29T07:00:00Z" }]),
    "Relance « Relancer Alain docteur » reportée au mar. 29/09, après le rendez-vous — elle attend son débrief, et revient seule s'il tombe à l'eau."
  );
  verifie("rien de déplacé : rien à dire", phraseReportees([]), null);
}

// --- 2. Relance qui tombe APRÈS le RDV : on n'y touche pas ------------------
console.log("\n— 2. rdv_pose_relance_apres_intacte —");
{
  const v = fiche([tache("t2", "2026-10-05T07:00:00Z")], [RDV_ALAIN], LE_22);
  verifie("le RDV passe devant", [v.isMeeting, v.when], [true, "RDV le 28/09 à 12h"]);
  verifie("la relance n'est pas un filet", estEnSommeil(tache("t2", "x"), [RDV_ALAIN]), false);
}

// --- 3. RDV reporté : le filet suit ------------------------------------------
console.log("\n— 3. rdv_reporte_filet_suit —");
{
  // Le 28 → vendredi 02/10 12h ; le filet suit au lundi 05/10 (jour ouvré).
  const reporte: Rdv = { ...RDV_ALAIN, starts_at: "2026-10-02T10:00:00Z", ends_at: "2026-10-02T11:00:00Z", status: "reporte" };
  const v = fiche([tache("t1", "2026-10-05T07:00:00Z", "m-alain")], [reporte], LE_22);
  verifie("« RDV le 02/10 à 12h »", v.when, "RDV le 02/10 à 12h");
  verifie("un RDV reporté reste vivant : le filet dort encore", estEnSommeil(tache("t1", "x", "m-alain"), [reporte]), true);
  verifie(
    "phrase du filet qui a suivi",
    phraseReportees([{ id: "t1", title: "Relancer Alain docteur", due_at: "2026-10-05T07:00:00Z" }])?.includes("lun. 05/10"),
    true
  );
}

// --- 4. RDV annulé au débrief : la fiche repart sur sa relance --------------
console.log("\n— 4. rdv_annule_filet_reveille —");
{
  const annule: Rdv = { ...RDV_ALAIN, status: "annule" };
  // Sans suite choisie, le trigger réveille le filet au premier jour ouvré.
  const v = fiche([tache("t1", "2026-10-01T07:00:00Z", "m-alain")], [annule], LE_30);
  verifie("la carte montre la relance, pas le RDV", [v.isMeeting, v.task?.id], [false, "t1"]);
  verifie("le filet est éveillé", estEnSommeil(tache("t1", "x", "m-alain"), [annule]), false);
  verifie("pas en retard : demain", v.overdue, false);
}

// --- 5. RDV passé, pas débriefé : « à débriefer », jamais « en retard » -----
console.log("\n— 5. rdv_passe_non_debriefe —");
{
  // Le 30/09 : le RDV du 28 n'a pas été débriefé, le filet du 29 est échu.
  const v = fiche([tache("t1", "2026-09-29T07:00:00Z", "m-alain")], [RDV_ALAIN], LE_30);
  verifie("c'est le RDV qui a la main", [v.isMeeting, v.task], [true, null]);
  verifie("à débriefer", v.aDebriefer, true);
  verifie("JAMAIS en retard", v.overdue, false);
  verifie("la carte le dit", v.when, "à débriefer — RDV le 28/09 à 12h");
  const l = lireProchaineAction(RDV_ALAIN.starts_at, "rendez_vous", LE_30);
  verifie(
    "liste / colonnes / tableau de bord : « À débriefer », pas d'ambre",
    [l.texte, l.retard, l.aDebriefer],
    ["À débriefer — RDV du 28/09 à 12h", false, true]
  );
  // Un RDV REPORTÉ puis passé aussi — c'est le bug de la zone débrief
  // (Garage Boetendael, 02/09, invisible trois semaines).
  const reportePasse: Rdv = { ...RDV_ALAIN, status: "reporte" };
  verifie("reporté puis passé : à débriefer aussi", fiche([], [reportePasse], LE_30).aDebriefer, true);
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
  // Un RDV perso n'a pas de fiche : aucune ligne de la fiche ne le porte, et
  // la base ne le voit pas (recalc_next_action ne lit que kind='prospect').
  // Côté lecture, une fiche sans RDV reste sur sa relance.
  const v = fiche([tache("t3", "2026-09-25T07:00:00Z")], [], LE_22);
  verifie("la fiche reste sur sa relance", [v.isMeeting, v.task?.id], [false, "t3"]);
}

// --- 8. Fiche gagnée ou perdue : on ne pose plus rien ------------------------
console.log("\n— 8. fiche_gagnee_ou_perdue —");
{
  // Aucun filet n'est posé (trigger). Un RDV de client gagné reste le RDV.
  const v = fiche([], [RDV_ALAIN], LE_22);
  verifie("le RDV se dit, sans relance", [v.isMeeting, v.task, v.ensuite], [true, null, null]);
}

// --- 9. Relance posée APRÈS que le RDV existe, avant sa date -----------------
console.log("\n— 9. relance_posee_apres_le_rdv_non_reportee —");
{
  // « Confirmer la veille » : posée en connaissant le RDV, elle n'est JAMAIS
  // reportée. La fiche affiche la relance, PUIS le RDV.
  const v = fiche([tache("t4", "2026-09-27T07:00:00Z")], [RDV_ALAIN], LE_22);
  verifie("la relance est la prochaine action", [v.isMeeting, v.task?.id], [false, "t4"]);
  verifie("le RDV vient ensuite", v.ensuite?.id, "m-alain");
  verifie("pas en retard avant sa date", v.overdue, false);
  const l = lireProchaineAction("2026-09-27T07:00:00Z", "relance", LE_22);
  verifie("liste : une relance, pas de calendrier", [l.estRdv, l.retard], [false, false]);
  // Et si elle est échue, elle est en retard — c'est une vraie relance voulue.
  verifie("échue, elle est en retard", fiche([tache("t4", "2026-09-27T07:00:00Z")], [RDV_ALAIN], T("2026-09-27T12:00:00Z")).overdue, true);
}

// --- Bout en bout : une seule prochaine action à chaque étape ----------------
console.log("\n— bout_en_bout_une_seule_prochaine_action —");
{
  // Avant : la relance du 25 et le RDV du 28 se contredisent (la base disait
  // le 25, la fiche d'Alain le 22/09).
  const avant = fiche([tache("t1", "2026-09-25T07:00:00Z")], [], LE_22);
  verifie("avant le RDV : la relance", avant.task?.id, "t1");

  // On pose le RDV → le trigger fait de la relance son filet (29/09).
  const pose = fiche([tache("t1", "2026-09-29T07:00:00Z", "m-alain")], [RDV_ALAIN], LE_22);
  const unePose = [pose.task, pose.meeting].filter(Boolean).length;
  verifie("RDV posé : UNE prochaine action, le RDV", [unePose, pose.isMeeting], [1, true]);

  // Le 25 : rien n'est réclamé, la fiche attend son RDV.
  const le25 = fiche([tache("t1", "2026-09-29T07:00:00Z", "m-alain")], [RDV_ALAIN], LE_25);
  verifie("le 25 : le RDV, pas « en retard »", [le25.isMeeting, le25.overdue], [true, false]);

  // Le 30, sans débrief : à débriefer.
  const le30 = fiche([tache("t1", "2026-09-29T07:00:00Z", "m-alain")], [RDV_ALAIN], LE_30);
  verifie("le 30 : à débriefer", [le30.aDebriefer, le30.overdue], [true, false]);

  // Débrief « Ça s'est fait », suite +3 j : le filet est re-daté et détaché.
  const honore: Rdv = { ...RDV_ALAIN, status: "honore" };
  const apres = fiche([tache("t1", "2026-10-03T07:00:00Z", null)], [honore], LE_30);
  const uneApres = [apres.task, apres.meeting].filter(Boolean).length;
  verifie("après le débrief : UNE prochaine action, la suite", [uneApres, apres.task?.id, apres.isMeeting], [1, "t1", false]);
}

console.log(echecs === 0 ? "\nTous les cas passent." : `\n${echecs} cas en ÉCHEC.`);
process.exit(echecs === 0 ? 0 : 1);
