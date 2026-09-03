import Link from "next/link";
import type { ConfidenceLevel, ProspectStatus } from "@/lib/types";
import {
  STATUS_CHIP,
  STATUS_LABEL,
  STATUS_ICON,
  CONFIDENCE_CHIP,
  CONFIDENCE_LABEL,
  CONFIDENCE_ICON,
  CONFIDENCE_PENDING_CHIP,
  CONFIDENCE_PENDING_LABEL,
  CONFIDENCE_PENDING_ICON,
  OUTCOME_ICON,
  OUTCOME_LABEL,
  OUTCOME_TEXT,
  isCallOutcome,
  initials,
  relative,
} from "@/lib/constants";
import {
  LAST_ACTION_ICON,
  LAST_ACTION_LABEL,
  type LastActionKind,
} from "@/lib/crm/lastAction";

export function StatusChip({ status }: { status: ProspectStatus }) {
  return (
    <span className={`chip ${STATUS_CHIP[status]}`}>
      <span aria-hidden className="text-[10px] leading-none">
        {STATUS_ICON[status]}
      </span>
      {STATUS_LABEL[status]}
    </span>
  );
}

/**
 * Confiance estimée par l'IA : Chaud (orange/rouge) / Tiède (ambre) /
 * Froid (bleu-ardoise), toujours avec libellé + pictogramme — la couleur ne
 * porte jamais seule. Sans estimation (IA indisponible, pas assez
 * d'éléments), le badge dit honnêtement « À évaluer ».
 */
export function ConfidenceBadge({
  level,
  reason,
  locked = false,
}: {
  level: ConfidenceLevel | null;
  /** La raison courte, montrée en infobulle (les pages l'affichent en clair). */
  reason?: string | null;
  /** Niveau fixé à la main par Bora. */
  locked?: boolean;
}) {
  const chip = level ? CONFIDENCE_CHIP[level] : CONFIDENCE_PENDING_CHIP;
  const label = level ? CONFIDENCE_LABEL[level] : CONFIDENCE_PENDING_LABEL;
  const icon = level ? CONFIDENCE_ICON[level] : CONFIDENCE_PENDING_ICON;
  const title = locked
    ? `Confiance fixée par vous : ${label}`
    : reason
      ? `${label} — ${reason}`
      : level
        ? `Confiance estimée : ${label}`
        : "Pas encore d'estimation — l'assistant évalue après chaque échange.";
  return (
    <span className={`chip ${chip}`} title={title}>
      <span aria-hidden className="text-[10px] leading-none">
        {icon}
      </span>
      {label}
      {locked && <span aria-hidden>🔒</span>}
    </span>
  );
}

/** Ce qui s'est dit, ramené à ce qui tient sur une ligne. */
const TEXTE_MAX = 70;

/**
 * La DERNIÈRE ACTION d'une fiche : résultat + ce qui s'est dit + date relative
 *
 *   ✕ Pas intéressé — « bosse déjà avec un concurrent »   ·  il y a 2 j
 *   📵 Pas de réponse (3e fois)                           ·  hier
 *   👍 Intéressé — « rappeler après les congés »          ·  il y a 5 j
 *
 * Même ligne sur la liste, les cartes du pipeline et le tableau de bord,
 * dérivée du dernier événement réel du journal (vue prospect_action_state).
 * Le RÉSULTAT prime sur le canal quand il existe : « Pas intéressé » en dit
 * infiniment plus que « note ».
 *
 * « (3e fois) » compte les appels sans réponse D'AFFILÉE depuis le dernier
 * échange réel — c'est l'information qui dit « arrête d'appeler celui-là ».
 */
export function LastActionLine({
  kind,
  at,
  outcome,
  text,
  streak,
}: {
  kind: LastActionKind | null | undefined;
  at: string | null | undefined;
  /** Le résultat d'appel de la dernière entrée, s'il y en a un. */
  outcome?: string | null;
  /** Le sujet, à défaut le début du corps — jamais réécrit. */
  text?: string | null;
  /** Appels sans réponse consécutifs (vue prospect_action_state). */
  streak?: number | null;
}) {
  if (!kind || !at) {
    return <span className="text-xs text-slate-600">Aucune action</span>;
  }

  const resultat = isCallOutcome(outcome) ? outcome : null;
  const libelle = resultat ? OUTCOME_LABEL[resultat] : LAST_ACTION_LABEL[kind];
  const icone = resultat ? OUTCOME_ICON[resultat] : LAST_ACTION_ICON[kind];
  const ton = resultat ? OUTCOME_TEXT[resultat] : "text-slate-300";

  const propre = text?.replace(/\s+/g, " ").trim() || null;
  const court =
    propre && propre.length > TEXTE_MAX
      ? `${propre.slice(0, TEXTE_MAX)}…`
      : propre;

  // « (3e fois) » dès la deuxième tentative : c'est là que l'insistance
  // commence à se voir, et le compteur reste muet sur un appel isolé.
  const repetitions =
    resultat === "sans_reponse" && (streak ?? 0) >= 2 ? streak! : null;

  return (
    <span
      className={`inline-flex max-w-full items-center gap-1.5 text-xs ${ton}`}
      title={[
        libelle,
        repetitions ? `(${repetitions}e fois)` : null,
        propre ? `— « ${propre} »` : null,
        `— ${relative(at)}`,
      ]
        .filter(Boolean)
        .join(" ")}
    >
      <span aria-hidden className="text-[13px] leading-none">
        {icone}
      </span>
      <span className="truncate">
        {libelle}
        {repetitions && (
          <span className="font-medium"> ({repetitions}e fois)</span>
        )}
        {court && <span className="text-slate-400"> — « {court} »</span>}
        <span className="text-slate-500"> · {relative(at)}</span>
      </span>
    </span>
  );
}

