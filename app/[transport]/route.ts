/**
 * Serveur MCP « Celya CRM » — connecteur personnalisé de Claude.
 *
 * Périmètre STRICTEMENT limité au CRM : ces outils ne touchent QUE les tables
 * prospects, activities, tasks, emails et meetings (l'agenda). Aucune exécution
 * SQL libre, aucun accès aux tables comptables du même projet Supabase. C'est
 * la raison d'être de ce connecteur face au connecteur Supabase brut.
 *
 * Chaque outil est une enveloppe fine au-dessus du cœur partagé (lib/crm) : un
 * prospect créé ici est indiscernable d'un prospect créé à la main (même dédup,
 * même normalisation « +32 », même cadence de relance).
 *
 * Le serveur agit en service_role (RLS contournée) : c'est donc lui qui impose
 * la cloison, et non Postgres. Depuis l'arrivée du premier commercial
 * (25 août), le jeton n'est plus réservé à l'admin — chaque membre actif a le
 * sien. Deux conséquences, tenues par `lib/crm/access.ts` :
 *
 *   · tout outil qui LIT passe par `scopeProspects` / `canSeeProspect` : un
 *     `lister_prospects` lancé par un commercial ne renvoie que ses fiches ;
 *   · tout outil qui ÉCRIT rattache au porteur du jeton (author_id /
 *     created_by / owner_id = sujet du jeton), jamais à une identité fournie
 *     par le client — aucun outil n'expose de paramètre « utilisateur ».
 *
 * Depuis l'interrupteur « travaille en équipe » (migration 020), VOIR et
 * ÉCRIRE ne sont plus la même question : un porteur voit les fiches de son
 * binôme et n'en modifie aucune. Les six outils qui écrivent appellent donc
 * `refusSiPasProprietaire` EN PLUS de `resolveProspect` — s'en tenir à la
 * visibilité rendrait l'assistant plus puissant que l'écran, exactement là où
 * la RLS n'est pas là pour rattraper l'oubli.
 *
 * L'ENCADREMENT (migration 021) élargit encore ce que « VOIR » recouvre — un
 * encadrant lit les fiches, le journal, les relances et l'agenda de ses
 * étudiants — et ne touche à « ÉCRIRE » en rien. Aucun outil n'a eu besoin
 * d'être réécrit pour ça, et ce n'est pas un hasard : la règle est entrée par
 * `Viewer.visiblesIds`, que `scopeProspects`, `scopeJoinedProspects` et le `in`
 * de l'outil `agenda` consultent déjà. La seule chose à ne jamais faire est de
 * brancher une ÉCRITURE sur `visiblesIds` ou sur `canSeeProspect` : c'est
 * `canEditProspect` qui répond à cette question, et il ignore délibérément et
 * l'équipe et l'encadrement.
 *
 * ⚠ Le corollaire du 19/09 vaut toujours, et il vaut DOUBLE ici : un outil qui
 * ne part pas de `prospects` n'est borné par RIEN. `agenda` porte son propre
 * `in`. Tout nouvel outil qui lit une table par un autre chemin doit porter le
 * sien, explicitement.
 */

import { createMcpHandler, withMcpAuth } from "mcp-handler";
import type { AuthInfo } from "@modelcontextprotocol/sdk/server/auth/types.js";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { createAdminClient } from "@/lib/supabase/admin";
import {
  loadViewer,
  canSeeProspect,
  canEditProspect,
  relanceEnLecture,
  scopeProspects,
  scopeJoinedProspects,
  NOT_EDITABLE,
  type Viewer,
} from "@/lib/crm/access";
import {
  filtrerProspects,
  filtrerTaches,
  peutElargir,
  type Perimetre,
} from "@/lib/crm/perimetre";
import { verifyJwt } from "@/lib/mcp/jwt";
import { SCOPE } from "@/lib/mcp/oauth";
import { SUPABASE_URL } from "@/lib/env";
import { createProspectCore, importProspectsCore } from "@/lib/crm/prospects";
import { saveExchangeCore } from "@/lib/crm/exchange";
import {
  poserRendezVous,
  deplacerRendezVous,
  cloturerRendezVous,
  MEETING_STATUS_LABEL,
  type MeetingStatus,
} from "@/lib/crm/agenda";
import {
  manualStatusPatch,
  applyAutoStatus,
  readProspectFacts,
} from "@/lib/crm/status";
import { recalcConfidence } from "@/lib/crm/confidence";
import { applyEmailSentCadence } from "@/lib/crm/emailCadence";
import {
  hasPlaceholder,
  isEmailAddress,
  MAX_BODY,
  MAX_SUBJECT,
  PLACEHOLDER,
} from "@/lib/crm/email";
import {
  STATUS_LABEL,
  ACTIVITY_LABEL,
  STATUS_ORDER,
  fmtDate,
  fmtDateTime,
} from "@/lib/constants";
import { todayBounds, localInputToISO, isoToLocalInput, dateInputToISO } from "@/lib/time";
import { lireProchaineAction, phraseAnnulees } from "@/lib/crm/prochaineAction";
import type { ProspectStatus } from "@/lib/types";
import type { SupabaseClient } from "@supabase/supabase-js";

export const runtime = "nodejs";
export const maxDuration = 60;

// ---------------------------------------------------------------------------
// Utilitaires de réponse.
// ---------------------------------------------------------------------------

type ToolResult = { content: { type: "text"; text: string }[]; isError?: boolean };

const text = (t: string): ToolResult => ({ content: [{ type: "text", text: t }] });
const fail = (t: string): ToolResult => ({ content: [{ type: "text", text: t }], isError: true });
const json = (label: string, data: unknown): ToolResult =>
  text(`${label}\n\n\`\`\`json\n${JSON.stringify(data, null, 2)}\n\`\`\``);

/**
 * Le contexte d'un appel : le client service_role, et QUI agit.
 *
 * Le serveur agit en service_role, donc la RLS ne le protège de rien : c'est
 * `viewer` qui porte la cloison, et chaque outil doit s'y référer. Le compte
 * est relu dans `crm_users` à chaque appel — désactiver un commercial dans
 * /equipe le coupe immédiatement, sans attendre l'expiration de son jeton.
 */
async function context(extra: {
  authInfo?: AuthInfo;
}): Promise<{ admin: SupabaseClient; viewer: Viewer } | { error: string }> {
  const id = extra.authInfo?.extra?.userId;
  if (typeof id !== "string" || !id) return { error: "Non authentifié." };
  const admin = createAdminClient();
  const viewer = await loadViewer(admin, id);
  if (!viewer) {
    return {
      error:
        "Compte inconnu ou désactivé — ce connecteur n'a plus accès au CRM. Contactez l'administrateur.",
    };
  }
  return { admin, viewer };
}

const STATUS_ENUM = STATUS_ORDER as [string, ...string[]];

/**
 * Le périmètre d'affichage (lib/crm/perimetre.ts), version connecteur : « moi »
 * par défaut, « equipe » réservé à l'admin et aux PORTEURS de l'interrupteur
 * d'équipe (migration 020) — tout autre appelant est FORCÉ à « moi », quoi que
 * demande le client.
 *
 * C'est du confort par-dessus la sécurité, et ici la nuance est vitale : le
 * mode « equipe » ne filtre RIEN. Sur une page, la RLS borne quand même le
 * résultat ; ici il n'y a pas de RLS, donc `scopeProspects` (la cloison) doit
 * s'appliquer AVANT, sans exception. L'outil `agenda`, qui ne part pas de
 * `prospects`, porte son propre `in` pour la même raison.
 */
/**
 * La prochaine action et ce qu'elle désigne (migrations 022 et 023) — pour
 * que Claude ne dise jamais « en retard » d'une fiche qui attend son
 * rendez-vous, ni ne propose d'appeler un prospect qu'on voit dans trois
 * jours, ni ne réclame le débrief d'une fiche gagnée ou perdue (une fiche
 * close ne réclame jamais rien : `statut` est requis pour le savoir).
 */
function prochaineActionPourClaude(at: unknown, kind: unknown, statut: unknown) {
  const l = lireProchaineAction(
    at as string | null,
    kind as string | null,
    Date.now(),
    statut as string | null
  );
  return {
    prochaine_action: l.rien ? null : ((at as string | null) ?? null),
    prochaine_action_type: l.rien
      ? null
      : l.estRdv
        ? l.aDebriefer
          ? "rendez-vous passé, à débriefer"
          : "rendez-vous"
        : "relance",
    prochaine_action_en_retard: l.retard,
  };
}

