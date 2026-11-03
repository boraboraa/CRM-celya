/**
 * Les gestes en un tap sur une relance — cocher, rouvrir, supprimer
 * (3 novembre 2026). Module NEUTRE et pur (ni React, ni Supabase), testé par
 * `npm run test:geste-relance`. Le hook `useGesteRelance`
 * (`components/TaskList.tsx`) ne fait que l'appeler et poser des minuteries.
 *
 * Ce qu'il corrige, vécu par Colin sur iPad :
 * - **la ligne quittait sa place sous le doigt** : cochée, elle disparaissait
 *   aussitôt, la suivante remontait, et un second tap rapide cochait la
 *   MAUVAISE relance. Désormais la ligne RESTE, barrée et estompée, avec
 *   « Annuler », pendant `DELAI_ANNULER_MS` ; puis elle se replie en hauteur
 *   (`DUREE_REPLI_MS`), sans saut ;
 * - **un double tap rouvrait la relance** : la case inversait l'état
 *   (`done = fait ? "0" : "1"`). Le geste dit désormais ce qu'il FAIT : la
 *   case d'une relance ouverte ne sait que « faire » (`valeurDone`), une ligne
 *   déjà engagée ignore le tap suivant (`demarrer` renvoie `null`) ;
 * - **le rechargement serveur re-sautait** : la liste revalidée arrive sans
 *   la relance faite, ou avec un autre ordre — `vueStable` garde chaque ligne
 *   engagée à SA place tant que son geste n'est pas fini.
 */

/** Ce que fait le geste. `rouvrir` n'existe que dans la liste des relances passées. */
export type TypeGeste = "fait" | "rouvrir" | "supprime";

/** Le sens de la case d'une liste : faire (relances ouvertes) ou rouvrir (passées). */
export type SensCase = "faire" | "rouvrir";

/**
 * `attente` : la ligne est là, barrée, « Annuler » offert. `repli` : elle se
 * ferme. `retour` : « Annuler » vient d'être tapé et l'écriture inverse est en
 * route — la ligne reste À SA PLACE, normale, sans commandes, jusqu'à la
 * réponse (sans quoi la liste revalidée par le premier geste la ferait
 * disparaître une fraction de seconde avant que l'inverse ne la ramène).
 */
export type Phase = "attente" | "repli" | "retour";

export const DELAI_ANNULER_MS = 1500;
export const DUREE_REPLI_MS = 180;

export type GesteLigne<T> = {
  id: string;
  type: TypeGeste;
  phase: Phase;
  /** L'instant du tap (ms). */
  depuis: number;
  /**
   * La place de la ligne au moment du tap : les identifiants des lignes AU-
   * DESSUS d'elle, la plus proche d'abord. Si le serveur la retire avant la
   * fin du geste, elle revient juste sous la plus proche qui est encore là —
   * un index absolu glisserait dès qu'une ligne plus haute part.
   */
  avant: readonly string[];
  /** La ligne telle qu'elle était : on la remontre si le serveur l'a déjà retirée. */
  tache: T;
  /** L'écriture est-elle partie au serveur ? (une suppression attend la fin du délai) */
  envoye: boolean;
};

export type Gestes<T> = ReadonlyMap<string, GesteLigne<T>>;

/** Le geste que déclenche la case, selon la liste. */
export function gesteDeLaCase(sens: SensCase): TypeGeste {
  return sens === "rouvrir" ? "rouvrir" : "fait";
}

/**
 * La valeur `done` envoyée à `completeTaskAction` : FIXE pour un geste donné,
 * jamais déduite de l'état de la ligne — un second tap ne peut plus défaire
 * le premier.
 */
export function valeurDone(type: "fait" | "rouvrir"): "1" | "0" {
  return type === "fait" ? "1" : "0";
}

