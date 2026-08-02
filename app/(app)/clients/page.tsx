import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { PageHeader, StatusChip, EmptyState, Avatar } from "@/components/ui";
import { STATUS_ORDER, STATUS_LABEL, fmtMoney, relative } from "@/lib/constants";
import type { ClientStatus } from "@/lib/types";

export const dynamic = "force-dynamic";

type Search = { q?: string; statut?: string; tri?: string };

export default async function ClientsPage({
  searchParams,
}: {
  searchParams: Promise<Search>;
}) {
  const { q, statut, tri } = await searchParams;
  const supabase = await createClient();

  let query = supabase
    .from("clients")
    .select(
      "id, company_name, contact_name, email, phone, city, status, value_estimate, next_action_at, last_contact_at, owner_id, crm_users!clients_owner_id_fkey(full_name)"
    );

  if (q) {
    const like = `%${q}%`;
    query = query.or(
      `company_name.ilike.${like},contact_name.ilike.${like},email.ilike.${like},city.ilike.${like}`
    );
  }
  if (statut && statut !== "tous") {
    query = query.eq("status", statut);
  }

  const sort = tri ?? "recent";
  if (sort === "relance") {
    query = query.order("next_action_at", { ascending: true, nullsFirst: false });
  } else if (sort === "valeur") {
    query = query.order("value_estimate", { ascending: false, nullsFirst: false });
  } else if (sort === "nom") {
    query = query.order("company_name", { ascending: true });
  } else {
    query = query.order("updated_at", { ascending: false });
  }

  const { data, error } = await query.limit(300);
  const clients = (data ?? []) as unknown as {
    id: string;
    company_name: string;
    contact_name: string | null;
    email: string | null;
    phone: string | null;
    city: string | null;
    status: ClientStatus;
    value_estimate: number | null;
    next_action_at: string | null;
    last_contact_at: string | null;
    crm_users: { full_name: string | null } | null;
  }[];

  return (
    <>
      <PageHeader
        title="Clients"
        subtitle={`${clients.length} fiche${clients.length > 1 ? "s" : ""}`}
        action={
          <div className="flex gap-2">
            <Link href="/clients/import" className="btn-ghost">
              Importer un CSV
            </Link>
            <Link href="/clients/nouveau" className="btn-primary">
              + Nouveau client
            </Link>
          </div>
        }
      />

      <form className="card mb-5 flex flex-wrap items-end gap-3 p-4">
        <div className="min-w-[220px] flex-1">
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
            Statut
          </label>
          <select id="statut" name="statut" defaultValue={statut ?? "tous"} className="input">
            <option value="tous">Tous</option>
            {STATUS_ORDER.map((s) => (
              <option key={s} value={s}>
                {STATUS_LABEL[s]}
              </option>
            ))}
          </select>
        </div>

        <div>
          <label className="label" htmlFor="tri">
            Trier par
          </label>
          <select id="tri" name="tri" defaultValue={sort} className="input">
            <option value="recent">Activité récente</option>
            <option value="relance">Prochaine relance</option>
            <option value="valeur">Valeur estimée</option>
            <option value="nom">Nom</option>
          </select>
        </div>

        <button className="btn-ghost">Filtrer</button>
      </form>

      {error && (
        <p className="mb-4 rounded-xl bg-rose-500/10 px-4 py-3 text-sm text-rose-300">
          {error.message}
        </p>
      )}

      {clients.length === 0 ? (
        <EmptyState
          title={q || statut ? "Aucun résultat" : "Aucun client pour l'instant"}
          hint={
            q || statut
              ? "Essayez d'élargir la recherche ou de retirer le filtre de statut."
              : "Créez votre première fiche : après chaque appel vous pourrez y noter ce qui s'est dit et planifier la relance."
          }
          href="/clients/nouveau"
          cta="Créer un client"
        />
      ) : (
        <div className="card overflow-x-auto">
          <table className="w-full min-w-[820px]">
            <thead className="border-b border-white/[0.06]">
              <tr>
                <th className="th">Client</th>
                <th className="th">Statut</th>
                <th className="th">Valeur</th>
                <th className="th">Prochaine relance</th>
                <th className="th">Dernier contact</th>
                <th className="th">Responsable</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-white/[0.04]">
              {clients.map((c) => {
                const overdue =
                  c.next_action_at && new Date(c.next_action_at).getTime() < Date.now();
                return (
                  <tr key={c.id} className="transition hover:bg-white/[0.03]">
                    <td className="td">
                      <Link href={`/clients/${c.id}`} className="flex items-center gap-3">
                        <Avatar name={c.contact_name ?? c.company_name} />
                        <span className="min-w-0">
                          <span className="block truncate font-medium text-slate-100">
                            {c.company_name}
                          </span>
                          <span className="block truncate text-xs text-slate-500">
                            {c.contact_name ?? c.email ?? c.phone ?? c.city ?? "—"}
                          </span>
                        </span>
                      </Link>
                    </td>
                    <td className="td">
                      <StatusChip status={c.status} />
                    </td>
                    <td className="td whitespace-nowrap">
                      {fmtMoney(c.value_estimate)}
                    </td>
                    <td className={`td whitespace-nowrap ${overdue ? "text-rose-400" : ""}`}>
                      {c.next_action_at ? relative(c.next_action_at) : "—"}
                    </td>
                    <td className="td whitespace-nowrap text-slate-400">
                      {c.last_contact_at ? relative(c.last_contact_at) : "Jamais"}
                    </td>
                    <td className="td">
                      <Avatar name={c.crm_users?.full_name ?? null} />
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
