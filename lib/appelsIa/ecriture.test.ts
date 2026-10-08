/**
 * Ce qu'un appel écrit sur la fiche, les gardes avant de composer, le secteur,
 * le brief :
 *
 *   node --experimental-strip-types lib/appelsIa/ecriture.test.ts
 */

import { ecritureFiche, lireDeclaration } from "./resultat.ts";
import { gardeAvantComposer, type FaitsFiche } from "./garde.ts";
import { secteurDe } from "./secteur.ts";
import {
  briefDepuisFiche,
  briefEnTexte,
  depuisSaisie,
  fusionner,
  ligneApprise,
  normaliserAppris,
  normaliserContenu,
} from "./brief.ts";
import { verifie, vrai, bilan } from "./verifie.ts";

// ---------------------------------------------------------------- l'ordre des preuves, les cinq résultats
const decl = (p: Record<string, unknown>) => lireDeclaration({ resume: "Résumé", decideur: false, ...p });
const sans = { rdvPose: false, opposition: false };

const e1 = ecritureFiche("repondu_humain", { rdvPose: true, opposition: false, rdvLibelle: "mardi 13 octobre à 10h" }, decl({ resultat: "rappeler" }));
verifie("RDV posé → intéressé, même si Janet déclare « rappeler »", [e1.resultat, e1.isExchange], ["interesse", true]);
const e2 = ecritureFiche("repondu_humain", { rdvPose: false, opposition: true }, decl({ resultat: "interesse" }));
verifie("opposition → refus, motif « Ne veut plus être appelé »", [e2.resultat, e2.motifRefus], ["refus", "Ne veut plus être appelé"]);
const e3 = ecritureFiche("repondeur", sans, decl({ resultat: "interesse" }));
verifie("répondeur → pas de réponse, PAS un échange, même si Janet déclare autre chose", [e3.resultat, e3.isExchange, e3.sujet], ["sans_reponse", false, "Répondeur"]);
const e4 = ecritureFiche("sans_reponse", sans, null);
verifie("pas décroché → pas de réponse", [e4.resultat, e4.isExchange, e4.sujet], ["sans_reponse", false, "Pas décroché"]);
const e5 = ecritureFiche("occupe_echec", sans, null);
verifie("occupé → pas de réponse", [e5.resultat, e5.isExchange], ["sans_reponse", false]);
const e6 = ecritureFiche("standard_ivr", sans, null);
verifie("standard automatique → barrage SANS échange (la fiche ne passe pas en Contacté)", [e6.resultat, e6.isExchange, e6.sujet], ["barrage", false, "Standard automatique"]);
for (const r of ["interesse", "rappeler", "refus", "barrage"] as const) {
  const e = ecritureFiche("repondu_humain", sans, decl({ resultat: r, resume: `Cas ${r}`, motif_refus: r === "refus" ? "Déjà équipé" : undefined }));
  verifie(`humain qui déclare « ${r} » → ${r}, échange réel`, [e.resultat, e.isExchange, e.sujet], [r, true, `Cas ${r}`]);
}
verifie("refus : le motif part dans lost_reason", ecritureFiche("repondu_humain", sans, decl({ resultat: "refus", motif_refus: "Déjà équipé" })).motifRefus, "Déjà équipé");
const e7 = ecritureFiche("repondu_humain", sans, null);
verifie("humain sans déclaration → « à rappeler », jamais deviné en « pas de réponse »", [e7.resultat, e7.isExchange], ["rappeler", true]);
verifie("le sujet n'a pas de préfixe « Appel IA · »", /^Appel IA/.test(e7.sujet), false);

// Le nom du contact : seulement le décideur.
verifie(
  "décideur → son nom est écrit sur la fiche",
  ecritureFiche("repondu_humain", sans, decl({ resultat: "interesse", interlocuteur: "Marc Dupont, gérant", decideur: true })).contact,
  "Marc Dupont, gérant"
);
verifie(
  "secrétaire → son nom n'est JAMAIS écrit comme contact",
  ecritureFiche("repondu_humain", sans, decl({ resultat: "barrage", interlocuteur: "Julie, secrétaire", decideur: false })).contact,
  null
);
verifie("déclaration avec un résultat inconnu → rien n'est deviné", lireDeclaration({ resultat: "peut-etre", resume: "x" }), null);
verifie("déclaration : date de rappel illisible ignorée", decl({ resultat: "rappeler", rappeler_le: "jeudi" })?.rappelerLe, null);

// ---------------------------------------------------------------- les gardes avant de composer
const fiche = (p: Partial<FaitsFiche>): FaitsFiche => ({
  existe: true,
  statut: "a_appeler",
  phone: "081 22 33 44",
  rdvAVenir: false,
  enOpposition: () => false,
  depuis: null,
  ...p,
});
verifie("fiche normale → on compose le numéro E.164", gardeAvantComposer(fiche({})), { ok: true, numero: "+3281223344" });
verifie("fiche supprimée", gardeAvantComposer(fiche({ existe: false })), { ok: false, motif: "fiche supprimée" });
verifie("fiche gagnée → jamais appelée", gardeAvantComposer(fiche({ statut: "gagne" })).ok, false);
verifie("fiche perdue → jamais appelée", gardeAvantComposer(fiche({ statut: "perdu" })).ok, false);
verifie("numéro 0900 → pas appelé", gardeAvantComposer(fiche({ phone: "0900 12 345" })).ok, false);
verifie("numéro sur la liste d'opposition", gardeAvantComposer(fiche({ enOpposition: (n) => n === "+3281223344" })), { ok: false, motif: "numéro sur la liste d'opposition" });
verifie("RDV à venir → pas appelé", gardeAvantComposer(fiche({ rdvAVenir: true })).ok, false);
const bouge = (d: Partial<NonNullable<FaitsFiche["depuis"]>>) =>
  gardeAvantComposer(fiche({ depuis: { activitesHumaines: 0, emailsEntrants: 0, rdvPosesHorsJanet: 0, etapeChangeeALaMain: false, ...d } }));
