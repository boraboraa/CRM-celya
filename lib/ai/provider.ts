/**
 * Abstraction du fournisseur IA — le fournisseur actif vient de AGENT_PROVIDER,
 * sa configuration des variables <FOURNISSEUR>_API_KEY / _BASE_URL / _MODEL /
 * _VISION_MODEL. Deux familles :
 *  - `anthropic` : API Messages via le SDK officiel (ANTHROPIC_API_KEY,
 *    ANTHROPIC_MODEL — défaut claude-opus-5) ;
 *  - tout le reste : API chat completions au format OpenAI (aujourd'hui
 *    MINIMAX_*). Le fournisseur se change par variable d'environnement,
 *    jamais par réécriture.
 *
 * Module strictement serveur : la clé d'API ne doit jamais atteindre le
 * navigateur. Toute panne ou réponse hors format renvoie null — l'appelant
 * doit toujours avoir un chemin manuel. C'est un CONTRAT : `chatJSON` ne lève
 * jamais, et aucun appelant n'a à s'y préparer.
 *
 * MAIS un échec silencieux n'est pas un échec expliqué. Chaque abandon passe
 * désormais par `echecIA`, qui écrit UNE ligne serveur nommant la cause —
 * variable absente, clé refusée, solde épuisé, URL fausse, réponse hors
 * format. Sans elle, quatre pannes très différentes se ressemblaient toutes à
 * l'écran (« Assistant indisponible ») et personne ne pouvait répondre à
 * « pourquoi l'IA ne marche pas ». La clé, elle, n'est JAMAIS journalisée.
 */

import Anthropic from "@anthropic-ai/sdk";
// Extension explicite et chemin RELATIF : ce module est exécuté tel quel par
// node pour `npm run test:ia` (voir provider.test.ts), qui ne connaît ni
// l'alias « @/ » ni les spécificateurs sans extension. Même motif que
// lib/crm/raccourcis.ts → ./maps.ts.
import {
  CAUSE_CONFIG_ABSENTE,
  CAUSE_JSON_INVALIDE,
  CAUSE_REFUS_MODELE,
  CAUSE_REPONSE_VIDE,
  CAUSE_RESEAU,
  CAUSE_TIMEOUT,
} from "./causes.ts";

const TIMEOUT_MS = 30000;

type TextPart = { type: "text"; text: string };
type ImagePart = { type: "image_url"; image_url: { url: string } };
export type UserContent = string | (TextPart | ImagePart)[];

function assertServer() {
  if (typeof window !== "undefined") {
    throw new Error("lib/ai/provider est un module serveur uniquement.");
  }
}

// ---------------------------------------------------------------------------
// Journalisation des échecs — un seul helper, une seule forme de ligne.
// ---------------------------------------------------------------------------

/**
 * La ligne que l'on cherchera dans les logs Vercel : `[IA] <cause> — <détail>`.
 * Ne JAMAIS y passer la clé d'API, un en-tête Authorization, ni le contenu
 * d'un échange avec un prospect — seulement de quoi nommer la panne.
 */
function echecIA(cause: string, detail?: string | null) {
  console.error(`[IA] ${cause}${detail ? ` — ${detail}` : ""}`);
}

/** Un corps de réponse ou un message d'erreur, réduit à ce qui se lit. */
function tronque(value: unknown, max = 200): string {
  const texte =
    typeof value === "string" ? value : value === undefined ? "" : String(value);
  const net = texte.replace(/\s+/g, " ").trim();
  return net.length > max ? `${net.slice(0, max)}…` : net;
}

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------

type ProviderConfig =
  | { kind: "anthropic"; apiKey: string; baseUrl: string | null; model: string }
  | { kind: "openai_compat"; apiKey: string; baseUrl: string; model: string };

/** Ce que l'environnement dit du fournisseur — y compris ce qui lui manque. */
type ConfigLue = {
  /** La valeur d'AGENT_PROVIDER, telle qu'elle est écrite. */
  fournisseur: string;
  config: ProviderConfig | null;
  /** Les VARIABLES manquantes, nommées — jamais leur valeur. */
  manquantes: string[];
  /** Le modèle et l'URL retenus, même quand la configuration est incomplète. */
  modele: string | null;
  baseUrl: string | null;
  cleePresente: boolean;
  cleeLongueur: number;
};

/**
 * Lit la configuration du fournisseur actif, et surtout : dit ce qui manque.
 * C'est la différence entre « Assistant indisponible » et « il manque
 * MINIMAX_MODEL sur l'hébergeur ».
 */
