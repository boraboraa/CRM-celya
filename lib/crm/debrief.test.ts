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
  rdvClosParEssai,
  rdvFermesParDebrief,
  ISSUES_TENUES,
  type RdvEnAttente,
} from "./debrief.ts";
import {
  evaluateStatus,
  factsFromRows,
  statusFromFacts,
  factReason,
  libelleFaitRdv,
  raisonAffichee,
  STATUS_RANK,
  isManualOnly,
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

// « Proposition envoyée » est RETIRÉE (29/10), avec l'étape.
verifie("« Proposition envoyée » n'est plus une issue du débrief",
  [ISSUES_TENUES.includes("proposition" as never), estIssueDebrief("proposition")], [false, false]);
verifie("les issues tenues, dans l'ordre", ISSUES_TENUES,
  ["a_rappeler", "suivi_email", "essai", "signe", "pas_interesse"]);

const signe = effetsDebrief("signe");
verifie("signé : honoré, « Gagné » décidé (verrouillé)", [signe.statutRdv, signe.etapeDecidee], ["honore", "gagne"]);
verifie("signé : pas de date demandée", [signe.exigeDate, signe.suiteOfferte], [false, false]);

const essai = effetsDebrief("essai");
verifie("essai gratuit : honoré, « Essai gratuit » décidé (verrouillé), issue essai",
  [essai.statutRdv, essai.etapeDecidee, essai.debriefIssue], ["honore", "essai_gratuit", "essai"]);
verifie("essai gratuit : un tap, la suite (fin d'essai) est OFFERTE, rien n'est annulé",
  [essai.exigeDate, essai.exigeRaison, essai.suiteOfferte, essai.annulerRelances], [false, false, true, false]);
verifie("essai gratuit : la carte dira « Intéressé »", essai.outcome, "interesse");
verifie("le sujet d'un essai", sujetDebrief("essai", RDV_29_09), "Débrief du RDV du 29/09 à 10h : essai gratuit démarré");

const refus = effetsDebrief("pas_interesse");
verifie("pas intéressé : honoré, « Perdu » décidé, raison exigée",
  [refus.statutRdv, refus.etapeDecidee, refus.exigeRaison], ["honore", "perdu", true]);
verifie("pas intéressé : les relances ouvertes sont annulées", refus.annulerRelances, true);
verifie("pas intéressé : la carte dira « Pas intéressé »", refus.outcome, "refus");

const suivi = effetsDebrief("suivi_email");
verifie("suivi par email : RDV honoré, issue suivi_email, l'étape SUIT les faits",
  [suivi.statutRdv, suivi.debriefIssue, suivi.etapeDecidee], ["honore", "suivi_email", null]);
verifie("suivi par email : la date de relance est exigée, la carte dira « Suivi par email »",
  [suivi.exigeDate, suivi.outcome], [true, "suivi_email"]);
verifie("suivi par email sans date : refusé, la phrase dit « relancer »",
  manqueDebrief({ issue: "suivi_email" }), "Quand faut-il relancer ? Choisissez une date.");

const decroche = effetsDebrief("pas_decroche");
verifie("pas décroché : le RDV n'a PAS eu lieu — annulé, issue pas_decroche, étape inchangée",
  [decroche.statutRdv, decroche.debriefIssue, decroche.etapeDecidee], ["annule", "pas_decroche", null]);
verifie("pas décroché : le journal dit « pas de réponse »", decroche.outcome, "sans_reponse");
verifie("pas décroché : la relance est PROPOSÉE, jamais exigée",
  [decroche.suiteOfferte, decroche.exigeDate, manqueDebrief({ issue: "pas_decroche" })], [true, false, null]);
verifie("le sujet d'un pas décroché",
  sujetDebrief("pas_decroche", RDV_29_09), "Débrief du RDV du 29/09 à 10h : pas décroché, n'a pas eu lieu");

const annule = effetsDebrief("annule");
verifie("annulé : RDV annulé, aucune issue, étape inchangée",
  [annule.statutRdv, annule.debriefIssue, annule.etapeDecidee], ["annule", null, null]);

verifie("UN tap suffit pour essai, signé, annulé",
  ["essai", "signe", "annule"].map((i) => manqueDebrief({ issue: i as "signe" })), [null, null, null]);
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
verifie("estIssueDebrief : les cinq issues tenues + pas décroché + annulé, rien d'autre",
  [...ISSUES_TENUES, "pas_decroche", "annule", "reporte", "constructor", ""].map(estIssueDebrief),
  [true, true, true, true, true, true, true, false, false, false]);

// --- 1b. Le débrief IMPLICITE (miroir du trigger SQL de la 027) ------------
console.log("\n— le débrief implicite —");

verifie("« Pas de réponse » après le RDV : ne ferme RIEN",
  issueImplicite({ type: "note", outcome: "sans_reponse", isExchange: false }), null);
verifie("« Barrage » après le RDV : ne ferme RIEN, même attesté",
  issueImplicite({ type: "note", outcome: "barrage", isExchange: true }), null);
verifie("« À rappeler » → a_rappeler", issueImplicite({ type: "note", outcome: "rappeler", isExchange: true }), "a_rappeler");
verifie("« Intéressé » → a_rappeler", issueImplicite({ type: "note", outcome: "interesse", isExchange: true }), "a_rappeler");
verifie("« Suivi par email » → suivi_email (033)",
  issueImplicite({ type: "note", outcome: "suivi_email", isExchange: true }), "suivi_email");
verifie("« Suivi par email » ferme même sans la case « échange » (le résultat suffit)",
  issueImplicite({ type: "note", outcome: "suivi_email", isExchange: false }), "suivi_email");
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
const statuts: Record<string, string> = { nice: "rendez_vous", vivier: "rendez_vous", gagne: "gagne", perdu: "perdu", ouverte: "a_rappeler", essai: "essai_gratuit" };
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
    rdv("essai", "essai", "2026-10-10T08:00:00Z"),
    rdv("deja", "ouverte", "2026-10-01T08:00:00Z", { status: "honore", debriefed_at: "2026-10-02T08:00:00Z" }),
  ],
  (p) => statuts[p],
  NOW
);
verifie("un seul RDV par fiche — le plus récent ; ni perso, ni fiche close, ni à venir, ni déjà débriefé ; une fiche en ESSAI n'est pas close",
  zone.map((m) => m.id), ["vivier-prev", "nice-06", "essai"]);

