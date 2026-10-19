/**
 * Le débrief d'un rendez-vous et l'étape « À rappeler » — sans réseau ni base :
 *
 *   node --experimental-strip-types lib/crm/debrief.test.ts
 *
 * (script npm : `npm run test:debrief`). Même style que agendaJour.test.ts.
 *
 * Ce qui est testé ICI : la règle des issues (lib/crm/debrief.ts), la zone
 * « à débriefer » (un seul RDV par fiche, jamais un RDV perso, jamais une
 * fiche close), et la règle d'étape (lib/crm/status.ts) — « À rappeler »
 * avance sur un fait, ne recule jamais, respecte le verrou.
 *
 * Le débrief implicite et les RDV remplacés vivent en SQL (migration 027),
 * testés par supabase/recettes/027_corps.sql — cas Carrosserie carsystem
 * compris. Ici, seulement la recopie lisible de la règle implicite
 * (`issueImplicite`), sur les mêmes cas : ce qui ferme, ce qui ne ferme rien
 * (pas de réponse, barrage, repérage), et « Pas intéressé » → Perdu.
 */

import {
  effetsDebrief,
  manqueDebrief,
  sujetDebrief,
  rdvADebriefer,
  estIssueDebrief,
  issueImplicite,
  ISSUES_TENUES,
  type RdvEnAttente,
} from "./debrief.ts";
import {
  evaluateStatus,
  factsFromRows,
  statusFromFacts,
  libelleFaitRdv,
  raisonAffichee,
  STATUS_RANK,
} from "./status.ts";
import { STATUS_ORDER, normalizeStatus } from "../constants.ts";

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

// Mercredi 18/10/2026, 10:00 UTC — le jour du constat.
const NOW = Date.parse("2026-10-18T10:00:00Z");
const RDV_29_09 = "2026-09-29T08:00:00Z"; // 10h à Bruxelles
const FUTUR = "2026-10-22T08:00:00Z";

// --- 1. Les issues ----------------------------------------------------------
console.log("— les issues —");

const rappel = effetsDebrief("a_rappeler");
verifie("à rappeler : RDV honoré, issue a_rappeler", [rappel.statutRdv, rappel.debriefIssue], ["honore", "a_rappeler"]);
verifie("à rappeler : l'étape SUIT les faits (aucune étape imposée)", rappel.etapeDecidee, null);
verifie("à rappeler : la date est exigée", rappel.exigeDate, true);
verifie("à rappeler : la carte dira « Intéressé »", rappel.outcome, "interesse");

const prop = effetsDebrief("proposition");
verifie("proposition : honoré, proposal_sent_at posé, étape suit les faits",
  [prop.statutRdv, prop.proposition, prop.etapeDecidee], ["honore", true, null]);
verifie("proposition : la suite est offerte, pas exigée", [prop.suiteOfferte, prop.exigeDate], [true, false]);

const signe = effetsDebrief("signe");
verifie("signé : honoré, « Gagné » décidé (verrouillé)", [signe.statutRdv, signe.etapeDecidee], ["honore", "gagne"]);
verifie("signé : pas de date demandée", [signe.exigeDate, signe.suiteOfferte], [false, false]);

const refus = effetsDebrief("pas_interesse");
verifie("pas intéressé : honoré, « Perdu » décidé, raison exigée",
  [refus.statutRdv, refus.etapeDecidee, refus.exigeRaison], ["honore", "perdu", true]);
verifie("pas intéressé : les relances ouvertes sont annulées", refus.annulerRelances, true);
verifie("pas intéressé : la carte dira « Pas intéressé »", refus.outcome, "refus");

const annule = effetsDebrief("annule");
verifie("annulé : RDV annulé, aucune issue, étape inchangée",
  [annule.statutRdv, annule.debriefIssue, annule.etapeDecidee], ["annule", null, null]);

verifie("UN tap suffit pour proposition, signé, annulé",
  ["proposition", "signe", "annule"].map((i) => manqueDebrief({ issue: i as "signe" })), [null, null, null]);
verifie("à rappeler sans date : refusé, la phrase le dit",
  manqueDebrief({ issue: "a_rappeler" }), "Quand faut-il rappeler ? Choisissez une date.");
verifie("à rappeler avec date : complet", manqueDebrief({ issue: "a_rappeler", suite: "2026-10-22" }), null);
verifie("pas intéressé sans raison (ou des blancs) : refusé",
  [manqueDebrief({ issue: "pas_interesse" }), manqueDebrief({ issue: "pas_interesse", raison: "   " })].every(Boolean), true);
verifie("pas intéressé avec raison : complet",
  manqueDebrief({ issue: "pas_interesse", raison: "bosse avec un concurrent" }), null);
