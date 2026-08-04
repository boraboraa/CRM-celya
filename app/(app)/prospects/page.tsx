import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import {
  PageHeader,
  StatusChip,
  EmptyState,
  Avatar,
  ConfidenceBadge,
} from "@/components/ui";
import { PipelineBoard, type BoardProspect } from "@/components/PipelineBoard";
import {
  STATUS_ORDER,
  STATUS_LABEL,
  normalizeStatus,
  relative,
} from "@/lib/constants";
import type { ConfidenceLevel } from "@/lib/types";

export const dynamic = "force-dynamic";

type Search = { q?: string; statut?: string; tri?: string; vue?: string };

/**
 * Une seule liste de prospects, deux affichages : liste (tableau filtrable)
 * ou colonnes par étape (glisser-déposer). Même jeu de données, mêmes
 * filtres — la vue en colonnes n'est qu'un mode d'affichage.
 */
export default async function ProspectsPage({
  searchParams,
}: {
  searchParams: Promise<Search>;
}) {
  const { q, statut, tri, vue } = await searchParams;
  const supabase = await createClient();
  const view = vue === "colonnes" ? "colonnes" : "liste";

  let query = supabase
    .from("prospects")
    .select(
      "id, company_name, contact_name, email, phone, city, status, confidence_level, confidence_reason, confidence_locked, next_action_at, last_contact_at, owner_id, crm_users!prospects_owner_id_fkey(full_name)"
    );

  if (q) {
    const like = `%${q}%`;
    query = query.or(
      `company_name.ilike.${like},contact_name.ilike.${like},email.ilike.${like},city.ilike.${like}`
    );
  }
  // Filtre d'étape poussé en SQL (sinon il s'appliquerait après .limit()
  // et fausserait résultats et compteur au-delà de 500 fiches).
  const statutFilter =
    statut && statut !== "tous" && (STATUS_ORDER as string[]).includes(statut)
      ? (statut as (typeof STATUS_ORDER)[number])
      : null;
  if (statutFilter) {
    query = query.eq("status", statutFilter);
  }

  const sort = tri ?? "recent";
  if (sort === "relance") {
    query = query.order("next_action_at", { ascending: true, nullsFirst: false });
  } else if (sort === "nom") {
    query = query.order("company_name", { ascending: true });
  } else {
    query = query.order("updated_at", { ascending: false });
  }

  const { data, error } = await query.limit(500);
  let prospects = ((data ?? []) as unknown as {
    id: string;
    company_name: string;
    contact_name: string | null;
    email: string | null;
    phone: string | null;
    city: string | null;
    status: string;
    confidence_level: ConfidenceLevel | null;
    confidence_reason: string | null;
    confidence_locked: boolean | null;
    next_action_at: string | null;
    last_contact_at: string | null;
    crm_users: { full_name: string | null } | null;
  }[]).map((p) => ({ ...p, status: normalizeStatus(p.status) }));

  // Ceinture et bretelles : re-filtre après normalisation des statuts.
  if (statutFilter) {
    prospects = prospects.filter((p) => p.status === statutFilter);
  }

  const boardProspects: BoardProspect[] = prospects.map((p) => ({
    id: p.id,
    company_name: p.company_name,
    contact_name: p.contact_name,
    status: p.status,
    confidence_level: p.confidence_level,
    confidence_reason: p.confidence_reason,
    confidence_locked: Boolean(p.confidence_locked),
    next_action_at: p.next_action_at,
  }));

  /** URL d'une vue en conservant filtres et tri. */
  const viewHref = (v: "liste" | "colonnes") => {
    const params = new URLSearchParams();
    if (q) params.set("q", q);
    if (statut && statut !== "tous") params.set("statut", statut);
    if (tri) params.set("tri", tri);
    if (v === "colonnes") params.set("vue", "colonnes");
    const qs = params.toString();
    return `/prospects${qs ? `?${qs}` : ""}`;
  };

  return (
    <>
      <PageHeader
        title="Prospects"
        subtitle={`${prospects.length} fiche${prospects.length > 1 ? "s" : ""}`}
        action={
          <div className="flex gap-2">
            <Link href="/prospects/import" className="btn-ghost">
              Importer un CSV
            </Link>
            <Link href="/prospects/nouveau" className="btn-primary">
              + Nouveau prospect
            </Link>
          </div>
        }
      />

      <div className="mb-5 flex flex-wrap items-end gap-3">
        {/* Bascule liste ↔ colonnes — même jeu de données. */}
        <div className="flex rounded-xl bg-white/[0.03] p-1 ring-1 ring-white/10">
          {(
            [
              ["liste", "☰ Liste"],
              ["colonnes", "▤ Colonnes"],
            ] as const
          ).map(([v, label]) => (
            <Link
              key={v}
              href={viewHref(v)}
              className={`rounded-lg px-3.5 py-1.5 text-xs font-medium transition ${
                view === v
                  ? "bg-white/[0.09] text-slate-100 ring-1 ring-white/15"
                  : "text-slate-400 hover:text-slate-200"
              }`}
            >
              {label}
            </Link>
          ))}
        </div>

        <form className="flex flex-1 flex-wrap items-end gap-3">
          {view === "colonnes" && <input type="hidden" name="vue" value="colonnes" />}
          <div className="min-w-[200px] flex-1">
            <label className="label" htmlFor="q">
              Rechercher
            </label>
            <input
              id="q"
              name="q"
              defaultValue={q ?? ""}
              className="input"
              placeholder="Nom, contact, email, ville…"
            />
          </div>

          <div>
            <label className="label" htmlFor="statut">
              Étape
            </label>
            <select id="statut" name="statut" defaultValue={statut ?? "tous"} className="input">
              <option value="tous">Toutes</option>
              {STATUS_ORDER.map((s) => (
                <option key={s} value={s}>
                  {STATUS_LABEL[s]}
                </option>
              ))}
            </select>
          </div>

          {view === "liste" && (
            <div>
              <label className="label" htmlFor="tri">
                Trier par
              </label>
              <select id="tri" name="tri" defaultValue={sort} className="input">
                <option value="recent">Activité récente</option>
                <option value="relance">Prochaine action</option>
                <option value="nom">Nom</option>
              </select>
            </div>
          )}

          <button className="btn-ghost">Filtrer</button>
        </form>
      </div>

      {error && (
        <p className="mb-4 rounded-xl bg-rose-500/10 px-4 py-3 text-sm text-rose-300">
          {error.message}
        </p>
      )}

      {prospects.length === 0 ? (
        <EmptyState
          title={q || statut ? "Aucun résultat" : "Aucun prospect pour l'instant"}
          hint={
            q || statut
              ? "Essayez d'élargir la recherche ou de retirer le filtre d'étape."
              : "Créez votre première fiche, ou importez une liste depuis un fichier CSV."
          }
          href="/prospects/nouveau"
          cta="Créer un prospect"
        />
      ) : view === "colonnes" ? (
        <PipelineBoard prospects={boardProspects} />
      ) : (
        <div className="card animate-rise overflow-x-auto">
          <table className="w-full min-w-[820px]">
            <thead className="border-b border-white/[0.06]">
              <tr>
                <th className="th">Prospect</th>
                <th className="th">Étape</th>
                <th className="th" title="Confiance estimée par l'assistant, corrigeable sur la fiche">
                  Confiance
                </th>
                <th className="th">Prochaine action</th>
                <th className="th">Dernier contact</th>
                <th className="th">Responsable</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-white/[0.04]">
              {prospects.map((p) => {
                const overdue =
                  p.next_action_at && new Date(p.next_action_at).getTime() < Date.now();
                return (
                  <tr key={p.id} className="transition duration-200 hover:bg-white/[0.04]">
                    <td className="td">
                      <Link href={`/prospects/${p.id}`} className="flex items-center gap-3">
                        <Avatar name={p.contact_name ?? p.company_name} />
                        <span className="min-w-0">
                          <span className="block truncate font-semibold text-slate-50">
                            {p.company_name}
                          </span>
                          <span className="block truncate text-xs text-slate-400">
                            {p.phone ?? p.contact_name ?? p.email ?? p.city ?? "—"}
                          </span>
                        </span>
                      </Link>
                    </td>
                    <td className="td">
                      <StatusChip status={p.status} />
                    </td>
                    <td className="td whitespace-nowrap">
                      <ConfidenceBadge
                        level={p.confidence_level}
                        reason={p.confidence_reason}
                        locked={Boolean(p.confidence_locked)}
                      />
                    </td>
                    <td className={`td whitespace-nowrap ${overdue ? "text-rose-400" : ""}`}>
                      {p.next_action_at ? relative(p.next_action_at) : "—"}
                    </td>
                    <td className="td whitespace-nowrap text-slate-400">
                      {p.last_contact_at ? relative(p.last_contact_at) : "Jamais"}
                    </td>
                    <td className="td">
                      <Avatar name={p.crm_users?.full_name ?? null} />
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}
