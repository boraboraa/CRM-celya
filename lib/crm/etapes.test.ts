// npm run test:etapes — l'étape déduite du journal, sans « Contacté » (29/10).
//
// Le jeu de cas `etapes.cas.json` est joué ICI contre la règle TypeScript
// (`factsFromRows` → `statusFromFacts`, lib/crm/status.ts) ET par la recette
// SQL de la 042 (`supabase/recettes/042_assembler.sh`), contre la recopie
// SQL qui range les fiches restées en « Contacté ». Les deux doivent dire la
// même chose : c'est ce qui garantit qu'aucune fiche ne part ailleurs que là
// où l'écran l'aurait mise.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { factsFromRows, statusFromFacts } from "./status.ts";

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