function perimetreDe(
  viewer: Viewer,
  demande: "moi" | "equipe" | undefined
): Perimetre {
  return demande === "equipe" && peutElargir(viewer)
    ? { mode: "equipe" }
    : { mode: "moi" };
}

/**
 * Le droit d'ÉCRIRE sur une fiche, pour les six outils qui écrivent.
 *
 * `resolveProspect` ne répond qu'à « puis-je la VOIR ». Depuis l'interrupteur
 * d'équipe (migration 020), les deux questions ont des réponses différentes :
 * un porteur voit les fiches de son binôme et n'en modifie aucune. Côté
 * interface, les policies rebasées sur `owner_id` refuseraient de toute façon ;
 * ici le serveur agit en `service_role`, RLS contournée — ce test EST le seul
 * garde-fou.
 *
 * Le refus NOMME le propriétaire, contrairement à celui d'une fiche invisible :
 * la fiche est sous les yeux de l'appelant, il n'y a rien à cacher, et savoir à
 * qui elle est, c'est justement ce que l'interrupteur apporte.
 */
async function refusSiPasProprietaire(
  admin: SupabaseClient,
  viewer: Viewer,
  resolved: ResolvedProspect
): Promise<string | null> {
  if (canEditProspect(viewer, resolved.owner_id)) return null;
  const { data } = await admin
    .from("crm_users")
    .select("full_name, email")
    .eq("id", resolved.owner_id ?? "")
    .maybeSingle();
  const proprio =
    ((data?.full_name as string | null) ?? null) ||
    ((data?.email as string | null) ?? null);
  return NOT_EDITABLE(proprio);
}

/** Nettoie une recherche texte avant de la passer à un filtre PostgREST or(). */
const safeSearch = (s: string) => s.replace(/[%,()*\\]/g, " ").trim().slice(0, 80);

/**
 * Diagnostique un début de rendez-vous fourni par le modèle. La règle du
 * 31/08 : si le JOUR ou l'HEURE manque, on REFUSE en le disant — on ne
 * complète JAMAIS en silence, et on ne pose JAMAIS une relance générique à
 * la place (c'est ainsi qu'un rendez-vous a été perdu).
 */
function litDateRendezVous(brut: string): { ok?: string; error?: string } {
  const v = (brut ?? "").trim();
  if (/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(v)) return { ok: v };
  if (/^\d{4}-\d{2}-\d{2}$/.test(v)) {
    return {
      error:
        "Il manque l'heure. Un rendez-vous n'est jamais « toute la journée » — demandez l'heure à l'utilisateur, puis repassez « YYYY-MM-DDTHH:mm ».",
    };
  }
  if (/^\d{1,2}\s*[:hH]\s*\d{0,2}$/.test(v)) {
    return {
      error:
        "Il manque le jour. Demandez le jour à l'utilisateur, puis repassez « YYYY-MM-DDTHH:mm ». Ne posez pas de relance à la place.",
    };
  }
  return {
    error: "Date invalide — attendu « YYYY-MM-DDTHH:mm » (heure de Bruxelles).",
  };
}

type ResolvedProspect = {
  id: string;
  company_name: string;
  status: string;
  owner_id: string | null;
};

/**
 * Résout un prospect par identifiant OU par nom, DANS LE PORTEFEUILLE DE
 * L'APPELANT. Renvoie une erreur lisible si rien ne correspond, et la liste
 * des candidats si le nom est ambigu.
 *
 * Une fiche hors portefeuille se comporte comme une fiche inexistante : c'est
 * `resolveProspect` qui tient la cloison pour les huit outils qui ciblent un
 * prospect, et la recherche par nom est bornée en base (`scopeProspects`) et
 * non après coup — sans quoi le `limit(10)` pourrait renvoyer dix fiches de
 * Bora et faire croire à une ambiguïté, en nommant ses sociétés au passage.
 */
async function resolveProspect(
  admin: SupabaseClient,
  viewer: Viewer,
  args: { id?: string; nom?: string }
): Promise<ResolvedProspect | { error: string }> {
  const COLS = "id, company_name, status, owner_id";

  if (args.id) {
    const { data } = await admin
      .from("prospects")
      .select(COLS)
      .eq("id", args.id)
      .maybeSingle();
    // Introuvable et non visible donnent le même message : ne pas révéler
    // l'existence d'une fiche qu'on n'a pas le droit de voir.
    if (!data || !canSeeProspect(viewer, (data.owner_id as string | null) ?? null)) {
      return { error: `Aucun prospect avec l'identifiant ${args.id}.` };
    }
    return data as ResolvedProspect;
  }

  const nom = args.nom?.trim();
  if (!nom) return { error: "Fournissez « id » ou « nom »." };

  const { data } = await scopeProspects(
    admin.from("prospects").select(COLS).ilike("company_name", `%${safeSearch(nom)}%`),
    viewer
  ).limit(10);

  const rows = ((data ?? []) as ResolvedProspect[]).filter((r) =>
    canSeeProspect(viewer, r.owner_id)
  );
  if (rows.length === 0) return { error: `Aucun prospect au nom « ${nom} ».` };
  if (rows.length > 1) {
    const liste = rows.map((r) => `- ${r.company_name} (id ${r.id})`).join("\n");
    return { error: `Plusieurs prospects correspondent à « ${nom} ». Précisez par identifiant :\n${liste}` };
  }
  return rows[0];
}

/**
 * Envoi réel d'un email — délégué à l'edge function crm-mail, jamais réécrit
 * ici. Elle seule connaît le mot de passe d'application (Vault), et elle seule
 * écrit la ligne `emails` + l'activité `type='email'` : dupliquer nodemailer
 * côté Next donnerait deux chemins d'envoi à tenir en phase.
 *
 * Le jeton du connecteur est un JWT HS256 maison, que Supabase Auth ne sait
 * pas vérifier : l'authentification passe donc par le secret partagé du Vault
 * (`x-internal-secret`, migration 013). Il authentifie l'appelant, il ne
 * l'autorise à rien : crm-mail relit le rôle de `user_id` dans crm_users et
 * réapplique la règle de `can_see_prospect`.
 */
async function sendViaMailFunction(
  admin: SupabaseClient,
  payload: {
    prospectId: string;
    to: string;
    subject: string;
    body: string;
    userId: string;
  }
): Promise<{ ok: true } | { error: string }> {
  const { data: secret } = await admin.rpc("mail_get_secret", {
    p_name: "crm_mail_internal_secret",
  });
  if (typeof secret !== "string" || !secret) {
    return {
      error:
        "Secret d'envoi interne absent — appliquez la migration 013_envoi_interne.sql.",
    };
  }

  let res: Response;
  try {
    res = await fetch(`${SUPABASE_URL}/functions/v1/crm-mail`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-internal-secret": secret,
      },
      body: JSON.stringify({
        action: "send",
        prospect_id: payload.prospectId,
        to: payload.to,
        subject: payload.subject,
        body: payload.body,
        user_id: payload.userId,
      }),
      cache: "no-store",
    });
  } catch (e) {
    return { error: e instanceof Error ? e.message : "Envoi impossible." };
  }

  let corps: Record<string, unknown> = {};
  try {
    corps = await res.json();
  } catch {
    /* réponse non JSON */
  }
  if (!res.ok) {
    return { error: (corps.error as string) ?? `Erreur ${res.status}` };
  }
  return { ok: true };
}

// ---------------------------------------------------------------------------
// Enregistrement des outils.
// ---------------------------------------------------------------------------