function lireConfig(vision: boolean): ConfigLue {
  const name = (process.env.AGENT_PROVIDER ?? "minimax").trim();

  if (name.toLowerCase() === "anthropic") {
    const apiKey = process.env.ANTHROPIC_API_KEY ?? "";
    const model = vision
      ? (process.env.ANTHROPIC_VISION_MODEL ??
        process.env.ANTHROPIC_MODEL ??
        "claude-opus-5")
      : (process.env.ANTHROPIC_MODEL ?? "claude-opus-5");
    const baseUrl = process.env.ANTHROPIC_BASE_URL?.replace(/\/+$/, "") ?? null;
    const manquantes = apiKey ? [] : ["ANTHROPIC_API_KEY"];

    return {
      fournisseur: name,
      config: apiKey ? { kind: "anthropic", apiKey, baseUrl, model } : null,
      manquantes,
      modele: model,
      baseUrl,
      cleePresente: Boolean(apiKey),
      cleeLongueur: apiKey.length,
    };
  }

  const prefix = name.toUpperCase().replace(/[^A-Z0-9]/g, "_");
  const apiKey = process.env[`${prefix}_API_KEY`] ?? "";
  const baseUrlRaw = process.env[`${prefix}_BASE_URL`] ?? "";
  const modelRaw = vision
    ? (process.env[`${prefix}_VISION_MODEL`] ?? process.env[`${prefix}_MODEL`] ?? "")
    : (process.env[`${prefix}_MODEL`] ?? "");

  const manquantes: string[] = [];
  if (!apiKey) manquantes.push(`${prefix}_API_KEY`);
  if (!baseUrlRaw) manquantes.push(`${prefix}_BASE_URL`);
  if (!modelRaw) manquantes.push(`${prefix}_MODEL`);

  const baseUrl = baseUrlRaw ? baseUrlRaw.replace(/\/+$/, "") : null;

  return {
    fournisseur: name,
    config:
      manquantes.length === 0
        ? { kind: "openai_compat", apiKey, baseUrl: baseUrl!, model: modelRaw }
        : null,
    manquantes,
    modele: modelRaw || null,
    baseUrl,
    cleePresente: Boolean(apiKey),
    cleeLongueur: apiKey.length,
  };
}

/**
 * Le fournisseur est-il configuré dans cet environnement ? Une réponse
 * négative est JOURNALISÉE : c'est la panne la plus fréquente (une variable
 * oubliée sur Vercel) et la plus invisible.
 */
export function aiAvailable(vision = false): boolean {
  assertServer();
  const lue = lireConfig(vision);
  if (!lue.config) {
    echecIA(
      CAUSE_CONFIG_ABSENTE,
      `${lue.fournisseur} : ${lue.manquantes.join(", ")}`
    );
    return false;
  }
  return true;
}

// ---------------------------------------------------------------------------
// Diagnostic — ce que l'écran « Assistant IA » de /compte affiche.
// ---------------------------------------------------------------------------

export type EtatFournisseur = {
  fournisseur: string;
  modele: string | null;
  baseUrl: string | null;
  /** Jamais la clé : seulement qu'elle est là, et sa longueur. */
  cleePresente: boolean;
  cleeLongueur: number;
  variablesManquantes: string[];
};

/** L'état de la configuration, sans appeler le fournisseur. */
export function etatFournisseur(): EtatFournisseur {
  assertServer();
  const lue = lireConfig(false);
  return {
    fournisseur: lue.fournisseur,
    modele: lue.modele,
    baseUrl: lue.baseUrl,
    cleePresente: lue.cleePresente,
    cleeLongueur: lue.cleeLongueur,
    variablesManquantes: lue.manquantes,
  };
}

export type TestFournisseur = {
  /** "ok", ou la cause exacte — la même que celle écrite dans les logs. */
  cause: string;
  detail: string | null;
  ms: number;
};

/**
 * Un appel RÉEL minimal : c'est le seul moyen de distinguer une clé refusée
 * d'un solde vide d'une URL fausse — MiniMax répond HTTP 200 dans les trois
 * cas. Renvoie la cause, là où `chatJSON` ne renvoie que null.
 */
