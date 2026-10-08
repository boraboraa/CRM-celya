/**
 * Le juge du numéro : ce que Janet a le droit de composer.
 *
 * MIROIR EXACT de `public.appels_ia_numero` (migration 025), qui sert au
 * trigger d'inscription automatique. Deux juges pour une règle, c'est le prix
 * d'un trigger SQL — d'où UN SEUL jeu de cas, `numeros.cas.json`, joué par
 * `numeros.test.ts` ET par la recette SQL de la 025 : si les deux divergent,
 * un des deux tests rougit.
 *
 * La règle : numéro belge seulement, rendu en E.164 (+32…).
 *   · 9 chiffres après le 0 : seulement les mobiles (045 à 049) ;
 *   · 8 chiffres : les fixes et les 0800 — un 04 à 8 chiffres est un fixe
 *     LIÉGEOIS, pas un mobile ;
 *   · jamais 090x (surtaxés), 070, 077 ni 078.
 * Le format national (« 081 22 33 44 ») est accepté : les fiches de Bora sont
 * saisies ainsi, aucune n'est en +32.
 *
 * Module pur, sans alias `@/` : le test l'exécute tel quel sous node.
 */

const SEPARATEURS = /[\s.\-/()  ]/g;

export function numeroAppelable(brut: string | null | undefined): string | null {
  const v = (brut ?? "").replace(SEPARATEURS, "");
  let n: string;
  if (v.startsWith("+32")) n = v.slice(3);
  else if (v.startsWith("0032")) n = v.slice(4);
  else if (/^0[1-9]/.test(v)) n = v.slice(1);
  else return null;
  // « +32 (0)81 … » : le zéro de liaison après l'indicatif.
  if (n.startsWith("0")) n = n.slice(1);
  if (!/^[0-9]+$/.test(n)) return null;
  if (n.length === 9) {
    if (!/^4[5-9]/.test(n)) return null;
  } else if (n.length === 8) {
    if (/^(90|70|77|78)/.test(n)) return null;
  } else {
    return null;
  }
  return `+32${n}`;
}

/** « +3281223344 » → « 081 22 33 44 » ; « +32470123456 » → « 0470 12 34 56 ». */
export function numeroLisible(e164: string | null | undefined): string {
  const v = e164 ?? "";
  if (!v.startsWith("+32")) return v;
  const n = v.slice(3);
  if (n.length === 9) return `0${n.slice(0, 3)} ${n.slice(3, 5)} ${n.slice(5, 7)} ${n.slice(7)}`;
  if (n.length === 8) {
    // Zones à un chiffre (Bruxelles 2, Anvers 3, Liège 4, Gand 9) : 0X XXX XX XX.
    if (/^[2349]/.test(n)) return `0${n[0]} ${n.slice(1, 4)} ${n.slice(4, 6)} ${n.slice(6)}`;
    return `0${n.slice(0, 2)} ${n.slice(2, 4)} ${n.slice(4, 6)} ${n.slice(6)}`;
  }
  return v;
}
