// npm run test:geste-relance — les gestes en un tap sur une relance (cocher,
// rouvrir, supprimer) et le verrou « un envoi ne part jamais deux fois ».
import assert from "node:assert/strict";
import {
  DELAI_ANNULER_MS,
  DUREE_REPLI_MS,
  annuler,
  avancer,
  demarrer,
  echec,
  finRetour,
  gesteDeLaCase,
  inverse,
  oublierPartis,
  peutToucher,
  valeurDone,
  vider,
  vueStable,
  type GesteLigne,
} from "./gesteRelance.ts";
import { DOUBLE_TAP_MS, creerVerrou, lancerUneFois } from "../unSeulEnvoi.ts";

let ok = 0;
async function cas(nom: string, f: () => void | Promise<void>) {
  await f();
  ok++;
  console.log(`  ✓ ${nom}`);
}

type T = { id: string; titre: string };
const t = (id: string): T => ({ id, titre: `Relance ${id}` });
const LISTE = [t("a"), t("b"), t("c"), t("d")];
const VIDE = new Map<string, GesteLigne<T>>();
const AUCUN = new Set<string>();
const ids = (v: { tache: T }[]) => v.map((l) => l.tache.id).join("");

await cas("la case dit ce qu'elle FAIT : « faire » sur les ouvertes, « rouvrir » sur les passées", () => {
  assert.equal(gesteDeLaCase("faire"), "fait");
  assert.equal(gesteDeLaCase("rouvrir"), "rouvrir");
  assert.equal(valeurDone("fait"), "1");
  assert.equal(valeurDone("rouvrir"), "0");
});

await cas("double tap : le second tap est IGNORÉ — une seule écriture, jamais « rouvrir »", () => {
  // Ce que fait le hook : envoyer seulement si `demarrer` accepte.
  const envois: string[] = [];
  let gestes: Map<string, GesteLigne<T>> = VIDE;
  for (const instant of [0, 90]) {
    const suite = demarrer(gestes, AUCUN, { id: "b", type: gesteDeLaCase("faire"), avant: ["a"], tache: t("b"), maintenant: instant });
    if (!suite) continue;
    gestes = suite;
    envois.push(`b:done=${valeurDone("fait")}`);
  }
  assert.deepEqual(envois, ["b:done=1"]);
  // Et la relance SUIVANTE n'a pas été touchée.
  assert.equal(gestes.has("c"), false);
  assert.equal(peutToucher(gestes, AUCUN, "c"), true);
});

await cas("une ligne en cours d'enregistrement ne prend pas de tap non plus", () => {
  assert.equal(peutToucher(VIDE, new Set(["a"]), "a"), false);
  assert.equal(demarrer(VIDE, new Set(["a"]), { id: "a", type: "fait", avant: [], tache: t("a"), maintenant: 0 }), null);
});

await cas("la ligne cochée RESTE à sa place, même quand le serveur l'a retirée", () => {
  const g = demarrer(VIDE, AUCUN, { id: "b", type: "fait", avant: ["a"], tache: t("b"), maintenant: 0 })!;
  // Avant la réponse : la liste du serveur la porte encore.
  assert.equal(ids(vueStable(LISTE, g, AUCUN)), "abcd");
  // La liste revalidée arrive SANS elle : elle reste à l'index 1.
  const sansB = LISTE.filter((x) => x.id !== "b");
  const v = vueStable(sansB, g, AUCUN);
  assert.equal(ids(v), "abcd");
  assert.equal(v[1].geste?.type, "fait");
  // Le serveur change l'ordre : la ligne reste collée sous SA voisine du dessus.
  assert.equal(ids(vueStable([t("d"), t("a"), t("c")], g, AUCUN)), "dabc");
  // Sa voisine est partie aussi : sous la suivante encore là (ou en tête).
  const g2 = demarrer(VIDE, AUCUN, { id: "c", type: "fait", avant: ["b", "a"], tache: t("c"), maintenant: 0 })!;
  assert.equal(ids(vueStable([t("a"), t("d")], g2, new Set(["b"]))), "acd");
  assert.equal(ids(vueStable([t("d")], g2, new Set(["a", "b"]))), "cd");
});

await cas("deux lignes engagées à la fois : chacune garde sa place, la fin de l'une n'efface pas l'autre", () => {
  let g = demarrer(VIDE, AUCUN, { id: "a", type: "fait", avant: [], tache: t("a"), maintenant: 0 })!;
  g = demarrer(g, AUCUN, { id: "c", type: "supprime", avant: ["b", "a"], tache: t("c"), maintenant: 400 })!;
  assert.equal(ids(vueStable([t("b"), t("d")], g, AUCUN)), "abcd");
  // « a » finit son repli ; « c » attend encore.
  const r = avancer(g, AUCUN, DELAI_ANNULER_MS + DUREE_REPLI_MS);
  assert.equal(r.gestes.has("a"), false);
  assert.ok(r.partis.has("a"));
  assert.equal(r.gestes.get("c")?.phase, "attente");
  assert.equal(ids(vueStable([t("a"), t("b"), t("c"), t("d")], r.gestes, r.partis)), "bcd", "« a » ne réapparaît pas");
});

