/**
 * La frontière SERVEUR → CLIENT : aucune fonction ne la traverse.
 *
 *   node --experimental-strip-types lib/rsc-frontiere.test.ts
 *
 * (script npm : `npm run test:frontiere`.)
 *
 * ---------------------------------------------------------------------------
 * POURQUOI CE TEST EXISTE
 * ---------------------------------------------------------------------------
 * Le 21 septembre 2026, `/dashboard` est tombé en « Application error » pour le
 * seul compte qui avait une relance en retard — Bora. Cause : `TaskSection`
 * (composant SERVEUR, dans app/(app)/dashboard/page.tsx) rendait `TaskList`
 * (composant CLIENT) en lui passant une PROP FONCTION :
 *
 *     lecture={lecture ? (_i, t) => lecture(t) : undefined}
 *
 * React refuse de sérialiser une fonction dans le flux RSC — « Functions cannot
 * be passed directly to Client Components » — et toute la page tombe. Les trois
 * filets du projet laissaient passer :
 *
 *   · `npx tsc --noEmit` : VERT. Le type de la prop autorisait la fonction ;
 *     TypeScript ne connaît pas la frontière serveur/client.
 *   · `next build` : VERT. Les routes dynamiques ne s'exécutent pas à la
 *     compilation (même motif que le piège `NAV_ITEMS` de CLAUDE.md).
 *   · les tests purs : ils testent des RÈGLES, pas des rendus.
 *
 * Et le crash était conditionné par les DONNÉES : `TaskSection` sort sur
 * `if (tasks.length === 0) return null` avant d'atteindre la ligne fautive.
 * Zéro relance échue, zéro symptôme — Rémi ne voyait rien, Bora ne voyait que
 * ça. Un bug de ce genre ne se trouve pas en relisant le code : il se trouve en
 * lisant la frontière.
 *
 * ---------------------------------------------------------------------------
 * CE QU'IL VÉRIFIE
 * ---------------------------------------------------------------------------
 * Pour chaque module SANS `"use client"` (donc serveur), toute balise JSX dont
 * le composant est importé d'un module `"use client"` : aucun de ses attributs
 * ne doit valoir une fonction — ni écrite sur place (`p={() => …}`, y compris
 * au fond d'un ternaire), ni nommée localement (`p={maFonction}`).
 *
 * Les SERVER ACTIONS sont la seule exception, et c'est React qui la pose : une
 * fonction d'un module `"use server"` est une référence sérialisable. Le test
 * les reconnaît et les laisse passer — c'est ainsi que les formulaires marchent.
 *
 * Analyse par l'AST de TypeScript (déjà en devDependency) : pas de regex, pas
 * de réseau, pas de dépendance nouvelle.
 */

import { readFileSync, readdirSync, existsSync, statSync } from "node:fs";
import { join, dirname, resolve } from "node:path";
import ts from "typescript";

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

const RACINE = resolve(import.meta.dirname, "..");
const DOSSIERS = ["app", "components", "lib"];

// --- Les fichiers du dépôt -------------------------------------------------
function sources(dossier: string, acc: string[] = []): string[] {
  const base = join(RACINE, dossier);
  if (!existsSync(base)) return acc;
  const parcourir = (d: string) => {
    for (const e of readdirSync(d, { withFileTypes: true })) {
      const p = join(d, e.name);
      if (e.isDirectory()) {
        if (e.name !== "node_modules" && !e.name.startsWith(".")) parcourir(p);
      } else if (/\.tsx?$/.test(e.name) && !/\.test\.tsx?$/.test(e.name)) {
        acc.push(p);
      }
    }
  };
  parcourir(base);
  return acc;
}

const FICHIERS = DOSSIERS.flatMap((d) => sources(d));

function lire(p: string) {
  return ts.createSourceFile(
    p,
    readFileSync(p, "utf8"),
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TSX
  );
}

/** La première directive du fichier : "use client", "use server", ou rien. */
function directive(sf: ts.SourceFile): string | null {
  for (const st of sf.statements) {
    if (
      ts.isExpressionStatement(st) &&
      ts.isStringLiteral(st.expression) &&
      (st.expression.text === "use client" || st.expression.text === "use server")
    ) {
      return st.expression.text;
    }
    // Une directive ne peut précéder que d'autres directives.
    if (!ts.isExpressionStatement(st) || !ts.isStringLiteral(st.expression)) break;
  }
  return null;
}

const AST = new Map<string, ts.SourceFile>();
const DIRECTIVE = new Map<string, string | null>();
for (const f of FICHIERS) {
  const sf = lire(f);
  AST.set(f, sf);
  DIRECTIVE.set(f, directive(sf));
}

