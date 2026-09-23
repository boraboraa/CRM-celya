import Link from "next/link";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getSession } from "@/lib/auth";
import { PageHeader, Avatar, Icone, type IconeNom } from "@/components/ui";
import { CreateUserForm, ResetPasswordForm } from "@/components/TeamForms";
import { adminUpdateUserAction } from "@/app/actions";
import {
  lirePorteurs,
  lireLiensEncadrement,
  encadrementDisponible,
} from "@/lib/crm/access";
import { fmtDate, fmtDateTime, ACTIVITY_LABEL } from "@/lib/constants";

/**
 * Équipe — le seul écran qui dise, pour chaque compte : qui c'est, si sa
 * configuration est complète, et ce qu'il produit.
 *
 * Tout vient d'un agrégat unique, `admin_team_overview(p_since)` : une seule
 * requête pour toute la page, jamais une par ligne affichée. Le contrôle
 * d'accès est EN BASE — la fonction lève 42501 si l'appelant n'est pas admin,
 * donc masquer le lien ne suffit pas à contourner, et un appel direct à la
 * route est refusé de la même manière.
 *
 * Aucun secret ici : ni mot de passe d'application, ni jeton. L'état
 * « connecté / pas connecté » est tout ce qu'il faut pour savoir qui est en
 * ordre de marche.
 */

type Row = {
  user_id: string;
  email: string;
  full_name: string | null;
  role: string;
  is_active: boolean;
  must_change_password: boolean;
  created_at: string;
  last_sign_in_at: string | null;
  mailbox: string | null;
  mailbox_last_sync_at: string | null;
  mailbox_error: string | null;
  mailbox_has_credentials: boolean;
  mcp_connected: boolean;
  mcp_last_token_at: string | null;
  prospects_total: number;
  prospects_actifs: number;
  notes: number;
  appels_sans_reponse: number;
  emails_envoyes: number;
  reponses_recues: number;
  rdv: number;
  relances_faites: number;
  relances_en_retard: number;
  derniere_action: string | null;
};

const PERIODES = [
  { cle: "7", label: "7 jours", jours: 7 },
  { cle: "30", label: "30 jours", jours: 30 },
  { cle: "tout", label: "Tout", jours: null },
] as const;

