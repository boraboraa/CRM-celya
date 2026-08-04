/**
 * Serveur MCP « Celya CRM » — connecteur personnalisé de Claude.
 *
 * Périmètre STRICTEMENT limité au CRM : ces outils ne touchent QUE les tables
 * prospects, activities, tasks, emails. Aucune exécution SQL libre, aucun accès
 * aux tables comptables du même projet Supabase. C'est la raison d'être de ce
 * connecteur face au connecteur Supabase brut.
 *
 * Chaque outil est une enveloppe fine au-dessus du cœur partagé (lib/crm) : un
 * prospect créé ici est indiscernable d'un prospect créé à la main (même dédup,
 * même normalisation « +32 », même cadence de relance).
 *
 * Le serveur agit en service_role (RLS contournée) : c'est donc lui qui impose
 * que tout est rattaché à Bora — author_id / created_by renseignés depuis le
 * sujet du jeton OAuth, délivré au seul compte administrateur.
 */

import { createMcpHandler, withMcpAuth } from "mcp-handler";
import type { AuthInfo } from "@modelcontextprotocol/sdk/server/auth/types.js";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { createAdminClient } from "@/lib/supabase/admin";
import { verifyJwt } from "@/lib/mcp/jwt";
import { SCOPE } from "@/lib/mcp/oauth";
import { createProspectCore, importProspectsCore } from "@/lib/crm/prospects";
import { saveExchangeCore } from "@/lib/crm/exchange";
import { manualStatusPatch } from "@/lib/crm/status";
import { STATUS_LABEL, ACTIVITY_LABEL, STATUS_ORDER, fmtDateTime } from "@/lib/constants";
import { todayBounds } from "@/lib/time";
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

/** L'identifiant de Bora, extrait du jeton OAuth (sujet). */
function userIdFrom(extra: { authInfo?: AuthInfo }): string | null {
  const id = extra.authInfo?.extra?.userId;
  return typeof id === "string" ? id : null;
}

const STATUS_ENUM = STATUS_ORDER as [string, ...string[]];

/** Nettoie une recherche texte avant de la passer à un filtre PostgREST or(). */
const safeSearch = (s: string) => s.replace(/[%,()*\\]/g, " ").trim().slice(0, 80);

/**
 * Résout un prospect par identifiant OU par nom. Renvoie une erreur lisible si
 * rien ne correspond, et la liste des candidats si le nom est ambigu.
 */
async function resolveProspect(
  admin: SupabaseClient,
  args: { id?: string; nom?: string }
): Promise<
  | { id: string; company_name: string; status: string }
  | { error: string }
> {
  if (args.id) {
    const { data } = await admin
      .from("prospects")
      .select("id, company_name, status")
      .eq("id", args.id)
      .maybeSingle();
    if (!data) return { error: `Aucun prospect avec l'identifiant ${args.id}.` };
    return data as { id: string; company_name: string; status: string };
  }
  const nom = args.nom?.trim();
  if (!nom) return { error: "Fournissez « id » ou « nom »." };

  const { data } = await admin
    .from("prospects")
    .select("id, company_name, status")
    .ilike("company_name", `%${safeSearch(nom)}%`)
    .limit(10);
  const rows = (data ?? []) as { id: string; company_name: string; status: string }[];
  if (rows.length === 0) return { error: `Aucun prospect au nom « ${nom} ».` };
  if (rows.length > 1) {
    const liste = rows.map((r) => `- ${r.company_name} (id ${r.id})`).join("\n");
    return { error: `Plusieurs prospects correspondent à « ${nom} ». Précisez par identifiant :\n${liste}` };
  }
  return rows[0];
}

// ---------------------------------------------------------------------------
// Enregistrement des outils.
// ---------------------------------------------------------------------------