/** `@/components/TaskList` ou `./maps` → le chemin réel du module, s'il est à nous. */
function resoudre(depuis: string, spec: string): string | null {
  let base: string;
  if (spec.startsWith("@/")) base = join(RACINE, spec.slice(2));
  else if (spec.startsWith(".")) base = resolve(dirname(depuis), spec);
  else return null; // dépendance externe : hors sujet
  for (const cand of [
    base,
    `${base}.tsx`,
    `${base}.ts`,
    join(base, "index.tsx"),
    join(base, "index.ts"),
  ]) {
    if (existsSync(cand) && statSync(cand).isFile() && /\.tsx?$/.test(cand)) {
      return cand;
    }
  }
  return null;
}

type Trouvaille = {
  fichier: string;
  ligne: number;
  composant: string;
  prop: string;
};

/**
 * Cette expression peut-elle VALOIR une fonction ?
 *
 * Structurel, et volontairement pas « contient une fonction quelque part » :
 * `drafts={drafts.map((d) => ({ …ic }))}` porte une flèche, mais elle est
 * APPELÉE côté serveur et ce qui traverse est un tableau d'objets nus. Un
 * parcours naïf de l'AST la signalait — un test qui crie au loup sur du code
 * juste finit désactivé, et ne protège plus de rien.
 *
 * On descend donc dans ce qui devient la valeur (ternaires, `&&`, `??`,
 * parenthèses, objets, tableaux) et jamais dans les ARGUMENTS d'un appel. Un
 * objet ou un tableau compte, lui : `p={{ onFoo: () => {} }}` échoue à la
 * sérialisation exactement comme `p={() => {}}`.
 */
function peutValoirFonction(n: ts.Node, locales: Set<string>): boolean {
  const r = (x: ts.Node) => peutValoirFonction(x, locales);
  if (ts.isArrowFunction(n) || ts.isFunctionExpression(n)) return true;
  if (ts.isIdentifier(n)) return locales.has(n.text);
  if (
    ts.isParenthesizedExpression(n) ||
    ts.isAsExpression(n) ||
    ts.isSatisfiesExpression(n) ||
    ts.isNonNullExpression(n) ||
    ts.isTypeAssertionExpression(n)
  ) {
    return r(n.expression);
  }
  if (ts.isConditionalExpression(n)) return r(n.whenTrue) || r(n.whenFalse);
  if (ts.isBinaryExpression(n)) {
    const k = n.operatorToken.kind;
    if (
      k === ts.SyntaxKind.AmpersandAmpersandToken ||
      k === ts.SyntaxKind.BarBarToken ||
      k === ts.SyntaxKind.QuestionQuestionToken
    ) {
      return r(n.left) || r(n.right);
    }
    return false;
  }
  if (ts.isObjectLiteralExpression(n)) {
    return n.properties.some((p) => {
      if (ts.isMethodDeclaration(p)) return true;
      if (ts.isPropertyAssignment(p)) return r(p.initializer);
      if (ts.isShorthandPropertyAssignment(p)) return locales.has(p.name.text);
      if (ts.isSpreadAssignment(p)) return r(p.expression);
      return false;
    });
  }
  if (ts.isArrayLiteralExpression(n)) {
    return n.elements.some((e) =>
      ts.isSpreadElement(e) ? r(e.expression) : r(e)
    );
  }
  return false;
}