verifie("rien n'a bougé depuis l'essai 1 → on compose", bouge({}).ok, true);
verifie("un échange noté par un humain → le cycle s'arrête", bouge({ activitesHumaines: 1 }), { ok: false, motif: "la fiche a bougé : un échange ou une note a été ajouté sur la fiche" });
verifie("un mail reçu → le cycle s'arrête", bouge({ emailsEntrants: 1 }).ok, false);
verifie("un RDV posé → le cycle s'arrête", bouge({ rdvPosesHorsJanet: 1 }).ok, false);
verifie("l'étape changée à la main → le cycle s'arrête", bouge({ etapeChangeeALaMain: true }).ok, false);

// ---------------------------------------------------------------- le secteur
const secteurs: [string | null, string][] = [
  ["Garage / carrosserie", "garage"],
  ["Carrosserie", "garage"],
  ["garage", "garage"],
  ["Dentiste", "cabinet"],
  ["Vétérinaire", "cabinet"],
  ["Cabinet de kinésithérapie", "cabinet"],
  ["Restaurant / HoReCa", "restaurant"],
  ["Brasserie", "restaurant"],
  ["Pizzeria", "restaurant"],
  ["Agence immobilière", "autre"],
  ["Courtier assurances", "autre"],
  ["Chauffage / sanitaire", "autre"],
  ["", "autre"],
  [null, "autre"],
];
for (const [s, attendu] of secteurs) verifie(`secteur « ${s} » → ${attendu}`, secteurDe(s), attendu);

// ---------------------------------------------------------------- le brief
const d = "2026-10-08";
const min = briefDepuisFiche({ company_name: "Garage Dupont", contact_name: "Marc Dupont", sector: "Garage", city: "Namur", notes: "Ouvert le samedi" }, d);
verifie("brief minimal : la fiche, et rien d'inventé", min, {
  activite: { texte: "Garage à Namur", source: "fiche", date: d },
  qui_demander: { texte: "Marc Dupont", source: "fiche", date: d },
  ce_qu_on_sait: [{ texte: "Ouvert le samedi", source: "fiche", date: d }],
});
verifie("fiche nue → brief vide", briefDepuisFiche({ company_name: "X" }, d), {});
const claude = depuisSaisie({ accroche: "Ils ratent des appels le samedi", questions: "Qui décroche le samedi ?\n- Combien d'appels ?" }, "claude", d);
verifie("saisie Claude : sourcée et datée", claude.questions?.map((q) => [q.texte, q.source]), [["Qui décroche le samedi ?", "claude"], ["Combien d'appels ?", "claude"]]);
const ia = depuisSaisie({ accroche: "Accroche de l'IA", activite: "Garage multimarque" }, "ia", d);
const complete = fusionner(fusionner(min, claude, "remplacer"), ia, "completer");
verifie("l'IA complète sans réécrire Claude", complete.accroche?.source, "claude");
verifie("l'IA comble seulement ce qui manque", complete.activite?.source, "fiche");
verifie("remplacer : le champ fourni remplace", fusionner(min, ia, "remplacer").activite?.texte, "Garage multimarque");
verifie("lecture tolérante d'un contenu abîmé", normaliserContenu({ accroche: { texte: "  ok  ", source: "inconnue" }, questions: "pas une liste", bidon: 1 }, d), {
  accroche: { texte: "ok", source: "bora", date: d },
});
verifie("appris : lignes illisibles ignorées", normaliserAppris([{ date: d, texte: "ok" }, { texte: "" }, 3]), [{ date: d, texte: "ok" }]);
verifie(
  "ligne apprise, déterministe",
  ligneApprise({ date: d, essai: 1, interlocuteur: "Julie, secrétaire", decideur: false, appris: "Le gérant est là le mardi matin", resultatLibelle: "Barrage" }),
  { date: d, essai: 1, texte: "Barrage. Interlocuteur : Julie, secrétaire. Le gérant est là le mardi matin" }
);
verifie("rien d'appris sans déclaration", ligneApprise({ date: d, essai: 1, interlocuteur: null, decideur: false, appris: null, resultatLibelle: "Répondeur" }), null);
const texte = briefEnTexte(complete, [{ date: d, essai: 1, texte: "Barrage. Le gérant est là le mardi" }]);
vrai("le brief en texte cite ses sources et ses dates", texte.includes("(Claude, 08/10/2026)") && texte.includes("(fiche, 08/10/2026)"), texte);
vrai("le brief en texte porte ce que Janet a appris", texte.includes("Ce que Janet a appris aux appels précédents"));
verifie("brief vide → une phrase, pas un trou", briefEnTexte({}, []), "Rien de plus que le nom de l'entreprise : découvre-la par tes questions.");

bilan("Écriture sur la fiche, gardes, secteur, brief");
