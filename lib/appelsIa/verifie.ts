/**
 * Le petit banc commun des tests des appels IA (même style que les autres
 * tests du dépôt : node --experimental-strip-types, aucun framework).
 */

let echecs = 0;
let total = 0;

export function verifie(nom: string, obtenu: unknown, attendu: unknown): void {
  total++;
  const o = JSON.stringify(obtenu);
  const a = JSON.stringify(attendu);
  if (o !== a) {
    echecs++;
    console.error(`  ✗ ${nom}\n      attendu ${a}\n      obtenu  ${o}`);
  } else {
    console.log(`✓ ${nom}`);
  }
}

export function vrai(nom: string, condition: boolean, detail?: unknown): void {
  total++;
  if (!condition) {
    echecs++;
    console.error(`  ✗ ${nom}${detail !== undefined ? `\n      ${JSON.stringify(detail)}` : ""}`);
  } else {
    console.log(`✓ ${nom}`);
  }
}

export function bilan(suite: string): void {
  if (echecs > 0) {
    console.error(`\n${suite} : ${echecs} échec(s) sur ${total}.`);
    process.exit(1);
  }
  console.log(`\n${suite} : tous les cas passent (${total}).`);
}
