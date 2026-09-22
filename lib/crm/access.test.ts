/**
 * La CLOISON, mise à l'épreuve sans réseau ni base :
 *
 *   node --experimental-strip-types lib/crm/access.test.ts
 *
 * (script npm : `npm run test:equipe`). Même style que lib/crm/maps.test.ts.
 *
 * Pourquoi ce test existe. `lib/crm/access.ts` est la seule cloison du
 * connecteur MCP : il agit en `service_role`, la RLS ne le protège de rien. Une
 * erreur ici ne se voit pas — elle ne lève pas, elle rend simplement des lignes
 * de trop. Les identifiants sont ceux RÉELS du 19/09/2026 (Collins et Nathan
 * travaillent en équipe, Rémi seul sur un autre marché, Bora admin), pour que la
 * table de cas se relise comme la situation qu'elle défend.
 *
 * Et un rappel qui vaut plus que le test : la règle vit en DEUX endroits, ici et
 * dans la policy SQL `can_see_prospect` / `partage_equipe` (migration 020). Ce
 * fichier ne peut pas vérifier le SQL. Les deux doivent bouger ensemble.
 */

import {
  loadViewer,
  lirePorteurs,
  lireEncadres,
  lireLiensEncadrement,
  canSeeProspect,
  canEditProspect,
  relanceEnLecture,
  scopeProspects,
  scopeJoinedProspects,
  type Viewer,
} from "./access.ts";
import {
  lirePerimetre,
  peutElargir,
  membresProposables,
  perimetreUserId,
} from "./perimetre.ts";

const COLLINS = "fc088df7-6bd5-4d28-b10a-417483964a9f";
const NATHAN = "f9d07f3f-daea-46b8-ae6c-b9380444be4b";
const REMI = "640f3e05-d9da-4fdc-a0eb-553a3afa00d6";
const BORA = "b3fdb505-76b0-4541-84ec-21b330afe58d";
// Les étudiants de septembre : encadrés par Collins et Nathan, cloisonnés de
// tout le monde et l'un de l'autre. Identifiants fictifs — ils n'existent pas
// encore en base, et le test ne doit pas dépendre de leur création.
const ETU_A = "a0000000-0000-4000-8000-0000000021a0";
const ETU_B = "a0000000-0000-4000-8000-0000000021b0";

/**
 * Ce que `lireMembresActifs` rend : TOUS les commerciaux actifs, avec leur
 * interrupteur. C'est la même lecture qui sert les porteurs et l'intersection
 * des encadrés — d'où une seule constante, comme en base il n'y a qu'une
 * jointure.
 */
const COMMERCIAUX = [
  { id: COLLINS, voit_equipe: true },
  { id: NATHAN, voit_equipe: true },
  { id: REMI, voit_equipe: false },
  { id: ETU_A, voit_equipe: false },
  { id: ETU_B, voit_equipe: false },
];

let echecs = 0;

function verifie(nom: string, obtenu: unknown, attendu: unknown) {
  const o = JSON.stringify(obtenu);
  const a = JSON.stringify(attendu);
  if (o !== a) {
    echecs++;
    console.error(`  ✗ ${nom}\n      attendu ${a}\n      obtenu  ${o}`);
  } else {
    console.log(`✓ ${nom}`);
  }
}

// ---------------------------------------------------------------------------
// Un faux client Supabase : de quoi satisfaire `loadViewer`, `lirePorteurs` et
// `lireEncadres` sans réseau. `maybeSingle()` sert la ligne du porteur du
// jeton ; attendre la chaîne elle-même sert une liste — ce sont les deux seules
// formes utilisées par access.ts.
//
// Il répond PAR TABLE depuis la 021 : `loadViewer` interroge maintenant
// `crm_users` ET `supervision`, et leur servir la même réponse ferait passer un
// test qui ne prouve rien (des porteurs lus comme des encadrés, ou l'inverse).
// ---------------------------------------------------------------------------
type Reponse = { data?: unknown; error?: unknown };

