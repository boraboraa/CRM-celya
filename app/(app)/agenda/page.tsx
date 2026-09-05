import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { getSession } from "@/lib/auth";
import { PageHeader, Icone } from "@/components/ui";
import { PerimetreSwitcher } from "@/components/PerimetreSwitcher";
import {
  AgendaGrid,
  type AgendaMeeting,
  type AgendaProspect,
} from "@/components/AgendaGrid";
import {
  lirePerimetre,
  filtrerProspects,
  type PerimetreViewer,
} from "@/lib/crm/perimetre";
import { localInputToISO, isoToLocalInput } from "@/lib/time";
import { initials } from "@/lib/constants";

type Search = {
  vue?: string;
  semaine?: string;
  jour?: string;
  perimetre?: string;
};

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

/** « YYYY-MM-DD » décalé de N jours — calculé à midi UTC pour ignorer les
 *  changements d'heure. */
function decale(date: string, jours: number): string {
  const d = new Date(`${date}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + jours);
  return d.toISOString().slice(0, 10);
}

/** Le lundi de la semaine contenant la date. */
function lundiDe(date: string): string {
  const d = new Date(`${date}T12:00:00Z`);
  return decale(date, -((d.getUTCDay() + 6) % 7));
}

/**
 * L'agenda — vue SEMAINE (lundi → samedi, 7h–21h) par défaut, bascule Jour.
 *
 * Toute la lecture passe par la vue `meetings_visibles` : un rendez-vous
 * personnel d'un autre membre n'expose que son créneau (« Occupé »). Le
 * périmètre de l'étape 1 s'applique — « moi » par défaut, l'admin peut
 * superposer l'équipe (seconde couleur, initiale du propriétaire).
 */
export default async function AgendaPage({
  searchParams,
}: {
  searchParams: Promise<Search>;
}) {
  const params = await searchParams;
  const supabase = await createClient();
  const session = await getSession();

  const viewer: PerimetreViewer = {
    userId: session?.userId ?? "",
    isAdmin: session?.me?.role === "admin",
  };
  const perimetre = lirePerimetre(params, viewer);

  const aujourdHui = isoToLocalInput(new Date().toISOString()).slice(0, 10);
  const vueJour = params.vue === "jour";
  const jour = params.jour && DATE_RE.test(params.jour) ? params.jour : aujourdHui;
  const semaineRef =
    params.semaine && DATE_RE.test(params.semaine) ? params.semaine : aujourdHui;
  const lundi = lundiDe(vueJour ? jour : semaineRef);

  // Lundi → samedi à l'écran ; la moisson couvre le dimanche aussi, pour que
  // la bascule Jour puisse afficher n'importe quel jour de la semaine.
  const jours = vueJour
    ? [jour]
    : Array.from({ length: 6 }, (_, i) => decale(lundi, i));
  const rangeStart = localInputToISO(`${jours[0]}T00:00`)!;
  const rangeEnd = localInputToISO(`${jours[jours.length - 1]}T23:59`)!;

  const [meetingsRes, prospectsRes, membresRes] = await Promise.all([
    filtrerProspects(
      supabase
        .from("meetings_visibles")
        .select(
          "id, owner_id, prospect_id, kind, title, starts_at, ends_at, location, notes, status, debriefed_at"
        )
        .gte("starts_at", rangeStart)
        .lte("starts_at", rangeEnd),
      perimetre,
      viewer
    )
      .order("starts_at", { ascending: true })
      .limit(300),
    // Les fiches proposées à la création (autocomplétion) — RLS appliquée.
    supabase
      .from("prospects")
      .select("id, company_name, contact_name, phone, city")
      .not("status", "in", "(gagne,perdu)")
      .order("company_name")
      .limit(500),
    supabase
      .from("crm_users")
      .select("id, full_name, email")
      .eq("is_active", true)
      .order("full_name"),
  ]);

  type Row = {
    id: string;
    owner_id: string;
    prospect_id: string | null;
    kind: string;
    title: string;
    starts_at: string;
    ends_at: string;
    location: string | null;
    notes: string | null;
    status: string;
  };
  const rows = (meetingsRes.data ?? []) as unknown as Row[];
  const prospects = (prospectsRes.data ?? []) as unknown as AgendaProspect[];
  const membres = (membresRes.data ?? []) as {
    id: string;
    full_name: string | null;
    email: string;
  }[];
  const parProspect = new Map(prospects.map((p) => [p.id, p]));
  const parMembre = new Map(membres.map((m) => [m.id, m]));

  const meetings: AgendaMeeting[] = rows.map((m) => {
    const isMine = m.owner_id === viewer.userId;
    return {
      id: m.id,
      title: m.title,
      starts_at: m.starts_at,
      ends_at: m.ends_at,
      status: m.status,
      kind: m.kind,
      location: m.location,
      isMine,
      canEdit: isMine || viewer.isAdmin,
      ownerInitial: isMine
        ? null
        : initials(
            parMembre.get(m.owner_id)?.full_name ??
              parMembre.get(m.owner_id)?.email ??
              null,
            "?"
          ),
      prospect: m.prospect_id ? (parProspect.get(m.prospect_id) ?? null) : null,
    };
  });

  /** URL de l'agenda en conservant vue, jour/semaine et périmètre. */
  const href = (over: { vue?: "semaine" | "jour"; ref?: string }) => {
    const sp = new URLSearchParams();
    const v = over.vue ?? (vueJour ? "jour" : "semaine");
    if (v === "jour") {
      sp.set("vue", "jour");
      sp.set("jour", over.ref ?? jour);
    } else if ((over.ref ?? lundi) !== lundiDe(aujourdHui)) {
      sp.set("semaine", over.ref ?? lundi);
    }
    if (params.perimetre && params.perimetre !== "moi") {
      sp.set("perimetre", params.perimetre);
    }
    const qs = sp.toString();
    return `/agenda${qs ? `?${qs}` : ""}`;
  };

  const fmtSemaine = new Intl.DateTimeFormat("fr-BE", {
    day: "numeric",
    month: "short",
    timeZone: "Europe/Brussels",
  });
  const titrePeriode = vueJour
    ? new Intl.DateTimeFormat("fr-BE", {
        weekday: "long",
        day: "numeric",
        month: "long",
        timeZone: "Europe/Brussels",
      }).format(new Date(`${jour}T12:00:00Z`))
    : `Semaine du ${fmtSemaine.format(new Date(`${lundi}T12:00:00Z`))} au ${fmtSemaine.format(
        new Date(`${decale(lundi, 5)}T12:00:00Z`)
      )}`;

  return (
    <>
      <PageHeader
        title="Agenda"
        subtitle="Vos rendez-vous — prospects et personnels. Cliquez sur une plage vide pour en poser un."
      />

      <div className="mb-5 flex flex-wrap items-center gap-3">
        <PerimetreSwitcher
          role={session?.me?.role ?? "commercial"}
          viewerId={viewer.userId}
          perimetre={perimetre}
          membres={membres}
          basePath="/agenda"
          searchParams={params}
        />

        {/* Bascule Semaine / Jour — même groupe segmenté que Liste/Colonnes. */}
        <div className="flex rounded-xl bg-white/[0.03] p-1 ring-1 ring-white/10">
          {(
            [
              ["semaine", "Semaine"],
              ["jour", "Jour"],
            ] as const
          ).map(([v, label]) => (
            <Link
              key={v}
              href={href({ vue: v })}
              className={`rounded-lg px-3.5 py-1.5 text-xs font-medium transition ${
                (v === "jour") === vueJour
                  ? "bg-white/[0.09] text-slate-100 ring-1 ring-white/15"
                  : "text-slate-400 hover:text-slate-200"
              }`}
            >
              {label}
            </Link>
          ))}
        </div>

        <div className="flex items-center gap-1.5">
          <Link
            href={href({ ref: vueJour ? decale(jour, -1) : decale(lundi, -7) })}
            aria-label={vueJour ? "Jour précédent" : "Semaine précédente"}
            className="inline-flex rounded-lg px-2.5 py-1.5 text-xs text-slate-400 ring-1 ring-white/10 transition hover:bg-white/[0.06] hover:text-slate-200"
          >
            <Icone nom="chevron" className="h-4 w-4 rotate-90" />
          </Link>
          <span className="min-w-[180px] text-center text-sm font-medium text-slate-200">
            {titrePeriode.charAt(0).toUpperCase() + titrePeriode.slice(1)}
          </span>
          <Link
            href={href({ ref: vueJour ? decale(jour, 1) : decale(lundi, 7) })}
            aria-label={vueJour ? "Jour suivant" : "Semaine suivante"}
            className="inline-flex rounded-lg px-2.5 py-1.5 text-xs text-slate-400 ring-1 ring-white/10 transition hover:bg-white/[0.06] hover:text-slate-200"
          >
            <Icone nom="chevron" className="h-4 w-4 -rotate-90" />
          </Link>
          <Link
            href={href({ ref: vueJour ? aujourdHui : lundiDe(aujourdHui) })}
            className="rounded-lg px-2.5 py-1.5 text-xs text-slate-400 ring-1 ring-white/10 transition hover:bg-white/[0.06] hover:text-slate-200"
          >
            Aujourd&apos;hui
          </Link>
        </div>
      </div>

      <AgendaGrid
        jours={jours}
        aujourdHui={aujourdHui}
        meetings={meetings}
        prospects={prospects}
      />
    </>
  );
}
