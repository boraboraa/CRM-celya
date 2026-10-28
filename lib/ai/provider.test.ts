/**
 * Test du fournisseur IA — contre un faux MiniMax qui répond comme le vrai.
 *
 * Le piège que ce test existe pour attraper : MiniMax renvoie HTTP 200 MÊME
 * EN CAS D'ÉCHEC, l'erreur étant dans `base_resp.status_code` (1004 = clé
 * refusée, 1008 = solde épuisé, 1002 = débit). `if (!res.ok)` ne se déclenche
 * donc jamais, et une clé morte devient indiscernable d'une panne réseau.
 *
 * Leçon déjà payée sur `imapHint` (voir CLAUDE.md) : un traducteur d'erreurs
 * doit être testé contre l'erreur RÉELLE du fournisseur, pas contre celle
 * qu'on imagine. D'où un vrai serveur HTTP local plutôt qu'un fetch simulé.
 *
 * Vérifie aussi les deux invariants : chatJSON renvoie TOUJOURS null en cas
 * d'échec (aucun appelant ne doit se mettre à lever), et la clé d'API
 * n'apparaît JAMAIS — ni dans un log, ni dans une réponse de diagnostic.
 *
 *   npm run test:ia
 */

import http from "node:http";
import type { AddressInfo } from "node:net";

// Un faux MiniMax : il répond HTTP 200 même quand il refuse — c'est tout le
// piège que le correctif doit attraper.
let mode = "base_resp_1004";
let dernierCorps: { max_tokens?: number } = {};
// La réflexion de MiniMax-M3 telle que relevée dans les logs du 28/10 —
// accolades comprises : c'est ce qui trompait l'extraction du JSON.
const REFLEXION =
  "<think>We need respond operations only. List seems columns company | phone. " +
  "Output like {ops: [...]} maybe {\"op\":\"secteur\"}.</think>\n";
const serveur = http.createServer(async (req, res) => {
  let corps = "";
  for await (const morceau of req) corps += morceau;
  try {
    dernierCorps = JSON.parse(corps);
  } catch {
    dernierCorps = {};
  }
  const repondre = (content: string) =>
    res.end(
      JSON.stringify({
        base_resp: { status_code: 0, status_msg: "success" },
        choices: [{ message: { content } }],
      })
    );
  if (mode === "http_404") {
    res.writeHead(404, { "content-type": "text/plain" });
    res.end("404 page not found");
    return;
  }
  res.writeHead(200, { "content-type": "application/json" });
  if (mode === "base_resp_1004") {
    res.end(
      JSON.stringify({ base_resp: { status_code: 1004, status_msg: "invalid api key" } })
    );
  } else if (mode === "base_resp_1008") {
    res.end(
      JSON.stringify({ base_resp: { status_code: 1008, status_msg: "insufficient balance" } })
    );
  } else if (mode === "ok") {
    repondre('{"ok":true}');
  } else if (mode === "think") {
    repondre(REFLEXION + '{"ok":true}');
  } else if (mode === "think_coupe") {
    repondre("<think>We need respond operations only. Maybe {\"op\": ... and then");
  } else if (mode === "think_sans_json") {
    repondre(REFLEXION + "Voici la réponse : d'accord.");
  } else {
    res.end(JSON.stringify({ choices: [{ message: { content: "pas du json" } }] }));
  }
});
await new Promise<void>((r) => {
  serveur.listen(0, () => r());
});
const base = `http://127.0.0.1:${(serveur.address() as AddressInfo).port}/v1`;

process.env.AGENT_PROVIDER = "minimax";
process.env.MINIMAX_API_KEY = "cle-bidon-pour-le-test";
process.env.MINIMAX_BASE_URL = base;
process.env.MINIMAX_MODEL = "MiniMax-Text-01";

const { chatJSON, aiAvailable, etatFournisseur, testerFournisseur, retirerRaisonnement } =
  await import("./provider.ts");
const { messagePourCause } = await import("./causes.ts");

const lignes: string[] = [];
const vraiErr = console.error;
console.error = (...a) => {
  lignes.push(a.join(" "));
  vraiErr(...a);
};

let echecs = 0;
function attendu(nom: string, condition: boolean, vu?: unknown) {
  console.log(`${condition ? "  OK  " : " ÉCHEC"} ${nom}${condition ? "" : ` — vu : ${vu}`}`);
  if (!condition) echecs++;
}

// ---- 1. Clé refusée : HTTP 200, erreur dans le corps.
mode = "base_resp_1004";
lignes.length = 0;
let res = await chatJSON({ system: "s", user: "u" });
attendu("clé refusée → chatJSON renvoie null", res === null, res);
attendu(
  "clé refusée → ligne [IA] base_resp_1004",
  lignes.some((l) => l.startsWith("[IA] base_resp_1004")),
  lignes.join(" | ")
);
attendu(
  "aucune clé dans les logs",
  !lignes.join(" ").includes("cle-bidon-pour-le-test"),
  lignes.join(" | ")
);
let diag = await testerFournisseur();
attendu(
  "diagnostic → « Clé d'API refusée par MiniMax. »",
  messagePourCause(diag.cause, diag.detail) === "Clé d'API refusée par MiniMax.",
  messagePourCause(diag.cause, diag.detail)
);

// ---- 2. Solde épuisé.
mode = "base_resp_1008";
diag = await testerFournisseur();
attendu(
  "solde → « Solde MiniMax épuisé — rechargez le compte. »",
  messagePourCause(diag.cause, diag.detail) ===
    "Solde MiniMax épuisé — rechargez le compte.",
  messagePourCause(diag.cause, diag.detail)
);