function register(server: McpServer) {
  // --- lister_prospects -----------------------------------------------------
  server.tool(
    "lister_prospects",
    "Liste les prospects du CRM avec un retour compact (nom, contact, téléphone, étape, prochaine action). Filtres : par étape, par « à relancer » (relances en retard ou du jour), et par recherche texte (société, contact, email, téléphone).",
    {
      statut: z.enum(STATUS_ENUM).optional().describe("Filtrer sur une étape précise."),
      a_relancer: z
        .boolean()
        .optional()
        .describe("Ne garder que les prospects dont la prochaine action échoit aujourd'hui ou est en retard."),
      recherche: z.string().optional().describe("Texte recherché dans société, contact, email ou téléphone."),
      limite: z.number().int().min(1).max(200).optional().describe("Nombre maximum de fiches (défaut 50)."),
    },
    async (args, extra) => {
      if (!userIdFrom(extra)) return fail("Non authentifié.");
      const admin = createAdminClient();

      let q = admin
        .from("prospects")
        .select("id, company_name, contact_name, phone, email, status, next_action_at")
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
      const rows = (data ?? []).map((r) => ({
        id: r.id,
        societe: r.company_name,
        contact: r.contact_name,
        telephone: r.phone,
        etape: STATUS_LABEL[r.status as keyof typeof STATUS_LABEL] ?? r.status,
        prochaine_action: r.next_action_at,
      }));
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
      if (!userIdFrom(extra)) return fail("Non authentifié.");
      const admin = createAdminClient();
      const resolved = await resolveProspect(admin, args);
      if ("error" in resolved) return fail(resolved.error);

      const [fiche, activites, taches] = await Promise.all([
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
        ville: p.city,
        etape: STATUS_LABEL[p.status as keyof typeof STATUS_LABEL] ?? p.status,
        source: p.source,
        valeur_estimee: p.value_estimate,
        probabilite: p.probability,
        valeur_ponderee: p.weighted_value,
        etape_verrouillee: p.status_locked,
        etape_motif_auto: p.status_auto_reason,
        prochaine_action: p.next_action_at,
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
      });
    }
  );

  // --- a_faire --------------------------------------------------------------
  server.tool(
    "a_faire",
    "Liste ce qu'il y a à faire : les relances en retard et celles du jour, tous prospects confondus. Réutilise la logique de l'écran « À faire » (c'est la date qui décide : une relance datée du 14 octobre ne remonte que le 14 octobre).",
    {},
    async (_args, extra) => {
      if (!userIdFrom(extra)) return fail("Non authentifié.");
      const admin = createAdminClient();
      const { start, end } = todayBounds();
      const SELECT = "id, title, due_at, priority, prospect_id, prospects(company_name, phone)";

      const [overdue, today] = await Promise.all([
        admin.from("tasks").select(SELECT).eq("status", "a_faire").lt("due_at", start).order("due_at", { ascending: true }).limit(100),
        admin.from("tasks").select(SELECT).eq("status", "a_faire").gte("due_at", start).lte("due_at", end).order("due_at", { ascending: true }).limit(100),
      ]);

      const shape = (t: Record<string, unknown>) => {
        const pros = t.prospects as { company_name?: string; phone?: string } | null;
        return {
          id: t.id,
          titre: t.title,
          echeance: t.due_at,
          societe: pros?.company_name ?? null,
          telephone: pros?.phone ?? null,
          prospect_id: t.prospect_id,
        };
      };

      return json("À faire — relances en retard puis du jour.", {
        en_retard: (overdue.data ?? []).map(shape),
        aujourd_hui: (today.data ?? []).map(shape),
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
      const userId = userIdFrom(extra);
      if (!userId) return fail("Non authentifié.");
      const admin = createAdminClient();

      const result = await createProspectCore(
        admin,
        userId,
        {
          company_name: args.societe,
          contact_name: args.contact,
          phone: args.telephone,
          email: args.email,
          website: args.site,
          sector: args.secteur,
          city: args.ville,
          status: args.statut,
          source: args.source,
          value_estimate: args.valeur_estimee,
          probability: args.probabilite,
          notes: args.notes,
        },
        { checkDuplicates: true, normalizePhone: true, force: args.forcer }
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
    "Change l'étape d'un prospect (par identifiant ou nom). Étapes valides : a_appeler, contacte, rendez_vous, proposition, gagne, perdu. ATTENTION : c'est une décision explicite — elle VERROUILLE l'étape, qui ne sera plus déduite automatiquement des faits (email envoyé, rendez-vous posé). Ne l'utilisez que si l'utilisateur demande vraiment de fixer l'étape ; pour un simple compte rendu, préférez « ajouter_note ».",
    {
      id: z.string().optional(),
      nom: z.string().optional().describe("Nom de société si l'identifiant n'est pas fourni."),
      statut: z.enum(STATUS_ENUM).describe("Nouvelle étape."),
    },
    async (args, extra) => {
      if (!userIdFrom(extra)) return fail("Non authentifié.");
      const admin = createAdminClient();
      const resolved = await resolveProspect(admin, { id: args.id, nom: args.nom });
      if ("error" in resolved) return fail(resolved.error);

      const { error } = await admin
        .from("prospects")
        .update(manualStatusPatch(args.statut as ProspectStatus))
        .eq("id", resolved.id);
      if (error) return fail(`Erreur : ${error.message}`);

      return text(
        `✅ ${resolved.company_name} : étape passée à « ${STATUS_LABEL[args.statut as keyof typeof STATUS_LABEL]} » et verrouillée (plus de déduction automatique — déverrouillable depuis la fiche).`
      );
    }
  );

  // --- ajouter_note ---------------------------------------------------------
  server.tool(
    "ajouter_note",
    "Ajoute une activité au journal d'un prospect (note, email ou rendez_vous). L'étape s'ajuste ensuite toute seule à partir des FAITS enregistrés — ne forcez pas « statut » sans raison. N'impose pas de date de relance — pour poser une relance, utilisez « planifier_relance ». Pour un texte non envoyé (brouillon d'email), passez « brouillon: true » : il sera rangé hors chronologie.",
    {
      id: z.string().optional(),
      nom: z.string().optional(),
      type: z.enum(["note", "email", "rendez_vous"]).describe("Type d'échange versé au journal."),
      note: z.string().describe("Texte de l'échange."),
      resume: z.string().optional().describe("Résumé court (versé en sujet)."),
      contact: z.string().optional().describe("Nom du contact à mettre à jour sur la fiche."),
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
      const userId = userIdFrom(extra);
      if (!userId) return fail("Non authentifié.");
      const admin = createAdminClient();
      const resolved = await resolveProspect(admin, { id: args.id, nom: args.nom });
      if ("error" in resolved) return fail(resolved.error);

      const r = await saveExchangeCore(admin, userId, {
        prospectId: resolved.id,
        type: args.type,
        note: args.note,
        resume: args.resume,
        contactName: args.contact,
        statut: args.statut as ProspectStatus | undefined,
        motif: args.motif,
        dateLocale: null,
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
          : `✅ Note ajoutée sur ${resolved.company_name}.`,
      ];
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

  // --- planifier_relance ----------------------------------------------------
  server.tool(
    "planifier_relance",
    "Pose une relance datée sur un prospect (met à jour next_action_at et la tâche associée, sans jamais créer de doublon : la relance ouverte existante est re-datée). La date est « YYYY-MM-DD » (échéance à 09:00) ou « YYYY-MM-DDTHH:mm » (heure précise, heure de Bruxelles). Un type « rendez_vous » crée une tâche « RDV avec … » protégée.",
    {
      id: z.string().optional(),
      nom: z.string().optional(),
      date: z
        .string()
        .regex(/^\d{4}-\d{2}-\d{2}(T\d{2}:\d{2})?$/, "Format attendu : YYYY-MM-DD ou YYYY-MM-DDTHH:mm.")
        .describe("Date de relance (heure de Bruxelles)."),
      type: z.enum(["note", "rendez_vous"]).optional().describe("« rendez_vous » pour un RDV daté (défaut « note » : simple relance)."),
      note: z.string().optional().describe("Note facultative versée au journal en même temps."),
    },
    async (args, extra) => {
      const userId = userIdFrom(extra);
      if (!userId) return fail("Non authentifié.");
      const admin = createAdminClient();
      const resolved = await resolveProspect(admin, { id: args.id, nom: args.nom });
      if ("error" in resolved) return fail(resolved.error);

      const r = await saveExchangeCore(admin, userId, {
        prospectId: resolved.id,
        type: args.type ?? "note",
        note: args.note ?? null,
        dateLocale: args.date,
        // Planifier n'est pas échanger : poser une relance ne fait pas passer
        // la fiche en « Contacté ». Un rendez-vous daté, lui, est un fait —
        // il passe par la tâche « RDV avec … » que crée le cœur partagé.
        isExchange: false,
      });
      if (r.error) return fail(`Erreur : ${r.error}`);

      const bits = [
        `✅ Relance posée sur ${resolved.company_name} : « ${r.taskTitle} » pour le ${fmtDateTime(r.scheduledAt)}.`,
      ];
      if (r.autoStatus) {
        bits.push(
          `Étape → « ${STATUS_LABEL[r.autoStatus as keyof typeof STATUS_LABEL]} » : ${r.autoReason}.`
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
      if (!userIdFrom(extra)) return fail("Non authentifié.");
      const admin = createAdminClient();

      // --- Cas 1 : une entrée précise.
      if (args.id && !args.brouillons) {
        const { data } = await admin
          .from("activities")
          .select("id, prospect_id, type, subject, body, occurred_at, is_draft")
          .eq("id", args.id)
          .maybeSingle();
        if (!data) return fail(`Aucune activité avec l'identifiant ${args.id}.`);

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

      const resolved = await resolveProspect(admin, { id: args.prospect_id, nom: args.nom });
      if ("error" in resolved) return fail(resolved.error);

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
      const userId = userIdFrom(extra);
      if (!userId) return fail("Non authentifié.");
      const admin = createAdminClient();

      const result = await importProspectsCore(admin, userId, args.prospects, null, {
        dryRun: !args.confirmer,
      });
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