await cas("l'horloge : attente (~1,5 s) → repli (150-200 ms) → partie", () => {
  assert.equal(DELAI_ANNULER_MS, 1500);
  assert.ok(DUREE_REPLI_MS >= 150 && DUREE_REPLI_MS <= 200);
  const g = demarrer(VIDE, AUCUN, { id: "b", type: "fait", avant: ["a"], tache: t("b"), maintenant: 1000 })!;
  let r = avancer(g, AUCUN, 1000 + DELAI_ANNULER_MS - 1);
  assert.equal(r.gestes.get("b")?.phase, "attente");
  assert.equal(r.prochain, 1000 + DELAI_ANNULER_MS);
  r = avancer(g, AUCUN, 1000 + DELAI_ANNULER_MS);
  assert.equal(r.gestes.get("b")?.phase, "repli");
  assert.equal(r.prochain, 1000 + DELAI_ANNULER_MS + DUREE_REPLI_MS);
  assert.deepEqual(r.aEnvoyer, [], "cocher est déjà parti au tap");
  r = avancer(r.gestes, r.partis, 1000 + DELAI_ANNULER_MS + DUREE_REPLI_MS);
  assert.equal(r.gestes.size, 0);
  assert.ok(r.partis.has("b"));
  assert.equal(r.prochain, null);
});

await cas("supprimer : rien ne part avant la fin du délai ; « Annuler » retient tout simplement", () => {
  const g = demarrer(VIDE, AUCUN, { id: "c", type: "supprime", avant: ["b", "a"], tache: t("c"), maintenant: 0 })!;
  assert.equal(g.get("c")?.envoye, false);
  const a = annuler(g, "c")!;
  assert.equal(a.ecrire, null, "rien n'est parti : rien à défaire");
  assert.equal(a.gestes.has("c"), false, "la ligne redevient libre aussitôt");
  // Sans « Annuler », la suppression part au début du repli, une seule fois.
  const r = avancer(g, AUCUN, DELAI_ANNULER_MS);
  assert.deepEqual(r.aEnvoyer.map((x) => x.id), ["c"]);
  const r2 = avancer(r.gestes, r.partis, DELAI_ANNULER_MS + 10);
  assert.deepEqual(r2.aEnvoyer, [], "jamais deux fois");
});

await cas("arrière-plan (visibilitychange / pagehide) : les suppressions en attente partent TOUT DE SUITE", () => {
  let g = demarrer(VIDE, AUCUN, { id: "c", type: "supprime", avant: ["b", "a"], tache: t("c"), maintenant: 0 })!;
  g = demarrer(g, AUCUN, { id: "a", type: "fait", avant: [], tache: t("a"), maintenant: 0 })!;
  const v = vider(g);
  assert.deepEqual(v.aEnvoyer.map((x) => x.id), ["c"], "« a » était déjà parti");
  assert.equal(v.gestes.get("c")?.envoye, true);
  assert.equal(v.gestes.get("c")?.phase, "attente", "la ligne reste affichée jusqu'à la fin de son délai");
  assert.deepEqual(vider(v.gestes).aEnvoyer, [], "un second passage n'envoie rien");
  assert.deepEqual(avancer(v.gestes, AUCUN, DELAI_ANNULER_MS).aEnvoyer, [], "ni la fin du délai");
});

await cas("« Annuler » d'une relance cochée : rouvrir, la ligne tenue à sa place jusqu'à la réponse", () => {
  const g = demarrer(VIDE, AUCUN, { id: "b", type: "fait", avant: ["a"], tache: t("b"), maintenant: 0 })!;
  const a = annuler(g, "b")!;
  assert.equal(a.ecrire, "rouvrir");
  assert.equal(a.gestes.get("b")?.phase, "retour");
  // Entre-temps, la liste revalidée par « fait » arrive sans elle : elle reste.
  assert.equal(ids(vueStable(LISTE.filter((x) => x.id !== "b"), a.gestes, AUCUN)), "abcd");
  // Le retour ne dépend pas de l'horloge.
  assert.equal(avancer(a.gestes, AUCUN, 99_999).gestes.get("b")?.phase, "retour");
  // Pas de second « Annuler » pendant le retour.
  assert.equal(annuler(a.gestes, "b"), null);
  // La réponse arrive : la ligne est libre, portée par le serveur.
  assert.equal(finRetour(a.gestes, "b").has("b"), false);
  // « rouvrir » s'annule en « fait ».
  const r = demarrer(VIDE, AUCUN, { id: "x", type: "rouvrir", avant: [], tache: t("x"), maintenant: 0 })!;
  assert.equal(annuler(r, "x")!.ecrire, "fait");
});