export default async function TeamPage({
  searchParams,
}: {
  searchParams: Promise<{ periode?: string }>;
}) {
  const session = await getSession();
  if (session?.me?.role !== "admin") redirect("/dashboard");

  const { periode: periodeParam } = await searchParams;
  const periode = PERIODES.find((p) => p.cle === periodeParam) ?? PERIODES[1];
  const since =
    periode.jours === null
      ? null
      : new Date(Date.now() - periode.jours * 86_400_000).toISOString();

  const supabase = await createClient();

  // Quatre requêtes pour toute la page : l'agrégat, le journal récent de TOUS
  // les comptes d'un coup (groupé en mémoire pour les lignes dépliées), les
  // porteurs de l'interrupteur d'équipe, et les liens d'encadrement.
  //
  // `voit_equipe` ne passe PAS par `admin_team_overview` : y ajouter une
  // colonne obligerait à `drop` puis recréer une fonction `security definer`
  // (on ne change pas le type de retour d'un `returns table` par un
  // `create or replace`) — un geste risqué en production pour une case à
  // cocher. `lirePorteurs` est une lecture de cinq lignes, tolérante à
  // l'absence de la colonne : la page rend donc aussi avant la migration 020.
  const [overviewRes, recentRes, porteurs, liens, encadrementEnService] = await Promise.all([
    supabase.rpc("admin_team_overview", { p_since: since }),
    supabase
      .from("activities")
      .select("id, author_id, type, subject, body, occurred_at, outcome, prospects(id, company_name)")
      .eq("is_draft", false)
      .order("occurred_at", { ascending: false })
      .limit(240),
    lirePorteurs(supabase),
    // Tolérante à l'absence de la table : la page rend aussi avant la 021.
    lireLiensEncadrement(supabase),
    // …et l'ÉCRITURE aussi : sans la table, pas de cases à cocher.
    encadrementDisponible(supabase),
  ]);

  const rows = (overviewRes.data ?? []) as Row[];
  const partage = new Set(porteurs);

  // Qui encadre qui — indexé DANS LE SENS OÙ L'ÉCRAN POSE LA QUESTION, c'est-à-
  // dire « qui voit le travail de cette personne ». La table est stockée dans
  // l'autre sens (une ligne par encadrant) parce que c'est le sens où la RLS
  // l'interroge ; l'écran, lui, parle depuis la carte de l'encadré.
  const encadrantsDe = new Map<string, Set<string>>();
  for (const l of liens) {
    const s = encadrantsDe.get(l.commercialId) ?? new Set<string>();
    s.add(l.encadrantId);
    encadrantsDe.set(l.commercialId, s);
  }
  const nomCourt = (id: string) => {
    const r = rows.find((x) => x.user_id === id);
    return r?.full_name?.split(" ")[0] ?? r?.email ?? "—";
  };

  type Recent = {
    id: string;
    author_id: string | null;
    type: string;
    subject: string | null;
    body: string | null;
    occurred_at: string;
    outcome: string | null;
    prospects: { id: string; company_name: string } | null;
  };
  const parAuteur = new Map<string, Recent[]>();
  for (const a of (recentRes.data ?? []) as unknown as Recent[]) {
    if (!a.author_id) continue;
    const list = parAuteur.get(a.author_id) ?? [];
    if (list.length < 8) list.push(a);
    parAuteur.set(a.author_id, list);
  }

  const incomplets = rows.filter(
    (r) => r.is_active && (!r.mailbox || !r.mcp_connected)
  ).length;

  return (
    <>
      <PageHeader
        title="Équipe"
        subtitle="Qui est en ordre de marche, et ce que chacun produit."
      />

      <div className="mb-7 max-w-3xl">
        <CreateUserForm />
      </div>

      {/* ---- Bandeau : période + alerte de configuration ---- */}
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-1.5">
          <span className="mr-1 text-xs text-slate-500">Activité sur</span>
          {PERIODES.map((p) => (
            <Link
              key={p.cle}
              href={`/equipe?periode=${p.cle}`}
              className={
                p.cle === periode.cle
                  ? "rounded-lg bg-white/[0.08] px-2.5 py-1 text-xs font-medium text-slate-100 ring-1 ring-white/15"
                  : "rounded-lg px-2.5 py-1 text-xs text-slate-400 ring-1 ring-white/[0.06] transition hover:bg-white/[0.04] hover:text-slate-200"
              }
            >
              {p.label}
            </Link>
          ))}
        </div>
        {incomplets > 0 && (
          <p className="chip bg-amber-500/15 text-amber-300 ring-amber-400/25">
            <Icone nom="alerte" className="h-3 w-3" />
            {incomplets} compte{incomplets > 1 ? "s" : ""} pas encore
            opérationnel{incomplets > 1 ? "s" : ""}
          </p>
        )}
      </div>

      {/* ---- Une carte par compte ---- */}
      <div className="space-y-4">
        {rows.map((u) => {
          const isMe = u.user_id === session.userId;
          const incomplet = u.is_active && (!u.mailbox || !u.mcp_connected);
          const recent = parAuteur.get(u.user_id) ?? [];

          return (
            <section
              key={u.user_id}
              className={
                incomplet
                  ? "card animate-rise border-l-2 border-l-amber-400/60 p-5"
                  : "card animate-rise border-l-2 border-l-transparent p-5"
              }
            >
              {/* -- Identité -- */}
              <div className="flex flex-wrap items-start justify-between gap-4">
                <div className="flex min-w-0 items-center gap-3">
                  <Avatar name={u.full_name ?? u.email} size="md" />
                  <div className="min-w-0">
                    <p className="truncate text-sm font-medium text-slate-50">
                      {u.full_name ?? "—"}
                      {isMe && (
                        <span className="ml-2 text-[11px] text-slate-500">(vous)</span>
                      )}
                    </p>
                    <p className="truncate text-xs text-slate-500">{u.email}</p>
                  </div>
                </div>

                <div className="flex flex-wrap items-center gap-2">
                  {u.is_active ? (
                    <span className="chip bg-emerald-500/15 text-emerald-300 ring-emerald-400/25">
                      <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-emerald-400" />
                      Actif
                    </span>
                  ) : (
                    <span className="chip bg-slate-500/15 text-slate-300 ring-slate-400/25">
                      <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-slate-500" />
                      Inactif
                    </span>
                  )}
                  <span className="chip bg-white/[0.06] text-slate-300 ring-white/10">
                    {u.role === "admin" ? "Administrateur" : "Commercial"}
                  </span>
                </div>
              </div>

              {/* -- État de la configuration -- */}
              <div className="mt-4 flex flex-wrap gap-2">
                <ConfigChip
                  ok={Boolean(u.mailbox && u.mailbox_has_credentials)}
                  icon="enveloppe"
                  okLabel={`Boîte : ${u.mailbox}`}
                  koLabel="Aucune boîte email connectée"
                />
                <ConfigChip
                  ok={u.mcp_connected}
                  icon="etincelle"
                  okLabel="Connecteur MCP branché"
                  koLabel="Connecteur MCP non branché"
                />
                {u.must_change_password && (
                  <span className="chip bg-amber-500/15 text-amber-300 ring-amber-400/25">
                    <Icone nom="alerte" className="h-3 w-3" />
                    Mot de passe provisoire
                  </span>
                )}
              </div>

              {u.mailbox_error && (
                <p className="mt-2 rounded-lg bg-rose-500/10 px-3 py-2 text-xs text-rose-300 ring-1 ring-rose-400/20">
                  Relève en erreur : {u.mailbox_error}
                </p>
              )}

              <p className="mt-2 text-[11px] text-slate-500">
                Compte créé le {fmtDate(u.created_at)}
                {" · "}
                {u.last_sign_in_at
                  ? `dernière connexion ${fmtDateTime(u.last_sign_in_at)}`
                  : "jamais connecté"}
                {u.mailbox && (
                  <>
                    {" · "}
                    {u.mailbox_last_sync_at
                      ? `relève ${fmtDateTime(u.mailbox_last_sync_at)}`
                      : "jamais relevée"}
                  </>
                )}
                {u.mcp_last_token_at && (
                  <> · jeton MCP du {fmtDate(u.mcp_last_token_at)}</>
                )}
              </p>

              {/* -- Activité -- */}
              <div className="mt-4 grid grid-cols-2 gap-px overflow-hidden rounded-xl bg-white/[0.06] sm:grid-cols-3 lg:grid-cols-5">
                <Stat label="Prospects" value={u.prospects_total} hint={`${u.prospects_actifs} en cours`} />
                <Stat label="Notes" value={u.notes} />
                <Stat label="Sans réponse" value={u.appels_sans_reponse} />
                <Stat label="Mails envoyés" value={u.emails_envoyes} />
                <Stat label="Réponses" value={u.reponses_recues} />
                <Stat label="Rendez-vous" value={u.rdv} />
                <Stat label="Relances faites" value={u.relances_faites} />
                {/* La métrique qui compte : les compteurs d'appels et de mails
                    flattent l'activité, c'est le retard qui dit si ça fuit. */}
                <Stat
                  label="Relances en retard"
                  value={u.relances_en_retard}
                  alert={u.relances_en_retard > 0}
                />
                <Stat
                  label="Dernière action"
                  text={u.derniere_action ? fmtDate(u.derniere_action) : "—"}
                />
              </div>

              {/* -- Le détail, replié -- */}
              {recent.length > 0 && (
                <details className="group mt-3">
                  <summary className="cursor-pointer list-none text-xs text-slate-400 transition hover:text-slate-200">
                    <Icone
                      nom="chevron"
                      className="inline-block h-3 w-3 transition group-open:rotate-180"
                    />{" "}
                    Dernières actions ({recent.length})
                  </summary>
                  <ul className="mt-2 space-y-1.5 border-l border-white/[0.08] pl-3">
                    {recent.map((a) => (
                      <li key={a.id} className="text-xs">
                        <span className="text-slate-500">
                          {fmtDateTime(a.occurred_at)}
                        </span>{" "}
                        <span className="text-slate-400">
                          {a.outcome === "sans_reponse"
                            ? "Appelé, pas de réponse"
                            : ACTIVITY_LABEL[a.type as keyof typeof ACTIVITY_LABEL] ?? a.type}
                        </span>
                        {a.prospects && (
                          <>
                            {" · "}
                            <Link
                              href={`/prospects/${a.prospects.id}`}
                              prefetch={false}
                              className="text-slate-200 underline-offset-2 hover:underline"
                            >
                              {a.prospects.company_name}
                            </Link>
                          </>
                        )}
                        {(a.subject || a.body) && (
                          <span className="text-slate-500">
                            {" — "}
                            {(a.subject ?? a.body ?? "").slice(0, 90)}
                          </span>
                        )}
                      </li>
                    ))}
                  </ul>
                </details>
              )}

              {/* -- L'interrupteur « travaille en équipe » --------------------
                  Une case par personne, RÉCIPROQUE : cochée, elle donne le
                  droit de voir ET expose. Personne n'est regardé sans être
                  regardant — c'est ce qui permet à un commercial qui travaille
                  seul de rester cloisonné dans les deux sens sans exception
                  écrite à son nom.

                  Pas d'interrupteur pour un ADMIN : il voit déjà tout, et ses
                  fiches ne doivent être exposées à personne (`partage_equipe`
                  exige `role = 'commercial'` des deux côtés, même si la case
                  était cochée par erreur). */}
              {u.role !== "admin" && (
                <form
                  action={adminUpdateUserAction}
                  className="mt-4 border-t border-white/[0.06] pt-4"
                >
                  <input type="hidden" name="op" value="set_voit_equipe" />
                  <input type="hidden" name="user_id" value={u.user_id} />
                  <input
                    type="hidden"
                    name="voit_equipe"
                    value={partage.has(u.user_id) ? "0" : "1"}
                  />
                  <button
                    type="submit"
                    className="flex items-start gap-2.5 text-left"
                    aria-pressed={partage.has(u.user_id)}
                  >
                    <span
                      className={
                        partage.has(u.user_id)
                          ? "mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center rounded border border-celya-blue bg-celya-blue text-slate-950"
                          : "mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center rounded border border-white/20 bg-white/[0.03]"
                      }
                    >
                      {partage.has(u.user_id) && (
                        <Icone nom="coche" className="h-3 w-3" />
                      )}
                    </span>
                    <span className="text-xs text-slate-300">
                      Travaille en équipe (voit et est vu par les autres membres
                      cochés)
                    </span>
                  </button>
                </form>
              )}

              {/* -- Encadrement (migration 021) --------------------------------
                  « Encadré par » : une case par encadrant possible, sur la
                  carte de la personne ENCADRÉE. C'est le sens où l'on se pose
                  la question quand on crée un compte d'étudiant — « qui doit
                  voir son travail ? » — même si la table, elle, est rangée par
                  encadrant, parce que c'est le sens où la RLS l'interroge.

                  Le libellé DIT LE SENS, sans jargon : un droit de regard qui
                  n'est pas un droit de modification, ce n'est évident pour
                  personne, et ça ne se devine pas d'une case à cocher.

                  Pas de case pour un ADMIN : `encadre()` exige
                  `role = 'commercial'` du côté encadré, une ligne posée vers
                  Bora n'exposerait donc rien. L'afficher promettrait un effet
                  qui n'aurait pas lieu.

                  Un admin n'apparaît pas non plus comme encadrant POSSIBLE : il
                  voit déjà tout par `is_admin()`, la ligne serait morte. */}
              {u.role !== "admin" && (
                <div className="mt-4 border-t border-white/[0.06] pt-4">
                  <p className="mb-2 text-xs font-medium text-slate-300">
                    Encadré par
                  </p>
                  {!encadrementEnService ? (
                    // Migration 021 pas encore appliquée : une phrase, pas des
                    // cases qui écriraient dans une table absente.
                    <p className="text-[11px] leading-relaxed text-slate-400">
                      Pas encore disponible : l&apos;encadrement sera activé
                      quand la mise à jour de la base (migration 021) aura été
                      appliquée. Rien à faire d&apos;ici là.
                    </p>
                  ) : (
                  <>
                  <p className="mb-3 text-[11px] leading-relaxed text-slate-400">
                    La personne cochée voit son travail — fiches, appels,
                    relances, agenda — et <strong>ne le modifie pas</strong>.
                    Lui ne voit rien d&apos;elle en retour.
                  </p>
                  <div className="flex flex-wrap gap-x-4 gap-y-2">
                    {rows
                      .filter(
                        (c) =>
                          c.user_id !== u.user_id &&
                          c.role !== "admin" &&
                          c.is_active
                      )
                      .map((c) => {
                        const coche =
                          encadrantsDe.get(u.user_id)?.has(c.user_id) === true;
                        return (
                          <form key={c.user_id} action={adminUpdateUserAction}>
                            <input type="hidden" name="op" value="set_encadrement" />
                            <input type="hidden" name="user_id" value={u.user_id} />
                            <input
                              type="hidden"
                              name="encadrant_id"
                              value={c.user_id}
                            />
                            <input
                              type="hidden"
                              name="encadre"
                              value={coche ? "0" : "1"}
                            />
                            <button
                              type="submit"
                              className="flex items-center gap-2 text-left"
                              aria-pressed={coche}
                            >
                              <span
                                className={
                                  coche
                                    ? "flex h-4 w-4 shrink-0 items-center justify-center rounded border border-celya-blue bg-celya-blue text-slate-950"
                                    : "flex h-4 w-4 shrink-0 items-center justify-center rounded border border-white/20 bg-white/[0.03]"
                                }
                              >
                                {coche && <Icone nom="coche" className="h-3 w-3" />}
                              </span>
                              <span className="text-xs text-slate-300">
                                {nomCourt(c.user_id)}
                              </span>
                            </button>
                          </form>
                        );
                      })}
                    {rows.filter(
                      (c) =>
                        c.user_id !== u.user_id && c.role !== "admin" && c.is_active
                    ).length === 0 && (
                      <p className="text-xs text-slate-500">
                        Aucun autre commercial actif à proposer.
                      </p>
                    )}
                  </div>
                  </>
                  )}
                </div>
              )}

              {/* -- Gestion du compte (rôle, activation, mot de passe) -- */}
              <div className="mt-4 flex flex-wrap items-center gap-2 border-t border-white/[0.06] pt-4">
                <form action={adminUpdateUserAction} className="flex items-center gap-2">
                  <input type="hidden" name="op" value="set_role" />
                  <input type="hidden" name="user_id" value={u.user_id} />
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

                {!isMe && (
                  <form action={adminUpdateUserAction}>
                    <input type="hidden" name="op" value="set_active" />
                    <input type="hidden" name="user_id" value={u.user_id} />
                    <input type="hidden" name="is_active" value={u.is_active ? "0" : "1"} />
                    <button className="rounded-lg px-2.5 py-1 text-[11px] text-slate-400 ring-1 ring-white/10 transition hover:bg-white/[0.06] hover:text-slate-200">
                      {u.is_active ? "Désactiver" : "Activer"}
                    </button>
                  </form>
                )}

                <ResetPasswordForm userId={u.user_id} name={u.full_name ?? u.email} />

                {!isMe && (
                  <form action={adminUpdateUserAction}>
                    <input type="hidden" name="op" value="delete_user" />
                    <input type="hidden" name="user_id" value={u.user_id} />
                    <button className="rounded-lg px-2.5 py-1 text-[11px] text-slate-600 transition hover:text-rose-400">
                      Supprimer
                    </button>
                  </form>
                )}
              </div>
            </section>
          );
        })}
      </div>

      <div className="card mt-6 max-w-3xl p-5 text-sm leading-relaxed text-slate-400">
        <h2 className="mb-2 font-display text-sm font-semibold text-slate-200">
          Qui voit quoi
        </h2>
        <ul className="list-inside list-disc space-y-1.5">
          <li>
            <span className="text-slate-200">Administrateur</span> — voit et modifie
            tous les prospects, toutes les relances, et gère l&apos;équipe.
          </li>
          <li>
            <span className="text-slate-200">Commercial</span> — voit uniquement les
            prospects dont il est responsable, plus les fiches non assignées. Il
            envoie depuis sa propre boîte, et ne voit ni celle des autres, ni
            leurs échanges.
          </li>
          <li>
            Un compte <span className="text-slate-200">inactif</span> peut se connecter
            mais ne voit aucune donnée — et son connecteur MCP cesse de répondre
            immédiatement.
          </li>
        </ul>
      </div>
    </>
  );
}

