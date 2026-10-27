import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { getSession, getPerimetreViewer, perimetreMemorise } from "@/lib/auth";
import { PageHeader, EmptyState, Icone } from "@/components/ui";
import { ListeProspects, type LigneListe } from "@/components/ListeProspects";
import { PerimetreSwitcher, optionsPerimetre } from "@/components/PerimetreSwitcher";
import { FiltresProspects } from "@/components/FiltresProspects";
import { FeuilleFiltres } from "@/components/FeuilleFiltres";
import {
  FILTRES_RAPIDES,
  TRIS,
  filtresActifs,
  hrefProspects,
} from "@/lib/crm/filtresProspects";
import { filtreRecherche } from "@/lib/crm/recherche";
import { PipelineBoard, type BoardProspect } from "@/components/PipelineBoard";
import { STATUS_ORDER, STATUS_LABEL, STATUS_CHIP, normalizeStatus } from "@/lib/constants";
import { ordonnerProspects } from "@/lib/crm/ordreProspects";
import { todayBounds } from "@/lib/time";
import { avecRepliColonne } from "@/lib/crm/tolerance";
import {
  LAST_ACTION_SELECT,
  mapLastActions,
  type LastActionRow,
} from "@/lib/crm/lastAction";
import {
  lirePerimetre,
  filtrerProspects,
  restreindreAuxProspects,
  peutElargir,
  membresProposables,
  type PerimetreViewer,
} from "@/lib/crm/perimetre";
import { plusRienDePrevu } from "@/lib/crm/prochaineAction";
import { fichesAppeleesParJanet } from "@/lib/appelsIa/lectures";
import type { ConfidenceLevel } from "@/lib/types";


type Search = {
  q?: string;
  statut?: string;
  tri?: string;
  vue?: string;
  filtre?: string;
  perimetre?: string;
};

/**
 * Une seule liste de prospects (refaite le 27/10) : des CARTES, dans l'ordre
 * « Priorité » — étoilées, puis ce qui est dû, puis le reste
 * (lib/crm/ordreProspects.ts). L'étape est une PUCE de filtre ; il n'y a plus
 * de bascule. La vue en colonnes reste accessible par `?vue=colonnes` : c'est
 * le pipeline d'équipe, un lien discret pour qui peut élargir le périmètre.
 *
 * Le tout dans le PÉRIMÈTRE choisi (« Toute l'équipe » par défaut pour
 * l'admin, « moi » pour les autres). Le nom du responsable n'apparaît sur la
 * carte que si la liste mêle plusieurs personnes.
 */
