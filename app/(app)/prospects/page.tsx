import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import {
  PageHeader,
  StatusChip,
  EmptyState,
  Avatar,
  ConfidenceBadge,
  LastActionLine,
} from "@/components/ui";
import { PipelineBoard, type BoardProspect } from "@/components/PipelineBoard";
import {
  STATUS_ORDER,
  STATUS_LABEL,
  normalizeStatus,
  relative,
  fmtDate,
} from "@/lib/constants";
import {
  LAST_ACTION_SELECT,
  mapLastActions,
  type LastActionRow,
} from "@/lib/crm/lastAction";
import { composerHref } from "@/lib/crm/composer";
import type { ConfidenceLevel } from "@/lib/types";


type Search = {
  q?: string;
  statut?: string;
  tri?: string;
  vue?: string;
  filtre?: string;
};

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
  const { q, statut, tri, vue, filtre } = await searchParams;
  const supabase = await createClient();
  const view = vue === "colonnes" ? "colonnes" : "liste";
  // « Emails envoyés » : ne garder que les fiches à qui un mail est parti,
  // triées par date du dernier envoi — pour les retrouver d'un coup.
  const filtreEmails = filtre === "emails";

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

  // La « dernière action » de chaque fiche (canal + date) vient de la vue
  // prospect_action_state — la RLS s'y applique comme partout.
  const [{ data, error }, actionsRes] = await Promise.all([
    query.limit(500),
    supabase
      .from("prospect_action_state")
      .select(LAST_ACTION_SELECT)
      .limit(2000),
  ]);
  const lastActions = mapLastActions(
    (actionsRes.data ?? []) as unknown as LastActionRow[]
  );
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

  // Filtre « Emails envoyés » : au moins un mail sortant, le plus récent
  // d'abord — la date affichée est celle du dernier mail.
  if (filtreEmails) {
    prospects = prospects
      .filter((p) => lastActions.get(p.id)?.last_email_sent_at)
      .sort(
        (a, b) =>
          new Date(lastActions.get(b.id)!.last_email_sent_at!).getTime() -
          new Date(lastActions.get(a.id)!.last_email_sent_at!).getTime()
      );
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
    last_kind: lastActions.get(p.id)?.last_kind ?? null,
    last_at: lastActions.get(p.id)?.last_at ?? null,
  }));

  /** URL de la page en conservant recherche, étape, tri, vue et filtre. */
  const makeHref = (over: {
    vue?: "liste" | "colonnes";
    filtreEmails?: boolean;
  }) => {
    const params = new URLSearchParams();
    if (q) params.set("q", q);
    if (statut && statut !== "tous") params.set("statut", statut);
    if (tri) params.set("tri", tri);
    if ((over.vue ?? view) === "colonnes") params.set("vue", "colonnes");
    if (over.filtreEmails ?? filtreEmails) params.set("filtre", "emails");
    const qs = params.toString();
    return `/prospects${qs ? `?${qs}` : ""}`;
  };
  const viewHref = (v: "liste" | "colonnes") => makeHref({ vue: v });

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

        {/* Emails envoyés : retrouver d'un coup les fiches déjà démarchées
            par mail, avec la date du dernier envoi. */}
        <Link
          href={makeHref({ filtreEmails: !filtreEmails })}
          aria-pressed={filtreEmails}
          title="Ne montrer que les prospects à qui un mail a été envoyé"
          className={`rounded-xl px-3.5 py-2 text-xs font-medium ring-1 transition ${
            filtreEmails
              ? "bg-violet-500/15 text-violet-200 ring-violet-400/30"
              : "bg-white/[0.03] text-slate-400 ring-white/10 hover:text-slate-200"
          }`}
        >
          📧 Emails envoyés
        </Link>

        <form className="flex flex-1 flex-wrap items-end gap-3">
          {view === "colonnes" && <input type="hidden" name="vue" value="colonnes" />}
          {filtreEmails && <input type="hidden" name="filtre" value="emails" />}
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
          title={
            filtreEmails
              ? "Aucun email envoyé"
              : q || statut
                ? "Aucun résultat"
                : "Aucun prospect pour l'instant"
          }
          hint={
            filtreEmails
              ? "Aucun mail n'est encore parti vers ces prospects — le filtre ne montre que les fiches déjà démarchées par email."
              : q || statut
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
                <th className="th" title="Le dernier événement du journal : canal + résultat + date">
                  Dernière action
                </th>
                {filtreEmails && <th className="th">Dernier mail</th>}
                <th className="th">Responsable</th>
                <th className="th">
                  <span className="sr-only">Écrire</span>
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-white/[0.04]">
              {prospects.map((p) => {
                const overdue =
                  p.next_action_at && new Date(p.next_action_at).getTime() < Date.now();
                return (
                  <tr key={p.id} className="transition duration-200 hover:bg-white/[0.04]">
                    <td className="td">
                      {/* Pas de préchargement : la liste peut afficher 500
                          lignes, et chacune déclenchait le rendu serveur
                          complet de sa fiche. */}
                      <Link
                        href={`/prospects/${p.id}`}
                        prefetch={false}
                        className="flex items-center gap-3"
                      >
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
                    <td className="td whitespace-nowrap">
                      <LastActionLine
                        kind={lastActions.get(p.id)?.last_kind}
                        at={lastActions.get(p.id)?.last_at}
                      />
                    </td>
                    {filtreEmails && (
                      <td className="td whitespace-nowrap text-slate-300">
                        {fmtDate(lastActions.get(p.id)?.last_email_sent_at)}
                        <span className="text-slate-500">
                          {" "}
                          · {relative(lastActions.get(p.id)?.last_email_sent_at)}
                        </span>
                      </td>
                    )}
                    <td className="td">
                      <Avatar name={p.crm_users?.full_name ?? null} />
                    </td>
                    {/* Écrire sans passer par la fiche puis par le composeur :
                        le lien ouvre la fiche, composeur déplié. */}
                    <td className="td text-right">
                      {p.email && (
                        <Link
                          href={composerHref(p.id)}
                          prefetch={false}
                          title={`Écrire à ${p.email}`}
                          aria-label={`Écrire à ${p.company_name}`}
                          className="rounded-lg px-2 py-1 text-slate-500 transition hover:bg-white/[0.06] hover:text-violet-300"
                        >
                          ✉
                        </Link>
                      )}
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
