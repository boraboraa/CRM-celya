import Link from "next/link";
import type { ProspectStatus } from "@/lib/types";
import {
  STATUS_CHIP,
  STATUS_LABEL,
  STATUS_ICON,
  initials,
  probabilityHeat,
} from "@/lib/constants";

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
 * Jauge « chaleur » de la probabilité de conclure : froid (bleu) sous 40 %,
 * ambre autour de 50 %, orange puis rouge au-delà. Le pourcentage reste écrit
 * à côté — la couleur ne porte jamais l'information seule.
 */
export function ProbabilityGauge({
  probability,
  size = "md",
}: {
  probability?: number | null;
  size?: "sm" | "md";
}) {
  if (probability === null || probability === undefined) return null;
  const heat = probabilityHeat(probability);
  const track = size === "sm" ? "h-1 w-10" : "h-1.5 w-16";
  return (
    <span
      className="inline-flex items-center gap-1.5 align-middle"
      title={`Probabilité de conclure : ${probability} %`}
    >
      <span className={`${track} overflow-hidden rounded-full bg-white/[0.09]`}>
        <span
          className={`block h-full rounded-full ${heat.bar} transition-all duration-300`}
          style={{ width: `${Math.min(100, Math.max(4, probability))}%` }}
        />
      </span>
      <span className={`text-[11px] font-medium tabular-nums ${heat.text}`}>
        {probability} %
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
}: {
  title: string;
  hint?: string;
  href?: string;
  cta?: string;
}) {
  return (
    <div className="card grid place-items-center px-6 py-14 text-center">
      <p className="font-display text-base font-medium text-slate-300">{title}</p>
      {hint && <p className="mt-1.5 max-w-md text-sm text-slate-500">{hint}</p>}
      {href && cta && (
        <Link href={href} className="btn-primary mt-5">
          {cta}
        </Link>
      )}
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
