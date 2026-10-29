// npm run test:ajout-rapide — l'ajout rapide du téléphone (19/10).
import assert from "node:assert/strict";
import { CHAMPS_FORMULAIRE, entreeFormulaire, ligneProspect } from "./ligneProspect.ts";
import { lireCeQuiSestPasse, jourCourt, heureCourte } from "./ajoutRapide.ts";
import { lireRaccourcis } from "./raccourcis.ts";
import { doublonsProbables, cleSociete } from "./recherche.ts";

let ok = 0;
function cas(nom: string, f: () => void) {
  f();
  ok++;
  console.log(`  ✓ ${nom}`);
}

const MOI = "11111111-1111-4111-8111-111111111111";
/** Un FormData réduit à ce que le formulaire porte. */
const formulaire = (champs: Record<string, string>) => (k: string) => champs[k] ?? null;

// --- La MÊME ligne que le formulaire complet --------------------------------
const rapide = ligneProspect(
  entreeFormulaire(formulaire({ company_name: " Garage Alpha ", contact_name: "Jean", phone: "081 22 33 44" })),
  MOI
);
const complet = ligneProspect(
  entreeFormulaire(
    formulaire({
      company_name: "Garage Alpha", contact_name: "Jean", email: "", phone: "081 22 33 44",
      website: "", sector: "", address: "", city: "", status: "", source: "",
      value_estimate: "", owner_id: "", notes: "",
    })
  ),
  MOI
);

cas("ajout rapide et formulaire complet : la même ligne, à l'octet près", () => {
  assert.deepEqual(rapide, complet);
});

cas("toutes les colonnes, toujours les mêmes clés (piège PGRST102)", () => {
  const pleine = ligneProspect(
    entreeFormulaire(formulaire({
      company_name: "X", contact_name: "Y", email: "A@B.BE", phone: "1", website: "w", sector: "s",
      address: "a", city: "c", status: "a_rappeler", source: "so", value_estimate: "1 200,50", owner_id: "", notes: "n",
    })),
    MOI
  );
  assert.deepEqual(Object.keys(rapide).sort(), Object.keys(pleine).sort());
  assert.equal(pleine.value_estimate, 1200.5);
  assert.equal(pleine.email, "a@b.be");
  for (const k of CHAMPS_FORMULAIRE) assert.ok(k in rapide || k === "owner_id", k);
});

cas("ce que l'ajout rapide ne porte pas vaut null — jamais une valeur inventée", () => {
  for (const k of ["email", "website", "sector", "address", "city", "source", "value_estimate", "notes", "probability"] as const) {
    assert.equal(rapide[k], null, k);
  }
});

cas("responsable = soi, étape = « À appeler » (les faits la feront avancer)", () => {
  assert.equal(rapide.owner_id, MOI);
  assert.equal(rapide.created_by, MOI);
  assert.equal(rapide.status, "a_appeler");
});

cas("société vide → « Sans nom » (le bouton l'exige déjà)", () => {
  assert.equal(ligneProspect(entreeFormulaire(formulaire({})), MOI).company_name, "Sans nom");
});

// --- « Ce qui s'est passé » --------------------------------------------------
// Lundi 19 octobre 2026, 15h à Bruxelles.
const LUNDI = new Date("2026-10-19T13:00:00Z");
const lire = (t: string, o?: Parameters<typeof lireCeQuiSestPasse>[2]) =>
  lireCeQuiSestPasse(t, lireRaccourcis(t, LUNDI), o);

cas("« rdv mardi 11h » pose un VRAI rendez-vous", () => {
  const l = lire("rdv mardi 11h");
  assert.equal(l.manque, null);
  assert.equal(l.echange?.type, "rendez_vous");
  assert.equal(l.echange?.dateLocale, "2026-10-20T11:00");
  assert.equal(l.echange?.isExchange, true);
  assert.equal(l.echange?.note, "rdv mardi 11h");
  assert.deepEqual(l.pastilles, ["Rendez-vous mar. 20/10 à 11h"]);
});

cas("un rendez-vous SANS heure n'est jamais posé — l'écran dit ce qui manque", () => {
  const l = lire("rdv jeudi");
  assert.equal(l.echange, null);
  assert.equal(l.manque, "heure");
  assert.deepEqual(l.pastilles, ["Rendez-vous : quelle heure ?"]);
});