function fauxClient(reponses: {
  ligne?: Reponse;
  liste?: Reponse;
  supervision?: Reponse;
}) {
  const chaine = (liste: Reponse | undefined) => {
    const c: Record<string, unknown> = {};
    Object.assign(c, {
      select: () => c,
      eq: () => c,
      in: () => c,
      maybeSingle: async () => reponses.ligne ?? { data: null },
      then: (ok: (v: Reponse) => unknown, ko?: (e: unknown) => unknown) =>
        Promise.resolve(liste ?? { data: [] }).then(ok, ko),
    });
    return c;
  };
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return {
    from: (table: string) =>
      chaine(table === "supervision" ? reponses.supervision : reponses.liste),
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  } as any;
}

/** Un enregistreur de filtres : ce que la requête aurait envoyé à PostgREST. */
function fausseRequete() {
  const appels: string[] = [];
  const q: Record<string, unknown> = {};
  Object.assign(q, {
    appels,
    eq: (c: string, v: string) => {
      appels.push(`eq(${c},${v})`);
      return q;
    },
    in: (c: string, v: readonly string[]) => {
      appels.push(`in(${c},[${[...v].join("|")}])`);
      return q;
    },
  });
  return q as { appels: string[] };
}

const viewer = (p: Partial<Viewer> & { userId: string }): Viewer => ({
  role: "commercial",
  isAdmin: false,
  fullName: null,
  voitEquipe: false,
  encadreIds: [],
  visiblesIds: [p.userId],
  ...p,
});

const COLLINS_PORTEUR = viewer({
  userId: COLLINS,
  voitEquipe: true,
  visiblesIds: [COLLINS, NATHAN],
});
const REMI_SEUL = viewer({ userId: REMI });
/** Collins tel qu'il sera : porteur de l'interrupteur ET encadrant des deux étudiants. */
const COLLINS_ENCADRANT = viewer({
  userId: COLLINS,
  voitEquipe: true,
  encadreIds: [ETU_A, ETU_B],
  visiblesIds: [COLLINS, NATHAN, ETU_A, ETU_B],
});
/** Un étudiant : aucun drapeau, aucun lien sortant. Le défaut de la 016. */
const ETUDIANT_A = viewer({ userId: ETU_A });
const BORA_ADMIN = viewer({
  userId: BORA,
  role: "admin",
  isAdmin: true,
  visiblesIds: [],
});

// ---------------------------------------------------------------------------
// lirePorteurs — et sa TOLÉRANCE, qui est ce qui permet au code de partir avant
// la migration. Un échec vaut « personne ne partage » : on voit moins, jamais
// plus.
// ---------------------------------------------------------------------------
console.log("\n— lirePorteurs —");

verifie(
  "colonne absente (42703) : personne ne partage",
  await lirePorteurs(
    fauxClient({ liste: { error: { code: "42703" }, data: null } })
  ),
  []
);
verifie(
  "deux porteurs parmi quatre commerciaux : leurs identifiants seuls",
  await lirePorteurs(fauxClient({ liste: { data: COMMERCIAUX } })),
  [COLLINS, NATHAN]
);
verifie(
  "aucun porteur : liste vide",
  await lirePorteurs(fauxClient({ liste: { data: [] } })),
  []
);

// ---------------------------------------------------------------------------
// loadViewer — qui agit, et ce qu'il a le droit de LIRE.
// ---------------------------------------------------------------------------
console.log("\n— loadViewer —");

verifie(
  "compte désactivé : aucun accès",
  await loadViewer(
    fauxClient({
      ligne: { data: { id: REMI, role: "commercial", is_active: false } },
    }),
    REMI
  ),
  null
);
verifie(
  "jeton sans sujet : aucun accès",
  await loadViewer(fauxClient({}), null),
  null
);

const chargeCollins = await loadViewer(
  fauxClient({
    ligne: {
      data: { id: COLLINS, role: "commercial", is_active: true, full_name: "collins" },
    },
    liste: { data: COMMERCIAUX },
  }),
  COLLINS
);
verifie("Collins est porteur", chargeCollins?.voitEquipe, true);
verifie("Collins lit son binôme", chargeCollins?.visiblesIds, [COLLINS, NATHAN]);

