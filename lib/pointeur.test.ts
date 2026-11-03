// npm run test:pointeur — le pointeur (souris ou doigt), le filet des 44 px,
// le glisser-déposer à la souris seule, le balayage, l'apparition des listes,
// et le GARDE-FOU : « souris: pour les cibles, lg: pour la mise en page ».
import assert from "node:assert/strict";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import {
  BALAYAGE_MIN_PX,
  CIBLE_TACTILE_MIN,
  REQUETE_DOIGT,
  REQUETE_SOURIS,
  balayage,
  deplacable,
  estSouris,
} from "./pointeur.ts";
import { APPARITIONS_MAX, clePage, delaiApparition, estRevue } from "./apparition.ts";

let ok = 0;
function cas(nom: string, f: () => void) {
  f();
  ok++;
  console.log(`  ✓ ${nom}`);
}

const racine = new URL("..", import.meta.url).pathname;
const lire = (chemin: string) => readFileSync(join(racine, chemin), "utf8");

cas("une seule requête : Tailwind l'importe, la CSS la recopie à l'identique", () => {
  assert.equal(REQUETE_SOURIS, "(hover: hover) and (pointer: fine)");
  assert.equal(REQUETE_DOIGT, "(pointer: coarse)");
  assert.equal(CIBLE_TACTILE_MIN, 44);
  const config = lire("tailwind.config.ts");
  assert.match(config, /import \{ REQUETE_SOURIS \} from "\.\/lib\/pointeur"/);
  assert.match(config, /souris: \{ raw: REQUETE_SOURIS \}/);
  assert.match(config, /hoverOnlyWhenSupported: true/);
  const css = lire("app/globals.css");
  assert.ok(css.includes(`@media ${REQUETE_SOURIS}`), "le soulèvement des cartes : à la souris seule");
  assert.ok(css.includes(`@media ${REQUETE_DOIGT}`), "le filet des 44 px et les champs à 16 px : au doigt");
  assert.ok(!css.includes("@media (max-width: 639px)"), "les champs à 16 px ne dépendent plus de la largeur");
  assert.match(css, /touch-action: manipulation/);
});