export async function testerFournisseur(): Promise<TestFournisseur> {
  assertServer();
  const debut = Date.now();
  const lue = lireConfig(false);

  if (!lue.config) {
    const detail = lue.manquantes.join(", ");
    echecIA(CAUSE_CONFIG_ABSENTE, `${lue.fournisseur} : ${detail}`);
    return { cause: CAUSE_CONFIG_ABSENTE, detail, ms: Date.now() - debut };
  }

  const res = await appelerFournisseur(lue.config, {
    system: 'Réponds exactement {"ok":true}',
    user: "ping",
    maxTokens: 20,
  });

  if (!res.ok) {
    echecIA(res.cause, res.detail);
    return { cause: res.cause, detail: res.detail ?? null, ms: Date.now() - debut };
  }
  return { cause: "ok", detail: null, ms: Date.now() - debut };
}

// ---------------------------------------------------------------------------
// L'appel
// ---------------------------------------------------------------------------

type Reponse =
  | { ok: true; text: string }
  | { ok: false; cause: string; detail: string | null };

/**
 * Appelle le modèle et attend un objet JSON en sortie. Renvoie null si le
 * fournisseur est absent, en panne, ou si la réponse n'est pas du JSON
 * exploitable — jamais d'exception. Chaque null part avec sa ligne `[IA] …`.
 */
export async function chatJSON(opts: {
  system: string;
  user: UserContent;
  vision?: boolean;
  maxTokens?: number;
}): Promise<Record<string, unknown> | null> {
  assertServer();

  const lue = lireConfig(opts.vision ?? false);
  if (!lue.config) {
    echecIA(
      CAUSE_CONFIG_ABSENTE,
      `${lue.fournisseur} : ${lue.manquantes.join(", ")}`
    );
    return null;
  }

  const res = await appelerFournisseur(lue.config, opts);
  if (!res.ok) {
    echecIA(res.cause, res.detail);
    return null;
  }

  const parsed = parseLooseJSON(res.text);
  if (!parsed) {
    // Le début de la réponse brute : c'est lui qui dit si le modèle a bavardé
    // avant son JSON, ou s'il a répondu tout autre chose.
    echecIA(CAUSE_JSON_INVALIDE, tronque(res.text));
    return null;
  }
  return parsed;
}

function appelerFournisseur(
  config: ProviderConfig,
  opts: { system: string; user: UserContent; maxTokens?: number }
): Promise<Reponse> {
  return config.kind === "anthropic"
    ? anthropicChat(config, opts)
    : openAICompatChat(config, opts);
}

// ---------------------------------------------------------------------------
// Fournisseur Anthropic — API Messages, SDK officiel.
// ---------------------------------------------------------------------------

async function anthropicChat(
  config: Extract<ProviderConfig, { kind: "anthropic" }>,
  opts: { system: string; user: UserContent; maxTokens?: number }
): Promise<Reponse> {
  try {
    const client = new Anthropic({
      apiKey: config.apiKey,
      ...(config.baseUrl ? { baseURL: config.baseUrl } : {}),
      timeout: TIMEOUT_MS,
      maxRetries: 1,
    });

    const content: Anthropic.ContentBlockParam[] = [];
    if (typeof opts.user === "string") {
      content.push({ type: "text", text: opts.user });
    } else {
      for (const part of opts.user) {
        if (part.type === "text") {
          // L'API rejette un bloc texte vide : on l'omet plutôt que d'envoyer
          // une requête vouée au 400.
          if (part.text.trim()) content.push({ type: "text", text: part.text });
          continue;
        }
        // data URL « data:image/png;base64,… » → bloc image Anthropic ;
        // un format non reconnu est ignoré (jamais un bloc vide).
        const match = /^data:(image\/(?:png|jpeg|webp));base64,(.+)$/.exec(
          part.image_url.url
        );
        if (!match) continue;
        content.push({
          type: "image",
          source: {
            type: "base64",
            media_type: match[1] as "image/png" | "image/jpeg" | "image/webp",
            data: match[2],
          },
        });
      }
    }
    if (content.length === 0) {
      return { ok: false, cause: CAUSE_REPONSE_VIDE, detail: "requête sans contenu" };
    }

    // Pas de temperature : le paramètre est retiré des modèles Claude
    // récents (erreur 400). Le déterminisme vient du prompt et de la
    // validation stricte côté code.
    const response = await client.messages.create({
      model: config.model,
      max_tokens: opts.maxTokens ?? 800,
      system: opts.system,
      messages: [{ role: "user", content }],
    });

    // Les classificateurs de sûreté peuvent décliner (stop_reason refusal) :
    // on retombe alors sur la saisie manuelle, comme pour toute panne.
    if (response.stop_reason === "refusal") {
      return { ok: false, cause: CAUSE_REFUS_MODELE, detail: null };
    }

    const text = response.content
      .filter((b): b is Anthropic.TextBlock => b.type === "text")
      .map((b) => b.text)
      .join("");
    return text
      ? { ok: true, text }
      : { ok: false, cause: CAUSE_REPONSE_VIDE, detail: `modèle ${config.model}` };
  } catch (err) {
    return erreurTransport(err);
  }
}