verifie("le sujet du journal dit le RDV et l'issue",
  sujetDebrief("a_rappeler", RDV_29_09), "Débrief du RDV du 29/09 à 10h : intéressé — à rappeler");
verifie("le sujet d'une annulation",
  sujetDebrief("annule", RDV_29_09), "Débrief du RDV du 29/09 à 10h : n'a pas eu lieu (annulé)");
verifie("estIssueDebrief : les quatre issues tenues + annulé, rien d'autre",
  [...ISSUES_TENUES, "annule", "reporte", "constructor", ""].map(estIssueDebrief),
  [true, true, true, true, true, false, false, false]);

// --- 1b. Le débrief IMPLICITE (miroir du trigger SQL de la 027) ------------
console.log("\n— le débrief implicite —");

verifie("« Pas de réponse » après le RDV : ne ferme RIEN",
  issueImplicite({ type: "note", outcome: "sans_reponse", isExchange: false }), null);
verifie("« Barrage » après le RDV : ne ferme RIEN, même attesté",
  issueImplicite({ type: "note", outcome: "barrage", isExchange: true }), null);
verifie("« À rappeler » → a_rappeler", issueImplicite({ type: "note", outcome: "rappeler", isExchange: true }), "a_rappeler");
verifie("« Intéressé » → a_rappeler", issueImplicite({ type: "note", outcome: "interesse", isExchange: true }), "a_rappeler");
const refusImplicite = issueImplicite({ type: "note", outcome: "refus", isExchange: true });
verifie("« Pas intéressé » → pas_interesse (et non suite_posee)", refusImplicite, "pas_interesse");
const effetsRefus = effetsDebrief(refusImplicite as "pas_interesse");
verifie("« Pas intéressé » implicite : mêmes effets que l'explicite — Perdu verrouillé, relances annulées",
  [effetsRefus.statutRdv, effetsRefus.etapeDecidee, effetsRefus.annulerRelances], ["honore", "perdu", true]);
verifie("échange attesté sans résultat → suite_posee",
  issueImplicite({ type: "note", outcome: null, isExchange: true }), "suite_posee");
verifie("email envoyé → suite_posee", issueImplicite({ type: "email", isExchange: false }), "suite_posee");
verifie("note de repérage (outcome NULL, pas un échange) : rien — le piège NULL du SQL",
  issueImplicite({ type: "note", outcome: null, isExchange: false }), null);
verifie("brouillon : rien", issueImplicite({ type: "email", isExchange: false, isDraft: true }), null);
verifie("activité rendez_vous : rien", issueImplicite({ type: "rendez_vous", isExchange: true }), null);
verifie("ligne rattachée à un RDV : rien",
  issueImplicite({ type: "note", outcome: "refus", isExchange: true, meetingId: "m1" }), null);

// --- 2. La zone « à débriefer » ---------------------------------------------
console.log("\n— la zone « à débriefer » —");

const rdv = (id: string, p: string | null, starts: string, extra: Partial<RdvEnAttente> = {}): RdvEnAttente => ({
  id, prospect_id: p, kind: "prospect", status: "prevu", starts_at: starts, debriefed_at: null, ...extra,
});
const statuts: Record<string, string> = { nice: "rendez_vous", vivier: "rendez_vous", gagne: "gagne", perdu: "perdu", ouverte: "contacte" };
const zone = rdvADebriefer(
  [
    rdv("nice-29", "nice", "2026-09-29T08:00:00Z"),
    rdv("nice-06", "nice", "2026-10-06T08:00:00Z"),
    rdv("vivier-rep", "vivier", "2026-09-27T08:00:00Z", { status: "reporte" }),
    rdv("vivier-prev", "vivier", "2026-09-28T08:00:00Z"),
    rdv("ephec", null, "2026-09-21T12:45:00Z", { kind: "perso" }),
    rdv("gagne", "gagne", "2026-09-02T08:00:00Z"),
    rdv("perdu", "perdu", "2026-09-02T08:00:00Z"),
    rdv("avenir", "ouverte", FUTUR),
    rdv("deja", "ouverte", "2026-10-01T08:00:00Z", { status: "honore", debriefed_at: "2026-10-02T08:00:00Z" }),
  ],
  (p) => statuts[p],
  NOW
);
verifie("un seul RDV par fiche — le plus récent ; ni perso, ni fiche close, ni à venir, ni déjà débriefé",
  zone.map((m) => m.id), ["vivier-prev", "nice-06"]);

// --- 3. L'étape « À rappeler » ----------------------------------------------
console.log("\n— l'étape « À rappeler » —");

verifie("sept étapes, « À rappeler » entre Rendez-vous et Proposition",
  STATUS_ORDER, ["a_appeler", "contacte", "rendez_vous", "a_rappeler", "proposition", "gagne", "perdu"]);