await cas("pendant le repli, plus de tap : ni « Annuler », ni un nouveau geste", () => {
  const g = demarrer(VIDE, AUCUN, { id: "b", type: "fait", avant: ["a"], tache: t("b"), maintenant: 0 })!;
  const r = avancer(g, AUCUN, DELAI_ANNULER_MS + 5);
  assert.equal(annuler(r.gestes, "b"), null);
  assert.equal(peutToucher(r.gestes, AUCUN, "b"), false);
});

await cas("échec serveur : la ligne revient telle qu'elle était", () => {
  const g = demarrer(VIDE, AUCUN, { id: "b", type: "fait", avant: ["a"], tache: t("b"), maintenant: 0 })!;
  const r = echec(g, new Set(["b"]), "b");
  assert.equal(r.gestes.has("b"), false);
  assert.equal(r.partis.has("b"), false);
  assert.equal(ids(vueStable(LISTE, r.gestes, r.partis)), "abcd");
  assert.equal(vueStable(LISTE, r.gestes, r.partis)[1].geste, undefined);
});

await cas("les lignes parties s'oublient quand le serveur ne les renvoie plus", () => {
  const partis = new Set(["b", "z"]);
  assert.deepEqual([...oublierPartis(LISTE, partis)], ["b"]);
  assert.equal(ids(vueStable(LISTE, VIDE, partis)), "acd", "tant qu'il la renvoie, elle reste cachée");
});

await cas("inverse : rien à défaire tant que rien n'est parti", () => {
  const base = { id: "a", avant: [], tache: t("a"), depuis: 0, phase: "attente" as const };
  assert.equal(inverse({ ...base, type: "fait", envoye: true }), "rouvrir");
  assert.equal(inverse({ ...base, type: "fait", envoye: false }), null);
  assert.equal(inverse({ ...base, type: "supprime", envoye: true }), null);
});

// ─── Un envoi ne part jamais deux fois (lib/unSeulEnvoi.ts) ───────────────

await cas("le verrou : un tap pendant l'envoi est ignoré, puis un court délai anti-rebond", () => {
  const v = creerVerrou();
  assert.equal(v.peut(0), true);
  assert.equal(v.prendre(0), true);
  assert.equal(v.peut(10), false);
  assert.equal(v.prendre(10), false, "en vol");
  v.rendre();
  assert.equal(v.prendre(DOUBLE_TAP_MS - 1), false, "rebond juste après une réponse rapide");
  assert.equal(v.prendre(DOUBLE_TAP_MS), true, "une correction volontaire, un peu plus tard");
});

await cas("lancerUneFois : deux taps rapides → UNE action ; le verrou est rendu même si l'action échoue", async () => {
  const v = creerVerrou();
  let appels = 0;
  const attentes: Promise<void>[] = [];
  const demarrer = (fn: () => Promise<void>) => {
    attentes.push(fn().catch(() => {}));
  };
  const action = async () => {
    appels++;
    await new Promise((r) => setTimeout(r, 5));
    throw new Error("refus serveur");
  };
  assert.equal(lancerUneFois(v, demarrer, action, 0), true);
  assert.equal(lancerUneFois(v, demarrer, action, 50), false);
  await Promise.all(attentes);
  assert.equal(appels, 1);
  assert.equal(v.pris, false, "rendu après l'échec");
  assert.equal(lancerUneFois(v, demarrer, async () => { appels++; }, 5_000), true);
  await Promise.all(attentes);
  assert.equal(appels, 2);
});

await cas("les composants d'envoi en un tap passent par le verrou", async () => {
  const { readFileSync } = await import("node:fs");
  const racine = new URL("../..", import.meta.url).pathname;
  for (const f of ["ResultatAppel", "NextActionCard", "DebriefRdv", "QuickNote"]) {
    const src = readFileSync(`${racine}components/${f}.tsx`, "utf8");
    assert.ok(!/(?<!lancerUneFois\(verrou, )startTransition\(async/.test(src), `${f} : un startTransition sans verrou`);
    assert.match(src, /useUnSeulEnvoi\(\)/, f);
  }
  const liste = readFileSync(`${racine}components/TaskList.tsx`, "utf8");
  assert.ok(!liste.includes('t.status === "fait" ? "0" : "1"'), "la case ne déduit plus son sens du statut");
  assert.match(liste, /valeurDone\(type\)/);
});

console.log(`\n${ok} OK`);