const chargeRemi = await loadViewer(
  fauxClient({
    ligne: {
      data: { id: REMI, role: "commercial", is_active: true, full_name: "Rémi Perez" },
    },
    liste: { data: COMMERCIAUX },
  }),
  REMI
);
verifie("Rémi n'est pas porteur", chargeRemi?.voitEquipe, false);
verifie("Rémi ne lit que lui", chargeRemi?.visiblesIds, [REMI]);

const chargeBora = await loadViewer(
  fauxClient({
    ligne: {
      data: { id: BORA, role: "admin", is_active: true, full_name: "Bora Dogrul" },
    },
    liste: { data: COMMERCIAUX },
  }),
  BORA
);
verifie("Bora est admin", chargeBora?.isAdmin, true);
verifie("Bora ne porte pas l'interrupteur", chargeBora?.voitEquipe, false);
verifie("Bora n'est pas filtré", chargeBora?.visiblesIds, []);

// ---------------------------------------------------------------------------
// VOIR n'est pas ÉCRIRE — le cœur du lot.
// ---------------------------------------------------------------------------
console.log("\n— canSeeProspect / canEditProspect —");

verifie("Collins voit sa fiche", canSeeProspect(COLLINS_PORTEUR, COLLINS), true);
verifie(
  "Collins voit la fiche de Nathan",
  canSeeProspect(COLLINS_PORTEUR, NATHAN),
  true
);
verifie(
  "Collins ne voit PAS la fiche de Rémi",
  canSeeProspect(COLLINS_PORTEUR, REMI),
  false
);
verifie(
  "Collins ne voit PAS la fiche de Bora",
  canSeeProspect(COLLINS_PORTEUR, BORA),
  false
);
verifie(
  "vivier fermé : une fiche sans propriétaire reste invisible",
  canSeeProspect(COLLINS_PORTEUR, null),
  false
);

verifie("Collins modifie sa fiche", canEditProspect(COLLINS_PORTEUR, COLLINS), true);
verifie(
  "Collins ne modifie PAS la fiche de Nathan (qu'il voit)",
  canEditProspect(COLLINS_PORTEUR, NATHAN),
  false
);
verifie(
  "Bora modifie la fiche de n'importe qui",
  [
    canEditProspect(BORA_ADMIN, NATHAN),
    canEditProspect(BORA_ADMIN, REMI),
  ],
  [true, true]
);
verifie(
  "Rémi ne voit et ne modifie que les siennes",
  [
    canSeeProspect(REMI_SEUL, REMI),
    canSeeProspect(REMI_SEUL, NATHAN),
    canEditProspect(REMI_SEUL, NATHAN),
  ],
  [true, false, false]
);

// ---------------------------------------------------------------------------
// Le filtre poussé EN BASE — `in`, et jamais rien pour l'admin.
// ---------------------------------------------------------------------------
console.log("\n— scopeProspects / scopeJoinedProspects —");

verifie(
  "Collins : in sur les deux porteurs",
  scopeProspects(fausseRequete(), COLLINS_PORTEUR).appels,
  [`in(owner_id,[${COLLINS}|${NATHAN}])`]
);
verifie(
  "Rémi : in sur lui seul (le filtre MORD toujours)",
  scopeProspects(fausseRequete(), REMI_SEUL).appels,
  [`in(owner_id,[${REMI}])`]
);
verifie(
  "Bora : aucun filtre",
  scopeProspects(fausseRequete(), BORA_ADMIN).appels,
  []
);
verifie(
  "jointure : le filtre porte sur la table jointe",
  scopeJoinedProspects(fausseRequete(), COLLINS_PORTEUR).appels,
  [`in(prospects.owner_id,[${COLLINS}|${NATHAN}])`]
);

// ---------------------------------------------------------------------------
// Le PÉRIMÈTRE — du confort, et son garde-fou : l'URL n'est pas une sonde.
// ---------------------------------------------------------------------------
console.log("\n— lirePerimetre —");

const PC = { userId: COLLINS, isAdmin: false, voitEquipe: true, partageIds: [COLLINS, NATHAN] };
const PR = { userId: REMI, isAdmin: false };
const PB = { userId: BORA, isAdmin: true };

