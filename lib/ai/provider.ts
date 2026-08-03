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
 * doit toujours avoir un chemin manuel.
 */

import Anthropic from "@anthropic-ai/sdk";

const TIMEOUT_MS = 30000;

type TextPart = { type: "text"; text: string };
type ImagePart = { type: "image_url"; image_url: { url: string } };
export type UserContent = string | (TextPart | ImagePart)[];

function assertServer() {
  if (typeof window !== "undefined") {
    throw new Error("lib/ai/provider est un module serveur uniquement.");
  }
}

type ProviderConfig =
  | { kind: "anthropic"; apiKey: string; baseUrl: string | null; model: string }
  | { kind: "openai_compat"; apiKey: string; baseUrl: string; model: string };

/** Lit la configuration du fournisseur actif. null si incomplète. */
function providerConfig(vision: boolean): ProviderConfig | null {
  const name = (process.env.AGENT_PROVIDER ?? "minimax").trim();

  if (name.toLowerCase() === "anthropic") {
    const apiKey = process.env.ANTHROPIC_API_KEY;
    if (!apiKey) return null;
    const model = vision
      ? (process.env.ANTHROPIC_VISION_MODEL ??
        process.env.ANTHROPIC_MODEL ??
        "claude-opus-5")
      : (process.env.ANTHROPIC_MODEL ?? "claude-opus-5");
    return {
      kind: "anthropic",
      apiKey,
      baseUrl: process.env.ANTHROPIC_BASE_URL?.replace(/\/+$/, "") ?? null,
      model,
    };
  }

  const prefix = name.toUpperCase().replace(/[^A-Z0-9]/g, "_");
  const apiKey = process.env[`${prefix}_API_KEY`];
  const baseUrl = process.env[`${prefix}_BASE_URL`];
  const model = vision
    ? (process.env[`${prefix}_VISION_MODEL`] ?? process.env[`${prefix}_MODEL`])
    : process.env[`${prefix}_MODEL`];

  if (!apiKey || !baseUrl || !model) return null;
  return {
    kind: "openai_compat",
    apiKey,
    baseUrl: baseUrl.replace(/\/+$/, ""),
    model,
  };
}

/** Le fournisseur est-il configuré dans cet environnement ? */
export function aiAvailable(vision = false): boolean {
  assertServer();
  return providerConfig(vision) !== null;
}

/**
 * Appelle le modèle et attend un objet JSON en sortie. Renvoie null si le
 * fournisseur est absent, en panne, ou si la réponse n'est pas du JSON
 * exploitable — jamais d'exception.
 */
export async function chatJSON(opts: {
  system: string;
  user: UserContent;
  vision?: boolean;
  maxTokens?: number;
}): Promise<Record<string, unknown> | null> {
  assertServer();

  const config = providerConfig(opts.vision ?? false);
  if (!config) return null;

  const raw =
    config.kind === "anthropic"
      ? await anthropicChat(config, opts)
      : await openAICompatChat(config, opts);

  return raw === null ? null : parseLooseJSON(raw);
}

// ---------------------------------------------------------------------------
// Fournisseur Anthropic — API Messages, SDK officiel.
// ---------------------------------------------------------------------------

async function anthropicChat(
  config: Extract<ProviderConfig, { kind: "anthropic" }>,
  opts: { system: string; user: UserContent; maxTokens?: number }
): Promise<string | null> {
  try {
    const client = new Anthropic({
      apiKey: config.apiKey,
      ...(config.baseUrl ? { baseURL: config.baseUrl } : {}),
      timeout: TIMEOUT_MS,
      maxRetries: 1,
    });

    const content: Anthropic.ContentBlockParam[] =
      typeof opts.user === "string"
        ? [{ type: "text", text: opts.user }]
        : opts.user.map((part): Anthropic.ContentBlockParam => {
            if (part.type === "text") return { type: "text", text: part.text };
            // data URL « data:image/png;base64,… » → bloc image Anthropic
            const match = /^data:(image\/(?:png|jpeg|webp));base64,(.+)$/.exec(
              part.image_url.url
            );
            if (!match) return { type: "text", text: "" };
            return {
              type: "image",
              source: {
                type: "base64",
                media_type: match[1] as "image/png" | "image/jpeg" | "image/webp",
                data: match[2],
              },
            };
          });

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
    if (response.stop_reason === "refusal") return null;

    const text = response.content
      .filter((b): b is Anthropic.TextBlock => b.type === "text")
      .map((b) => b.text)
      .join("");
    return text || null;
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// Fournisseurs au format OpenAI (MiniMax…) — API chat completions.
// ---------------------------------------------------------------------------

async function openAICompatChat(
  config: Extract<ProviderConfig, { kind: "openai_compat" }>,
  opts: { system: string; user: UserContent; maxTokens?: number }
): Promise<string | null> {
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

    if (!res.ok) return null;

    const data = (await res.json()) as {
      choices?: { message?: { content?: string } }[];
    };
    const content = data.choices?.[0]?.message?.content;
    return typeof content === "string" ? content : null;
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
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
