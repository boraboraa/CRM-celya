/**
 * Tri d'une réponse email entrante — même contrat que la classification faite
 * par l'edge function crm-mail à la relève : ce module sert de repli manuel
 * (bouton « Analyser ») quand les secrets IA ne sont pas posés côté edge,
 * en réutilisant le fournisseur configuré sur Vercel (lib/ai/provider).
 */
import { chatJSON, aiAvailable } from "./provider";
import type { EmailIntent } from "@/lib/types";

const INTENTS: EmailIntent[] = [
  "interesse",
  "demande_info",
  "pas_interesse",
  "rappel_plus_tard",
  "absence",
  "hors_sujet",
];

export type ReplyProposal = {
  intent: EmailIntent;
  /** « YYYY-MM-DD » — pour une absence, le lendemain du retour. */
  date: string | null;
  summary: string | null;
  confidence: number | null;
};

export function triageAvailable(): boolean {
  return aiAvailable();
}

export async function classifyReply(input: {
  subject: string;
  text: string;
  today: string; // YYYY-MM-DD, heure de Bruxelles
}): Promise<ReplyProposal | null> {
  const system = `Tu tries la réponse email d'un prospect belge à un email de prospection. Nous sommes le ${input.today}.
Réponds UNIQUEMENT avec un objet JSON :
{
  "intent": une valeur parmi ${JSON.stringify(INTENTS)},
  "date_rappel": date d'action déduite au format "YYYY-MM-DD", sinon null — pour une absence ("je suis en congé jusqu'au 20"), le LENDEMAIN du retour,
  "action": la prochaine action proposée, en une courte phrase française,
  "resume": résumé de la réponse en une phrase,
  "confidence": nombre entre 0 et 1
}`;

  const raw = await chatJSON({
    system,
    user: `Sujet : ${input.subject}\n\n${input.text.slice(0, 4000)}`,
    maxTokens: 300,
  });
  if (!raw) return null;

  const intent = INTENTS.includes(raw.intent as EmailIntent)
    ? (raw.intent as EmailIntent)
    : null;
  if (!intent) return null;

  const date =
    typeof raw.date_rappel === "string" && /^\d{4}-\d{2}-\d{2}$/.test(raw.date_rappel)
      ? raw.date_rappel
      : null;
  const confidence =
    typeof raw.confidence === "number" && raw.confidence >= 0 && raw.confidence <= 1
      ? raw.confidence
      : null;
  const summary =
    [raw.resume, raw.action]
      .filter((s): s is string => typeof s === "string" && s.length > 0)
      .join(" — ")
      .slice(0, 400) || null;

  return { intent, date, summary, confidence };
}