// --- 2b. L'essai gratuit clôt le RDV en attente (miroir du trigger 033) -----
console.log("\n— l'essai gratuit clôt le RDV en attente —");
const moto = (id: string, starts_at: string, status = "prevu", extra: Partial<RdvEnAttente> = {}): RdvEnAttente =>
  ({ id, prospect_id: "moto", kind: "prospect", status, starts_at, ...extra });
const rdvMoto = [moto("rdv-29-09", RDV_29_09), moto("rdv-futur", FUTUR)];
verifie("100% MOTO : passer en essai clôt le RDV du 29/09 (commencé, en attente)",
  rdvClosParEssai(rdvMoto, "rendez_vous", "essai_gratuit", NOW)?.id, "rdv-29-09");
verifie("un RDV À VENIR n'est jamais touché",
  rdvClosParEssai([moto("rdv-futur", FUTUR)], "a_rappeler", "essai_gratuit", NOW), null);
verifie("le plus RÉCENT des RDV commencés (les autres : remplacés par la base)",
  rdvClosParEssai([moto("vieux", "2026-09-10T08:00:00Z"), moto("recent", RDV_29_09, "reporte")], "a_rappeler", "essai_gratuit", NOW)?.id,
  "recent");
verifie("déjà en essai : rien (pas de passage)", rdvClosParEssai(rdvMoto, "essai_gratuit", "essai_gratuit", NOW), null);
verifie("une autre étape : rien", rdvClosParEssai(rdvMoto, "rendez_vous", "a_rappeler", NOW), null);
verifie("un RDV déjà débriefé, annulé ou perso : rien",
  rdvClosParEssai([
    moto("deb", RDV_29_09, "prevu", { debriefed_at: "2026-10-01T08:00:00Z" }),
    moto("ann", RDV_29_09, "annule"),
    { id: "perso", prospect_id: null, kind: "perso", status: "prevu", starts_at: RDV_29_09 },
  ], "rendez_vous", "essai_gratuit", NOW), null);

