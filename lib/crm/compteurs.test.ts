// npm run test:objectifs — la règle de comptage (recopie de `compteurs_pour`,
// migration 031), les bornes de semaine à Bruxelles, et ce que l'écran en dit.
// Le jeu de cas `compteurs.cas.json` est joué AUSSI par la recette SQL de la 031.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  ajouterJours,
  avancement,
  compter,
  jourBruxelles,
  lundiDe,
  minuitBruxelles,
  ordreClassement,
  phraseObjectifs,
  ZERO,
  type LignesCompteurs,
} from "./compteurs.ts";

let ok = 0;
function cas(nom: string, f: () => void) {
  f();
  ok++;
  console.log(`  ✓ ${nom}`);
}

type Jeu = {
  semaine: { debut: string; fin: string };
  activites: { author: string; outcome: string | null; meeting?: boolean; draft?: boolean; occurred_at: string }[];
  rdv: { created_by: string | null; owner: string; kind: string; status: string; created_at: string }[];
  fiches: { owner: string; created_by: string; created_at: string; essai_gratuit_at: string | null }[];
  attendu: Record<string, Record<string, number>>;
};
const jeu = JSON.parse(readFileSync(new URL("./compteurs.cas.json", import.meta.url), "utf8")) as Jeu;
const lignes: LignesCompteurs = {
  activites: jeu.activites.map((a) => ({
    author_id: a.author,
    outcome: a.outcome,
    is_draft: a.draft ?? false,
    meeting_id: a.meeting ? "m" : null,
    occurred_at: a.occurred_at,
  })),
  rdv: jeu.rdv.map((m) => ({ created_by: m.created_by, owner_id: m.owner, kind: m.kind, status: m.status, created_at: m.created_at })),
  fiches: jeu.fiches.map((p) => ({ owner_id: p.owner, created_by: p.created_by, created_at: p.created_at, essai_gratuit_at: p.essai_gratuit_at })),
};

for (const [u, attendu] of Object.entries(jeu.attendu)) {
  cas(`le jeu de cas : ${u} → ${JSON.stringify(attendu)}`, () => {
    assert.deepEqual(compter(lignes, u, jeu.semaine.debut, jeu.semaine.fin), attendu);
  });
}

cas("bornes : minuit à Bruxelles, heure d'hiver (UTC+1) et d'été (UTC+2)", () => {
  assert.equal(new Date(minuitBruxelles("2026-11-02")).toISOString(), "2026-11-01T23:00:00.000Z");
  assert.equal(new Date(minuitBruxelles("2026-07-06")).toISOString(), "2026-07-05T22:00:00.000Z");
});

cas("la semaine se désigne par son lundi — du lundi au dimanche", () => {
  assert.equal(lundiDe("2026-11-02"), "2026-11-02"); // lundi
  assert.equal(lundiDe("2026-11-08"), "2026-11-02"); // dimanche
  assert.equal(lundiDe("2026-11-09"), "2026-11-09"); // lundi suivant
  assert.equal(lundiDe("2026-11-04"), "2026-11-02");
  assert.equal(ajouterJours("2026-10-26", 7), "2026-11-02");
});

cas("le jour à Bruxelles d'un instant : dimanche 23h30 est encore dimanche", () => {
  assert.equal(jourBruxelles("2026-11-01T22:30:00Z"), "2026-11-01");
  assert.equal(jourBruxelles("2026-11-01T23:10:00Z"), "2026-11-02");
});

cas("la semaine qui enjambe le changement d'heure (25/10/2026) compte 7 jours pleins", () => {
  const l: LignesCompteurs = { activites: [], rdv: [], fiches: [] };
  l.activites.push({ author_id: "U", outcome: "barrage", occurred_at: "2026-10-25T22:59:00Z" }); // dimanche 23h59 (UTC+1)
  l.activites.push({ author_id: "U", outcome: "barrage", occurred_at: "2026-10-18T22:00:00Z" }); // lundi 19/10 0h00 (UTC+2)
  assert.equal(compter(l, "U", "2026-10-19", "2026-10-26").appels, 2);
});

cas("la phrase de « À faire » : objectifs posés", () => {
  const s = { ...ZERO, appels: 23, reponses: 6, rdv: 1 };
  assert.equal(
    phraseObjectifs(s, 0, { appels: 60, reponses: 15, rdv: 3, essaisPeriode: 2 }),
    "23/60 appels · 6/15 réponses · 1/3 RDV · 0/2 essais"
  );
});

cas("la phrase sans objectif : le compte seul", () => {
  assert.equal(phraseObjectifs({ ...ZERO, appels: 1 }, 1, null), "1 appel · 0 réponse · 0 RDV · 1 essai");
});

cas("l'avancement est borné à 100 %, null sans objectif", () => {
  assert.equal(avancement(23, 60), 38);
  assert.equal(avancement(80, 60), 100);
  assert.equal(avancement(3, null), null);
  assert.equal(avancement(3, 0), null);
});

cas("le classement : essais, puis RDV, puis réponses, puis appels, puis le nom", () => {
  const l = [
    { ...ZERO, nom: "Hakim", appels: 80, reponses: 10, rdv: 1 },
    { ...ZERO, nom: "Aissata", appels: 40, reponses: 12, rdv: 2 },
    { ...ZERO, nom: "Meryem", appels: 40, essais: 1 },
    { ...ZERO, nom: "Estelia", appels: 80, reponses: 10, rdv: 1 },
  ];
  assert.deepEqual(ordreClassement(l).map((x) => x.nom), ["Meryem", "Aissata", "Estelia", "Hakim"]);
});

console.log(`\n${ok} cas OK`);