/** L'inverse d'un geste, pour « Annuler » : `null` quand il n'y a rien à écrire. */
export function inverse(geste: GesteLigne<unknown>): "fait" | "rouvrir" | null {
  if (geste.type === "supprime") return null; // rien n'est encore parti
  // Rien n'est parti (échec réseau avant l'envoi) : rien à défaire.
  if (!geste.envoye) return null;
  return geste.type === "fait" ? "rouvrir" : "fait";
}

/** La ligne accepte-t-elle un tap ? Non dès qu'un geste l'a engagée. */
export function peutToucher(gestes: Gestes<unknown>, enCours: ReadonlySet<string>, id: string): boolean {
  return !gestes.has(id) && !enCours.has(id);
}

/**
 * Engage un geste. `null` si la ligne est déjà engagée : le second tap d'un
 * double tap est IGNORÉ — pas mis en file, pas inversé.
 */
export function demarrer<T>(
  gestes: Gestes<T>,
  enCours: ReadonlySet<string>,
  g: { id: string; type: TypeGeste; avant: readonly string[]; tache: T; maintenant: number }
): Map<string, GesteLigne<T>> | null {
  if (!peutToucher(gestes, enCours, g.id)) return null;
  const suite = new Map(gestes);
  suite.set(g.id, {
    id: g.id,
    type: g.type,
    phase: "attente",
    depuis: g.maintenant,
    avant: g.avant,
    tache: g.tache,
    // Cocher / rouvrir partent tout de suite (la base est à jour, même si l'on
    // quitte l'écran) ; une suppression, irréversible, attend le délai.
    envoye: g.type !== "supprime",
  });
  return suite;
}

/**
 * « Annuler » : seulement pendant l'attente (pendant le repli, la ligne ne
 * reçoit plus de taps). Renvoie les gestes et l'écriture inverse à envoyer
 * (ou `null`). Avec une écriture inverse, la ligne passe en `retour` (tenue à
 * sa place jusqu'à la réponse, `finRetour`) ; sans, elle est simplement
 * libérée.
 */
export function annuler<T>(
  gestes: Gestes<T>,
  id: string
): { gestes: Map<string, GesteLigne<T>>; ecrire: "fait" | "rouvrir" | null } | null {
  const g = gestes.get(id);
  if (!g || g.phase !== "attente") return null;
  const suite = new Map(gestes);
  const ecrire = inverse(g);
  if (ecrire) suite.set(id, { ...g, phase: "retour" });
  else suite.delete(id);
  return { gestes: suite, ecrire };
}

/** L'écriture inverse a répondu : la ligne redevient libre (la liste du serveur la porte). */
export function finRetour<T>(gestes: Gestes<T>, id: string): Map<string, GesteLigne<T>> {
  const suite = new Map(gestes);
  if (suite.get(id)?.phase === "retour") suite.delete(id);
  return suite;
}

/** Le serveur a refusé : la ligne revient telle qu'elle était. */
export function echec<T>(gestes: Gestes<T>, partis: ReadonlySet<string>, id: string) {
  const g = new Map(gestes);
  g.delete(id);
  const p = new Set(partis);
  p.delete(id);
  return { gestes: g, partis: p };
}

/**
 * Le temps passe : l'attente devient repli (et une suppression part alors au
 * serveur), le repli fini fait PARTIR la ligne. Renvoie aussi le prochain
 * instant où rappeler `avancer` (ou `null` : rien n'attend).
 */