// --- 2c. Débriefer ferme les autres RDV passés (miroir du trigger 036) ------
console.log("\n— débriefer ferme les autres RDV passés de la fiche —");
const api = (id: string, starts_at: string, status = "prevu", extra: Partial<RdvEnAttente> = {}): RdvEnAttente =>
  ({ id, prospect_id: "api", kind: "prospect", status, starts_at, debriefed_at: null, ...extra });
const rdvApi = [
  api("api-26", "2026-09-26T10:17:00Z"),
  api("api-28", "2026-09-28T09:00:00Z"),
  api("api-futur", FUTUR),
  api("api-deja", "2026-09-10T08:00:00Z", "honore", { debriefed_at: "2026-09-11T08:00:00Z" }),
  api("api-annule", "2026-09-12T08:00:00Z", "annule"),
  { id: "autre-fiche", prospect_id: "nice", kind: "prospect", status: "prevu", starts_at: "2026-09-29T08:00:00Z" },
  { id: "perso", prospect_id: null, kind: "perso", status: "prevu", starts_at: "2026-09-27T08:00:00Z" },
];
verifie("API CAR 3000 : débriefer le 26/09 ferme le 28/09 (plus RÉCENT) — rien d'autre",
  rdvFermesParDebrief(rdvApi, "api-26", "rendez_vous", NOW).map((m) => m.id), ["api-28"]);
verifie("débriefer le 28/09 ferme le 26/09 (plus ancien, comme la 027)",
  rdvFermesParDebrief(rdvApi, "api-28", "rendez_vous", NOW).map((m) => m.id), ["api-26"]);
verifie("un RDV à venir, déjà débriefé, annulé, d'une autre fiche ou perso : jamais",
  rdvFermesParDebrief(rdvApi, "api-26", "a_rappeler", NOW).some((m) =>
    ["api-futur", "api-deja", "api-annule", "autre-fiche", "perso"].includes(m.id)), false);
verifie("fiche gagnée ou perdue : rien",
  [rdvFermesParDebrief(rdvApi, "api-26", "gagne", NOW).length, rdvFermesParDebrief(rdvApi, "api-26", "perdu", NOW).length], [0, 0]);
verifie("Nice Cars (29/09, 06/10) : débriefer l'un ferme l'autre",
  rdvFermesParDebrief([api("n29", "2026-09-29T13:00:00Z"), api("n06", "2026-10-06T13:00:00Z")], "n06", "rendez_vous", NOW).map((m) => m.id),
  ["n29"]);
verifie("RDV inconnu : rien", rdvFermesParDebrief(rdvApi, "absent", "rendez_vous", NOW), []);

// --- 3. L'étape « À rappeler » ----------------------------------------------
console.log("\n— l'étape « À rappeler » —");

verifie("sept étapes, « À rappeler » puis « Suivi par email » après Rendez-vous, « Essai gratuit » avant Gagné — plus de « Proposition » ni de « Contacté » (29/10)",
  STATUS_ORDER, ["a_appeler", "rendez_vous", "a_rappeler", "suivi_email", "essai_gratuit", "gagne", "perdu"]);
verifie("rang : rendez_vous < a_rappeler < suivi_email < essai < gagné = perdu",
  [STATUS_RANK.rendez_vous < STATUS_RANK.a_rappeler, STATUS_RANK.a_rappeler < STATUS_RANK.suivi_email,
   STATUS_RANK.suivi_email < STATUS_RANK.essai_gratuit,
   STATUS_RANK.essai_gratuit < STATUS_RANK.gagne, STATUS_RANK.gagne === STATUS_RANK.perdu],
  [true, true, true, true, true]);
verifie("une « proposition » restée en base se lit « À rappeler »", normalizeStatus("proposition"), "a_rappeler");
verifie("un « contacte » resté en base se lit « À rappeler »", normalizeStatus("contacte"), "a_rappeler");
verifie("les plus anciennes : « sans_reponse » → À appeler, « contact_etabli » / « rappel_programme » → À rappeler",
  ["sans_reponse", "contact_etabli", "rappel_programme"].map(normalizeStatus), ["a_appeler", "a_rappeler", "a_rappeler"]);