/** Un état de configuration : vert si en ordre, ambre si manquant. Jamais un
 *  secret — seulement « connecté / pas connecté ». */
function ConfigChip({
  ok,
  icon,
  okLabel,
  koLabel,
}: {
  ok: boolean;
  icon: IconeNom;
  okLabel: string;
  koLabel: string;
}) {
  return ok ? (
    <span className="chip bg-emerald-500/15 text-emerald-300 ring-emerald-400/25">
      <Icone nom={icon} className="h-3 w-3" />
      {okLabel}
    </span>
  ) : (
    <span className="chip bg-amber-500/15 text-amber-300 ring-amber-400/25">
      <Icone nom={icon} className="h-3 w-3" />
      {koLabel}
    </span>
  );
}

function Stat({
  label,
  value,
  text,
  hint,
  alert,
}: {
  label: string;
  value?: number;
  text?: string;
  hint?: string;
  alert?: boolean;
}) {
  return (
    <div className={alert ? "bg-amber-500/10 px-3 py-2.5" : "bg-[#0A0E1A] px-3 py-2.5"}>
      <p
        className={
          alert
            ? "font-display text-lg font-semibold text-amber-300"
            : "font-display text-lg font-semibold text-slate-100"
        }
      >
        {text ?? value ?? 0}
      </p>
      <p className={alert ? "text-[11px] text-amber-300/80" : "text-[11px] text-slate-500"}>
        {label}
      </p>
      {hint && <p className="text-[10px] text-slate-600">{hint}</p>}
    </div>
  );
}