/**
 * « Pourquoi ? » — le lien qui mène au diagnostic de l'assistant, affiché à
 * côté d'un « Assistant indisponible ». ADMIN SEULEMENT : c'est lui qui peut
 * corriger une variable sur l'hébergeur ; pour un commercial, le message
 * actuel suffit et la configuration de l'hébergeur ne le regarde pas.
 */
export function LienPourquoiIA({ isAdmin = false }: { isAdmin?: boolean }) {
  if (!isAdmin) return null;
  return (
    <Link
      href="/compte#assistant-ia"
      prefetch={false}
      className="text-[11px] font-medium text-celya-cyan underline-offset-2 hover:underline"
    >
      Pourquoi&nbsp;?
    </Link>
  );
}

export function Avatar({
  name,
  size = "sm",
}: {
  name?: string | null;
  size?: "sm" | "md";
}) {
  const dim = size === "md" ? "h-9 w-9 text-xs" : "h-7 w-7 text-[10px]";
  return (
    <span
      title={name ?? "Non assigné"}
      className={`${dim} grid place-items-center rounded-full bg-white/[0.07] font-semibold text-slate-300 ring-1 ring-white/10`}
    >
      {initials(name, "—")}
    </span>
  );
}

export function PageHeader({
  title,
  subtitle,
  action,
}: {
  title: string;
  subtitle?: string;
  action?: React.ReactNode;
}) {
  return (
    <div className="mb-7 flex flex-wrap items-end justify-between gap-4">
      <div>
        <h1 className="font-display text-2xl font-semibold tracking-tight text-slate-50">
          {title}
        </h1>
        {subtitle && <p className="mt-1 text-sm text-slate-400">{subtitle}</p>}
      </div>
      {action}
    </div>
  );
}

export function EmptyState({
  title,
  hint,
  href,
  cta,
  action,
  compact = false,
}: {
  title: string;
  hint?: string;
  href?: string;
  cta?: string;
  /** Un geste sur place (bouton client) plutôt qu'un lien. */
  action?: React.ReactNode;
  /** Version resserrée, quand l'espace vide n'a pas à être spectaculaire. */
  compact?: boolean;
}) {
  return (
    <div
      className={`card grid place-items-center px-6 text-center ${
        compact ? "py-8" : "py-14"
      }`}
    >
      <p className="font-display text-base font-medium text-slate-300">{title}</p>
      {hint && <p className="mt-1.5 max-w-md text-sm text-slate-500">{hint}</p>}
      {href && cta && (
        <Link href={href} className="btn-primary mt-5">
          {cta}
        </Link>
      )}
      {action && <div className="mt-5">{action}</div>}
    </div>
  );
}

export function Stat({
  label,
  value,
  tone = "default",
  hint,
}: {
  label: string;
  value: string | number;
  tone?: "default" | "warn" | "good";
  hint?: string;
}) {
  const toneClass =
    tone === "warn"
      ? "text-amber-300"
      : tone === "good"
        ? "text-emerald-300"
        : "text-slate-50";
  return (
    <div className="card px-5 py-4">
      <p className="text-[11px] font-medium uppercase tracking-wider text-slate-400">
        {label}
      </p>
      <p className={`mt-1.5 font-display text-2xl font-semibold ${toneClass}`}>
        {value}
      </p>
      {hint && <p className="mt-0.5 text-xs text-slate-500">{hint}</p>}
    </div>
  );
}

export function FormError({ message }: { message?: string }) {
  if (!message) return null;
  return (
    <p className="rounded-xl bg-rose-500/10 px-3.5 py-2.5 text-sm text-rose-300 ring-1 ring-rose-400/20">
      {message}
    </p>
  );
}