verifie("défaut « moi » pour l'admin aussi", lirePerimetre({}, PB), { mode: "moi" });
verifie("porteur : « equipe » accepté", lirePerimetre({ perimetre: "equipe" }, PC), {
  mode: "equipe",
});
verifie(
  "porteur : l'uuid d'un co-porteur accepté",
  lirePerimetre({ perimetre: NATHAN }, PC),
  { mode: "membre", id: NATHAN }
);
verifie(
  "porteur : l'uuid de Rémi REFUSÉ (l'URL ne doit pas servir de sonde)",
  lirePerimetre({ perimetre: REMI }, PC),
  { mode: "moi" }
);
verifie(
  "porteur : l'uuid de Bora REFUSÉ",
  lirePerimetre({ perimetre: BORA }, PC),
  { mode: "moi" }
);
verifie(
  "non-porteur : « equipe » ignoré",
  lirePerimetre({ perimetre: "equipe" }, PR),
  { mode: "moi" }
);
verifie(
  "non-porteur : un uuid ignoré",
  lirePerimetre({ perimetre: COLLINS }, PR),
  { mode: "moi" }
);
verifie(
  "admin : n'importe quel membre",
  lirePerimetre({ perimetre: REMI }, PB),
  { mode: "membre", id: REMI }
);
verifie("valeur inconnue : « moi »", lirePerimetre({ perimetre: "tout" }, PC), {
  mode: "moi",
});

verifie(
  "mode équipe : aucun filtre applicatif (c'est scopeProspects qui borne)",
  perimetreUserId({ mode: "equipe" }, PC),
  null
);

console.log("\n— peutElargir / membresProposables —");

verifie(
  "qui a droit au sélecteur",
  [peutElargir(PB), peutElargir(PC), peutElargir(PR)],
  [true, true, false]
);

const TOUS = [{ id: BORA }, { id: REMI }, { id: COLLINS }, { id: NATHAN }];
verifie(
  "admin : tout le monde",
  membresProposables(TOUS, PB).map((m) => m.id),
  [BORA, REMI, COLLINS, NATHAN]
);
verifie(
  "porteur : les porteurs SEULS (ni Bora ni Rémi nommés)",
  membresProposables(TOUS, PC).map((m) => m.id),
  [COLLINS, NATHAN]
);
verifie("non-porteur : personne", membresProposables(TOUS, PR), []);

// ---------------------------------------------------------------------------
// relanceEnLecture — « lecture partagée, écriture perso » appliqué au tableau
// de bord. Le pendant de `tasks_update`, rebasée sur `assignee_id` par la 020.
// ---------------------------------------------------------------------------
console.log("\n— relanceEnLecture —");

const vCollins = { userId: COLLINS, isAdmin: false };
const vBora = { userId: BORA, isAdmin: true };

verifie("ma relance : je l'actionne", relanceEnLecture(vCollins, COLLINS), false);
verifie(
  "la relance de Nathan : je la LIS (tasks_update la refuserait)",
  relanceEnLecture(vCollins, NATHAN),
  true
);
verifie(
  "une relance LIBRE reste à qui la regarde",
  relanceEnLecture(vCollins, null),
  false
);
verifie("… même non renseignée", relanceEnLecture(vCollins, undefined), false);
verifie(
  "l'admin actionne tout, y compris la relance de Rémi",
  [relanceEnLecture(vBora, REMI), relanceEnLecture(vBora, BORA)],
  [false, false]
);

// ---------------------------------------------------------------------------
// L'ENCADREMENT (migration 021) — une relation ORIENTÉE, et une seule sauteuse.
//
// Ce que ces cas défendent, en une phrase : un encadrant VOIT le travail de son
// étudiant et n'y TOUCHE pas, l'étudiant ne gagne RIEN, et l'encadrement ne se
// propage pas.
// ---------------------------------------------------------------------------
console.log("\n— lireEncadres —");

