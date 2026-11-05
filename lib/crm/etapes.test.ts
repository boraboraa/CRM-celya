// npm run test:etapes — l'étape déduite du journal, sans « Contacté » (29/10).
// 05/11 (Bora) : « Pas décroché » n'est plus un fait d'étape — « À appeler »
// = jamais appelée OU uniquement des « Pas décroché » ; une fiche qui a eu un
// vrai échange reste « À appeler » même si un « Pas décroché » suit.
//
// Le jeu de cas `etapes.cas.json` est joué ICI contre la règle TypeScript
// (`factsFromRows` → `statusFromFacts`, lib/crm/status.ts) ET par la recette
// SQL de la 042 (`supabase/recettes/042_assembler.sh`), contre la recopie
// SQL qui range les fiches restées en « Contacté ». Les deux doivent dire la
// même chose : c'est ce qui garantit qu'aucune fiche ne part ailleurs que là
// où l'écran l'aurait mise.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { evaluateStatus, factsFromRows, factReason, raisonAffichee, statusFromFacts } from "./status.ts";

type Cas = {
  nom: string;
  attendu: string;
  activities?: { at: string; type?: string; outcome?: string | null; is_exchange?: boolean; is_draft?: boolean }[];
  emails?: { direction: string; at: string }[];
  meetings?: { starts_at: string; status: string; debrief_issue?: string | null }[];
};

const cas: Cas[] = JSON.parse(readFileSync(new URL("./etapes.cas.json", import.meta.url), "utf8"));

let ok = 0;
for (const c of cas) {
  const etape = statusFromFacts(
    factsFromRows({
      activities: (c.activities ?? []).map((a) => ({
        type: a.type ?? "note",
        occurred_at: a.at,
        is_exchange: a.is_exchange ?? true,
        is_draft: a.is_draft ?? false,
        outcome: a.outcome ?? null,
      })),
      emails: (c.emails ?? []).map((e) => ({ direction: e.direction, received_at: e.at })),
      meetings: (c.meetings ?? []).map((m) => ({ starts_at: m.starts_at, status: m.status, debrief_issue: m.debrief_issue ?? null })),
    })
  );
  assert.equal(etape, c.attendu, c.nom);
  assert.notEqual(etape, "contacte", c.nom);
  ok++;
  console.log(`  ✓ ${c.nom} → ${etape}`);
}

const attendus = new Set(cas.map((c) => c.attendu));
for (const e of ["a_appeler", "a_rappeler", "suivi_email", "rendez_vous"]) {
  assert.ok(attendus.has(e), `le jeu de cas couvre « ${e} »`);
}
console.log(`\n${ok} cas — tout passe.`);

// --- Le motif d'une fiche déjà tentée (05/11) --------------------------------
const ligne = (at: string, outcome: string | null, extra: Partial<{ type: string; is_exchange: boolean }> = {}) => ({
  type: extra.type ?? "note",
  occurred_at: at,
  is_exchange: extra.is_exchange ?? outcome !== "sans_reponse",
  is_draft: false,
  outcome,
});
const unPasDecroche = factsFromRows({ activities: [ligne("2026-11-05T09:30:00Z", "sans_reponse")], emails: [], meetings: [] });
assert.equal(unPasDecroche.tentative?.label, "appelée le 05/11, sans réponse");
assert.equal(unPasDecroche.echange, null, "un pas décroché n'est pas un échange");
assert.equal(raisonAffichee("a_appeler", null, unPasDecroche), "appelée le 05/11, sans réponse");
assert.equal(raisonAffichee("a_appeler", "jamais appelée", unPasDecroche), "appelée le 05/11, sans réponse");
assert.equal(factReason("a_appeler", unPasDecroche), "appelée le 05/11, sans réponse");
console.log("  ✓ motif : « appelée le 05/11, sans réponse » sous « À appeler »");

const troisFois = factsFromRows({
  activities: [
    ligne("2026-11-03T09:00:00Z", "sans_reponse"),
    ligne("2026-11-05T15:30:00Z", "sans_reponse"),
    ligne("2026-11-04T09:00:00Z", "barrage", { is_exchange: true }),
  ],
  emails: [],
  meetings: [],
});
assert.equal(troisFois.tentative?.label, "appelée 3 fois sans réponse, la dernière le 05/11");
console.log("  ✓ motif : « appelée 3 fois sans réponse, la dernière le 05/11 »");

const jamais = factsFromRows({ activities: [], emails: [], meetings: [] });
assert.equal(raisonAffichee("a_appeler", null, jamais), null);
assert.equal(raisonAffichee("a_appeler", "jamais appelée", jamais), "jamais appelée");
console.log("  ✓ motif : une fiche jamais appelée n'invente rien");

// Le motif de tentative ne se montre que sous « À appeler ».
const rappelPuisPasDecroche = factsFromRows({
  activities: [ligne("2026-11-02T09:00:00Z", "rappeler"), ligne("2026-11-05T09:00:00Z", "sans_reponse")],
  emails: [],
  meetings: [],
});
assert.equal(
  raisonAffichee("a_rappeler", "x", rappelPuisPasDecroche),
  rappelPuisPasDecroche.rappel?.label
);
console.log("  ✓ motif : sous « À rappeler », le rappel demandé reste le motif");

// --- Le rang : un « Pas décroché » ne fait jamais reculer une fiche ----------
let v = evaluateStatus("a_rappeler", false, unPasDecroche);
assert.equal(v.derived, "a_appeler");
assert.equal(v.apply, false, "pas de recul automatique — c'est la reprise 046 qui range l'existant");
v = evaluateStatus("a_appeler", false, unPasDecroche);
assert.deepEqual([v.apply, v.suggest], [false, false], "« À appeler » + pas décroché : rien ne bouge");
v = evaluateStatus("a_appeler", false, rappelPuisPasDecroche);
assert.deepEqual([v.derived, v.apply], ["a_rappeler", true]);
console.log("  ✓ rang : un pas décroché ne déplace rien, un vrai échange avance");
