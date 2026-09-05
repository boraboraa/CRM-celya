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

// ---------------------------------------------------------------------------
// Pictogrammes — un seul jeu, dessiné ici
// ---------------------------------------------------------------------------

/**
 * Les emojis rendaient un dessin différent par système (et deux tailles
 * différentes sur la même ligne). Ici : des tracés à la main sur une grille de
 * 16, en `currentColor`, qui prennent la couleur et la taille du texte autour.
 *
 * Aucune librairie : ajouter une icône, c'est ajouter un nom au type et un
 * tracé au Record ci-dessous.
 */
export type IconeNom =
  | "telephone"
  | "telephone-barre"
  | "barriere"
  | "retour"
  | "pouce"
  | "croix"
  | "coche"
  | "note"
  | "calendrier"
  | "enveloppe"
  | "reponse"
  | "epingle"
  | "itineraire"
  | "cadenas"
  | "etincelle"
  | "flamme"
  | "demi"
  | "flocon"
  | "attente"
  | "plus"
  | "alerte"
  | "chevron"
  | "personne"
  | "report"
  | "taches"
  | "agenda"
  | "dossier"
  | "equipe"
  | "reglages";

/** Le combiné, réutilisé par « téléphone barré ». */
const COMBINE = (
  <path d="M4.1 2.5h2.3l1.1 2.8-1.4 1a8.4 8.4 0 0 0 3.6 3.6l1-1.4 2.8 1.1v2.3a1 1 0 0 1-1.1 1A11.2 11.2 0 0 1 3.1 3.6a1 1 0 0 1 1-1.1Z" />
);