verifie("rang : rendez_vous < a_rappeler < proposition < gagné = perdu",
  [STATUS_RANK.rendez_vous < STATUS_RANK.a_rappeler, STATUS_RANK.a_rappeler < STATUS_RANK.proposition,
   STATUS_RANK.gagne === STATUS_RANK.perdu], [true, true, true]);
verifie("normalizeStatus reconnaît la nouvelle valeur", normalizeStatus("a_rappeler"), "a_rappeler");

const sansRien = { activities: [], emails: [], meetings: [], proposalSentAt: null };
const rdvTenuARappeler = {
  ...sansRien,
  meetings: [{ starts_at: RDV_29_09, status: "honore", debrief_issue: "a_rappeler", debriefed_at: "2026-10-14T09:00:00Z" }],
};
const faitsRappel = factsFromRows(rdvTenuARappeler);
verifie("un RDV débriefé « à rappeler » → l'étape déduite est « À rappeler »", statusFromFacts(faitsRappel), "a_rappeler");
verifie("…avec son motif en clair", faitsRappel.rappel?.label,
  "le rendez-vous du 29 sept. 2026 a été débriefé : intéressé, à rappeler");

let v = evaluateStatus("rendez_vous", false, faitsRappel);
verifie("AVANCE : Rendez-vous → À rappeler (fiche non verrouillée)", [v.derived, v.apply, v.suggest], ["a_rappeler", true, false]);
v = evaluateStatus("rendez_vous", true, faitsRappel);
verifie("VERROU : rien n'est écrit, c'est seulement suggéré", [v.apply, v.suggest], [false, true]);
v = evaluateStatus("proposition", false, faitsRappel);
verifie("NE RECULE JAMAIS : une fiche en Proposition reste en Proposition", [v.apply, v.suggest], [false, false]);
v = evaluateStatus("a_rappeler", false, factsFromRows({ ...sansRien, meetings: [{ starts_at: FUTUR, status: "prevu" }] }));
verifie("NE RECULE JAMAIS : un nouveau RDV ne ramène pas « À rappeler » en Rendez-vous", v.apply, false);
v = evaluateStatus("gagne", false, faitsRappel);
verifie("Gagné / Perdu : plus rien ne bouge seul", v.apply, false);

const tenuSuitePosee = factsFromRows({
  ...sansRien,
  meetings: [{ starts_at: RDV_29_09, status: "honore", debrief_issue: "suite_posee", debriefed_at: "2026-10-15T09:00:00Z" }],
});
verifie("un RDV tenu sans issue « à rappeler » ne mène PAS à « À rappeler »", statusFromFacts(tenuSuitePosee), "rendez_vous");
verifie("un RDV remplacé (annulé) n'est pas un fait",
  statusFromFacts(factsFromRows({ ...sansRien, meetings: [{ starts_at: RDV_29_09, status: "annule", debrief_issue: "remplace" }] })),
  "a_appeler");
verifie("la proposition passe devant « À rappeler »",
  statusFromFacts(factsFromRows({ ...rdvTenuARappeler, proposalSentAt: "2026-10-16T09:00:00Z" })), "proposition");

// --- 4. Le libellé sous l'étape ---------------------------------------------
console.log("\n— le libellé de l'étape —");

verifie("RDV passé non débriefé : « en attente de son issue », jamais « est prévu »",
  libelleFaitRdv({ starts_at: RDV_29_09, status: "prevu" }, NOW),
  "un rendez-vous a eu lieu le 29 sept. 2026, en attente de son issue");
verifie("RDV tenu : « a été tenu »",
  libelleFaitRdv({ starts_at: RDV_29_09, status: "honore" }, NOW), "un rendez-vous a été tenu le 29 sept. 2026");
verifie("RDV à venir : « est prévu »",
  libelleFaitRdv({ starts_at: FUTUR, status: "prevu" }, NOW).startsWith("un rendez-vous est prévu le "), true);
const faitsPasse = factsFromRows({ ...sansRien, meetings: [{ starts_at: RDV_29_09, status: "prevu" }] });
verifie("la fiche relit le fait du jour au lieu du motif stocké (cas du 18/10)",
  raisonAffichee("rendez_vous", "un rendez-vous est prévu le 29 sept.", faitsPasse)?.includes("en attente de son issue"), true);
verifie("sans motif stocké (étape posée à la main puis rendue), aucun motif inventé",
  raisonAffichee("rendez_vous", null, faitsPasse), null);
verifie("les autres étapes gardent leur motif stocké",
  raisonAffichee("contacte", "un email a été échangé le 01/10/2026", faitsPasse), "un email a été échangé le 01/10/2026");

console.log(echecs === 0 ? "\nTous les cas passent." : `\n${echecs} cas en ÉCHEC.`);
process.exit(echecs === 0 ? 0 : 1);
