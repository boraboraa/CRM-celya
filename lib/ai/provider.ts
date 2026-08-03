/**
 * Abstraction du fournisseur IA — même principe que l'app comptable :
 * le fournisseur actif vient de AGENT_PROVIDER, sa configuration des
 * variables <FOURNISSEUR>_API_KEY / _BASE_URL / _MODEL / _VISION_MODEL
 * (aujourd'hui MINIMAX_*, demain un fournisseur hébergé en Europe).
 * Le modèle se change par variable d'environnement, jamais par réécriture.
 *
 * Module strictement serveur : la clé d'API ne doit jamais atteindre le
 * navigateur. Toute panne ou réponse hors format renvoie null — l'appelant
 * doit toujours avoir un chemin manuel.
 */

const TIMEOUT_MS = 30000;

type TextPart = { type: "text"; text: string };
type ImagePart = { type: "image_url"; image_url: { url: string } };
export type UserContent = string | (TextPart | ImagePart)[];

function assertServer() {
  if (typeof window !== "undefined") {
    throw new Error("lib/ai/provider est un module serveur uniquement.");
  }
}

type ProviderConfig = {
  apiKey: string;
  baseUrl: string;
  model: string;
};

/** Lit la configuration du fournisseur actif. null si incomplète. */
function providerConfig(vision: boolean): ProviderConfig | null {
  const name = (process.env.AGENT_PROVIDER ?? "minimax").trim();
  const prefix = name.toUpperCase().replace(/[^A-Z0-9]/g, "_");

  const apiKey = process.env[`${prefix}_API_KEY`];
  const baseUrl = process.env[`${prefix}_BASE_URL`];
  const model = vision
    ? (process.env[`${prefix}_VISION_MODEL`] ?? process.env[`${prefix}_MODEL`])
    : process.env[`${prefix}_MODEL`];

  if (!apiKey || !baseUrl || !model) return null;
  return { apiKey, baseUrl: baseUrl.replace(/\/+$/, ""), model };
}

/** Le fournisseur est-il configuré dans cet environnement ? */
export function aiAvailable(vision = false): boolean {
  assertServer();
  return providerConfig(vision) !== null;
}

/**
 * Appelle le modèle (API chat completions, format OpenAI) et attend un objet
 * JSON en sortie. Renvoie null si le fournisseur est absent, en panne, ou si
 * la réponse n'est pas du JSON exploitable — jamais d'exception.
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
    if (typeof content !== "string") return null;

    return parseLooseJSON(content);
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
