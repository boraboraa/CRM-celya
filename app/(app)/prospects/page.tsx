import { cookies } from "next/headers";
import { createClient } from "@/lib/supabase/server";
import { getSession, getPerimetreViewer, perimetreMemorise } from "@/lib/auth";
import { type LigneListe } from "@/components/ListeProspects";
import { optionsPerimetre } from "@/components/PerimetreSwitcher";
import { AffichageProspects } from "@/components/AffichageProspects";
import { lireVue, VUE_COOKIE } from "@/lib/crm/filtresProspects";
import { ETAPES_MASQUEES, masquerPerdues } from "@/lib/crm/perdues";
import { filtreRecherche } from "@/lib/crm/recherche";
import { type BoardProspect } from "@/components/PipelineBoard";
import { STATUS_ORDER, normalizeStatus } from "@/lib/constants";
import { ordonnerProspects } from "@/lib/crm/ordreProspects";
import { lireFiltreRegion } from "@/lib/crm/regions";
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
  region?: string;
};

/**
 * Les prospects (27/10, au soir) : DEUX affichages des mêmes fiches — la
 * LISTE (une ligne par fiche, ordre « Priorité » : étoilées, en retard,
 * aujourd'hui, à venir, jamais appelées, rien de prévu — lib/crm/
 * ordreProspects.ts) et le PIPELINE (`?vue=colonnes`, les colonnes par étape).
 * Le sélecteur est visible par tous ; le dernier choix est retenu (cookie
 * `celya_vue`, relu par `lireVue`). L'affichage vit dans AffichageProspects :
 * cette page ne fait que lire.
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
  const view = lireVue(vue, (await cookies()).get(VUE_COOKIE)?.value ?? null);
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
  const sort = tri && ["relance", "recent", "nom", "commune"].includes(tri) ? tri : "priorite";
  // La région (034) : une région, un groupe (« Tout Bruxelles »), ou
  // « Région inconnue » — poussée en SQL, comme l'étape.
  const filtreRegion = lireFiltreRegion(params.region);

  // `starred_at` (031) : nommée seulement si la base la connaît — voir
  // lib/crm/tolerance.ts. La requête est donc FABRIQUÉE, pas construite une fois.
  const fabriquer = (avecEtoile: boolean) => {
  const colonnes: string = `id, company_name, contact_name, email, phone, city, region, status, notes, ${avecEtoile ? "starred_at, " : ""}confidence_level, confidence_reason, confidence_locked, next_action_at, next_action_kind, last_contact_at, owner_id, crm_users!prospects_owner_id_fkey(full_name, email)`;
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
  } else if (view === "liste" && masquerPerdues(statut)) {
    // Les perdues ne s'affichent plus par défaut dans la liste (29/10,
    // lib/crm/perdues.ts) — « Perdu » ou « Toutes, perdues comprises » les
    // rendent. Le pipeline les garde dans sa colonne repliée.
    query = query.not("status", "in", `(${ETAPES_MASQUEES.join(",")})`);
  }
  if (filtreRegion?.type === "aucune") query = query.is("region", null);
  else if (filtreRegion) query = query.in("region", filtreRegion.regions);

  if (sort === "relance" || sort === "priorite") {
    query = query.order("next_action_at", { ascending: true, nullsFirst: false });
  } else if (sort === "nom") {
    query = query.order("company_name", { ascending: true });
  } else if (sort === "commune") {
    // Par commune, puis par nom : un quartier se démarche d'un coup. Les
    // fiches sans commune à la fin.
    query = query
      .order("city", { ascending: true, nullsFirst: false })
      .order("company_name", { ascending: true });
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
    region: string | null;
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
    const jour = todayBounds();
    prospects = ordonnerProspects(prospects, new Date(jour.end).getTime(), new Date(jour.start).getTime());
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
    city: p.city,
    region: p.region,
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
      region: p.region,
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

  const qui = optionsPerimetre({
    role: session?.me?.role ?? "commercial",
    viewerId: viewer.userId,
    perimetre,
    membres: membresProposables(membres, viewer),
    peutElargir: peutElargir(viewer),
    basePath: "/prospects",
    searchParams: params,
  });

  return (
    <AffichageProspects
      params={params}
      vue={view}
      lignes={lignes}
      board={boardProspects}
      janetIds={janetIds}
      erreur={error?.message ?? null}
      qui={qui}
      admin={viewer.isAdmin}
      membresAttribution={
        viewer.isAdmin ? membres.map((m) => [m.id, m.full_name ?? m.email] as [string, string]) : []
      }
      tri={sort}
    />
  );
}