export default async function ProspectsPage({
  searchParams,
}: {
  searchParams: Promise<Search>;
}) {
  const params = await searchParams;
  const { q, statut, tri, vue, filtre } = params;
  const supabase = await createClient();
  const session = await getSession();
  const view = vue === "colonnes" ? "colonnes" : "liste";
  // « Emails envoyés » : ne garder que les fiches à qui un mail est parti,
  // triées par date du dernier envoi — pour les retrouver d'un coup.
  const filtreEmails = filtre === "emails";
  // « À débriefer » (18/10) : les fiches dont la prochaine action est un
  // rendez-vous déjà commencé — ce qui attend une issue. Fiches closes
  // exclues (023 : elles ne réclament jamais rien).
  const filtreDebrief = filtre === "a_debriefer";

  // `getPerimetreViewer` porte aussi l'interrupteur « travaille en équipe »
  // et la liste des porteurs (migration 020) — `cache()`é, donc une seule
  // requête par rendu, et zéro pour un admin.
  const viewer: PerimetreViewer = await getPerimetreViewer();
  const perimetre = lirePerimetre(params, viewer, await perimetreMemorise());

  const statutFilter =
    statut && statut !== "tous" && (STATUS_ORDER as string[]).includes(statut)
      ? (statut as (typeof STATUS_ORDER)[number])
      : null;
  // « Priorité » (défaut) : la base trie par prochaine action, la page range
  // ensuite les étoilées et le dû en tête (en mémoire — PostgREST ne trie pas
  // sur une expression). Les deux bornes du jour viennent de lib/time.
  const sort = tri && ["relance", "recent", "nom"].includes(tri) ? tri : "priorite";

  // `starred_at` (031) : nommée seulement si la base la connaît — voir
  // lib/crm/tolerance.ts. La requête est donc FABRIQUÉE, pas construite une fois.
  const fabriquer = (avecEtoile: boolean) => {
  const colonnes: string = `id, company_name, contact_name, email, phone, city, status, notes, ${avecEtoile ? "starred_at, " : ""}confidence_level, confidence_reason, confidence_locked, next_action_at, next_action_kind, last_contact_at, owner_id, crm_users!prospects_owner_id_fkey(full_name, email)`;
  let query = filtrerProspects(supabase.from("prospects").select(colonnes), perimetre, viewer);

  // La recherche — la même règle que la recherche globale de l'en-tête
  // (lib/crm/recherche.ts) : société, contact, email, ville, et le
  // téléphone chiffre à chiffre. Saisie nettoyée : une virgule cassait le
  // filtre or() et renvoyait une erreur.
  const recherche = filtreRecherche(q);
  if (recherche) query = query.or(recherche);
  if (filtreDebrief) {
    query = query
      .eq("next_action_kind", "rendez_vous")
      .lte("next_action_at", new Date().toISOString())
      .not("status", "in", "(gagne,perdu)");
  }
  // Filtre d'étape poussé en SQL (sinon il s'appliquerait après .limit()
  // et fausserait résultats et compteur au-delà de 500 fiches).
  if (statutFilter) {
    query = query.eq("status", statutFilter);
  }

  if (sort === "relance" || sort === "priorite") {
    query = query.order("next_action_at", { ascending: true, nullsFirst: false });
  } else if (sort === "nom") {
    query = query.order("company_name", { ascending: true });
  } else {
    query = query.order("updated_at", { ascending: false });
  }
  return query.limit(500);
  };

  // La « dernière action » de chaque fiche (canal + date) vient de la vue
  // prospect_action_state — la RLS s'y applique comme partout. Le périmètre,
  // lui, est restreint en mémoire (la vue ne porte pas owner_id).
  //
  // Les fiches qui ont eu un rendez-vous CLOS : sans prochaine action, elles
  // disent « Plus rien de prévu » au lieu de « — » (migration 022 — le débrief
  // sans suite ne doit pas faire disparaître une fiche en silence). Même
  // lecture parallèle, RLS appliquée ; on ne garde que les fiches affichées.
  //
  // Les fiches qu'un appel RÉEL de Janet a touchées — l'étiquette « Janet »,
  // ADMIN SEUL. Cette lecture a besoin des identifiants de la liste : elle part
  // dès que la liste revient, sans attendre les trois autres lectures.
  const [[{ data, error }, appeleesParJanet], actionsRes, membresRes, rdvClosRes] =
    await Promise.all([
      avecRepliColonne(fabriquer).then(
        async (res) =>
          [
            res,
            viewer.isAdmin && res.data?.length
              ? await fichesAppeleesParJanet(
                  supabase,
                  (res.data as unknown as { id: string }[]).map((p) => p.id)
                )
              : new Set<string>(),
          ] as const
      ),
      supabase
        .from("prospect_action_state")
        .select(LAST_ACTION_SELECT)
        .limit(2000),
      peutElargir(viewer) || viewer.isAdmin
        ? supabase
            .from("crm_users")
            .select("id, full_name, email")
            .eq("is_active", true)
            .order("full_name")
        : Promise.resolve({ data: [] }),
      supabase
        .from("meetings_visibles")
        .select("prospect_id")
        .eq("kind", "prospect")
        .in("status", ["honore", "annule"])
        .not("prospect_id", "is", null)
        .limit(2000),
    ]);
  const avecRdvClos = new Set(
    ((rdvClosRes.data ?? []) as { prospect_id: string | null }[])
      .map((m) => m.prospect_id)
      .filter(Boolean) as string[]
  );
  const plusRien = (p: { id: string; next_action_at: string | null; status: string }) =>
    plusRienDePrevu({
      nextActionAt: p.next_action_at,
      status: p.status,
      aEuUnRdvClos: avecRdvClos.has(p.id),
    });
  const membres = (membresRes.data ?? []) as {
    id: string;
    full_name: string | null;
    email: string;
  }[];
  // Écrire est un geste d'écriture : réservé au propriétaire (et à l'admin).
  const aMoi = (ownerId: string | null | undefined) =>
    viewer.isAdmin || ownerId === viewer.userId;

  const lastActions = mapLastActions(
    restreindreAuxProspects(
      (actionsRes.data ?? []) as unknown as LastActionRow[],
      new Set(((data ?? []) as unknown as { id: string }[]).map((p) => p.id)),
      perimetre
    )
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
    next_action_kind: string | null;
    last_contact_at: string | null;
    notes: string | null;
    starred_at: string | null;
    /** Déjà demandé par le select ; utile pour savoir ce qu'on a le droit de faire. */
    owner_id: string | null;
    crm_users: { full_name: string | null; email: string | null } | null;
  }[]).map((p) => ({ ...p, status: normalizeStatus(p.status) }));

  if (sort === "priorite") {
    prospects = ordonnerProspects(prospects, new Date(todayBounds().end).getTime());
  }

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

  // L'étiquette « Janet » — un TABLEAU d'identifiants pour les colonnes
  // (composant client : un `Set` ne traverse pas la frontière serveur → client),
  // borné aux fiches affichées.
  const janetIds = prospects.filter((p) => appeleesParJanet.has(p.id)).map((p) => p.id);

  const boardProspects: BoardProspect[] = prospects.map((p) => ({
    id: p.id,
    company_name: p.company_name,
    contact_name: p.contact_name,
    status: p.status,
    confidence_level: p.confidence_level,
    confidence_reason: p.confidence_reason,
    confidence_locked: Boolean(p.confidence_locked),
    next_action_at: p.next_action_at,
    next_action_kind: p.next_action_kind,
    plus_rien: plusRien(p),
    last_kind: lastActions.get(p.id)?.last_kind ?? null,
    last_at: lastActions.get(p.id)?.last_at ?? null,
    last_outcome: lastActions.get(p.id)?.last_outcome ?? null,
    last_text: lastActions.get(p.id)?.last_text ?? null,
    last_no_answer_streak: lastActions.get(p.id)?.last_no_answer_streak ?? null,
    modifiable: aMoi(p.owner_id),
  }));

  // La liste mêle-t-elle plusieurs responsables ? Alors chaque carte nomme le
  // sien (avatar) — sinon c'est du bruit.
  const plusieurs = new Set(prospects.map((p) => p.owner_id)).size > 1;
  const lignes: LigneListe[] = prospects.map((p) => {
    const a = lastActions.get(p.id);
    return {
      id: p.id,
      company_name: p.company_name,
      contact_name: p.contact_name,
      email: p.email,
      phone: p.phone,
      city: p.city,
      status: p.status,
      confidence_level: p.confidence_level,
      confidence_reason: p.confidence_reason,
      confidence_locked: Boolean(p.confidence_locked),
      next_action_at: p.next_action_at,
      next_action_kind: p.next_action_kind,
      plus_rien: plusRien(p),
      etoilee: Boolean(p.starred_at),
      // « Ce qu'on sait » : borné, la fiche porte le texte entier.
      note: p.notes?.trim() ? p.notes.trim().slice(0, 600) : null,
      modifiable: aMoi(p.owner_id),
      responsable: plusieurs ? (p.crm_users?.full_name ?? p.crm_users?.email ?? null) : null,
      janet: appeleesParJanet.has(p.id),
      last_kind: a?.last_kind ?? null,
      last_at: a?.last_at ?? null,
      last_outcome: a?.last_outcome ?? null,
      last_text: a?.last_text ?? null,
      last_no_answer_streak: a?.last_no_answer_streak ?? null,
      dernier_mail: filtreEmails ? (a?.last_email_sent_at ?? null) : null,
    };
  });

  /** URL de la page en conservant recherche, étape, tri, vue, filtre — et
   *  périmètre (la règle vit dans lib/crm/filtresProspects.ts). */
  const makeHref = (over: {
    vue?: "liste" | "colonnes" | null;
    filtre?: "emails" | "a_debriefer" | null;
  }) => hrefProspects(params, over);

  // ---- Téléphone : la feuille « Filtres » reçoit des liens tout faits.
  const proprietes = {
    role: session?.me?.role ?? "commercial",
    viewerId: viewer.userId,
    perimetre,
    membres: membresProposables(membres, viewer),
    peutElargir: peutElargir(viewer),
    basePath: "/prospects",
    searchParams: params,
  };
  const libellesEtapes = Object.fromEntries(STATUS_ORDER.map((st) => [st, STATUS_LABEL[st]]));
  const actifs = filtresActifs(params, libellesEtapes);
  const lienFiltre = (over: Parameters<typeof hrefProspects>[1], label: string, actif: boolean) => ({
    href: hrefProspects(params, over),
    label,
    actif,
  });
  const etapesLiens = [
    lienFiltre({ statut: null }, "Toutes", !statut || statut === "tous"),
    ...STATUS_ORDER.map((st) => lienFiltre({ statut: st }, STATUS_LABEL[st], statut === st)),
  ];
  // Le pipeline d'équipe (les colonnes) : un lien discret, pour qui voit
  // plusieurs portefeuilles — l'URL reste ouverte à tous.
  const lienPipeline = peutElargir(viewer);

  return (
    <>
      <PageHeader
        title="Prospects"
        subtitle={`${prospects.length} fiche${prospects.length > 1 ? "s" : ""}`}
        compactMobile
        action={
          <div className="flex flex-wrap gap-2">
            <Link href="/prospects/ma-liste" className="btn-ghost">
              Coller ma liste
            </Link>
            <Link href="/prospects/import" className="btn-ghost">
              Importer un CSV
            </Link>
            <Link href="/prospects/nouveau" className="btn-primary">
              + Nouveau prospect
            </Link>
          </div>
        }
      />

      {/* Téléphone : la recherche, et UNE puce « Filtres » pour tout le reste ;
          les filtres posés restent visibles, chacun retirable d'un tap. */}
      <div className="mb-3 space-y-2 lg:hidden">
        <div className="flex items-center gap-2">
          <FiltresProspects
            q={q ?? ""}
            statut={statut ?? "tous"}
            tri={tri ?? ""}
            etapes={[]}
            avecTri={false}
            seulementRecherche
          />
          <FeuilleFiltres
            nbActifs={actifs.filter((f) => f.cle !== "q").length}
            vues={
              view === "colonnes" || lienPipeline
                ? [
                    lienFiltre({ vue: null }, "Liste", view === "liste"),
                    lienFiltre({ vue: "colonnes" }, "Pipeline", view === "colonnes"),
                  ]
                : []
            }
            perimetre={optionsPerimetre(proprietes)}
            raccourcis={(Object.keys(FILTRES_RAPIDES) as (keyof typeof FILTRES_RAPIDES)[]).map((f) =>
              lienFiltre({ filtre: filtre === f ? null : f }, FILTRES_RAPIDES[f], filtre === f)
            )}
            etapes={etapesLiens}
            tris={
              view === "liste"
                ? (Object.keys(TRIS) as (keyof typeof TRIS)[]).map((t) =>
                    lienFiltre({ tri: t === "priorite" ? null : t }, TRIS[t], (sort ?? "priorite") === t)
                  )
                : null
            }
          />
          <Link
            href="/prospects/ma-liste"
            aria-label="Coller ma liste"
            className="btn-ghost min-h-[44px] shrink-0 px-3 text-sm"
          >
            Coller
          </Link>
        </div>
        {actifs.some((f) => f.cle !== "q") && (
          <ul className="flex flex-wrap gap-1.5" aria-label="Filtres actifs">
            {actifs
              .filter((f) => f.cle !== "q")
              .map((f) => (
                <li key={f.cle}>
                  <Link
                    href={f.retirer}
                    prefetch={false}
                    aria-label={`Retirer le filtre ${f.label}`}
                    className="inline-flex min-h-[44px] items-center gap-1.5 rounded-full bg-celya-blue/10 px-3 text-xs text-blue-100 ring-1 ring-celya-blue/30"
                  >
                    {f.label}
                    <Icone nom="croix" className="h-3 w-3" />
                  </Link>
                </li>
              ))}
          </ul>
        )}
        <p className="text-xs text-slate-500">
          {prospects.length} fiche{prospects.length > 1 ? "s" : ""}
        </p>
      </div>

      <div className="mb-3 hidden flex-wrap items-end gap-3 lg:flex">
        {/* Le périmètre — admin seulement (le composant ne rend rien sinon). */}
        <PerimetreSwitcher
          puceMobile={false}
          role={session?.me?.role ?? "commercial"}
          viewerId={viewer.userId}
          perimetre={perimetre}
          membres={membresProposables(membres, viewer)}
          peutElargir={peutElargir(viewer)}
          basePath="/prospects"
          searchParams={params}
        />

        {/* Emails envoyés : retrouver d'un coup les fiches déjà démarchées
            par mail, avec la date du dernier envoi. */}
        <Link
          href={makeHref({ filtre: filtreEmails ? null : "emails" })}
          aria-pressed={filtreEmails}
          title="Ne montrer que les prospects à qui un mail a été envoyé"
          className={`inline-flex items-center gap-1.5 rounded-xl px-3.5 py-2 text-xs font-medium ring-1 transition ${
            filtreEmails
              ? "bg-celya-blue/15 text-blue-200 ring-celya-blue/40"
              : "bg-white/[0.03] text-slate-400 ring-white/10 hover:text-slate-200"
          }`}
        >
          <Icone nom="enveloppe" className="h-3.5 w-3.5" />
          Emails envoyés
        </Link>

        {/* À débriefer : les fiches dont un rendez-vous attend son issue —
            le même ensemble que la zone en tête de « À faire ». */}
        <Link
          href={makeHref({ filtre: filtreDebrief ? null : "a_debriefer" })}
          aria-pressed={filtreDebrief}
          title="Ne montrer que les fiches dont un rendez-vous passé attend son débrief"
          className={`inline-flex items-center gap-1.5 rounded-xl px-3.5 py-2 text-xs font-medium ring-1 transition ${
            filtreDebrief
              ? "bg-amber-500/15 text-amber-200 ring-amber-400/40"
              : "bg-white/[0.03] text-slate-400 ring-white/10 hover:text-slate-200"
          }`}
        >
          <Icone nom="calendrier" className="h-3.5 w-3.5" />
          À débriefer
        </Link>

        {/* Recherche et tri : à la frappe. L'étape a ses puces, juste dessous. */}
        <FiltresProspects
          q={q ?? ""}
          statut={statut ?? "tous"}
          tri={tri ?? ""}
          etapes={[]}
          avecTri={view === "liste"}
        />

        {lienPipeline && (
          <Link
            href={makeHref({ vue: view === "colonnes" ? null : "colonnes" })}
            className="btn-link ml-auto text-xs"
          >
            {view === "colonnes" ? "← Revenir à la liste" : "Pipeline d'équipe (colonnes) →"}
          </Link>
        )}
      </div>

      {/* L'étape — une PUCE de filtre, à la place de l'ancienne bascule. Sur
          téléphone, la rangée défile d'elle-même (jamais la page). */}
      {view === "liste" && (
        <nav aria-label="Étape" className="-mx-4 mb-4 overflow-x-auto px-4 lg:mx-0 lg:px-0">
          <ul className="flex w-max gap-1.5 lg:w-auto lg:flex-wrap">
            {etapesLiens.map((l, i) => (
              <li key={l.href + l.label}>
                <Link
                  href={l.href}
                  prefetch={false}
                  aria-current={l.actif ? "true" : undefined}
                  className={`inline-flex min-h-[44px] items-center rounded-full px-3.5 text-xs font-medium ring-1 transition lg:min-h-[36px] ${
                    l.actif
                      ? i === 0
                        ? "bg-white/[0.09] text-slate-50 ring-white/20"
                        : STATUS_CHIP[STATUS_ORDER[i - 1]]
                      : "bg-white/[0.02] text-slate-400 ring-white/10 hover:text-slate-200"
                  }`}
                >
                  {l.label}
                </Link>
              </li>
            ))}
          </ul>
        </nav>
      )}

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
              : filtreDebrief
                ? "Aucun rendez-vous à débriefer"
                : q || statut
                ? "Aucun résultat"
                : "Aucun prospect pour l'instant"
          }
          hint={
            filtreEmails
              ? "Aucun mail n'est encore parti vers ces prospects — le filtre ne montre que les fiches déjà démarchées par email."
              : filtreDebrief
                ? "Aucun rendez-vous passé n'attend son issue dans ce périmètre."
                : q || statut
                ? "Essayez d'élargir la recherche ou de retirer le filtre d'étape."
                : "Collez votre liste (« Coller ma liste »), importez un CSV, ou créez une première fiche."
          }
          href="/prospects/ma-liste"
          cta="Coller ma liste"
        />
      ) : view === "colonnes" ? (
        <PipelineBoard prospects={boardProspects} janetIds={janetIds} />
      ) : (
        <ListeProspects
          lignes={lignes}
          admin={viewer.isAdmin}
          membres={
            viewer.isAdmin
              ? membres.map((m) => [m.id, m.full_name ?? m.email] as [string, string])
              : []
          }
          filtreEmails={filtreEmails}
        />
      )}
    </>
  );
}
