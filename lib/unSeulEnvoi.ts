/**
 * Un envoi ne part jamais deux fois (3 novembre 2026) — module NEUTRE et pur,
 * testé par `test:geste-relance`.
 *
 * `disabled={pending}` ne suffit pas tout à fait : entre le premier tap et le
 * rendu qui grise le bouton, un second tap peut arriver (iPad, doigt qui
 * rebondit). Le verrou est posé DANS le gestionnaire, avant tout rendu : tant
 * qu'un envoi est en vol, et `DOUBLE_TAP_MS` après son départ, un nouveau tap
 * est ignoré. Une correction volontaire (une seconde pastille de résultat
 * d'appel, un peu plus tard) passe normalement.
 */
export const DOUBLE_TAP_MS = 600;

export type Verrou = {
  /** Prend le verrou ; `false` : un envoi est en vol, ou vient de partir. */
  prendre(maintenant: number): boolean;
  /** Un tap serait-il accepté maintenant ? (sans prendre le verrou) */
  peut(maintenant: number): boolean;
  /** L'envoi a répondu (succès ou échec). */
  rendre(): void;
  readonly pris: boolean;
};

export function creerVerrou(delaiMs: number = DOUBLE_TAP_MS): Verrou {
  let pris = false;
  let depuis = Number.NEGATIVE_INFINITY;
  return {
    peut(maintenant) {
      return !pris && maintenant - depuis >= delaiMs;
    },
    prendre(maintenant) {
      if (pris || maintenant - depuis < delaiMs) return false;
      pris = true;
      depuis = maintenant;
      return true;
    },
    rendre() {
      pris = false;
    },
    get pris() {
      return pris;
    },
  };
}

/**
 * Lance `fn` dans `demarrer` (un `startTransition`) si le verrou est libre,
 * et le rend quoi qu'il arrive. Renvoie `false` quand le tap est ignoré.
 */
export function lancerUneFois(
  verrou: Verrou,
  demarrer: (fn: () => Promise<void>) => void,
  fn: () => Promise<void>,
  maintenant: number = Date.now()
): boolean {
  if (!verrou.prendre(maintenant)) return false;
  demarrer(async () => {
    try {
      await fn();
    } finally {
      verrou.rendre();
    }
  });
  return true;
}