// ---- 3. URL fausse (404) : le message nomme la variable à corriger.
mode = "http_404";
diag = await testerFournisseur();
attendu(
  "404 → message qui nomme MINIMAX_BASE_URL",
  diag.cause === "http_404" &&
    messagePourCause(diag.cause, diag.detail).includes("MINIMAX_BASE_URL"),
  `${diag.cause} / ${messagePourCause(diag.cause, diag.detail)}`
);

// ---- 4. Réponse hors format.
mode = "json_invalide";
lignes.length = 0;
res = await chatJSON({ system: "s", user: "u" });
attendu(
  "hors format → null + [IA] json_invalide",
  res === null && lignes.some((l) => l.startsWith("[IA] json_invalide")),
  lignes.join(" | ")
);

// ---- 5. Tout va bien.
mode = "ok";
res = await chatJSON({ system: "s", user: "u" });
attendu("réponse valide → objet JSON", res?.ok === true, JSON.stringify(res));
diag = await testerFournisseur();
attendu("diagnostic → ok", diag.cause === "ok", diag.cause);

// ---- 5bis. Un modèle qui raisonne (MiniMax-M3, 28/10) : la réflexion
// précède le JSON et contient des accolades.
mode = "think";
lignes.length = 0;
res = await chatJSON({ system: "s", user: "u", maxTokens: 1200 });
attendu("réflexion puis JSON → l'objet JSON", res?.ok === true, JSON.stringify(res));
attendu("aucune ligne [IA] quand la réflexion est retirée", lignes.length === 0, lignes.join(" | "));
attendu(
  "le budget de jetons porte la marge de réflexion",
  (dernierCorps.max_tokens ?? 0) > 1200,
  dernierCorps.max_tokens
);
diag = await testerFournisseur();
attendu("diagnostic → ok malgré la réflexion", diag.cause === "ok", diag.cause);

mode = "think_coupe";
lignes.length = 0;
res = await chatJSON({ system: "s", user: "u" });
attendu(
  "réflexion coupée → null + [IA] reponse_coupee",
  res === null && lignes.some((l) => l.startsWith("[IA] reponse_coupee")),
  lignes.join(" | ")
);
diag = await testerFournisseur();
attendu(
  "diagnostic → message « raisonné trop longtemps »",
  diag.cause === "reponse_coupee" &&
    messagePourCause(diag.cause, diag.detail).includes("raisonné trop longtemps"),
  `${diag.cause} / ${messagePourCause(diag.cause, diag.detail)}`
);

// ---- 5ter. Le diagnostic n'accepte plus « une réponse quelconque » : le
// 28/10 il disait « ok » pendant que tous les vrais appels échouaient.
mode = "think_sans_json";
diag = await testerFournisseur();
attendu("réponse sans JSON → diagnostic json_invalide", diag.cause === "json_invalide", diag.cause);
mode = "json_invalide";
diag = await testerFournisseur();
attendu("« pas du json » → diagnostic json_invalide", diag.cause === "json_invalide", diag.cause);

// ---- 5quater. retirerRaisonnement, à l'unité.
const r1 = retirerRaisonnement("<think>a {b}</think>\n{\"x\":1}");
attendu("bloc fermé retiré", r1.texte === '{"x":1}' && !r1.coupe, JSON.stringify(r1));
const r2 = retirerRaisonnement("<THINK>a</THINK><think>b</think>{}");
attendu("plusieurs blocs, casse indifférente", r2.texte === "{}" && !r2.coupe, JSON.stringify(r2));
const r3 = retirerRaisonnement("<think>jamais fini");
attendu("bloc ouvert → vide et coupe", r3.texte === "" && r3.coupe, JSON.stringify(r3));
const r4 = retirerRaisonnement('{"pas":"de réflexion"}');
attendu("sans réflexion → tel quel", r4.texte === '{"pas":"de réflexion"}' && !r4.coupe, JSON.stringify(r4));
mode = "ok";

// ---- 6. Variable manquante (la recette : retirer MINIMAX_MODEL).
delete process.env.MINIMAX_MODEL;
lignes.length = 0;
const etat = etatFournisseur();
attendu(
  "MINIMAX_MODEL retiré → variablesManquantes le nomme",
  etat.variablesManquantes.join(",") === "MINIMAX_MODEL",
  etat.variablesManquantes.join(",")
);
attendu(
  "la clé n'est jamais renvoyée, seulement sa longueur",
  etat.cleePresente === true &&
    etat.cleeLongueur === "cle-bidon-pour-le-test".length &&
    !JSON.stringify(etat).includes("cle-bidon-pour-le-test"),
  JSON.stringify(etat)
);
diag = await testerFournisseur();
attendu(
  "diagnostic → « Variables manquantes … MINIMAX_MODEL »",
  messagePourCause(diag.cause, etat.variablesManquantes.join(", ")) ===
    "Variables manquantes sur l'hébergeur : MINIMAX_MODEL.",
  messagePourCause(diag.cause, etat.variablesManquantes.join(", "))
);
attendu("config absente → chatJSON renvoie null", (await chatJSON({ system: "s", user: "u" })) === null);
attendu("aiAvailable() = false et le journalise", aiAvailable() === false &&
  lignes.some((l) => l.startsWith("[IA] config_absente")), lignes.join(" | "));

serveur.close();
console.log(echecs === 0 ? "\nTous les cas passent." : `\n${echecs} cas en échec.`);
process.exit(echecs === 0 ? 0 : 1);