cas("le filet des 44 px : spécificité nulle, centré, sous le contenu, jamais sur un lien étiré", () => {
  const css = lire("app/globals.css");
  const filet = css.slice(css.indexOf("Le FILET des 44 px"));
  assert.match(filet, /:where\(\s*:is\(button, a\[href\], \[role="button"\], summary, label\[for\], label:has\(> input\)\)/);
  assert.match(filet, /\[class\*="before:"\]/, "un lien étiré (before:) n'est pas touché");
  assert.match(filet, /\[class\*="after:"\]/);
  assert.match(filet, /isolation: isolate/);
  assert.match(filet, /z-index: -1/);
  // La zone ne s'étend que de ce qui manque, des quatre côtés.
  for (const cote of ["top", "bottom", "left", "right"]) {
    assert.match(filet, new RegExp(`${cote}: min\\(0px, calc\\(50% - ${CIBLE_TACTILE_MIN / 2}px\\)\\)`), cote);
  }
  assert.match(filet, /:where\(select\) \{\s*min-height: 44px;/);
});

cas("estSouris : sans matchMedia (serveur), on part du doigt", () => {
  assert.equal(estSouris(undefined), false);
  assert.equal(estSouris(null), false);
  assert.equal(estSouris((q) => ({ matches: q === REQUETE_SOURIS })), true);
  assert.equal(estSouris(() => ({ matches: false })), false);
  assert.equal(estSouris(() => { throw new Error("pas de matchMedia"); }), false);
});

cas("glisser-déposer : à la souris, et seulement sur ce qu'on peut modifier", () => {
  assert.equal(deplacable(true, true), true);
  assert.equal(deplacable(false, true), false, "au doigt, la carte est un lien");
  assert.equal(deplacable(true, false), false, "la fiche d'un collègue ne bouge pas");
  assert.equal(deplacable(false, false), false);
});

cas("balayage : franchement horizontal, sinon rien", () => {
  assert.equal(balayage(-80, 0), 1, "vers la gauche : jour suivant");
  assert.equal(balayage(80, 10), -1, "vers la droite : jour précédent");
  assert.equal(balayage(BALAYAGE_MIN_PX - 1, 0), 0, "trop court");
  assert.equal(balayage(-70, 36), 0, "défilement oblique : plus de la moitié de vertical");
  assert.equal(balayage(-120, 59), 1, "un peu de vertical, deux fois moins : accepté");
  assert.equal(balayage(-120, -61), 0);
  assert.equal(balayage(0, 300), 0, "défilement vertical");
});

cas("apparition : un décalage pour les 6 premiers seulement", () => {
  assert.equal(APPARITIONS_MAX, 6);
  assert.deepEqual([0, 1, 2, 3, 4, 5].map(delaiApparition), [0, 30, 60, 90, 120, 150]);
  assert.equal(delaiApparition(6), null, "la 7e colonne arrive sans animation");
  assert.equal(delaiApparition(40), null);
  assert.equal(delaiApparition(-1), null);
  assert.equal(delaiApparition(1.5), null);
});

cas("apparition : une page déjà vue ne rejoue rien au retour", () => {
  assert.equal(clePage("/prospects?statut=a_appeler"), "/prospects", "un filtre ne rend pas la page neuve");
  assert.equal(clePage("/prospects/"), "/prospects");
  assert.equal(clePage("/"), "/");
  let r = estRevue([], "/prospects");
  assert.deepEqual(r, { revue: false, vues: ["/prospects"] });
  r = estRevue(r.vues, "/prospects/123");
  assert.equal(r.revue, false);
  r = estRevue(r.vues, "/prospects?secteur=Autre#haut");
  assert.equal(r.revue, true, "retour sur la liste");
  const beaucoup = Array.from({ length: 60 }, (_, i) => `/p${i}`);
  assert.equal(estRevue(beaucoup, "/neuf").vues.length, 50, "mémoire bornée");
});

// ─── Le garde-fou de STRUCTURE ────────────────────────────────────────────
//
// « souris: pour les cibles, lg: pour la mise en page. » Chaque `lg:` restant
// (sans `souris:`) a été CLASSÉ « mise en page » le 3/11 — cet inventaire est
// la liste blanche. Un nouveau `lg:` fait rougir ce test : le classer ici
// (mise en page) ou l'écrire `lg:souris:` (cible). Une cible ne rétrécit
// jamais à cause de la largeur : un iPad en paysage a des doigts.
const MISE_EN_PAGE: Record<string, string[]> = {
  "app/(app)/compte/page.tsx": ["hidden"],
  "app/(app)/equipe/page.tsx": ["grid-cols-5"],
  "app/(app)/layout.tsx": ["flex", "hidden", "px-8", "py-9"],
  "app/(app)/prospects/[id]/page.tsx": ["col-span-2", "grid-cols-3", "mt-1.5", "text-2xl", "w-auto"],
  "app/(app)/reglages-email/page.tsx": ["grid-cols-2"],
  "components/AffichageProspects.tsx": ["flex", "hidden", "mb-4"],
  "components/BarreOnglets.tsx": ["hidden"],
  "components/DebriefList.tsx": ["block", "flex", "gap-3", "items-baseline", "min-w-0", "shrink-0"],
  "components/ListeProspects.tsx": ["bottom-6", "left-64"],
  "components/MaListe.tsx": [
    "bg-transparent", "col-span-2", "col-span-4",
    "grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)_minmax(0,1fr)_minmax(0,1.2fr)]",
    "max-w-none", "p-0", "pb-0", "px-0", "ring-0", "shadow-none", "static",
  ],
  "components/PerimetreSwitcher.tsx": ["flex", "hidden"],
  "components/PipelineBoard.tsx": ["block", "flex", "gap-4", "hidden", "inline-flex", "min-w-max", "w-[272px]", "w-[76px]"],
  "components/RepliMobile.tsx": ["block", "hidden"],
  "components/Skeleton.tsx": ["col-span-2", "grid-cols-3"],
  "components/Timeline.tsx": ["block", "flex", "hidden"],
  "components/appelsIa/ecran/AssistantCampagne.tsx": ["grid-cols-4"],
  "components/appelsIa/ecran/Campagnes.tsx": ["grid-cols-2"],
  "components/ui.tsx": ["block", "mb-7", "text-2xl"],
};

function fichiers(dossier: string): string[] {
  const out: string[] = [];
  for (const nom of readdirSync(join(racine, dossier))) {
    const rel = `${dossier}/${nom}`;
    if (statSync(join(racine, rel)).isDirectory()) out.push(...fichiers(rel));
    else if (rel.endsWith(".tsx")) out.push(rel);
  }
  return out;
}
const TSX = [...fichiers("app"), ...fichiers("components")];

cas("chaque `lg:` restant est une bascule de MISE EN PAGE inventoriée", () => {
  const trouve: Record<string, string[]> = {};
  for (const f of TSX) {
    const toks = [...lire(f).matchAll(/(?<![\w:-])lg:(?!souris:)([^\s"`'}]+)/g)].map((m) => m[1]);
    if (toks.length) trouve[f] = [...new Set(toks)].sort();
  }
  assert.deepEqual(
    trouve,
    MISE_EN_PAGE,
    "un `lg:` non classé : mise en page → l'ajouter à MISE_EN_PAGE ; cible → l'écrire `lg:souris:`"
  );
});

cas("aucune cible ne rétrécit à la largeur : ni min-h-0, ni case de 20 px, sans `souris:`", () => {
  const fautes: string[] = [];
  for (const f of TSX) {
    const t = lire(f);
    for (const m of t.matchAll(/(?<![\w:-])(?:sm|md|lg|xl|2xl):(?!souris:)(min-h-0|min-w-0\s+min-h-0|m-0|h-5|w-5|h-4|w-4)(?![\w-])/g)) {
      fautes.push(`${f} : ${m[0]}`);
    }
  }
  assert.deepEqual(fautes, []);
});

cas("les bascules de cible connues sont bien à la souris", () => {
  const tache = lire("components/TaskRow.tsx");
  assert.match(tache, /h-11 w-11 place-items-center lg:souris:m-0 lg:souris:h-5 lg:souris:w-5/, "la case garde 44 px au doigt");
  assert.match(tache, /mt-2\.5 flex flex-wrap items-center gap-2 lg:souris:hidden/, "la rangée tactile (Appeler, Résultat, date) reste au doigt");
  assert.match(tache, /hidden shrink-0 items-center gap-1 lg:souris:flex/, "les commandes compactes : souris seule");
  const pipeline = lire("components/PipelineBoard.tsx");
  assert.match(pipeline, /focus:ring-celya-blue\/60 lg:souris:hidden/, "le menu d'étape de la carte reste au doigt en paysage");
  assert.match(pipeline, /draggable=\{glissable\}/);
  assert.match(lire("components/AgendaGrid.tsx"), /deplacable\(\s*souris,/);
});

console.log(`\n${ok} OK`);
