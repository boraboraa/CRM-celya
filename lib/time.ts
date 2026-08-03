const TZ = "Europe/Brussels";

/** Décalage (en minutes) de Bruxelles par rapport à UTC à l'instant donné. */
function tzOffsetMinutes(date: Date): number {
  const dtf = new Intl.DateTimeFormat("en-US", {
    timeZone: TZ,
    hour12: false,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
  const parts = Object.fromEntries(
    dtf.formatToParts(date).map((p) => [p.type, p.value])
  ) as Record<string, string>;
  const asUTC = Date.UTC(
    Number(parts.year),
    Number(parts.month) - 1,
    Number(parts.day),
    Number(parts.hour === "24" ? "0" : parts.hour),
    Number(parts.minute),
    Number(parts.second)
  );
  return (asUTC - date.getTime()) / 60000;
}

/**
 * Convertit la valeur d'un <input type="datetime-local"> (« 2026-08-05T10:00 »),
 * saisie en heure de Bruxelles, vers un ISO UTC exploitable par Postgres.
 */
export function localInputToISO(value?: string | null): string | null {
  if (!value) return null;
  const naive = new Date(`${value.length === 16 ? value : value.slice(0, 16)}:00Z`);
  if (Number.isNaN(naive.getTime())) return null;
  const offset = tzOffsetMinutes(naive);
  return new Date(naive.getTime() - offset * 60000).toISOString();
}

/** ISO UTC → valeur pour <input type="datetime-local"> en heure de Bruxelles. */
export function isoToLocalInput(iso?: string | null): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat("en-CA", {
      timeZone: TZ,
      hour12: false,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
    })
      .formatToParts(d)
      .map((p) => [p.type, p.value])
  ) as Record<string, string>;
  const hour = parts.hour === "24" ? "00" : parts.hour;
  return `${parts.year}-${parts.month}-${parts.day}T${hour}:${parts.minute}`;
}

/** Dans N jours, à 09:00 heure de Bruxelles. */
export function inDaysAt9(days: number): string {
  const now = new Date();
  const target = new Date(now.getTime() + days * 86400000);
  const localDate = isoToLocalInput(target.toISOString()).slice(0, 10);
  return localInputToISO(`${localDate}T09:00`) ?? target.toISOString();
}

/**
 * Convertit une saisie de date locale — « YYYY-MM-DD » (échéance à 09:00) ou
 * « YYYY-MM-DDTHH:mm » (heure précise, ex. rendez-vous) — vers un ISO UTC.
 */
export function dateInputToISO(value?: string | null): string | null {
  if (!value) return null;
  const v = value.trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(v)) return localInputToISO(`${v}T09:00`);
  if (/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/.test(v)) return localInputToISO(v.slice(0, 16));
  return null;
}

/** Bornes du jour courant (heure de Bruxelles) exprimées en ISO UTC. */
export function todayBounds(): { start: string; end: string } {
  const today = isoToLocalInput(new Date().toISOString()).slice(0, 10);
  return {
    start: localInputToISO(`${today}T00:00`)!,
    end: localInputToISO(`${today}T23:59`)!,
  };
}