verifie(
  "table absente (42P01) : je n'encadre personne",
  await lireEncadres(
    fauxClient({
      liste: { data: COMMERCIAUX },
      supervision: { error: { code: "42P01" }, data: null },
    }),
    COLLINS
  ),
  []
);
verifie(
  "deux encadrés : leurs identifiants",
  await lireEncadres(
    fauxClient({
      liste: { data: COMMERCIAUX },
      supervision: {
        data: [{ commercial_id: ETU_A }, { commercial_id: ETU_B }],
      },
    }),
    COLLINS
  ),
  [ETU_A, ETU_B]
);
verifie(
  "un encadré DÉSACTIVÉ disparaît (la jointure du SQL le fait aussi)",
  await lireEncadres(
    fauxClient({
      // ETU_B n'est plus dans les commerciaux actifs.
      liste: { data: COMMERCIAUX.filter((m) => m.id !== ETU_B) },
      supervision: {
        data: [{ commercial_id: ETU_A }, { commercial_id: ETU_B }],
      },
    }),
    COLLINS
  ),
  [ETU_A]
);
verifie(
  "jeton sans sujet : personne",
  await lireEncadres(fauxClient({}), null),
  []
);
verifie(
  "lireLiensEncadrement tolère l'absence de la table",
  await lireLiensEncadrement(
    fauxClient({ supervision: { error: { code: "42P01" }, data: null } })
  ),
  []
);

console.log("\n— loadViewer : l'union des trois branches —");

const chargeEncadrant = await loadViewer(
  fauxClient({
    ligne: {
      data: { id: COLLINS, role: "commercial", is_active: true, full_name: "Collins" },
    },
    liste: { data: COMMERCIAUX },
    supervision: { data: [{ commercial_id: ETU_A }, { commercial_id: ETU_B }] },
  }),
  COLLINS
);
verifie(
  "Collins lit son binôme ET ses étudiants",
  chargeEncadrant?.visiblesIds,
  [COLLINS, NATHAN, ETU_A, ETU_B]
);
verifie("Collins encadre deux personnes", chargeEncadrant?.encadreIds, [
  ETU_A,
  ETU_B,
]);

// L'ORIENTATION, sur le chemin réel : l'étudiant a les mêmes données en face de
// lui (mêmes commerciaux actifs, mêmes liens) et n'en tire rien. Le faux client
// lui sert d'ailleurs la MÊME table `supervision` — ce qui compte, c'est que
// `lireEncadres` filtre sur `encadrant_id`, jamais sur `commercial_id`.
const chargeEtudiant = await loadViewer(
  fauxClient({
    ligne: {
      data: { id: ETU_A, role: "commercial", is_active: true, full_name: "Étudiant A" },
    },
    liste: { data: COMMERCIAUX },
    supervision: { data: [] },
  }),
  ETU_A
);
verifie(
  "ORIENTATION : l'étudiant A ne lit que lui",
  chargeEtudiant?.visiblesIds,
  [ETU_A]
);
verifie("… et n'encadre personne", chargeEtudiant?.encadreIds, []);

console.log("\n— l'encadrant VOIT, il n'ÉCRIT pas —");

verifie(
  "Collins voit les fiches de l'étudiant A",
  canSeeProspect(COLLINS_ENCADRANT, ETU_A),
  true
);
verifie(
  "Collins ne MODIFIE PAS la fiche de l'étudiant A",
  canEditProspect(COLLINS_ENCADRANT, ETU_A),
  false
);
verifie(
  "l'étudiant A ne voit RIEN de Collins",
  canSeeProspect(ETUDIANT_A, COLLINS),
  false
);
verifie(
  "l'étudiant A ne voit rien de l'étudiant B (même encadrant, pourtant)",
  canSeeProspect(ETUDIANT_A, ETU_B),
  false
);
verifie(
  "l'étudiant A ne voit ni Bora ni Rémi",
  [canSeeProspect(ETUDIANT_A, BORA), canSeeProspect(ETUDIANT_A, REMI)],
  [false, false]
);
verifie(
  "Rémi reste cloisonné DANS LES DEUX SENS, étudiants compris",
  [
    canSeeProspect(REMI_SEUL, ETU_A),
    canSeeProspect(COLLINS_ENCADRANT, REMI),
    canSeeProspect(ETUDIANT_A, REMI),
  ],
  [false, false, false]
);
verifie(
  "Collins <-> Nathan continue de fonctionner (020 intacte)",
  [
    canSeeProspect(COLLINS_ENCADRANT, NATHAN),
    canEditProspect(COLLINS_ENCADRANT, NATHAN),
  ],
  [true, false]
);

