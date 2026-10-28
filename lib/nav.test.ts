// npm run test:nav — la barre du bas sort de la MÊME source que la barre latérale.
import assert from "node:assert/strict";
import {
  NAV_ITEMS,
  ADMIN_ITEM,
  APPELS_IA_ITEM,
  ACCOUNT_ITEM,
  CLASSEMENT_ITEM,
  MA_LISTE_ITEM,
  navOrdinateur,
  ongletsMobiles,
  ongletActif,
  type OngletMobile,
} from "./nav.ts";

let ok = 0;
function cas(nom: string, f: () => void) {
  f();
  ok++;
  console.log(`  ✓ ${nom}`);
}

const libelles = (o: OngletMobile[]) =>
  o.map((x) => (x.type === "lien" ? x.item.label : x.type === "ajout" ? "＋" : "Plus"));

cas("commercial : À faire · Prospects · ＋ · Agenda, quatre onglets", () => {
  assert.deepEqual(libelles(ongletsMobiles("commercial")), ["À faire", "Prospects", "＋", "Agenda"]);
});

cas("admin : « Classement » prend la place d'« Agenda », jamais plus de cinq", () => {
  const o = ongletsMobiles("admin");
  assert.deepEqual(libelles(o), ["À faire", "Prospects", "＋", "Classement", "Plus"]);
  assert.ok(o.length <= 5);
});

cas("« Plus » de l'admin : Équipe, Agenda, Appels IA, Compte — rien d'inventé, rien de perdu", () => {
  const plus = ongletsMobiles("admin").find((x) => x.type === "plus");
  assert.ok(plus && plus.type === "plus");
  assert.deepEqual(plus.items.map((i) => i.label), ["Équipe", "Agenda", "Appels IA", "Compte"]);
  assert.ok(plus.items.includes(ADMIN_ITEM) && plus.items.includes(APPELS_IA_ITEM) && plus.items.includes(ACCOUNT_ITEM));
});

cas("tout écran de la barre latérale de l'admin est atteignable au téléphone", () => {
  const mobile = ongletsMobiles("admin").flatMap((o) => (o.type === "lien" ? [o.item] : o.type === "plus" ? o.items : []));
  for (const i of navOrdinateur("admin")) assert.ok(mobile.includes(i), i.href);
});

cas("un commercial n'a jamais Équipe ni Appels IA, nulle part", () => {
  const tout = JSON.stringify(ongletsMobiles("commercial"));
  assert.ok(!tout.includes(ADMIN_ITEM.href));
  assert.ok(!tout.includes(APPELS_IA_ITEM.href));
  assert.deepEqual(navOrdinateur("commercial"), [...NAV_ITEMS, CLASSEMENT_ITEM]);
  // Un rôle inconnu (compte mal formé) retombe sur le commercial, jamais sur l'admin.
  assert.deepEqual(libelles(ongletsMobiles("")), ["À faire", "Prospects", "＋", "Agenda"]);
});

cas("les liens de la barre du bas SONT les objets de la barre latérale (aucune copie)", () => {
  for (const role of ["commercial", "admin"]) {
    for (const o of ongletsMobiles(role)) {
      if (o.type === "lien") assert.ok(navOrdinateur(role).includes(o.item), o.item.href);
    }
  }
});

cas("ordinateur : l'admin voit l'équipe avant l'agenda", () => {
  assert.deepEqual(navOrdinateur("admin").map((i) => i.label), [
    "À faire",
    "Prospects",
    "Classement",
    "Équipe",
    "Agenda",
    "Appels IA",
  ]);
});

cas("un commercial voit le classement sur ordinateur, pas dans sa barre du bas (quatre onglets)", () => {
  assert.ok(navOrdinateur("commercial").includes(CLASSEMENT_ITEM));
  assert.ok(!JSON.stringify(ongletsMobiles("commercial")).includes(CLASSEMENT_ITEM.href));
});

cas("« Coller ma liste » : un raccourci de la barre latérale, jamais un onglet (ni écran, ni barre du bas)", () => {
  assert.equal(MA_LISTE_ITEM.href, "/prospects/ma-liste");
  for (const role of ["admin", "commercial"]) {
    assert.ok(!navOrdinateur(role).includes(MA_LISTE_ITEM));
    assert.ok(!JSON.stringify(ongletsMobiles(role)).includes(MA_LISTE_ITEM.href));
  }
});

cas("onglet actif : la fiche allume « Prospects », pas « /prospectsX »", () => {
  assert.ok(ongletActif("/prospects/123", "/prospects"));
  assert.ok(ongletActif("/prospects", "/prospects"));
  assert.ok(!ongletActif("/prospectsX", "/prospects"));
  assert.ok(!ongletActif("/dashboard", "/prospects"));
});

console.log(`\n${ok} OK`);
