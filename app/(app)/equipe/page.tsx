import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getSession } from "@/lib/auth";
import { PageHeader, Avatar } from "@/components/ui";
import { CreateUserForm, ResetPasswordForm } from "@/components/TeamForms";
import { adminUpdateUserAction } from "@/app/actions";
import { fmtDate } from "@/lib/constants";
import type { Profile } from "@/lib/types";

export const dynamic = "force-dynamic";

export default async function TeamPage() {
  const session = await getSession();
  if (session?.me?.role !== "admin") redirect("/dashboard");

  const supabase = await createClient();
  const { data } = await supabase
    .from("crm_users")
    .select("*")
    .order("created_at", { ascending: true });

  const users = (data ?? []) as Profile[];

  return (
    <>
      <PageHeader
        title="Équipe"
        subtitle="Créez les accès de vos étudiants et choisissez ce que chacun peut voir."
      />

      <div className="mb-7 max-w-3xl">
        <CreateUserForm />
      </div>

      <div className="card overflow-x-auto">
        <table className="w-full min-w-[760px]">
          <thead className="border-b border-white/[0.06]">
            <tr>
              <th className="th">Personne</th>
              <th className="th">Rôle</th>
              <th className="th">Statut</th>
              <th className="th">Depuis</th>
              <th className="th">Actions</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-white/[0.04]">
            {users.map((u) => {
              const isMe = u.id === session.userId;
              return (
                <tr key={u.id} className="align-top">
                  <td className="td">
                    <div className="flex items-center gap-3">
                      <Avatar name={u.full_name ?? u.email} size="md" />
                      <div className="min-w-0">
                        <p className="truncate text-sm font-medium text-slate-100">
                          {u.full_name ?? "—"}
                          {isMe && (
                            <span className="ml-2 text-[11px] text-slate-500">(vous)</span>
                          )}
                        </p>
                        <p className="truncate text-xs text-slate-500">{u.email}</p>
                      </div>
                    </div>
                  </td>

                  <td className="td">
                    <form action={adminUpdateUserAction} className="flex items-center gap-2">
                      <input type="hidden" name="op" value="set_role" />
                      <input type="hidden" name="user_id" value={u.id} />
                      <select
                        name="role"
                        defaultValue={u.role}
                        disabled={isMe}
                        className="input py-1.5 text-xs disabled:opacity-50"
                      >
                        <option value="commercial">Commercial</option>
                        <option value="admin">Admin</option>
                      </select>
                      {!isMe && (
                        <button className="rounded-lg px-2 py-1 text-[11px] text-slate-400 ring-1 ring-white/10 hover:text-slate-200">
                          OK
                        </button>
                      )}
                    </form>
                  </td>

                  <td className="td">
                    {u.is_active ? (
                      <span className="chip bg-emerald-500/15 text-emerald-300 ring-emerald-400/25">
                        Actif
                      </span>
                    ) : (
                      <span className="chip bg-amber-500/15 text-amber-300 ring-amber-400/25">
                        Inactif
                      </span>
                    )}
                    {u.must_change_password && (
                      <p className="mt-1 text-[11px] text-slate-500">
                        Doit changer son mot de passe
                      </p>
                    )}
                  </td>

                  <td className="td whitespace-nowrap text-slate-400">
                    {fmtDate(u.created_at)}
                  </td>

                  <td className="td">
                    <div className="flex flex-col items-start gap-2">
                      {!isMe && (
                        <form action={adminUpdateUserAction}>
                          <input type="hidden" name="op" value="set_active" />
                          <input type="hidden" name="user_id" value={u.id} />
                          <input
                            type="hidden"
                            name="is_active"
                            value={u.is_active ? "0" : "1"}
                          />
                          <button className="rounded-lg px-2.5 py-1 text-[11px] text-slate-400 ring-1 ring-white/10 transition hover:bg-white/[0.06] hover:text-slate-200">
                            {u.is_active ? "Désactiver" : "Activer"}
                          </button>
                        </form>
                      )}

                      <ResetPasswordForm userId={u.id} name={u.full_name ?? u.email} />

                      {!isMe && (
                        <form action={adminUpdateUserAction}>
                          <input type="hidden" name="op" value="delete_user" />
                          <input type="hidden" name="user_id" value={u.id} />
                          <button className="rounded-lg px-2.5 py-1 text-[11px] text-slate-600 transition hover:text-rose-400">
                            Supprimer
                          </button>
                        </form>
                      )}
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <div className="card mt-6 max-w-3xl p-5 text-sm leading-relaxed text-slate-400">
        <h2 className="mb-2 font-display text-sm font-semibold text-slate-200">
          Qui voit quoi
        </h2>
        <ul className="list-inside list-disc space-y-1.5">
          <li>
            <span className="text-slate-200">Administrateur</span> — voit et modifie
            tous les clients, toutes les relances, et gère l&apos;équipe.
          </li>
          <li>
            <span className="text-slate-200">Commercial</span> — voit uniquement les
            clients dont il est responsable, plus les fiches non assignées.
          </li>
          <li>
            Un compte <span className="text-slate-200">inactif</span> peut se connecter
            mais ne voit aucune donnée.
          </li>
        </ul>
      </div>
    </>
  );
}