verifie("« négociation » (ancienne valeur) se lit « À rappeler »", normalizeStatus("negociation"), "a_rappeler");
verifie("normalizeStatus reconnaît « suivi_email »", normalizeStatus("suivi_email"), "suivi_email");
verifie("normalizeStatus reconnaît la nouvelle valeur", normalizeStatus("a_rappeler"), "a_rappeler");

const sansRien = { activities: [], emails: [], meetings: [] };
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
v = evaluateStatus("suivi_email", false, faitsRappel);
verifie("NE RECULE JAMAIS : une fiche en Suivi par email reste en Suivi par email", [v.apply, v.suggest], [false, false]);
v = evaluateStatus("a_rappeler", false, factsFromRows({ ...sansRien, meetings: [{ starts_at: FUTUR, status: "prevu" }] }));
verifie("NE RECULE JAMAIS : un nouveau RDV ne ramène pas « À rappeler » en Rendez-vous", v.apply, false);
v = evaluateStatus("gagne", false, faitsRappel);
verifie("Gagné / Perdu : plus rien ne bouge seul", v.apply, false);

const tenuSuitePosee = factsFromRows({
  ...sansRien,
  meetings: [{ starts_at: RDV_29_09, status: "honore", debrief_issue: "suite_posee", debriefed_at: "2026-10-15T09:00:00Z" }],
});
verifie("un RDV tenu sans issue « à rappeler » ne mène PAS à « À rappeler »", statusFromFacts(tenuSuitePosee), "rendez_vous");
// --- « À rappeler » par le RÉSULTAT d'appel (29/10) -------------------------
const appelRappeler = factsFromRows({
  ...sansRien,
  activities: [{ type: "note", occurred_at: "2026-10-29T15:04:00Z", is_exchange: true, is_draft: false, outcome: "rappeler" }],
});
verifie("un résultat « À rappeler » → l'étape déduite est « À rappeler »",
  statusFromFacts(appelRappeler), "a_rappeler");
verifie("…avec son motif en clair", appelRappeler.rappel?.label,
  "la personne a demandé à être rappelée le 29 oct. 2026");
v = evaluateStatus("a_appeler", false, appelRappeler);
verifie("AVANCE : À appeler → À rappeler", [v.derived, v.apply], ["a_rappeler", true]);
v = evaluateStatus("a_appeler", true, appelRappeler);
verifie("VERROU : seulement suggéré", [v.apply, v.suggest], [false, true]);
v = evaluateStatus("suivi_email", false, appelRappeler);
verifie("NE RECULE JAMAIS : Suivi par email reste", v.apply, false);
v = evaluateStatus("essai_gratuit", false, appelRappeler);
verifie("NE RECULE JAMAIS : Essai gratuit reste", v.apply, false);
verifie("un brouillon « À rappeler » n'est pas un fait",
  statusFromFacts(factsFromRows({ ...sansRien, activities: [{ type: "note", occurred_at: "2026-10-29T15:04:00Z", is_exchange: true, is_draft: true, outcome: "rappeler" }] })),
  "a_appeler");

// --- Plus d'étape « Contacté » (29/10) : chaque fait dit la suite -----------
console.log("\n— sans « Contacté » —");
const note = (outcome: string | null, is_exchange = true, at = "2026-10-29T15:04:00Z", type = "note") =>
  ({ type, occurred_at: at, is_exchange, is_draft: false, outcome });
const etapeDe = (activities: ReturnType<typeof note>[], emails: { direction: string; received_at: string }[] = [], meetings: { starts_at: string; status: string }[] = []) =>
  statusFromFacts(factsFromRows({ activities, emails, meetings }));

verifie("« Intéressé » → « À rappeler »", etapeDe([note("interesse")]), "a_rappeler");
verifie("…avec son motif en clair", factsFromRows({ ...sansRien, activities: [note("interesse")] }).rappel?.label,
  "la personne s'est montrée intéressée le 29 oct. 2026");
