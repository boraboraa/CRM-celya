// npm run test:nav — la barre du bas sort de la MÊME source que la barre latérale.
import assert from "node:assert/strict";
import {
  NAV_ITEMS,
  ADMIN_ITEM,
  APPELS_IA_ITEM,
  ACCOUNT_ITEM,
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

cas("admin : un cinquième onglet « Plus », jamais plus de cinq", () => {
  const o = ongletsMobiles("admin");
  assert.deepEqual(libelles(o), ["À faire", "Prospects", "＋", "Agenda", "Plus"]);
  assert.ok(o.length <= 5);
});

cas("« Plus » de l'admin : Équipe, Appels IA, Compte — rien d'inventé", () => {
  const plus = ongletsMobiles("admin").find((x) => x.type === "plus");
  assert.ok(plus && plus.type === "plus");
  assert.deepEqual(plus.items, [ADMIN_ITEM, APPELS_IA_ITEM, ACCOUNT_ITEM]);
});

cas("un commercial n'a jamais Équipe ni Appels IA, nulle part", () => {
  const tout = JSON.stringify(ongletsMobiles("commercial"));
  assert.ok(!tout.includes(ADMIN_ITEM.href));
  assert.ok(!tout.includes(APPELS_IA_ITEM.href));
  assert.deepEqual(navOrdinateur("commercial"), NAV_ITEMS);
  // Un rôle inconnu (compte mal formé) retombe sur le commercial, jamais sur l'admin.
  assert.deepEqual(libelles(ongletsMobiles("")), ["À faire", "Prospects", "＋", "Agenda"]);
});

cas("les liens de la barre du bas SONT les objets de NAV_ITEMS (aucune copie)", () => {
  for (const role of ["commercial", "admin"]) {
    for (const o of ongletsMobiles(role)) {
      if (o.type === "lien") assert.ok(NAV_ITEMS.includes(o.item), o.item.href);
    }
  }
});

cas("ordinateur : la barre latérale de l'admin est inchangée", () => {
  assert.deepEqual(navOrdinateur("admin"), [...NAV_ITEMS, ADMIN_ITEM, APPELS_IA_ITEM]);
});

cas("onglet actif : la fiche allume « Prospects », pas « /prospectsX »", () => {
  assert.ok(ongletActif("/prospects/123", "/prospects"));
  assert.ok(ongletActif("/prospects", "/prospects"));
  assert.ok(!ongletActif("/prospectsX", "/prospects"));
  assert.ok(!ongletActif("/dashboard", "/prospects"));
});

console.log(`\n${ok} OK`);
