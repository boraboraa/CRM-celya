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

/**
 * La DERNIÈRE ACTION d'une fiche : canal + résultat + date relative —
 * « 📧 Mail envoyé · il y a 2 j », « 📞 Appelé, pas de réponse · il y a 3 j ».
 * Même ligne sur la liste et sur les cartes du pipeline, dérivée du dernier
 * événement réel du journal (vue prospect_action_state), jamais du texte.
 */
export function LastActionLine({
  kind,
  at,
}: {
  kind: LastActionKind | null | undefined;
  at: string | null | undefined;
}) {
  if (!kind || !at) {
    return <span className="text-xs text-slate-600">Aucune action</span>;
  }
  return (
    <span
      className="inline-flex items-center gap-1.5 text-xs text-slate-300"
      title={`${LAST_ACTION_LABEL[kind]} — ${relative(at)}`}
    >
      <span aria-hidden className="text-[13px] leading-none">
        {LAST_ACTION_ICON[kind]}
      </span>
      <span className="truncate">
        {LAST_ACTION_LABEL[kind]}
        <span className="text-slate-500"> · {relative(at)}</span>
      </span>
    </span>
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