verifie("« Barrage » seul (compté comme échange à l'écran) → reste « À appeler »", etapeDe([note("barrage", true)]), "a_appeler");
verifie("« Barrage » de Janet (sans échange) → « À appeler »", etapeDe([note("barrage", false)]), "a_appeler");
verifie("« Pas décroché » → « À appeler »", etapeDe([note("sans_reponse", false)]), "a_appeler");
verifie("trois barrages d'affilée → toujours « À appeler »",
  etapeDe([note("barrage", true, "2026-10-01T08:00:00Z"), note("barrage", true, "2026-10-08T08:00:00Z"), note("barrage", true, "2026-10-15T08:00:00Z")]), "a_appeler");
verifie("« Pas intéressé » n'est pas un fait d'étape (Perdu se pose à la main)", etapeDe([note("refus")]), "a_appeler");
verifie("note attestée SANS résultat (« j'ai réellement eu cet échange ») → « À rappeler »", etapeDe([note(null, true)]), "a_rappeler");
verifie("…avec son motif en clair", factReason("a_rappeler", factsFromRows({ ...sansRien, activities: [note(null, true)] })),
  "un échange a été noté le 29 oct. 2026");
verifie("note « déjà appelé, à contacter par mail » PUIS quatre mails → « Suivi par email » (Baradent, Keller…)",
  etapeDe([note(null, true, "2026-08-05T08:00:00Z"), note(null, true, "2026-08-05T09:00:00Z", "email"), note(null, true, "2026-09-01T08:00:00Z", "email")]),
  "suivi_email");
verifie("mails PUIS un échange au téléphone → « À rappeler » (le plus récent dit la suite)",
  etapeDe([note(null, true, "2026-10-20T08:00:00Z")], [{ direction: "sortant", received_at: "2026-10-01T08:00:00Z" }]), "a_rappeler");
verifie("« Intéressé » PUIS mails → reste « À rappeler » (un résultat d'appel est plus précis qu'un mail)",
  etapeDe([note("interesse", true, "2026-08-01T08:00:00Z")], [{ direction: "sortant", received_at: "2026-10-01T08:00:00Z" }]), "a_rappeler");
verifie("note de repérage (non attestée) → rien", etapeDe([note(null, false)]), "a_appeler");
verifie("Barrage puis note attestée → « À rappeler »",
  etapeDe([note("barrage", true, "2026-10-01T08:00:00Z"), note(null, true, "2026-10-08T08:00:00Z")]), "a_rappeler");
verifie("email envoyé (activité) → « Suivi par email »", etapeDe([note(null, true, "2026-10-01T08:00:00Z", "email")]), "suivi_email");
verifie("email envoyé (ligne emails) → « Suivi par email »", etapeDe([], [{ direction: "sortant", received_at: "2026-10-01T08:00:00Z" }]), "suivi_email");
verifie("réponse reçue → « Suivi par email », motif en clair",
  [etapeDe([], [{ direction: "entrant", received_at: "2026-10-02T08:00:00Z" }]),
   factReason("suivi_email", factsFromRows({ ...sansRien, emails: [{ direction: "entrant", received_at: "2026-10-02T08:00:00Z" }] }))],
  ["suivi_email", "une réponse est arrivée le 02 oct. 2026"]);
verifie("Barrage + email → « Suivi par email »",
  etapeDe([note("barrage", true)], [{ direction: "sortant", received_at: "2026-10-01T08:00:00Z" }]), "suivi_email");
verifie("RDV + email de confirmation → reste « Rendez-vous »",
  etapeDe([], [{ direction: "sortant", received_at: "2026-10-01T08:00:00Z" }], [{ starts_at: FUTUR, status: "prevu" }]), "rendez_vous");
verifie("À rappeler + email → « À rappeler » (le rappel est plus précis que le mail)",
  etapeDe([note("rappeler")], [{ direction: "sortant", received_at: "2026-10-30T08:00:00Z" }]), "a_rappeler");
v = evaluateStatus("suivi_email", false, appelRappeler);
verifie("effet assumé : une fiche en Suivi par email qui reçoit « À rappeler » y reste (on ne recule jamais)", v.apply, false);
verifie("aucun fait ne mène plus à « Contacté »",
  [etapeDe([note(null)]), etapeDe([note("barrage")]), etapeDe([note("interesse")]), etapeDe([], [{ direction: "sortant", received_at: FUTUR }])]
    .includes("contacte" as never), false);