export function avancer<T>(
  gestes: Gestes<T>,
  partis: ReadonlySet<string>,
  maintenant: number
): {
  gestes: Map<string, GesteLigne<T>>;
  partis: Set<string>;
  aEnvoyer: GesteLigne<T>[];
  prochain: number | null;
} {
  const suite = new Map<string, GesteLigne<T>>();
  const p = new Set(partis);
  const aEnvoyer: GesteLigne<T>[] = [];
  let prochain: number | null = null;
  const plusTot = (t: number) => {
    prochain = prochain === null ? t : Math.min(prochain, t);
  };
  for (const g of gestes.values()) {
    // Un retour attend la réponse du serveur, pas l'horloge.
    if (g.phase === "retour") {
      suite.set(g.id, g);
      continue;
    }
    const finAttente = g.depuis + DELAI_ANNULER_MS;
    const finRepli = finAttente + DUREE_REPLI_MS;
    if (maintenant >= finRepli) {
      p.add(g.id);
      if (!g.envoye) aEnvoyer.push({ ...g, envoye: true });
      continue;
    }
    if (maintenant >= finAttente) {
      const envoi = !g.envoye;
      const r = { ...g, phase: "repli" as const, envoye: true };
      if (envoi) aEnvoyer.push(r);
      suite.set(g.id, r);
      plusTot(finRepli);
      continue;
    }
    suite.set(g.id, g);
    plusTot(finAttente);
  }
  return { gestes: suite, partis: p, aEnvoyer, prochain };
}

/**
 * L'application passe en arrière-plan (`visibilitychange`, `pagehide`) ou
 * l'écran se démonte : les suppressions en attente partent TOUT DE SUITE —
 * on ne les perd pas parce que Colin a changé d'app. Elles restent affichées
 * jusqu'à la fin de leur délai.
 */
export function vider<T>(gestes: Gestes<T>): { gestes: Map<string, GesteLigne<T>>; aEnvoyer: GesteLigne<T>[] } {
  const suite = new Map<string, GesteLigne<T>>();
  const aEnvoyer: GesteLigne<T>[] = [];
  for (const g of gestes.values()) {
    if (!g.envoye) {
      const r = { ...g, envoye: true };
      aEnvoyer.push(r);
      suite.set(g.id, r);
    } else suite.set(g.id, g);
  }
  return { gestes: suite, aEnvoyer };
}

/** Une ligne affichée, et le geste qui la tient (s'il y en a un). */
export type LigneVue<T> = { tache: T; geste?: GesteLigne<T> };

/**
 * La liste À AFFICHER : celle du serveur, moins les lignes parties, avec
 * chaque ligne engagée À SA PLACE — même quand le serveur l'a déjà retirée
 * (relance faite, liste revalidée). Une ligne que le serveur porte encore
 * garde la place qu'il lui donne ; une ligne qu'il a retirée revient juste
 * sous sa plus proche voisine du dessus encore affichée. Rien sous le doigt
 * ne remonte pendant le geste.
 */
export function vueStable<T extends { id: string }>(
  serveur: readonly T[],
  gestes: Gestes<T>,
  partis: ReadonlySet<string>
): LigneVue<T>[] {
  const out: LigneVue<T>[] = serveur
    .filter((t) => !partis.has(t.id))
    .map((t) => ({ tache: t, ...(gestes.has(t.id) ? { geste: gestes.get(t.id)! } : {}) }));
  const presents = new Set(out.map((l) => l.tache.id));
  // Les lignes engagées que le serveur ne porte plus, remises à leur place —
  // celles du HAUT d'abord (moins de lignes au-dessus d'elles) : la voisine
  // d'une ligne peut être une autre ligne engagée, déjà replacée.
  const manquantes = [...gestes.values()]
    .filter((g) => !partis.has(g.id) && !presents.has(g.id))
    .sort((a, b) => a.avant.length - b.avant.length);
  for (const g of manquantes) {
    const voisine = g.avant.find((id) => presents.has(id));
    const i = voisine ? out.findIndex((l) => l.tache.id === voisine) + 1 : 0;
    out.splice(i, 0, { tache: g.tache, geste: g });
    presents.add(g.id);
  }
  return out;
}

/**
 * Les lignes « parties » qu'on peut oublier : le serveur ne les renvoie plus.
 * Tant qu'il les renvoie (revalidation pas encore arrivée), on les garde
 * cachées — sinon la ligne repliée réapparaîtrait une fraction de seconde.
 */
export function oublierPartis(serveur: readonly { id: string }[], partis: ReadonlySet<string>): Set<string> {
  const ids = new Set(serveur.map((t) => t.id));
  return new Set([...partis].filter((id) => ids.has(id)));
}