function analyser(fichier: string): Trouvaille[] {
  const sf = AST.get(fichier)!;
  if (DIRECTIVE.get(fichier) !== null) return []; // client ou server action : pas notre frontière

  // Ce que ce module importe, et d'où.
  const origine = new Map<string, string>(); // identifiant local → fichier
  for (const st of sf.statements) {
    if (!ts.isImportDeclaration(st) || !ts.isStringLiteral(st.moduleSpecifier)) continue;
    const cible = resoudre(fichier, st.moduleSpecifier.text);
    if (!cible) continue;
    const b = st.importClause?.namedBindings;
    if (st.importClause?.name) origine.set(st.importClause.name.text, cible);
    if (b && ts.isNamedImports(b)) {
      for (const e of b.elements) {
        if (!e.isTypeOnly && !st.importClause?.isTypeOnly) origine.set(e.name.text, cible);
      }
    }
  }

  // Les fonctions déclarées DANS ce fichier — `prop={maFonction}` est aussi
  // une fonction qui traverse, même si elle n'est pas écrite sur place.
  const localesFonctions = new Set<string>();
  const collecter = (n: ts.Node) => {
    if (ts.isFunctionDeclaration(n) && n.name) localesFonctions.add(n.name.text);
    if (ts.isVariableDeclaration(n) && ts.isIdentifier(n.name) && n.initializer) {
      if (ts.isArrowFunction(n.initializer) || ts.isFunctionExpression(n.initializer)) {
        localesFonctions.add(n.name.text);
      }
    }
    ts.forEachChild(n, collecter);
  };
  collecter(sf);

  const trouvailles: Trouvaille[] = [];
  const visiter = (n: ts.Node) => {
    const ouverture = ts.isJsxElement(n)
      ? n.openingElement
      : ts.isJsxSelfClosingElement(n)
        ? n
        : null;
    if (ouverture) {
      const tag = ouverture.tagName.getText(sf);
      const source = origine.get(tag.split(".")[0]);
      // Balise HTML, composant local (serveur), ou composant d'un module
      // serveur : la frontière n'est pas là.
      if (source && DIRECTIVE.get(source) === "use client") {
        for (const attr of ouverture.attributes.properties) {
          if (!ts.isJsxAttribute(attr) || !attr.initializer) continue;
          if (!ts.isJsxExpression(attr.initializer) || !attr.initializer.expression) continue;
          const expr = attr.initializer.expression;
          const nom = attr.name.getText(sf);

          // `prop={() => …}`, `prop={a ? fn : undefined}`, `prop={maFonction}` :
          // toutes des fonctions qui atterrissent côté client.
          let coupable = peutValoirFonction(expr, localesFonctions);
          // Une SERVER ACTION est une référence, pas une closure : React sait
          // la sérialiser. C'est la seule fonction qui a le droit de passer.
          if (coupable && ts.isIdentifier(expr)) {
            const mod = origine.get(expr.text);
            if (mod && DIRECTIVE.get(mod) === "use server") coupable = false;
          }
          if (coupable) {
            trouvailles.push({
              fichier: fichier.slice(RACINE.length + 1),
              ligne: sf.getLineAndCharacterOfPosition(attr.getStart(sf)).line + 1,
              composant: tag,
              prop: nom,
            });
          }
        }
      }
    }
    ts.forEachChild(n, visiter);
  };
  visiter(sf);
  return trouvailles;
}

// --- Le test lui-même ------------------------------------------------------
console.log(
  `— frontière serveur → client — ${FICHIERS.length} modules, ` +
    `${FICHIERS.filter((f) => DIRECTIVE.get(f) === "use client").length} côté client —\n`
);

const trouvailles = FICHIERS.flatMap(analyser);
for (const t of trouvailles) {
  console.error(
    `  ✗ ${t.fichier}:${t.ligne} — <${t.composant} ${t.prop}={…}> : ` +
      `une fonction ne traverse pas la frontière serveur → client`
  );
}
verifie("aucune fonction ne franchit la frontière", trouvailles.length, 0);

// --- Le filet est-il bien tendu ? ------------------------------------------
// Un test qui ne trouve jamais rien peut être un test qui ne cherche rien. On
// lui redonne donc le code EXACT de fc4cfbc, et il doit le refuser.
const REGRESSION = `
import { TaskList } from "@/components/TaskList";
function TaskSection({ tasks, lecture }: { tasks: unknown[]; lecture?: (t: unknown) => boolean }) {
  if (tasks.length === 0) return null;
  return <TaskList tasks={tasks} lecture={lecture ? (_i, t) => lecture(t) : undefined} />;
}
`;
const FAUX = join(RACINE, "app", "__frontiere_regression__.tsx");
AST.set(FAUX, ts.createSourceFile(FAUX, REGRESSION, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX));
DIRECTIVE.set(FAUX, null);
verifie(
  "le crash du 21/09 serait bien attrapé",
  analyser(FAUX).map((t) => `${t.composant}.${t.prop}`),
  ["TaskList.lecture"]
);

// Et il ne doit pas hurler sur la forme CORRIGÉE.
const CORRIGE = `
import { TaskList } from "@/components/TaskList";
function TaskSection({ tasks, lecture }: { tasks: unknown[]; lecture?: string[] }) {
  if (tasks.length === 0) return null;
  return <TaskList tasks={tasks} lecture={lecture} />;
}
`;
const BON = join(RACINE, "app", "__frontiere_corrige__.tsx");
AST.set(BON, ts.createSourceFile(BON, CORRIGE, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX));
DIRECTIVE.set(BON, null);
verifie("la liste d'identifiants passe", analyser(BON).length, 0);

console.log(
  echecs === 0 ? "\nTous les cas passent." : `\n${echecs} cas en ÉCHEC.`
);
process.exit(echecs === 0 ? 0 : 1);
