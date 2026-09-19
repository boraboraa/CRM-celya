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
  canSeeProspect,
  canEditProspect,
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
// Un faux client Supabase : de quoi satisfaire `loadViewer` et `lirePorteurs`
// sans réseau. `maybeSingle()` sert la ligne du porteur du jeton ; attendre la
// chaîne elle-même sert la liste des porteurs — ce sont les deux seules formes
// utilisées par access.ts.
// ---------------------------------------------------------------------------
type Reponse = { data?: unknown; error?: unknown };

function fauxClient(reponses: { ligne?: Reponse; liste?: Reponse }) {
  const chaine: Record<string, unknown> = {};
  Object.assign(chaine, {
    select: () => chaine,
    eq: () => chaine,
    in: () => chaine,
    maybeSingle: async () => reponses.ligne ?? { data: null },
    then: (ok: (v: Reponse) => unknown, ko?: (e: unknown) => unknown) =>
      Promise.resolve(reponses.liste ?? { data: [] }).then(ok, ko),
  });
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return { from: () => chaine } as any;
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
  visiblesIds: [p.userId],
  ...p,
});

const COLLINS_PORTEUR = viewer({
  userId: COLLINS,
  voitEquipe: true,
  visiblesIds: [COLLINS, NATHAN],
});
const REMI_SEUL = viewer({ userId: REMI });
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
  "deux porteurs : leurs identifiants",
  await lirePorteurs(
    fauxClient({ liste: { data: [{ id: COLLINS }, { id: NATHAN }] } })
  ),
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
    liste: { data: [{ id: COLLINS }, { id: NATHAN }] },
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
    liste: { data: [{ id: COLLINS }, { id: NATHAN }] },
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
    liste: { data: [{ id: COLLINS }, { id: NATHAN }] },
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

console.log(
  echecs === 0 ? "\nTous les cas passent." : `\n${echecs} cas en ÉCHEC.`
);
process.exit(echecs === 0 ? 0 : 1);