function register(server: McpServer) {
  // --- lister_prospects -----------------------------------------------------
  server.tool(
    "lister_prospects",
    "Liste les prospects du CRM avec un retour compact (nom, contact, téléphone, étape, prochaine action). Par DÉFAUT, seules les fiches de l'appelant (périmètre « moi ») ; un administrateur, ou un commercial qui « travaille en équipe », peut passer perimetre: « equipe ». Filtres : par étape, par « à relancer » (relances en retard ou du jour), et par recherche texte (société, contact, email, téléphone).",
    {
      statut: z.enum(STATUS_ENUM).optional().describe("Filtrer sur une étape précise."),
      a_relancer: z
        .boolean()
        .optional()
        .describe(
          "Ne garder que les prospects dont la prochaine action échoit aujourd'hui ou est en retard. Une fiche dont la prochaine action est un RENDEZ-VOUS passé y figure aussi : elle n'est pas « en retard », elle attend son débrief (champ « prochaine_action_type »). Jamais une fiche gagnée ou perdue pour un débrief : une fiche close ne réclame rien — seules ses relances et ses rendez-vous à venir comptent."
        ),
      recherche: z.string().optional().describe("Texte recherché dans société, contact, email ou téléphone."),
      limite: z.number().int().min(1).max(200).optional().describe("Nombre maximum de fiches (défaut 50)."),
      perimetre: z
        .enum(["moi", "equipe"])
        .optional()
        .describe(
          "Défaut « moi » : uniquement les fiches de l'appelant. « equipe » élargit à l'équipe — administrateur, ou commercial qui « travaille en équipe » ; sans effet pour les autres."
        ),
    },
    async (args, extra) => {
      const ctx = await context(extra);
      if ("error" in ctx) return fail(ctx.error);
      const { admin, viewer } = ctx;

      // Le filtre de portefeuille est posé AVANT le limit : sinon les 50
      // premières lignes pourraient être celles d'un autre, et la liste
      // reviendrait vide alors que l'appelant a des fiches. Le périmètre
      // (confort) se pose APRÈS la cloison (sécurité), jamais à sa place.
      let q = filtrerProspects(
        scopeProspects(
          admin
            .from("prospects")
            .select(
              "id, company_name, contact_name, phone, email, status, next_action_at, next_action_kind, owner_id"
            ),
          viewer
        ),
        perimetreDe(viewer, args.perimetre),
        viewer
      )
        .order("next_action_at", { ascending: true, nullsFirst: false })
        .limit(args.limite ?? 50);

      if (args.statut) q = q.eq("status", args.statut);
      if (args.a_relancer) {
        const { end } = todayBounds();
        q = q.not("next_action_at", "is", null).lte("next_action_at", end);
      }
      if (args.recherche) {
        const t = safeSearch(args.recherche);
        if (t)
          q = q.or(
            `company_name.ilike.%${t}%,contact_name.ilike.%${t}%,email.ilike.%${t}%,phone.ilike.%${t}%`
          );
      }

      const { data, error } = await q;
      if (error) return fail(`Erreur : ${error.message}`);
      const rows = (data ?? [])
        // Dernier verrou, après le filtre de requête : une fiche hors
        // portefeuille ne sort pas d'ici, quoi qu'il arrive en amont.
        .filter((r) => canSeeProspect(viewer, (r.owner_id as string | null) ?? null))
        .map((r) => ({
          id: r.id,
          societe: r.company_name,
          contact: r.contact_name,
          telephone: r.phone,
          etape: STATUS_LABEL[r.status as keyof typeof STATUS_LABEL] ?? r.status,
          ...prochaineActionPourClaude(r.next_action_at, r.next_action_kind, r.status),
        }))
        // « À relancer » : une fiche close dont le RDV vient de commencer n'a
        // plus rien à faire, même si la tâche horaire (023) ne l'a pas encore
        // recalculée.
        .filter((r) => !args.a_relancer || r.prochaine_action !== null);
      return json(`${rows.length} prospect(s).`, rows);
    }
  );

  // --- obtenir_prospect -----------------------------------------------------
  server.tool(
    "obtenir_prospect",
    "Récupère la fiche complète d'un prospect (par identifiant ou par nom) avec son journal d'activités et ses relances ouvertes.",
    {
      id: z.string().optional().describe("Identifiant du prospect."),
      nom: z.string().optional().describe("Nom de société (utilisé si l'identifiant n'est pas fourni)."),
    },
    async (args, extra) => {
      const ctx = await context(extra);
      if ("error" in ctx) return fail(ctx.error);
      const { admin, viewer } = ctx;
      const resolved = await resolveProspect(admin, viewer, args);
      if ("error" in resolved) return fail(resolved.error);

      const [fiche, activites, taches, rdvs] = await Promise.all([
        admin.from("prospects").select("*").eq("id", resolved.id).single(),
        admin
          .from("activities")
          .select("type, subject, body, occurred_at")
          .eq("prospect_id", resolved.id)
          .order("occurred_at", { ascending: false })
          .limit(20),
        admin
          .from("tasks")
          .select("id, title, due_at, priority, status")
          .eq("prospect_id", resolved.id)
          .eq("status", "a_faire")
          .order("due_at", { ascending: true }),
        admin
          .from("meetings_visibles")
          .select("id, title, starts_at, ends_at, location, status")
          .eq("prospect_id", resolved.id)
          .order("starts_at", { ascending: false })
          .limit(5),
      ]);

      if (fiche.error) return fail(`Erreur : ${fiche.error.message}`);
      const p = fiche.data;
      return json("Fiche prospect.", {
        id: p.id,
        societe: p.company_name,
        contact: p.contact_name,
        telephone: p.phone,
        email: p.email,
        site: p.website,
        secteur: p.sector,
        adresse: p.address,
        ville: p.city,
        etape: STATUS_LABEL[p.status as keyof typeof STATUS_LABEL] ?? p.status,
        source: p.source,
        valeur_estimee: p.value_estimate,
        probabilite: p.probability,
        valeur_ponderee: p.weighted_value,
        etape_verrouillee: p.status_locked,
        etape_motif_auto: p.status_auto_reason,
        ...prochaineActionPourClaude(p.next_action_at, p.next_action_kind, p.status),
        dernier_contact: p.last_contact_at,
        notes: p.notes,
        journal: (activites.data ?? []).map((a) => ({
          type: ACTIVITY_LABEL[a.type as keyof typeof ACTIVITY_LABEL] ?? a.type,
          resume: a.subject,
          note: a.body,
          date: a.occurred_at,
        })),
        relances: (taches.data ?? []).map((t) => ({
          id: t.id,
          titre: t.title,
          echeance: t.due_at,
          priorite: t.priority,
        })),
        rendez_vous: (rdvs.data ?? []).map((m) => ({
          id: m.id,
          titre: m.title,
          debut: m.starts_at,
          fin: m.ends_at,
          lieu: m.location,
          statut:
            MEETING_STATUS_LABEL[m.status as MeetingStatus] ?? m.status,
        })),
      });
    }
  );

  // --- a_faire --------------------------------------------------------------
  server.tool(
    "a_faire",
    "Liste ce qu'il y a à faire : les relances en retard et celles du jour. Par DÉFAUT, uniquement les relances de l'appelant (périmètre « moi ») ; un administrateur, ou un commercial qui « travaille en équipe », peut passer perimetre: « equipe ». Réutilise la logique de l'écran « À faire » (c'est la date qui décide : une relance datée du 14 octobre ne remonte que le 14 octobre). Poser un rendez-vous clôture les relances qui tombaient avant lui : c'est le débrief du rendez-vous qui décide de la suite.",
    {
      perimetre: z
        .enum(["moi", "equipe"])
        .optional()
        .describe(
          "Défaut « moi » : uniquement les relances de l'appelant. « equipe » élargit à l'équipe — administrateur, ou commercial qui « travaille en équipe » ; sans effet pour les autres."
        ),
    },
    async (args, extra) => {
      const ctx = await context(extra);
      if ("error" in ctx) return fail(ctx.error);
      const { admin, viewer } = ctx;
      const { start, end } = todayBounds();
      const per = perimetreDe(viewer, args.perimetre);
      // `!inner` : la jointure devient filtrante, et `owner_id` remonte pour
      // la vérification en mémoire ci-dessous. La cloison (scopeJoinedProspects)
      // d'abord, le périmètre (assignee_id, comme l'écran « À faire ») ensuite.
      const SELECT =
        "id, title, due_at, priority, prospect_id, assignee_id, prospects!inner(company_name, phone, owner_id)";

      const [overdue, today] = await Promise.all([
        filtrerTaches(
          scopeJoinedProspects(
            admin
              .from("tasks")
              .select(SELECT)
              .eq("status", "a_faire")
              .lt("due_at", start),
            viewer
          ),
          per,
          viewer
        ).order("due_at", { ascending: true }).limit(100),
        filtrerTaches(
          scopeJoinedProspects(
            admin
              .from("tasks")
              .select(SELECT)
              .eq("status", "a_faire")
              .gte("due_at", start)
              .lte("due_at", end),
            viewer
          ),
          per,
          viewer
        ).order("due_at", { ascending: true }).limit(100),
      ]);

      type Row = Record<string, unknown> & {
        assignee_id?: string | null;
        prospects?: { company_name?: string; phone?: string; owner_id?: string | null } | null;
      };
      const visible = (t: Row) =>
        canSeeProspect(viewer, t.prospects?.owner_id ?? null);
      const shape = (t: Row) => ({
        id: t.id,
        titre: t.title,
        echeance: t.due_at,
        societe: t.prospects?.company_name ?? null,
        telephone: t.prospects?.phone ?? null,
        prospect_id: t.prospect_id,
        // À QUI EST CETTE RELANCE — et c'est nécessaire, pas décoratif.
        //
        // En périmètre « equipe », cette liste mélange mes relances et celles
        // des gens que je vois : mon binôme (020), mes étudiants (021). Sans
        // ce drapeau, Claude lit « relance en retard chez Garage X » et propose
        // de la traiter — alors que la cocher déplacerait le « À faire » de
        // quelqu'un d'autre, et que la base refuserait après coup. L'outil
        // `agenda` porte déjà `a_moi` pour exactement la même raison.
        a_moi: !relanceEnLecture(viewer, (t.assignee_id as string | null) ?? null),
      });

      return json("À faire — relances en retard puis du jour.", {
        en_retard: ((overdue.data ?? []) as Row[]).filter(visible).map(shape),
        aujourd_hui: ((today.data ?? []) as Row[]).filter(visible).map(shape),
      });
    }
  );

  // --- creer_prospect -------------------------------------------------------
  server.tool(
    "creer_prospect",
    "Crée un prospect via la même logique que l'interface : détection de doublon (téléphone / email / société), normalisation du téléphone au format belge « +32 », étape « À appeler » par défaut. Si un doublon est détecté, renvoie un avertissement au lieu de créer — passez « forcer: true » pour créer malgré tout.",
    {
      societe: z.string().describe("Nom de la société (obligatoire)."),
      contact: z.string().optional().describe("Nom du contact principal."),
      telephone: z.string().optional().describe("Téléphone (sera normalisé en +32)."),
      email: z.string().optional(),
      site: z.string().optional().describe("Site web."),
      secteur: z.string().optional(),
      adresse: z
        .string()
        .optional()
        .describe(
          "Adresse postale OU lien Google Maps collé — un seul champ, stocké tel quel. N'y mettez JAMAIS le pays : la ville suffit."
        ),
      ville: z.string().optional(),
      statut: z.enum(STATUS_ENUM).optional().describe("Étape (défaut « a_appeler »)."),
      source: z.string().optional(),
      valeur_estimee: z.number().optional().describe("Valeur estimée en euros."),
      probabilite: z
        .number()
        .int()
        .min(0)
        .max(100)
        .optional()
        .describe("Probabilité de conclure, en % (0–100). Laisser vide si inconnue — ne la devinez pas."),
      notes: z.string().optional(),
      forcer: z.boolean().optional().describe("Créer même si un doublon est détecté."),
    },
    async (args, extra) => {
      const ctx = await context(extra);
      if ("error" in ctx) return fail(ctx.error);
      const { admin, viewer } = ctx;

      const result = await createProspectCore(
        admin,
        viewer.userId,
        {
          company_name: args.societe,
          contact_name: args.contact,
          phone: args.telephone,
          email: args.email,
          website: args.site,
          sector: args.secteur,
          address: args.adresse,
          city: args.ville,
          status: args.statut,
          source: args.source,
          value_estimate: args.valeur_estimee,
          probability: args.probabilite,
          notes: args.notes,
          // La fiche appartient au porteur du jeton. Le trigger en base la
          // rattraperait de toute façon, mais mieux vaut que le propriétaire
          // soit posé par l'appelant que par un filet de sécurité.
          owner_id: viewer.userId,
        },
        {
          checkDuplicates: true,
          normalizePhone: true,
          force: args.forcer,
          // Sans ce scope, l'avertissement de doublon nommerait les sociétés
          // des autres — le service_role voit tout.
          scope: viewer,
        }
      );

      if (result.error) return fail(`Erreur : ${result.error}`);
      if (result.duplicates) {
        return json(
          `⚠️ Doublon(s) possible(s) — rien créé. Vérifiez, puis relancez avec « forcer: true » si c'est bien une nouvelle fiche.`,
          result.duplicates.map((d) => ({
            id: d.id,
            societe: d.company_name,
            telephone: d.phone,
            email: d.email,
            raison: d.reason,
          }))
        );
      }

      const { data } = await admin
        .from("prospects")
        .select("id, company_name, phone, status")
        .eq("id", result.id!)
        .single();
      return json("✅ Prospect créé.", {
        id: data?.id,
        societe: data?.company_name,
        telephone: data?.phone,
        etape: STATUS_LABEL[(data?.status ?? "a_appeler") as keyof typeof STATUS_LABEL],
      });
    }
  );

  // --- mettre_a_jour_statut -------------------------------------------------
  server.tool(
    "mettre_a_jour_statut",
    "Change l'étape d'un prospect (par identifiant ou nom). Étapes valides : a_appeler, contacte, rendez_vous, proposition, gagne, perdu. ATTENTION : c'est une décision explicite — elle VERROUILLE l'étape, qui ne sera plus déduite automatiquement des faits (email envoyé, rendez-vous posé). Ne l'utilisez que si l'utilisateur demande vraiment de fixer l'étape ; pour un simple compte rendu, préférez « ajouter_note ». « rendez_vous » est REFUSÉ tant qu'aucun rendez-vous réel (daté) n'est enregistré sur la fiche : posez d'abord le rendez-vous, l'étape suivra toute seule.",
    {
      id: z.string().optional(),
      nom: z.string().optional().describe("Nom de société si l'identifiant n'est pas fourni."),
      statut: z.enum(STATUS_ENUM).describe("Nouvelle étape."),
    },
    async (args, extra) => {
      const ctx = await context(extra);
      if ("error" in ctx) return fail(ctx.error);
      const { admin, viewer } = ctx;
      const resolved = await resolveProspect(admin, viewer, { id: args.id, nom: args.nom });
      if ("error" in resolved) return fail(resolved.error);
      const refus = await refusSiPasProprietaire(admin, viewer, resolved);
      if (refus) return fail(refus);

      // « Rendez-vous » n'est pas une intention, c'est un FAIT : sans
      // rendez-vous enregistré (activité datée ou rendez-vous à venir),
      // l'étape ne se force pas — c'est ainsi qu'un RDV sans date a déjà
      // été perdu. On pose le rendez-vous, l'étape suit toute seule.
      if (args.statut === "rendez_vous") {
        const facts = await readProspectFacts(admin, resolved.id);
        if (!facts.meeting) {
          return fail(
            "Aucun rendez-vous enregistré sur cette fiche. Posez d'abord le rendez-vous, l'étape suivra toute seule."
          );
        }
      }

      const { error } = await admin
        .from("prospects")
        .update(manualStatusPatch(args.statut as ProspectStatus))
        .eq("id", resolved.id);
      if (error) return fail(`Erreur : ${error.message}`);

      // Un changement d'étape est un événement : la confiance se recalcule
      // (jamais bloquant, et jamais par-dessus un niveau fixé à la main).
      await recalcConfidence(admin, resolved.id);

      return text(
        `✅ ${resolved.company_name} : étape passée à « ${STATUS_LABEL[args.statut as keyof typeof STATUS_LABEL]} » et verrouillée (plus de déduction automatique — déverrouillable depuis la fiche).`
      );
    }
  );

  // --- ajouter_note ---------------------------------------------------------
  server.tool(
    "ajouter_note",
    "Ajoute une activité au journal d'un prospect (note, email ou rendez_vous). L'étape s'ajuste ensuite toute seule à partir des FAITS enregistrés — ne forcez pas « statut » sans raison. Si la note mentionne un rendez-vous daté, passez « rdv_le » (et « lieu ») : le rendez-vous est posé dans l'agenda en même temps. Si la note mentionne un rendez-vous dont le JOUR ou l'HEURE manque, POSEZ LA QUESTION à l'utilisateur. Ne posez jamais une relance générique à la place : le rendez-vous serait perdu. Pour une simple relance, utilisez « planifier_relance ». Pour un texte non envoyé (brouillon d'email), passez « brouillon: true » : il sera rangé hors chronologie.",
    {
      id: z.string().optional(),
      nom: z.string().optional(),
      type: z.enum(["note", "email", "rendez_vous"]).describe("Type d'échange versé au journal."),
      note: z.string().describe("Texte de l'échange."),
      resume: z.string().optional().describe("Résumé court (versé en sujet)."),
      contact: z.string().optional().describe("Nom du contact à mettre à jour sur la fiche."),
      rdv_le: z
        .string()
        .optional()
        .describe(
          "Rendez-vous mentionné dans la note : « YYYY-MM-DDTHH:mm » (heure de Bruxelles), jour ET heure OBLIGATOIRES. Le rendez-vous est posé dans l'agenda et la note versée au journal."
        ),
      lieu: z.string().optional().describe("Lieu du rendez-vous (avec « rdv_le »)."),
      echange: z
        .boolean()
        .optional()
        .describe(
          "true UNIQUEMENT si un échange a réellement eu lieu avec le prospect (appel passé, visite). Défaut false : une note de repérage ou de préparation ne fait pas passer la fiche en « Contacté »."
        ),
      brouillon: z
        .boolean()
        .optional()
        .describe(
          "true pour un texte non envoyé (brouillon d'email) : rangé dans « Brouillons », hors chronologie, et ne compte pour aucun fait."
        ),
      proposition_envoyee: z
        .boolean()
        .optional()
        .describe("true si une proposition / un devis vient d'être ENVOYÉ (fait passer en « Proposition »)."),
      statut: z
        .enum(STATUS_ENUM)
        .optional()
        .describe("Étape imposée. VERROUILLE la fiche — à n'utiliser que sur demande explicite."),
      motif: z.string().optional().describe("Raison de la perte (si statut = perdu)."),
    },
    async (args, extra) => {
      const ctx = await context(extra);
      if ("error" in ctx) return fail(ctx.error);
      const { admin, viewer } = ctx;
      const resolved = await resolveProspect(admin, viewer, { id: args.id, nom: args.nom });
      if ("error" in resolved) return fail(resolved.error);
      const refus = await refusSiPasProprietaire(admin, viewer, resolved);
      if (refus) return fail(refus);

      // Un rendez-vous mentionné dans la note : validé strictement (jour ET
      // heure), puis délégué au cœur agenda via saveExchangeCore — la note
      // devient une activité rendez_vous, le créneau part dans meetings.
      let rdvLe: string | null = null;
      if (args.rdv_le) {
        const quand = litDateRendezVous(args.rdv_le);
        if (quand.error) return fail(quand.error);
        rdvLe = quand.ok!;
      }

      const r = await saveExchangeCore(admin, viewer.userId, {
        prospectId: resolved.id,
        type: rdvLe ? "rendez_vous" : args.type,
        note: args.note,
        resume: args.resume,
        contactName: args.contact,
        statut: args.statut as ProspectStatus | undefined,
        motif: args.motif,
        dateLocale: rdvLe,
        rdvLieu: rdvLe ? (args.lieu ?? null) : null,
        // Défaut prudent côté connecteur : sans déclaration explicite, une
        // note écrite par Claude n'atteste pas d'un échange (l'interface, elle,
        // coche la case par défaut — la saisie y est humaine).
        isExchange: args.echange === true,
        isDraft: args.brouillon === true,
        proposalSent: args.proposition_envoyee === true,
      });
      if (r.error) return fail(`Erreur : ${r.error}`);

      const bits = [
        args.brouillon
          ? `✅ Brouillon rangé sur ${resolved.company_name} (hors chronologie).`
          : rdvLe
            ? `✅ Note ajoutée sur ${resolved.company_name}, rendez-vous posé le ${fmtDateTime(r.scheduledAt)}${args.lieu ? ` — ${args.lieu}` : ""}.`
            : `✅ Note ajoutée sur ${resolved.company_name}.`,
      ];
      if (r.conflit) {
        bits.push(
          `⚠ Ce créneau chevauche « ${r.conflit.title} » (${fmtDateTime(r.conflit.starts_at)}).`
        );
      }
      if (r.statusChanged) {
        bits.push(
          `Étape → « ${STATUS_LABEL[r.newStatus as keyof typeof STATUS_LABEL]} » (fixée à la main, donc verrouillée).`
        );
      } else if (r.autoStatus) {
        bits.push(
          `Étape → « ${STATUS_LABEL[r.autoStatus as keyof typeof STATUS_LABEL]} » : ${r.autoReason}.`
        );
      }
      return text(bits.join(" "));
    }
  );

  // --- envoyer_email --------------------------------------------------------
  server.tool(
    "envoyer_email",
    "Envoie réellement un email à un prospect depuis la boîte Zoho du CRM, puis le consigne au journal. Par défaut (« confirmer » absent ou faux), renvoie une SIMULATION : destinataire, objet et corps, sans rien envoyer. Repassez avec « confirmer: true » pour envoyer pour de vrai. Peut envoyer un brouillon existant via « brouillon_id » au lieu de retaper le texte. Un envoi CLÔT l'action en cours : la relance ouverte passe « fait » et une relance « si pas de réponse » est posée à +5 jours.",
    {
      id: z.string().optional(),
      nom: z.string().optional().describe("Nom de société si l'identifiant n'est pas fourni."),
      brouillon_id: z
        .string()
        .optional()
        .describe(
          "Identifiant d'une activité brouillon (is_draft) : son sujet et son corps sont repris tels quels, et le brouillon est retiré après l'envoi."
        ),
      destinataire: z
        .string()
        .optional()
        .describe("Email du destinataire. Par défaut, l'adresse de la fiche prospect."),
      objet: z.string().max(MAX_SUBJECT).optional(),
      message: z.string().max(MAX_BODY).optional(),
      proposition: z
        .boolean()
        .optional()
        .describe(
          "true si ce message est une proposition / un devis (fait passer la fiche en « Proposition »)."
        ),
      confirmer: z
        .boolean()
        .optional()
        .describe("false/absent → simulation ; true → envoi réel, irréversible."),
    },
    async (args, extra) => {
      const ctx = await context(extra);
      if ("error" in ctx) return fail(ctx.error);
      const { admin, viewer } = ctx;
      const userId = viewer.userId;

      const resolved = await resolveProspect(admin, viewer, { id: args.id, nom: args.nom });
      if ("error" in resolved) return fail(resolved.error);
      const refus = await refusSiPasProprietaire(admin, viewer, resolved);
      if (refus) return fail(refus);

      const { data: fiche } = await admin
        .from("prospects")
        .select("id, company_name, email")
        .eq("id", resolved.id)
        .maybeSingle();
      if (!fiche) return fail("Prospect introuvable.");

      // --- Le contenu : un brouillon repris, ou le texte fourni. Les
      //     arguments explicites l'emportent sur le brouillon.
      let objet = args.objet?.trim() ?? "";
      let message = args.message?.trim() ?? "";
      let origine = "texte fourni";

      if (args.brouillon_id) {
        const { data: brouillon } = await admin
          .from("activities")
          .select("id, prospect_id, subject, body, is_draft")
          .eq("id", args.brouillon_id)
          .maybeSingle();
        if (!brouillon) return fail(`Aucune activité ${args.brouillon_id}.`);
        if (brouillon.prospect_id !== fiche.id) {
          return fail(
            `Ce brouillon appartient à un autre prospect que ${fiche.company_name}.`
          );
        }
        if (!brouillon.is_draft) {
          return fail("Cette entrée du journal n'est pas un brouillon.");
        }
        if (!objet) objet = (brouillon.subject ?? "").trim();
        if (!message) message = (brouillon.body ?? "").trim();
        origine = `brouillon ${brouillon.id}`;
      }

      // --- Le destinataire : celui demandé, sinon l'adresse de la fiche.
      const destinataire = (args.destinataire ?? fiche.email ?? "")
        .trim()
        .toLowerCase();
      if (!destinataire) {
        return fail(
          `Aucune adresse email sur la fiche ${fiche.company_name} — précisez « destinataire », ou ajoutez l'adresse à la fiche.`
        );
      }
      if (!isEmailAddress(destinataire)) {
        return fail(`Adresse email invalide : « ${destinataire} ».`);
      }

      // --- Les mêmes bornes que l'edge function, appliquées avant la
      //     simulation pour que Claude voie exactement ce qui partira.
      objet = objet.slice(0, MAX_SUBJECT);
      message = message.slice(0, MAX_BODY);
      if (!objet) return fail("Objet manquant.");
      if (!message) return fail("Message manquant.");
      if (hasPlaceholder(objet) || hasPlaceholder(message)) {
        return fail(
          `Le message contient encore « ${PLACEHOLDER} » : complétez-le avant de l'envoyer.`
        );
      }

      // --- Simulation : rien n'est écrit, rien ne part.
      if (args.confirmer !== true) {
        return json(
          `SIMULATION — rien n'a été envoyé. Relisez, puis repassez avec « confirmer: true » pour envoyer réellement.`,
          {
            prospect: fiche.company_name,
            destinataire,
            objet,
            message,
            origine,
            proposition: args.proposition === true,
          }
        );
      }

      // --- Envoi réel.
      const envoi = await sendViaMailFunction(admin, {
        prospectId: fiche.id,
        to: destinataire,
        subject: objet,
        body: message,
        userId,
      });
      if ("error" in envoi) return fail(`Envoi impossible : ${envoi.error}`);

      // --- Ce que l'edge function ne fait pas (elle n'écrit que l'email et
      //     l'activité) : la proposition, la cadence, l'étape, la confiance.
      //     Exactement la même suite que sendProspectEmailAction — un mail
      //     parti d'ici est indiscernable d'un mail parti de l'interface.
      if (args.proposition === true) {
        await admin
          .from("prospects")
          .update({ proposal_sent_at: new Date().toISOString() })
          .eq("id", fiche.id);
      }
      const cadence = await applyEmailSentCadence(admin, userId, fiche.id);
      const auto = await applyAutoStatus(admin, fiche.id);
      await recalcConfidence(admin, fiche.id);

      // Le brouillon a vécu : l'activité « email » le remplace au journal.
      if (args.brouillon_id) {
        await admin.from("activities").delete().eq("id", args.brouillon_id);
      }

      const bits = [`✅ Email envoyé à ${destinataire} — « ${objet} ».`];
      if (cadence.completedTitle) {
        bits.push(`Relance « ${cadence.completedTitle} » marquée faite.`);
      }
      if (cadence.followUpAt) {
        bits.push(
          `Sans réponse, la fiche remonte le ${fmtDate(cadence.followUpAt)}.`
        );
      }
      if (auto.changed) {
        bits.push(
          `Étape → « ${STATUS_LABEL[auto.status as keyof typeof STATUS_LABEL]} » : ${auto.reason}.`
        );
      }
      if (args.brouillon_id) bits.push("Brouillon retiré.");
      return text(bits.join(" "));
    }
  );

  // --- planifier_relance ----------------------------------------------------
  server.tool(
    "planifier_relance",
    "Pose une relance datée sur un prospect (met à jour next_action_at et la tâche associée, sans jamais créer de doublon : la relance ouverte existante est re-datée). La date est « YYYY-MM-DD » (échéance à 09:00) ou « YYYY-MM-DDTHH:mm » (heure précise, heure de Bruxelles). Pour un RENDEZ-VOUS, utilisez « poser_rendez_vous » (agenda, jour ET heure obligatoires) — le type « rendez_vous » ici exige aussi une heure et crée le même rendez-vous d'agenda.",
    {
      id: z.string().optional(),
      nom: z.string().optional(),
      date: z
        .string()
        .regex(/^\d{4}-\d{2}-\d{2}(T\d{2}:\d{2})?$/, "Format attendu : YYYY-MM-DD ou YYYY-MM-DDTHH:mm.")
        .describe("Date de relance (heure de Bruxelles)."),
      type: z.enum(["note", "rendez_vous"]).optional().describe("« rendez_vous » pose un vrai rendez-vous d'AGENDA — jour ET heure alors obligatoires (préférez « poser_rendez_vous », plus complet). Défaut « note » : simple relance."),
      note: z.string().optional().describe("Note facultative versée au journal en même temps."),
    },
    async (args, extra) => {
      const ctx = await context(extra);
      if ("error" in ctx) return fail(ctx.error);
      const { admin, viewer } = ctx;
      const resolved = await resolveProspect(admin, viewer, { id: args.id, nom: args.nom });
      if ("error" in resolved) return fail(resolved.error);
      const refus = await refusSiPasProprietaire(admin, viewer, resolved);
      if (refus) return fail(refus);

      const r = await saveExchangeCore(admin, viewer.userId, {
        prospectId: resolved.id,
        type: args.type ?? "note",
        note: args.note ?? null,
        dateLocale: args.date,
        // Planifier n'est pas échanger : poser une relance ne fait pas passer
        // la fiche en « Contacté ». Un rendez-vous daté, lui, est un fait —
        // le cœur partagé le pose dans l'agenda (meetings).
        isExchange: false,
      });
      if (r.error) return fail(`Erreur : ${r.error}`);

      const bits = [
        args.type === "rendez_vous"
          ? `✅ Rendez-vous posé sur ${resolved.company_name} : « ${r.taskTitle} » le ${fmtDateTime(r.scheduledAt)}.`
          : `✅ Relance posée sur ${resolved.company_name} : « ${r.taskTitle} » pour le ${fmtDateTime(r.scheduledAt)}.`,
      ];
      if (r.autoStatus) {
        bits.push(
          `Étape → « ${STATUS_LABEL[r.autoStatus as keyof typeof STATUS_LABEL]} » : ${r.autoReason}.`
        );
      }
      if (r.conflit) {
        bits.push(
          `⚠ Ce créneau chevauche « ${r.conflit.title} » (${fmtDateTime(r.conflit.starts_at)}).`
        );
      }
      return text(bits.join(" "));
    }
  );

  // --- agenda ---------------------------------------------------------------
  server.tool(
    "agenda",
    "Liste les rendez-vous de l'agenda sur une période (défaut : les 7 prochains jours). Par DÉFAUT, uniquement les rendez-vous de l'appelant (périmètre « moi ») ; un administrateur, ou un commercial qui « travaille en équipe », peut passer perimetre: « equipe ». Les rendez-vous PERSONNELS des autres membres n'exposent que leur créneau (« Occupé »), jamais leur intitulé.",
    {
      du: z
        .string()
        .regex(/^\d{4}-\d{2}-\d{2}$/, "Format attendu : YYYY-MM-DD.")
        .optional()
        .describe("Début de période (YYYY-MM-DD, heure de Bruxelles). Défaut : aujourd'hui."),
      au: z
        .string()
        .regex(/^\d{4}-\d{2}-\d{2}$/, "Format attendu : YYYY-MM-DD.")
        .optional()
        .describe("Fin de période, incluse. Défaut : début + 7 jours."),
      perimetre: z
        .enum(["moi", "equipe"])
        .optional()
        .describe("Défaut « moi ». « equipe » superpose l'équipe — réservé à l'administrateur et aux commerciaux qui « travaillent en équipe »."),
    },
    async (args, extra) => {
      const ctx = await context(extra);
      if ("error" in ctx) return fail(ctx.error);
      const { admin, viewer } = ctx;
      const per = perimetreDe(viewer, args.perimetre);

      const du = args.du ?? isoToLocalInput(new Date().toISOString()).slice(0, 10);
      const auDefaut = new Date(`${du}T12:00:00Z`);
      auDefaut.setUTCDate(auDefaut.getUTCDate() + 7);
      const au = args.au ?? auDefaut.toISOString().slice(0, 10);
      const debut = localInputToISO(`${du}T00:00`);
      const fin = localInputToISO(`${au}T23:59`);
      if (!debut || !fin) return fail("Période invalide.");

      // LA CLOISON, ICI, EST CE `in` — et rien d'autre.
      //
      // Cet outil ne part pas de `prospects` : ni `scopeProspects` ni
      // `scopeJoinedProspects` ne peuvent le borner. Avant l'interrupteur
      // d'équipe, le mode « equipe » était réservé à l'admin et l'absence de
      // filtre ne se voyait pas. Ouvert à un porteur, il aurait rendu TOUS les
      // rendez-vous de la base — ceux de Bora et ceux de Rémi compris — et
      // `meetings_visibles` n'aurait masqué aucun RDV personnel, son `CASE`
      // reposant sur `auth.uid()`, qui est NUL sous service_role. Le titre, le
      // lieu et les notes d'un rendez-vous privé seraient sortis en clair.
      let q = admin
        .from("meetings_visibles")
        .select("id, owner_id, prospect_id, kind, title, starts_at, ends_at, location, status")
        .gte("starts_at", debut)
        .lte("starts_at", fin)
        .order("starts_at", { ascending: true })
        .limit(100);
      if (per.mode === "moi") q = q.eq("owner_id", viewer.userId);
      else if (!viewer.isAdmin) q = q.in("owner_id", viewer.visiblesIds);

      const { data, error } = await q;
      if (error) return fail(`Erreur : ${error.message}`);

      type Row = {
        id: string;
        owner_id: string;
        prospect_id: string | null;
        kind: string;
        title: string;
        starts_at: string;
        ends_at: string;
        location: string | null;
        status: string;
      };
      const rows = (data ?? []) as Row[];

      // Les noms de société, pour que Claude sache de qui on parle.
      const prospectIds = [
        ...new Set(rows.map((m) => m.prospect_id).filter(Boolean) as string[]),
      ];
      const societes = new Map<string, string>();
      if (prospectIds.length > 0) {
        const { data: fiches } = await admin
          .from("prospects")
          .select("id, company_name")
          .in("id", prospectIds);
        for (const f of (fiches ?? []) as { id: string; company_name: string }[]) {
          societes.set(f.id, f.company_name);
        }
      }

      // Le serveur agit en service_role : la vue ne masque RIEN ici
      // (auth.uid() est nul). Le masquage des rendez-vous perso des autres
      // est donc réappliqué en code — même règle que la vue.
      const sortie = rows.map((m) => {
        const persoAutrui = m.kind === "perso" && m.owner_id !== viewer.userId;
        return {
          id: m.id,
          titre: persoAutrui ? "Occupé" : m.title,
          debut: m.starts_at,
          fin: m.ends_at,
          statut: MEETING_STATUS_LABEL[m.status as MeetingStatus] ?? m.status,
          lieu: persoAutrui ? null : m.location,
          prospect_id: persoAutrui ? null : m.prospect_id,
          societe:
            !persoAutrui && m.prospect_id
              ? (societes.get(m.prospect_id) ?? null)
              : null,
          a_moi: m.owner_id === viewer.userId,
        };
      });
      return json(`${sortie.length} rendez-vous du ${du} au ${au}.`, sortie);
    }
  );

  // --- poser_rendez_vous ----------------------------------------------------
  server.tool(
    "poser_rendez_vous",
    "Pose un rendez-vous dans l'agenda : créneau daté (jour ET heure OBLIGATOIRES), lieu, durée — et, pour un prospect, trace au journal et étape « Rendez-vous » déduite automatiquement. Si le JOUR ou l'HEURE manque dans la demande de l'utilisateur, POSEZ-LUI LA QUESTION : l'outil refuse (« Il manque le jour » / « Il manque l'heure ») et ne devine jamais. Ne posez JAMAIS une relance générique à la place — le rendez-vous serait perdu. Poser un rendez-vous CLÔTURE les relances ouvertes de la fiche qui tombaient avant lui (tracé au journal) : c'est son débrief qui décidera de la suite. Une relance que vous posez ensuite (ex. confirmer la veille) n'est jamais touchée.",
    {
      id: z.string().optional().describe("Identifiant du prospect."),
      nom: z.string().optional().describe("Nom de société si l'identifiant n'est pas fourni."),
      personnel: z
        .boolean()
        .optional()
        .describe("true : rendez-vous PERSONNEL, sans prospect (les autres ne verront que « Occupé »)."),
      date: z
        .string()
        .describe("Début du rendez-vous : « YYYY-MM-DDTHH:mm » (heure de Bruxelles). Jour ET heure obligatoires."),
      duree_min: z
        .number()
        .int()
        .min(5)
        .max(600)
        .optional()
        .describe("Durée en minutes (défaut 60)."),
      lieu: z
        .string()
        .optional()
        .describe(
          "Lieu du rendez-vous (adresse, visio…). Laissé vide, il reprend l'adresse de la fiche."
        ),
      titre: z.string().optional().describe("Titre (défaut « RDV avec <société> »)."),
      notes: z.string().optional(),
    },
    async (args, extra) => {
      const ctx = await context(extra);
      if ("error" in ctx) return fail(ctx.error);
      const { admin, viewer } = ctx;

      const quand = litDateRendezVous(args.date);
      if (quand.error) return fail(quand.error);

      let prospectId: string | null = null;
      let societe: string | null = null;
      if (!args.personnel) {
        const resolved = await resolveProspect(admin, viewer, {
          id: args.id,
          nom: args.nom,
        });
        if ("error" in resolved) return fail(resolved.error);
        const refus = await refusSiPasProprietaire(admin, viewer, resolved);
        if (refus) return fail(refus);
        prospectId = resolved.id;
        societe = resolved.company_name;
      }

      const r = await poserRendezVous(admin, viewer.userId, {
        prospectId,
        kind: args.personnel ? "perso" : "prospect",
        title: args.titre,
        startsAt: quand.ok!,
        dureeMin: args.duree_min,
        location: args.lieu,
        notes: args.notes,
      });
      if (r.error) return fail(r.error);

      const bits = [
        `✅ Rendez-vous posé : « ${r.title} » le ${fmtDateTime(r.startsAtISO)}${
          args.lieu ? ` — ${args.lieu}` : ""
        }${societe ? ` (fiche ${societe})` : ""}.`,
      ];
      if (r.autoStatus) {
        bits.push(
          `Étape → « ${STATUS_LABEL[r.autoStatus as keyof typeof STATUS_LABEL]} » : ${r.autoReason}.`
        );
      }
      if (r.conflit) {
        bits.push(
          `⚠ Ce créneau chevauche « ${r.conflit.title} » (${fmtDateTime(r.conflit.starts_at)}) — signalez-le à l'utilisateur.`
        );
      }
      const annulees = phraseAnnulees(r.annulees);
      if (annulees) bits.push(annulees);
      return text(bits.join(" "));
    }
  );

  // --- deplacer_rendez_vous -------------------------------------------------
  server.tool(
    "deplacer_rendez_vous",
    "Déplace un rendez-vous de l'agenda (nouvelle date « YYYY-MM-DDTHH:mm », jour ET heure) ou l'annule (annuler: true). Le report passe le statut à « reporté » et verse l'ancienne et la nouvelle date au journal de la fiche ; l'annulation clôt le rendez-vous. L'identifiant vient de l'outil « agenda » ou d'« obtenir_prospect ».",
    {
      id: z.string().describe("Identifiant du rendez-vous."),
      date: z
        .string()
        .optional()
        .describe("Nouveau début « YYYY-MM-DDTHH:mm » (heure de Bruxelles). Requis sauf pour annuler."),
      annuler: z.boolean().optional().describe("true : annule le rendez-vous au lieu de le déplacer."),
      motif: z.string().optional().describe("Motif du report ou de l'annulation, versé au journal."),
      relancer_le: z
        .string()
        .optional()
        .describe(
          "Avec « annuler: true » seulement, FACULTATIF : la suite — date de relance « YYYY-MM-DD » (09:00) ou « YYYY-MM-DDTHH:mm ». Absente, rien n'est posé : si la fiche n'a plus aucune relance, elle ne remontera plus nulle part — demandez à l'utilisateur s'il a une date en tête plutôt que d'en inventer une."
        ),
    },
    async (args, extra) => {
      const ctx = await context(extra);
      if ("error" in ctx) return fail(ctx.error);
      const { admin, viewer } = ctx;

      if (args.annuler) {
        let suite: { dueAt: string } | null = null;
        if (args.relancer_le) {
          const dueAt = dateInputToISO(args.relancer_le);
          if (!dueAt) {
            return fail("« relancer_le » invalide — attendu « YYYY-MM-DD » ou « YYYY-MM-DDTHH:mm ».");
          }
          suite = { dueAt };
        }
        const r = await cloturerRendezVous(admin, viewer.userId, {
          id: args.id,
          resultat: "annule",
          compteRendu: args.motif,
          suite,
          isAdmin: viewer.isAdmin,
        });
        if (r.error) return fail(r.error);
        return text(
          `✅ Rendez-vous « ${r.title} » annulé.` +
            (r.ensuite
              ? ` Prochaine action de la fiche : « ${r.ensuite.title} » le ${fmtDateTime(r.ensuite.due_at)}.`
              : r.plusRien
                ? " ⚠ Plus rien de prévu sur cette fiche : elle ne remontera plus dans « À faire ». Demandez à l'utilisateur s'il veut poser une suite."
                : "")
        );
      }

      if (!args.date) {
        return fail("Fournissez « date » (YYYY-MM-DDTHH:mm) pour déplacer, ou « annuler: true ».");
      }
      const quand = litDateRendezVous(args.date);
      if (quand.error) return fail(quand.error);

      const r = await deplacerRendezVous(admin, viewer.userId, {
        id: args.id,
        startsAt: quand.ok!,
        motif: args.motif,
        isAdmin: viewer.isAdmin,
      });
      if (r.error) return fail(r.error);

      const bits = [
        `✅ Rendez-vous « ${r.title} » reporté au ${fmtDateTime(r.startsAtISO)}.`,
      ];
      // Relances qui tombent désormais avant le RDV : clôturées (trigger, 022).
      const annulees = phraseAnnulees(r.annulees);
      if (annulees) bits.push(annulees);
      if (r.conflit) {
        bits.push(
          `⚠ Ce créneau chevauche « ${r.conflit.title} » (${fmtDateTime(r.conflit.starts_at)}).`
        );
      }
      return text(bits.join(" "));
    }
  );

  // --- supprimer_activite ---------------------------------------------------
  server.tool(
    "supprimer_activite",
    "Supprime définitivement une entrée du journal d'un prospect (note, email consigné, brouillon). Sert au nettoyage — par exemple retirer des brouillons qui polluent l'historique. Par défaut (« confirmer » absent ou faux), renvoie une SIMULATION : la liste de ce qui serait supprimé, sans rien effacer. Repassez avec « confirmer: true » pour exécuter. Le jeton du connecteur n'étant délivré qu'au compte administrateur, cet outil lui est de fait réservé.",
    {
      id: z.string().optional().describe("Identifiant de l'activité à supprimer."),
      prospect_id: z
        .string()
        .optional()
        .describe("Prospect ciblé (avec « brouillons: true » pour un nettoyage groupé)."),
      nom: z.string().optional().describe("Nom de société si prospect_id n'est pas fourni."),
      brouillons: z
        .boolean()
        .optional()
        .describe("true : cible TOUS les brouillons du prospect au lieu d'une entrée précise."),
      confirmer: z.boolean().optional().describe("false/absent → simulation ; true → suppression réelle."),
    },
    async (args, extra) => {
      const ctx = await context(extra);
      if ("error" in ctx) return fail(ctx.error);
      const { admin, viewer } = ctx;

      // --- Cas 1 : une entrée précise.
      if (args.id && !args.brouillons) {
        const { data } = await admin
          .from("activities")
          .select("id, prospect_id, type, subject, body, occurred_at, is_draft, prospects(owner_id)")
          .eq("id", args.id)
          .maybeSingle();
        if (!data) return fail(`Aucune activité avec l'identifiant ${args.id}.`);
        // Une entrée du journal appartient à son prospect.
        //
        // ⚠ CETTE BRANCHE NE PASSE PAS PAR `resolveProspect` : elle part d'un
        // identifiant d'activité, pas de prospect. Le garde-fou de propriété
        // doit donc être posé ICI, à la main — c'est le seul endroit du
        // connecteur où il ne vient pas avec `resolveProspect`, et c'est
        // exactement celui qu'on oublie. Tester la seule VISIBILITÉ suffisait
        // tant que voir == posséder ; depuis l'interrupteur d'équipe
        // (migration 020) un porteur voit le journal de son binôme, et
        // supprimer définitivement une trace de SON journal n'est pas une
        // lecture.
        //
        // Deux refus distincts, et c'est voulu : une fiche invisible se
        // comporte comme inexistante (ne pas révéler qu'elle existe) ; une
        // fiche visible mais qui n'est pas la nôtre est nommée, puisqu'on la
        // voit de toute façon.
        const proprio =
          (data.prospects as { owner_id?: string | null } | null)?.owner_id ?? null;
        if (!canSeeProspect(viewer, proprio)) {
          return fail(`Aucune activité avec l'identifiant ${args.id}.`);
        }
        if (!canEditProspect(viewer, proprio)) {
          const { data: p } = await admin
            .from("crm_users")
            .select("full_name, email")
            .eq("id", proprio ?? "")
            .maybeSingle();
          return fail(
            NOT_EDITABLE(
              ((p?.full_name as string | null) ?? null) ||
                ((p?.email as string | null) ?? null)
            )
          );
        }

        const apercu = {
          id: data.id,
          type: ACTIVITY_LABEL[data.type as keyof typeof ACTIVITY_LABEL] ?? data.type,
          brouillon: data.is_draft,
          resume: data.subject,
          extrait: (data.body ?? "").slice(0, 160),
          date: data.occurred_at,
        };

        if (!args.confirmer) {
          return json(
            "SIMULATION (rien supprimé). Cette entrée serait effacée définitivement. Repassez avec « confirmer: true ».",
            apercu
          );
        }
        const { error } = await admin.from("activities").delete().eq("id", args.id);
        if (error) return fail(`Erreur : ${error.message}`);
        return json("✅ Entrée supprimée définitivement.", apercu);
      }

      // --- Cas 2 : tous les brouillons d'un prospect.
      if (!args.brouillons) {
        return fail(
          "Fournissez « id » (une entrée précise), ou « brouillons: true » avec « prospect_id »/« nom »."
        );
      }

      const resolved = await resolveProspect(admin, viewer, {
        id: args.prospect_id,
        nom: args.nom,
      });
      if ("error" in resolved) return fail(resolved.error);
      const refus = await refusSiPasProprietaire(admin, viewer, resolved);
      if (refus) return fail(refus);

      const { data: rows } = await admin
        .from("activities")
        .select("id, subject, occurred_at")
        .eq("prospect_id", resolved.id)
        .eq("is_draft", true)
        .order("occurred_at", { ascending: false });
      const drafts = (rows ?? []) as { id: string; subject: string | null; occurred_at: string }[];

      if (drafts.length === 0) {
        return text(`Aucun brouillon sur ${resolved.company_name}.`);
      }
      const apercu = drafts.map((d) => ({
        id: d.id,
        resume: d.subject,
        date: d.occurred_at,
      }));

      if (!args.confirmer) {
        return json(
          `SIMULATION (rien supprimé). ${drafts.length} brouillon(s) de ${resolved.company_name} seraient effacés. Repassez avec « confirmer: true ».`,
          apercu
        );
      }
      const { error } = await admin
        .from("activities")
        .delete()
        .in("id", drafts.map((d) => d.id));
      if (error) return fail(`Erreur : ${error.message}`);
      return json(
        `✅ ${drafts.length} brouillon(s) supprimé(s) sur ${resolved.company_name}.`,
        apercu
      );
    }
  );

  // --- importer_prospects ---------------------------------------------------
  server.tool(
    "importer_prospects",
    "Crée des prospects en lot, avec dédup ligne par ligne (email). Par défaut (« confirmer » absent ou faux), renvoie une SIMULATION — le résumé de ce qui serait créé / ignoré — sans rien écrire. Repassez avec « confirmer: true » pour exécuter réellement l'import.",
    {
      prospects: z
        .array(
          z.object({
            company_name: z.string().optional(),
            contact_name: z.string().optional(),
            email: z.string().optional(),
            phone: z.string().optional(),
            website: z.string().optional(),
            sector: z.string().optional(),
            city: z.string().optional(),
            status: z.string().optional(),
            source: z.string().optional(),
            value_estimate: z.string().optional(),
            notes: z.string().optional(),
          })
        )
        .describe("Lignes à importer (société obligatoire par ligne)."),
      confirmer: z.boolean().optional().describe("false/absent → simulation ; true → écriture réelle."),
    },
    async (args, extra) => {
      const ctx = await context(extra);
      if ("error" in ctx) return fail(ctx.error);
      const { admin, viewer } = ctx;

      // `null` en propriétaire versait TOUT l'import dans le vivier — donc
      // visible par tous les commerciaux. Les fiches importées appartiennent
      // à qui les importe, comme celles créées une par une.
      const result = await importProspectsCore(
        admin,
        viewer.userId,
        args.prospects,
        viewer.userId,
        { dryRun: !args.confirmer }
      );
      if (result.error) return fail(`Erreur : ${result.error}`);

      if (!args.confirmer) {
        return json(
          `SIMULATION (rien écrit). ${result.pending} fiche(s) seraient créées, ${result.skipped} ignorée(s). Repassez avec « confirmer: true » pour exécuter.`,
          { a_creer: result.pending, ignores: result.skipped, details: result.reasons }
        );
      }
      return json(
        `✅ Import terminé : ${result.inserted} créée(s), ${result.skipped} ignorée(s).`,
        { crees: result.inserted, ignores: result.skipped, details: result.reasons }
      );
    }
  );
}

// ---------------------------------------------------------------------------
// Handler + garde OAuth.
// ---------------------------------------------------------------------------

const baseHandler = createMcpHandler(
  register,
  { serverInfo: { name: "Celya CRM", version: "1.0.0" } },
  { basePath: "/", disableSse: true, maxDuration: 60 }
);

const verifyToken = async (
  _req: Request,
  bearerToken?: string
): Promise<AuthInfo | undefined> => {
  if (!bearerToken) return undefined;
  const claims = verifyJwt(bearerToken);
  if (!claims) return undefined;
  return {
    token: bearerToken,
    clientId: claims.client_id,
    scopes: (claims.scope ?? "").split(" ").filter(Boolean),
    expiresAt: claims.exp,
    extra: { userId: claims.sub },
  };
};

const handler = withMcpAuth(baseHandler, verifyToken, {
  required: true,
  requiredScopes: [SCOPE],
});

export { handler as GET, handler as POST, handler as DELETE };