cas("un rendez-vous SANS jour non plus — jamais aujourd'hui par défaut", () => {
  const l = lire("rdv à 14h");
  assert.equal(l.echange, null);
  assert.equal(l.manque, "jour");
});

cas("« sans le rendez-vous » : le texte part en note, aucun RDV", () => {
  const l = lire("rdv jeudi", { sansRdv: true });
  assert.equal(l.manque, null);
  assert.equal(l.echange?.type, "note");
  assert.equal(l.echange?.dateLocale, null);
});

cas("« rappeler jeudi » pose une relance, et c'est un échange réel", () => {
  const l = lire("intéressé, rappeler jeudi");
  assert.equal(l.echange?.type, "note");
  assert.equal(l.echange?.dateLocale, "2026-10-22");
  assert.equal(l.echange?.isExchange, true);
  assert.ok(l.pastilles.includes("Relance jeu. 22/10"));
});

cas("« pdr » : appel sans réponse, pas un échange", () => {
  const l = lire("pdr");
  assert.equal(l.echange?.noAnswer, true);
  assert.equal(l.echange?.isExchange, false);
  assert.ok(l.pastilles.includes("Appelé, pas décroché"));
});

cas("« Repéré, pas encore contacté » : note de repérage, la fiche reste « À appeler »", () => {
  const l = lire("vu en passant, atelier ouvert le samedi", { repere: true });
  assert.equal(l.echange?.isExchange, false);
  assert.equal(l.echange?.noAnswer, false);
  assert.ok(l.pastilles.includes("Repérage — reste « À appeler »"));
});

cas("par défaut, ce qui s'est passé EST un échange réel", () => {
  assert.equal(lire("passé au garage, le gérant est intéressé")?.echange?.isExchange, true);
});

cas("« devis envoyé » : une note, plus de pastille « Proposition » (retirée le 29/10)", () => {
  const r = lire("devis envoyé");
  assert.equal(r?.echange?.type, "note");
  assert.equal(r?.pastilles.some((p) => /proposition/i.test(p)), false);
});

cas("ligne vide : rien à consigner, rien de bloqué", () => {
  assert.deepEqual(lire("   "), { echange: null, manque: null, pastilles: [] });
});

cas("le contact saisi prime sur celui lu dans le texte", () => {
  assert.equal(lire("avec Paul Martin, rappeler jeudi", { contactSaisi: "Jean" }).echange?.contactName, "Jean");
});

cas("jours et heures en clair", () => {
  assert.equal(jourCourt("2026-10-25"), "dim. 25/10");
  assert.equal(heureCourte("11:00"), "11h");
  assert.equal(heureCourte("09:30"), "9h30");
});

// --- Doublons : même recherche que ⌘K ---------------------------------------
const trouvees = [
  { id: "a", company_name: "Garage Dupont et fils", phone: null },
  { id: "b", company_name: "GARAGE DUPONT SRL", phone: "+32 81 99 88 77" },
  { id: "c", company_name: "Carrosserie Martin", phone: "081 22 33 44" },
  { id: "c", company_name: "Carrosserie Martin", phone: "081 22 33 44" },
];

cas("même numéro (chiffre à chiffre) d'abord, puis même nom, puis voisin", () => {
  const d = doublonsProbables({ nom: "Garage Dupont", telephone: "+32 81 22 33 44" }, trouvees);
  assert.deepEqual(d.map((x) => [x.fiche.id, x.raison]), [["c", "telephone"], ["b", "nom"], ["a", "proche"]]);
});

cas("une fiche trouvée deux fois (nom ET numéro) n'apparaît qu'une fois", () => {
  const d = doublonsProbables({ nom: "Carrosserie Martin", telephone: "0032 81 22 33 44" }, trouvees);
  assert.equal(d.filter((x) => x.fiche.id === "c").length, 1);
});

cas("la forme juridique et les accents ne font pas un autre nom", () => {
  assert.equal(cleSociete("Garage Dupont SRL"), cleSociete("garage-dupont"));
  assert.equal(cleSociete("Éts Hébert"), cleSociete("ets hebert"));
});

cas("rien de commun : aucun doublon", () => {
  assert.deepEqual(doublonsProbables({ nom: "Pneus Zêta", telephone: "0470 00 00 00" }, trouvees), []);
});

console.log(`\n${ok} OK`);