v = evaluateStatus("a_appeler", true, factsFromRows({ ...sansRien, activities: [note("interesse")] }));
verifie("VERROU : « Intéressé » sur une fiche verrouillée → suggestion seulement", [v.apply, v.suggest], [false, true]);
v = evaluateStatus("a_rappeler", false, factsFromRows({ ...sansRien, activities: [note("barrage")] }));
verifie("NE RECULE JAMAIS : un barrage ne ramène pas « À rappeler » en « À appeler »", [v.derived, v.apply], ["a_appeler", false]);

// --- « Suivi par email » : on y entre par le FAIT ---------------------------
const appelSuivi = factsFromRows({
  ...sansRien,
  activities: [{ type: "note", occurred_at: "2026-10-16T09:00:00Z", is_exchange: true, is_draft: false, outcome: "suivi_email" }],
});
verifie("un résultat « Suivi par email » → l'étape déduite est « Suivi par email »", statusFromFacts(appelSuivi), "suivi_email");
verifie("…avec son motif en clair", appelSuivi.suiviEmail?.label,
  "la personne a demandé un suivi par email le 16 oct. 2026");
v = evaluateStatus("a_appeler", false, appelSuivi);
verifie("AVANCE : À appeler → Suivi par email", [v.derived, v.apply], ["suivi_email", true]);
v = evaluateStatus("a_rappeler", false, appelSuivi);
verifie("AVANCE : À rappeler → Suivi par email", v.apply, true);
v = evaluateStatus("essai_gratuit", false, appelSuivi);
verifie("NE RECULE JAMAIS : Essai gratuit reste Essai gratuit", v.apply, false);
v = evaluateStatus("a_rappeler", true, appelSuivi);
verifie("VERROU : seulement suggéré", [v.apply, v.suggest], [false, true]);
verifie("un brouillon « Suivi par email » n'est pas un fait",
  statusFromFacts(factsFromRows({ ...sansRien, activities: [{ type: "note", occurred_at: "2026-10-16T09:00:00Z", is_exchange: true, is_draft: true, outcome: "suivi_email" }] })),
  "a_appeler");
verifie("un RDV débriefé « Suivi par email » → « Suivi par email »",
  statusFromFacts(factsFromRows({ ...sansRien, meetings: [{ starts_at: RDV_29_09, status: "honore", debrief_issue: "suivi_email", debriefed_at: "2026-10-14T09:00:00Z" }] })),
  "suivi_email");

verifie("un RDV remplacé (annulé) n'est pas un fait",
  statusFromFacts(factsFromRows({ ...sansRien, meetings: [{ starts_at: RDV_29_09, status: "annule", debrief_issue: "remplace" }] })),
  "a_appeler");
verifie("aucun fait ne mène plus à « Proposition » (retirée le 29/10)",
  [statusFromFacts(faitsRappel), statusFromFacts(appelSuivi)].includes("proposition" as never), false);

// --- 3bis. L'étape « Essai gratuit » (030) -----------------------------------
console.log("\n— l'étape « Essai gratuit » —");
verifie("rang : suivi_email < essai_gratuit < gagné = perdu",
  [STATUS_RANK.suivi_email < STATUS_RANK.essai_gratuit, STATUS_RANK.essai_gratuit < STATUS_RANK.gagne,
   STATUS_RANK.gagne === STATUS_RANK.perdu], [true, true, true]);
verifie("manuelle : jamais déduite (MANUAL_ONLY)", [isManualOnly("essai_gratuit"), isManualOnly("suivi_email")], [true, false]);
verifie("normalizeStatus la reconnaît", normalizeStatus("essai_gratuit"), "essai_gratuit");
v = evaluateStatus("essai_gratuit", false, appelSuivi);
verifie("NE RECULE JAMAIS : un suivi par email ne ramène pas l'essai en arrière", [v.apply, v.suggest], [false, false]);
verifie("aucun fait ne mène à l'essai", statusFromFacts(faitsRappel) === "essai_gratuit", false);


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
  raisonAffichee("suivi_email", "un email a été échangé le 01/10/2026", faitsPasse), "un email a été échangé le 01/10/2026");

console.log(echecs === 0 ? "\nTous les cas passent." : `\n${echecs} cas en ÉCHEC.`);
process.exit(echecs === 0 ? 0 : 1);