// ---------------------------------------------------------------------------
// Fournisseurs au format OpenAI (MiniMax…) — API chat completions.
// ---------------------------------------------------------------------------

async function openAICompatChat(
  config: Extract<ProviderConfig, { kind: "openai_compat" }>,
  opts: { system: string; user: UserContent; maxTokens?: number }
): Promise<Reponse> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);

  try {
    const res = await fetch(`${config.baseUrl}/chat/completions`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${config.apiKey}`,
      },
      body: JSON.stringify({
        model: config.model,
        temperature: 0,
        max_tokens: opts.maxTokens ?? 800,
        messages: [
          { role: "system", content: opts.system },
          { role: "user", content: opts.user },
        ],
      }),
      signal: controller.signal,
      cache: "no-store",
    });

    // Le corps est lu en texte d'abord : sur une erreur, c'est LUI qui dit
    // quoi (« model not found », « invalid api key »), et un corps d'erreur
    // n'est pas toujours du JSON.
    const brut = await res.text();

    if (!res.ok) {
      return { ok: false, cause: `http_${res.status}`, detail: tronque(brut) };
    }

    let data: {
      choices?: { message?: { content?: string } }[];
      base_resp?: { status_code?: unknown; status_msg?: unknown };
    };
    try {
      data = JSON.parse(brut);
    } catch {
      return { ok: false, cause: CAUSE_JSON_INVALIDE, detail: tronque(brut) };
    }

    // MiniMax répond HTTP 200 MÊME EN CAS D'ÉCHEC : l'erreur est dans le
    // corps. Sans ce test, `if (!res.ok)` ne se déclenche jamais et le code
    // va chercher un `choices[0].message.content` absent — une clé morte et
    // un compte à zéro deviennent indiscernables d'une panne réseau. On lit
    // donc base_resp AVANT choices.
    const br = data?.base_resp;
    if (br && typeof br.status_code === "number" && br.status_code !== 0) {
      return {
        ok: false,
        cause: `base_resp_${br.status_code}`,
        detail: tronque(br.status_msg ?? ""),
      };
    }

    const content = data.choices?.[0]?.message?.content;
    return typeof content === "string" && content.trim()
      ? { ok: true, text: content }
      : { ok: false, cause: CAUSE_REPONSE_VIDE, detail: tronque(brut) };
  } catch (err) {
    return erreurTransport(err);
  } finally {
    clearTimeout(timer);
  }
}

/** Une panne de transport : délai dépassé, DNS, TLS, connexion refusée. */
function erreurTransport(err: unknown): Reponse {
  const nom = err instanceof Error ? err.name : "";
  const message = err instanceof Error ? err.message : String(err);

  // Le SDK Anthropic porte le code HTTP sur son erreur : on le garde, c'est
  // lui qui distingue une clé refusée (401) d'un modèle inconnu (404).
  const status = (err as { status?: unknown })?.status;
  if (typeof status === "number" && status > 0) {
    return { ok: false, cause: `http_${status}`, detail: tronque(message) };
  }

  if (nom === "AbortError" || nom === "TimeoutError" || /timeout/i.test(message)) {
    return { ok: false, cause: CAUSE_TIMEOUT, detail: null };
  }
  return { ok: false, cause: CAUSE_RESEAU, detail: tronque(message) };
}

/** Extrait le premier objet JSON d'une réponse de modèle (code fences, prose…). */
function parseLooseJSON(raw: string): Record<string, unknown> | null {
  const cleaned = raw.replace(/```(?:json)?/gi, "").trim();
  const start = cleaned.indexOf("{");
  const end = cleaned.lastIndexOf("}");
  if (start === -1 || end <= start) return null;
  try {
    const parsed = JSON.parse(cleaned.slice(start, end + 1));
    return typeof parsed === "object" && parsed !== null && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : null;
  } catch {
    return null;
  }
}