// TRANSITIVITÉ — la propriété tient à la FORME de `lireEncadres` : elle lit la
// table une fois et ne rappelle jamais sur son propre résultat. On le vérifie
// sur le chemin réel : Nathan encadre Collins, Collins encadre les étudiants,
// et la table de Nathan ne contient QUE Collins.
const chargeNathan = await loadViewer(
  fauxClient({
    ligne: {
      data: { id: NATHAN, role: "commercial", is_active: true, full_name: "Nathan" },
    },
    liste: { data: COMMERCIAUX },
    supervision: { data: [{ commercial_id: COLLINS }] },
  }),
  NATHAN
);
verifie(
  "TRANSITIVITÉ : Nathan encadre Collins et n'hérite PAS de ses étudiants",
  chargeNathan?.visiblesIds,
  [NATHAN, COLLINS]
);

console.log("\n— le filtre en base, et le sélecteur —");

verifie(
  "scopeProspects : un in sur les quatre propriétaires lisibles",
  scopeProspects(fausseRequete(), COLLINS_ENCADRANT).appels,
  [`in(owner_id,[${COLLINS}|${NATHAN}|${ETU_A}|${ETU_B}])`]
);
verifie(
  "l'étudiant : un in sur lui seul (le filtre MORD toujours)",
  scopeProspects(fausseRequete(), ETUDIANT_A).appels,
  [`in(owner_id,[${ETU_A}])`]
);

// Un encadrant qui ne porte PAS l'interrupteur : le cas qui prouve que le droit
// au sélecteur ne se déduit pas de `voitEquipe`.
const PE = {
  userId: NATHAN,
  isAdmin: false,
  voitEquipe: false,
  encadreIds: [ETU_A],
  partageIds: [NATHAN, ETU_A],
};
const PETU = { userId: ETU_A, isAdmin: false, voitEquipe: false, encadreIds: [] };

verifie(
  "un encadrant NON porteur a droit au sélecteur",
  peutElargir(PE),
  true
);
verifie("un étudiant n'y a pas droit", peutElargir(PETU), false);
verifie(
  "l'encadrant peut viser son étudiant",
  lirePerimetre({ perimetre: ETU_A }, PE),
  { mode: "membre", id: ETU_A }
);
verifie(
  "… et PAS Bora (l'URL n'est pas une sonde)",
  lirePerimetre({ perimetre: BORA }, PE),
  { mode: "moi" }
);
verifie(
  "l'étudiant est forcé à « moi », quoi qu'il mette dans l'URL",
  [
    lirePerimetre({ perimetre: "equipe" }, PETU),
    lirePerimetre({ perimetre: COLLINS }, PETU),
  ],
  [{ mode: "moi" }, { mode: "moi" }]
);
verifie(
  "l'encadrant ne PROPOSE que son étudiant et lui — jamais Bora ni Rémi",
  membresProposables(
    [{ id: BORA }, { id: REMI }, { id: NATHAN }, { id: ETU_A }, { id: ETU_B }],
    PE
  ).map((m) => m.id),
  [NATHAN, ETU_A]
);
verifie(
  "l'étudiant ne propose personne (le sélecteur ne le nomme pas)",
  membresProposables([{ id: COLLINS }, { id: ETU_B }], PETU),
  []
);
verifie(
  "la relance de son étudiant est en LECTURE pour l'encadrant",
  relanceEnLecture({ userId: COLLINS, isAdmin: false }, ETU_A),
  true
);

console.log(
  echecs === 0 ? "\nTous les cas passent." : `\n${echecs} cas en ÉCHEC.`
);
process.exit(echecs === 0 ? 0 : 1);