const TRACES: Record<IconeNom, React.ReactNode> = {
  telephone: COMBINE,
  "telephone-barre": (
    <>
      {COMBINE}
      <path d="M2.4 13.6 13.6 2.4" />
    </>
  ),
  barriere: (
    <>
      <path d="M1.6 6.2h12.8v3.4H1.6z" />
      <path d="M5.4 6.2 3.2 9.6M9.4 6.2 7.2 9.6M13.4 6.2l-2.2 3.4" />
      <path d="M3.2 9.6v4.2M12.8 9.6v4.2" />
    </>
  ),
  retour: (
    <>
      <path d="M13 3.6v3.2a3.2 3.2 0 0 1-3.2 3.2H3.4" />
      <path d="M6.4 7 3.2 10l3.2 3" />
    </>
  ),
  pouce: (
    <>
      <path d="M5.6 13.8V7.1l3.1-4.6a1.4 1.4 0 0 1 2.4 1.4L10 7h3.1a1.4 1.4 0 0 1 1.4 1.8l-1.1 3.9a1.7 1.7 0 0 1-1.6 1.1H5.6Z" />
      <path d="M1.7 7.1h3.9v6.7H1.7z" />
    </>
  ),
  croix: <path d="M3.6 3.6 12.4 12.4M12.4 3.6 3.6 12.4" />,
  coche: <path d="M3 8.4 6.4 11.9 13 4.4" />,
  note: (
    <>
      <path d="M11.2 2.4 13.6 4.8 5.5 12.9l-3.1.7.7-3.1z" />
      <path d="M9.9 3.7 12.3 6.1" />
    </>
  ),
  calendrier: (
    <>
      <path d="M2.4 4h11.2v9.6H2.4z" />
      <path d="M2.4 7h11.2M5.4 2.4v3M10.6 2.4v3" />
    </>
  ),
  enveloppe: (
    <>
      <path d="M1.8 3.8h12.4v8.4H1.8z" />
      <path d="m1.8 4.4 6.2 4.5 6.2-4.5" />
    </>
  ),
  reponse: (
    <>
      <path d="M2 9.4v4.2h12V9.4" />
      <path d="M2 9.4 4.6 5.6h6.8L14 9.4" />
      <path d="M8 1.2v4.2M6.2 3.6 8 5.4l1.8-1.8" />
    </>
  ),
  epingle: (
    <>
      <path d="M8 14.4S13 9.8 13 6.6a5 5 0 0 0-10 0c0 3.2 5 7.8 5 7.8Z" />
      <path d="M8 4.8a1.8 1.8 0 1 1 0 3.6 1.8 1.8 0 0 1 0-3.6Z" />
    </>
  ),
  itineraire: (
    <>
      <path d="M2.2 8h11" />
      <path d="M9.6 4.4 13.2 8l-3.6 3.6" />
    </>
  ),
  cadenas: (
    <>
      <path d="M3.4 6.9h9.2v6.7H3.4z" />
      <path d="M5.6 6.9V4.8a2.4 2.4 0 0 1 4.8 0v2.1" />
    </>
  ),
  etincelle: (
    <path d="M8 1.4 9.4 6l4.6 1.4L9.4 8.8 8 13.4 6.6 8.8 2 7.4 6.6 6z" />
  ),
  flamme: (
    <path d="M8 1.8c3 3.2 4.4 4.8 4.4 7.4a4.4 4.4 0 1 1-8.8 0c0-1.5.5-2.7 1.6-3.8.2 1.2.8 1.9 1.7 2.1.5-1.9.7-3.8 1.1-5.7Z" />
  ),
  demi: (
    <>
      <path d="M8 1.8a6.2 6.2 0 1 1 0 12.4 6.2 6.2 0 0 1 0-12.4Z" />
      <path d="M8 1.8a6.2 6.2 0 0 1 0 12.4Z" fill="currentColor" stroke="none" />
    </>
  ),
  flocon: (
    <>
      <path d="M8 1.6v12.8M2.5 4.8l11 6.4M2.5 11.2l11-6.4" />
      <path d="M6.2 3.4 8 5.2l1.8-1.8M6.2 12.6 8 10.8l1.8 1.8" />
    </>
  ),
  attente: (
    <>
      <circle cx="3.4" cy="8" r="1.1" fill="currentColor" stroke="none" />
      <circle cx="8" cy="8" r="1.1" fill="currentColor" stroke="none" />
      <circle cx="12.6" cy="8" r="1.1" fill="currentColor" stroke="none" />
    </>
  ),
  plus: <path d="M8 2.8v10.4M2.8 8h10.4" />,
  alerte: (
    <>
      <path d="M8 2.2 14.5 13.4h-13z" />
      <path d="M8 6.2v3.3M8 11.6v.01" />
    </>
  ),
  chevron: <path d="M4.2 6.2 8 10l3.8-3.8" />,
  personne: (
    <>
      <path d="M8 2.4a2.7 2.7 0 1 1 0 5.4 2.7 2.7 0 0 1 0-5.4Z" />
      <path d="M2.8 13.8c.6-2.6 2.6-3.9 5.2-3.9s4.6 1.3 5.2 3.9" />
    </>
  ),
  report: (
    <>
      <path d="M14 8a6 6 0 1 1-2.3-4.7" />
      <path d="M14.2 1.4v3.6h-3.6" />
    </>
  ),
  taches: (
    <>
      <path d="M2.2 4.3 3.5 5.6 5.8 3.3M2.2 11.3l1.3 1.3 2.3-2.3" />
      <path d="M8 4.6h6M8 11.6h6" />
    </>
  ),
  agenda: (
    <>
      <path d="M2.4 2.4h11.2v11.2H2.4z" />
      <path d="M2.4 8h11.2M8 2.4v11.2" />
    </>
  ),
  dossier: <path d="M1.9 3.9h4.3l1.4 1.8h6.5v6.6H1.9z" />,
  equipe: (
    <>
      <path d="M6 2.7a2.4 2.4 0 1 1 0 4.8 2.4 2.4 0 0 1 0-4.8Z" />
      <path d="M1.5 13.6c.5-2.3 2.3-3.5 4.5-3.5s4 1.2 4.5 3.5" />
      <path d="M11 3.1a2.2 2.2 0 0 1 0 4.4" />
      <path d="M11.8 10.3c1.4.4 2.3 1.5 2.7 3.3" />
    </>
  ),
  reglages: (
    <>
      <path d="M8 5.6a2.4 2.4 0 1 1 0 4.8 2.4 2.4 0 0 1 0-4.8Z" />
      <path d="M8 1.4v2M8 12.6v2M1.4 8h2M12.6 8h2" />
      <path d="M3.3 3.3 4.7 4.7M11.3 11.3l1.4 1.4M12.7 3.3 11.3 4.7M3.3 12.7l1.4-1.4" />
    </>
  ),
};

/**
 * Le pictogramme d'un nom. Décoratif : le libellé à côté porte le sens,
 * l'icône est `aria-hidden`.
 */
export function Icone({
  nom,
  className = "h-3.5 w-3.5",
}: {
  nom: IconeNom;
  className?: string;
}) {
  return (
    <svg
      aria-hidden
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.6}
      strokeLinecap="round"
      strokeLinejoin="round"
      className={`shrink-0 ${className}`}
    >
      {TRACES[nom]}
    </svg>
  );
}

// ---------------------------------------------------------------------------

export function StatusChip({ status }: { status: ProspectStatus }) {
  return (
    <span className={`chip ${STATUS_CHIP[status]}`}>
      <Icone nom={STATUS_ICON[status]} className="h-3 w-3" />
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
      <Icone nom={icon} className="h-3 w-3" />
      {label}
      {locked && <Icone nom="cadenas" className="h-3 w-3" />}
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
      <Icone nom={icone} />
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
