// Celya CRM — boîte Zoho dans les deux sens.
// - save_account : enregistre SA boîte (mot de passe d'application → Vault).
//                  Ouvert à tout membre actif depuis le 25 août : chacun
//                  connecte la sienne, Bora ne manipule le mot de passe de
//                  personne. Hôtes déduits du domaine (voir zohoHosts).
// - send         : envoi SMTP depuis la boîte DE L'APPELANT + journalisation,
//                  accroché au fil de discussion du prospect (RFC 5322).
//                  Jamais depuis la boîte d'un autre — voir pickAccount.
// - sync         : relève IMAP (pg_cron toutes les 5 min, ou bouton admin)
// - probe        : diagnostic en lecture seule de la boîte
//
// Le mot de passe d'application ne quitte jamais Supabase : Vault + RPC
// réservées à service_role. Analyse MIME par mailparser, IMAP par imapflow,
// SMTP par nodemailer — des bibliothèques éprouvées, pas d'analyseur maison.
import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient, type SupabaseClient } from "jsr:@supabase/supabase-js@2";
import { ImapFlow } from "npm:imapflow@1.0.164";
import { simpleParser } from "npm:mailparser@3.7.1";
import nodemailer from "npm:nodemailer@6.9.16";
import Anthropic from "npm:@anthropic-ai/sdk@0.115.0";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });

// Domaines grand public : jamais de rattachement par domaine sur ceux-là.
const PUBLIC_DOMAINS = new Set([
  "gmail.com", "googlemail.com", "hotmail.com", "hotmail.be", "hotmail.fr",
  "outlook.com", "outlook.be", "outlook.fr", "live.com", "live.be", "msn.com",
  "yahoo.com", "yahoo.fr", "yahoo.be", "icloud.com", "me.com", "mac.com",
  "proximus.be", "skynet.be", "telenet.be", "voo.be", "orange.be", "base.be",
  "protonmail.com", "proton.me", "gmx.com", "gmx.de", "gmx.fr", "free.fr",
  "laposte.net", "wanadoo.fr",
]);

type Account = {
  id: string;
  user_id: string;
  email_address: string;
  smtp_host: string;
  imap_host: string;
  credentials_secret_id: string | null;
  sync_cursor: { uidValidity?: number; lastUid?: number };
};

// ---------------------------------------------------------------------------
// Bornes de la relève — la panne du 16 août 2026 vient de leur absence.
//
// L'ancienne boucle lisait `${lastUid + 1}:*` : tout l'arriéré d'un coup,
// simpleParser sur chaque message, et le curseur écrit SEULEMENT après la
// boucle. Le worker mourait sur son quota CPU avant d'y arriver, le curseur
// restait à 20, le tour suivant re-téléchargeait le même paquet — en pire,
// puisqu'il grossissait de tout ce qui arrivait entre-temps. Auto-aggravant :
// ça ne se serait jamais débloqué tout seul.
//
// Les quatre bornes ci-dessous, plus le curseur écrit APRÈS CHAQUE MESSAGE
// (voir syncAccount), garantissent qu'une relève progresse toujours, même
// tuée en plein vol.
// ---------------------------------------------------------------------------

/** Fenêtre UID lue par relève. Jamais de plage ouverte. */
const BATCH = 25;

/** Budget de temps d'une relève, tous comptes confondus. Le cron accorde 45 s.
 *  La borne est à 15 s pour qu'un dernier message déjà engagé (téléchargement
 *  du corps, jusqu'à MAX_PARSE_BYTES) puisse finir sans jamais faire dépasser
 *  25 s à la réponse. Le tour suivant (5 min) reprend au curseur — une boîte
 *  en retard se rattrape en quelques cycles au lieu de mourir en boucle. */
const SYNC_BUDGET_MS = 15_000;

/** En dessous de ce reliquat, on n'appelle plus le classifieur : l'email est
 *  inséré tel quel (`triage='a_traiter'`, `intent=null`) et le bouton
 *  « ✨ Analyser » de la carte fera le tri. Voir classifyBudget(). */
const CLASSIFY_RESERVE_MS = 8_000;

/**
 * Au-delà de cette taille, le corps n'est NI téléchargé NI analysé.
 *
 * C'est la vraie cause de la panne, mesurée le 19 août : UID 21 pesait
 * 6,3 Mo (et deux autres ~3 Mo). simpleParser décode les pièces jointes en
 * mémoire, et un seul message de cette taille consomme tout le quota CPU du
 * worker — avant même la première écriture de curseur. Borner le NOMBRE de
 * messages n'y pouvait rien : le premier suffisait à tuer la relève.
 *
 * Le message n'est pas perdu pour autant : son enveloppe (expéditeur, sujet,
 * date, fil de réponse) suffit à créer la ligne `emails`, à la rattacher au
 * prospect et à faire remonter la fiche. Seul le corps manque, et il est dans
 * Zoho. Voir un email sans son corps vaut infiniment mieux que ne pas le voir.
 *
 * 1 Mo sépare proprement le réel du monstrueux : les vraies réponses de
 * prospects mesurées ce jour-là allaient de 11 Ko à 290 Ko.
 */
const MAX_PARSE_BYTES = 1024 * 1024;

/** Volume total réellement analysé par relève — le reste roule au tour
 *  suivant. Ne compte que ce qui passe par simpleParser : c'est là qu'est le
 *  CPU, pas dans les enveloppes. */
const PARSE_BUDGET_BYTES = 4 * 1024 * 1024;

// ---------------------------------------------------------------------------
// Fil de discussion — un prospect, un seul fil, à vie.
//
// `send` n'a longtemps posé aucun en-tête de fil : chaque relance arrivait chez
// le prospect comme une sollicitation neuve, ce que les filtres anti-spam
// sanctionnent précisément. In-Reply-To et References ne sont pas des
// heuristiques, c'est le mécanisme normatif (RFC 5322) — sans eux Gmail et
// Outlook n'ont AUCUN moyen de rattacher le message.
//
// La règle qui couvre les trois cas (1re prise de contact, relance sans
// réponse, réponse à sa réponse) tient en une phrase : on s'accroche au
// DERNIER message du fil, toutes directions confondues. Chercher « mon dernier
// envoi » raterait le troisième cas, le plus important.
// ---------------------------------------------------------------------------

/** Préfixes de réponse/transfert à ne jamais empiler. `objet` est là pour une
 *  raison précise : un ancien envoi a laissé la chaîne littérale « Objet : »
 *  en tête d'un sujet stocké en base. */
const SUBJECT_PREFIX = /^\s*(?:re|ré|rep|rép|reponse|réponse|fw|fwd|tr|objet)\s*:\s*/i;

/** Retire tous les préfixes empilés — « RE : TR: Objet : x » → « x ». */
function stripSubjectPrefixes(subject: string | null | undefined): string {
  let out = (subject ?? "").trim();
  for (let i = 0; i < 10; i++) {
    const next = out.replace(SUBJECT_PREFIX, "").trim();
    if (next === out) break;
    out = next;
  }
  return out;
}

/** Sujet d'une réponse : « Re: » + le sujet de la RACINE du fil, jamais celui
 *  passé en paramètre. Un vrai client mail ne change pas le sujet en
 *  répondant, et Outlook regroupe encore par sujet. */
function threadSubject(rootSubject: string | null | undefined): string {
  const base = stripSubjectPrefixes(rootSubject);
  return base ? `Re: ${base}` : "Re:";
}

/** Un message du fil, tel qu'on en a besoin pour s'y accrocher. */
type ThreadRow = {
  direction: string;
  to_email: string | null;
  from_email: string | null;
  subject: string | null;
  message_id: string | null;
  thread_key: string | null;
  received_at: string;
};

/** Pourquoi la relève s'est arrêtée. Aucune de ces valeurs n'est une erreur :
 *  `sync_error` reste null, la raison se lit dans la réponse JSON. */
type StopReason =
  | "caught_up" // plus rien à lire : le curseur touche uidNext - 1
  | "batch_done" // fenêtre BATCH épuisée, il en reste — le prochain cron suit
  | "deadline" // budget de temps atteint
  | "bytes_budget" // budget d'octets analysés atteint
  | "cursor_reset"; // première relève (ou uidValidity changée) : curseur posé

type SyncOutcome = {
  imported: number;
  scanned: number;
  stopped_reason: StopReason;
  last_uid: number | null;
};

Deno.serve(async (req: Request) => {
  if (req.method !== "POST") return json({ error: "Méthode non autorisée" }, 405);

  const admin = createClient(SUPABASE_URL, SERVICE_KEY, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  let payload: Record<string, unknown>;
  try {
    payload = await req.json();
  } catch {
    return json({ error: "Corps de requête invalide" }, 400);
  }
  const action = String(payload.action ?? "");

  // ---- Authentification ----
  // sync : secret pg_cron (ou admin connecté). save_account / send : JWT.
  const cronSecret = req.headers.get("x-cron-secret");
  let callerId: string | null = null;
  let callerRole: string | null = null;

  const token = (req.headers.get("Authorization") ?? "").replace(/^Bearer\s+/i, "");
  if (token) {
    const { data: caller } = await admin.auth.getUser(token);
    if (caller?.user) {
      const { data: me } = await admin
        .from("crm_users")
        .select("id, role, is_active")
        .eq("id", caller.user.id)
        .maybeSingle();
      if (me?.is_active) {
        callerId = me.id;
        callerRole = me.role;
      }
    }
  }

  try {
    switch (action) {
      // ---------------------------------------------------------------
      // Chacun connecte SA boîte. Réserver ce geste à l'admin obligeait Bora à
      // manipuler le mot de passe d'application d'un collègue — précisément ce
      // qu'on veut éviter. Un membre actif suffit ; c'est le `user_id` ÉCRIT
      // qui tient la cloison, et il vaut `callerId` sauf demande explicite
      // d'un admin agissant pour autrui.
      case "save_account": {
        if (!callerId) return json({ error: "Non authentifié" }, 401);

        // Le seul cas où l'identité écrite peut différer de l'appelant — et il
        // faut être admin pour l'obtenir. Jamais de user_id lu du payload pour
        // un non-admin : ce serait offrir la boîte d'autrui en écriture.
        const cible = String(payload.user_id ?? "").trim();
        let targetUser = callerId;
        if (cible && cible !== callerId) {
          if (callerRole !== "admin") {
            return json(
              { error: "Vous ne pouvez enregistrer que votre propre boîte." },
              403
            );
          }
          const { data: t } = await admin
            .from("crm_users")
            .select("id, is_active")
            .eq("id", cible)
            .maybeSingle();
          if (!t?.is_active) return json({ error: "Utilisateur inconnu ou inactif" }, 400);
          targetUser = t.id;
        }

        const email = String(payload.email_address ?? "").trim().toLowerCase();
        const password = String(payload.app_password ?? "");
        const dc = payload.datacenter === "eu" ? "eu" : "com";

        if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email)) {
          return json({ error: "Adresse email invalide" }, 400);
        }
        if (password.length < 8) {
          return json({ error: "Mot de passe d'application requis" }, 400);
        }

        // `email_address` est UNIQUE : sans ce garde-fou, enregistrer l'adresse
        // déjà connectée par quelqu'un d'autre RÉÉCRIRAIT son user_id et lui
        // volerait sa boîte — avec, au passage, l'envoi sous son nom.
        const { data: existant } = await admin
          .from("email_accounts")
          .select("id, user_id")
          .eq("email_address", email)
          .maybeSingle();
        if (existant && existant.user_id !== targetUser) {
          return json(
            {
              error:
                "Cette adresse est déjà connectée par un autre utilisateur du CRM.",
            },
            409
          );
        }

        const { smtpHost, imapHost, style } = zohoHosts(email, dc, payload.hosts);

        // Test de connexion IMAP immédiat : les erreurs Zoho sont opaques,
        // autant les attraper à l'enregistrement (mauvais centre de données,
        // mauvais jeu d'hôtes, IMAP non activé, mot de passe erroné).
        let testError: string | null = null;
        try {
          const probe = new ImapFlow({
            host: imapHost,
            port: 993,
            secure: true,
            auth: { user: email, pass: password },
            logger: false,
            socketTimeout: 15000,
            greetingTimeout: 15000,
          });
          await probe.connect();
          await probe.logout();
        } catch (e) {
          testError = e instanceof Error ? e.message : String(e);
        }

        const { data: secretId, error: rpcErr } = await admin.rpc(
          "mail_store_credentials",
          { p_email: email, p_password: password }
        );
        if (rpcErr) return json({ error: rpcErr.message }, 400);

        const { error: upErr } = await admin.from("email_accounts").upsert(
          {
            user_id: targetUser,
            email_address: email,
            smtp_host: smtpHost,
            imap_host: imapHost,
            credentials_secret_id: secretId,
            sync_error: testError,
          },
          { onConflict: "email_address" }
        );
        if (upErr) return json({ error: upErr.message }, 400);

        return json({
          ok: true,
          tested: testError === null,
          test_error: testError,
          // Ce que l'appelant doit pouvoir relire : le mot de passe, lui, ne
          // ressort jamais et n'est jamais journalisé.
          hosts: style,
          smtp_host: smtpHost,
          imap_host: imapHost,
          imap_hint: testError ? imapHint(testError) : null,
        });
      }

      // ---------------------------------------------------------------
      case "send": {
        // Seconde voie d'authentification : appel serveur-à-serveur depuis le
        // connecteur MCP. Son jeton OAuth est un JWT HS256 signé par l'app —
        // Supabase Auth ne sait pas le vérifier, l'appel était donc rejeté et
        // aucun outil MCP ne pouvait envoyer d'email. Même motif que la relève
        // planifiée : un secret partagé du Vault, connu du seul service_role.
        //
        // Il AUTHENTIFIE l'appelant, il ne l'autorise à rien de plus : le rôle
        // est relu dans crm_users, et le contrôle d'accès au prospect (juste
        // en dessous) reste identique.
        //
        // `payload.user_id` n'est JAMAIS lu pour un appelant porteur d'un JWT :
        // la branche est gardée par `if (!callerId)`, donc un utilisateur
        // connecté agit sous SON identité et ne peut pas s'en déclarer une
        // autre. Elle n'est atteignable qu'avec le secret du Vault, que seul
        // le `service_role` peut lire (RPC mail_get_secret) — c'est-à-dire le
        // serveur MCP, qui y met le sujet de son jeton OAuth signé et rien
        // d'autre. Un client qui fabriquerait `user_id` sans le secret tombe
        // sur le 401 juste en dessous.
        if (!callerId) {
          const internalSecret = req.headers.get("x-internal-secret");
          const expected = internalSecret ? await getInternalSecret(admin) : null;
          if (internalSecret && expected && internalSecret === expected) {
            const uid = String(payload.user_id ?? "");
            if (uid) {
              const { data: me } = await admin
                .from("crm_users")
                .select("id, role, is_active")
                .eq("id", uid)
                .maybeSingle();
              if (me?.is_active) {
                callerId = me.id;
                callerRole = me.role;
              }
            }
          }
        }
        if (!callerId) return json({ error: "Non authentifié" }, 401);

        const prospectId = String(payload.prospect_id ?? "");
        const to = String(payload.to ?? "").trim().toLowerCase();
        const subject = String(payload.subject ?? "").trim().slice(0, 300);
        const body = String(payload.body ?? "").trim().slice(0, 20000);

        if (!prospectId || !to || !subject || !body) {
          return json({ error: "Destinataire, sujet et message requis" }, 400);
        }

        const { data: prospect } = await admin
          .from("prospects")
          .select("id, owner_id, company_name")
          .eq("id", prospectId)
          .maybeSingle();
        if (!prospect) return json({ error: "Prospect introuvable" }, 404);
        // Même règle que can_see_prospect : admin, ou propriétaire. Le vivier
        // (owner_id null) a été fermé le 25 août (migration 016) — la branche
        // qui le laissait passer est retirée ici aussi. Cette fonction est en
        // Deno et ne peut pas importer lib/crm/access.ts : toute évolution de
        // la règle doit être répercutée aux deux endroits.
        if (callerRole !== "admin" && prospect.owner_id !== callerId) {
          return json({ error: "Prospect non accessible" }, 403);
        }

        // Pas de boîte à soi, pas d'envoi. Surtout pas depuis celle d'un
        // autre : voir le commentaire de pickAccount.
        const account = await pickAccount(admin, callerId);
        if (!account) {
          return json(
            {
              error:
                "Vous n'avez pas encore connecté votre boîte email — Mon compte → Boîte email. " +
                "Un envoi depuis la boîte d'un collègue n'est pas possible : les réponses " +
                "lui reviendraient et le message partirait à son nom.",
            },
            400
          );
        }
        const password = await getPassword(admin, account);
        if (!password) return json({ error: "Identifiants de la boîte introuvables" }, 500);

        const { data: sender } = await admin
          .from("crm_users")
          .select("full_name")
          .eq("id", callerId)
          .maybeSingle();

        const domain = account.email_address.split("@")[1] ?? "celya.be";
        const messageId = `<crm-${crypto.randomUUID()}@${domain}>`;

        // ---- Fil de discussion (voir « Fil de discussion » en tête de fichier)
        // `new_thread` est l'échappatoire explicite : une offre vraiment
        // différente ne doit pas s'enterrer dans un vieux fil.
        const newThread = payload.new_thread === true;
        const { parent, rows } = newThread
          ? { parent: null, rows: [] as ThreadRow[] }
          : await findThreadParent(admin, prospect.id, to);

        let inReplyTo: string | null = null;
        let references: string[] = [];
        let threadKey = messageId; // racine par défaut : le message qu'on envoie
        let subjectUsed = subject;

        if (parent?.message_id) {
          inReplyTo = parent.message_id;
          const root = parent.thread_key ?? parent.message_id;
          threadKey = root;
          // References : la racine puis le parent, dédupliqués.
          references = root === parent.message_id ? [root] : [root, parent.message_id];
          // Le sujet du fil est celui de sa RACINE, pas celui du parent ni
          // celui passé en paramètre.
          const rootRow = rows.find((r) => r.message_id === root);
          subjectUsed = threadSubject(rootRow?.subject ?? parent.subject).slice(0, 300);
        }

        const transport = nodemailer.createTransport({
          host: account.smtp_host,
          port: 465,
          secure: true, // SSL — compte Zoho sur domaine propre
          auth: { user: account.email_address, pass: password },
        });

        await transport.sendMail({
          from: sender?.full_name
            ? `"${sender.full_name.replace(/"/g, "")}" <${account.email_address}>`
            : account.email_address,
          to,
          subject: subjectUsed,
          text: body,
          messageId,
          ...(inReplyTo
            ? { inReplyTo, references: references.join(" ") }
            : {}),
        });
        // Zoho range automatiquement le message dans « Envoyés » : la boîte
        // reste la source de vérité, le CRM n'en garde qu'une copie.

        const now = new Date().toISOString();
        await admin.from("emails").insert({
          prospect_id: prospect.id,
          direction: "sortant",
          from_name: sender?.full_name ?? null,
          from_email: account.email_address,
          to_email: to,
          subject: subjectUsed,
          body_text: body,
          message_id: messageId,
          in_reply_to: inReplyTo,
          thread_key: threadKey,
          mailbox: account.email_address,
          received_at: now,
          is_read: true,
          triage: "accepte",
        });

        await admin.from("activities").insert({
          prospect_id: prospect.id,
          author_id: callerId,
          type: "email",
          subject: subjectUsed,
          body: body.slice(0, 2000),
          occurred_at: now,
        });

        // `subject_used` : l'appelant doit savoir ce qui est réellement parti,
        // puisqu'une réponse reprend le sujet du fil et ignore le sien.
        return json({
          ok: true,
          message_id: messageId,
          subject_used: subjectUsed,
          in_reply_to: inReplyTo,
          thread_key: threadKey,
          new_thread: inReplyTo === null,
        });
      }

      // ---------------------------------------------------------------
      case "sync": {
        const authorized =
          callerRole === "admin" ||
          (cronSecret !== null && cronSecret === (await getCronSecret(admin)));
        if (!authorized) return json({ error: "Non autorisé" }, 401);

        const { data: accounts } = await admin
          .from("email_accounts")
          .select("id, user_id, email_address, smtp_host, imap_host, credentials_secret_id, sync_cursor");

        if (!accounts || accounts.length === 0) {
          return json({ ok: true, accounts: 0, imported: 0 });
        }

        // Budget partagé par tous les comptes : c'est la durée de la RÉPONSE
        // qui doit tenir sous le timeout du cron, pas celle d'un compte.
        const deadline = Date.now() + SYNC_BUDGET_MS;

        let imported = 0;
        let scanned = 0;
        const details: Array<Record<string, unknown>> = [];

        for (const account of accounts as Account[]) {
          let outcome: SyncOutcome | null = null;
          let failure: string | null = null;
          try {
            outcome = await syncAccount(admin, account, deadline);
            imported += outcome.imported;
            scanned += outcome.scanned;
          } catch (e) {
            failure = e instanceof Error ? e.message : String(e);
          } finally {
            // Observabilité honnête : la table dit ce qui s'est réellement
            // passé, et le try/finally garantit qu'elle est écrite même sur
            // échec. Une sortie sur budget n'est PAS une erreur — sync_error
            // reste null, la raison se lit dans la réponse.
            await admin
              .from("email_accounts")
              .update({ last_sync_at: new Date().toISOString(), sync_error: failure })
              .eq("id", account.id);
          }
          details.push({
            email: account.email_address,
            imported: outcome?.imported ?? 0,
            scanned: outcome?.scanned ?? 0,
            stopped_reason: outcome?.stopped_reason ?? "error",
            last_uid: outcome?.last_uid ?? null,
            error: failure,
          });
        }

        // Les compteurs du premier compte remontent à la racine : en pratique
        // il n'y en a qu'un (la boîte de Bora), et c'est ce qu'on lit au
        // déclenchement manuel.
        const head = details[0] ?? {};
        return json({
          ok: true,
          accounts: accounts.length,
          imported,
          scanned,
          stopped_reason: head.stopped_reason ?? null,
          last_uid: head.last_uid ?? null,
          comptes: details,
        });
      }

      // ---------------------------------------------------------------
      // Diagnostic en lecture seule : état de la boîte et TAILLE des
      // prochains messages, sans télécharger ni analyser un seul corps.
      // Les erreurs Zoho sont opaques et une relève qui meurt ne dit rien ;
      // c'est le pendant du test de connexion de save_account.
      case "probe": {
        const authorized =
          callerRole === "admin" ||
          (cronSecret !== null && cronSecret === (await getCronSecret(admin)));
        if (!authorized) return json({ error: "Non autorisé" }, 401);

        const { data: accounts } = await admin
          .from("email_accounts")
          .select("id, user_id, email_address, smtp_host, imap_host, credentials_secret_id, sync_cursor");

        const out: Array<Record<string, unknown>> = [];
        for (const account of (accounts ?? []) as Account[]) {
          try {
            out.push(await probeAccount(admin, account));
          } catch (e) {
            out.push({
              email: account.email_address,
              error: e instanceof Error ? e.message : String(e),
            });
          }
        }
        return json({ ok: true, comptes: out });
      }

      default:
        return json({ error: `Action inconnue : ${action}` }, 400);
    }
  } catch (e) {
    return json({ error: e instanceof Error ? e.message : "Erreur inattendue" }, 500);
  }
});

// ===========================================================================
// Helpers
// ===========================================================================

/**
 * La boîte de l'appelant — la SIENNE, ou rien.
 *
 * Cette fonction se terminait par `?? list[0]` : faute de boîte configurée,
 * l'appelant envoyait depuis celle de quelqu'un d'autre. Tant que Bora était
 * seul, le repli ne se voyait pas ; à deux, il signe les mails d'un commercial
 * du nom de Bora, fait revenir les réponses dans la mauvaise boîte, et engage
 * la réputation d'expéditeur de Bora sur une prospection qui n'est pas la
 * sienne. Une usurpation d'identité, involontaire mais réelle.
 *
 * Sans boîte, `send` échoue avec un message qui dit quoi faire — c'est la
 * seule issue acceptable.
 */
async function pickAccount(admin: SupabaseClient, userId: string): Promise<Account | null> {
  const { data } = await admin
    .from("email_accounts")
    .select("id, user_id, email_address, smtp_host, imap_host, credentials_secret_id, sync_cursor")
    .eq("user_id", userId)
    .order("created_at", { ascending: true })
    .limit(1)
    .maybeSingle();
  return (data as Account | null) ?? null;
}

// ---------------------------------------------------------------------------
// Zoho : deux familles de comptes, deux jeux d'hôtes
//
//   domaine personnalisé (@celya.be)  → imappro / smtppro
//   compte personnel (@zohomail.eu…)  → imap    / smtp
//
// Se tromper de jeu donne une erreur d'authentification opaque, indiscernable
// d'un mauvais mot de passe. Le domaine de l'adresse suffit à trancher : une
// adresse en `zoho.*` ou `zohomail.*` est un compte personnel, tout le reste
// est un domaine propre. `hosts` permet de forcer à la main les cas tordus.
// ---------------------------------------------------------------------------

type HostStyle = "perso" | "pro";

function zohoHosts(
  email: string,
  dc: string,
  forced: unknown
): { smtpHost: string; imapHost: string; style: HostStyle } {
  const domain = email.split("@")[1] ?? "";
  const deduced: HostStyle = /^zoho(mail)?\./i.test(domain) ? "perso" : "pro";
  const style: HostStyle =
    forced === "perso" || forced === "pro" ? forced : deduced;
  const p = style === "pro" ? "pro" : "";
  return {
    smtpHost: `smtp${p}.zoho.${dc}`,
    imapHost: `imap${p}.zoho.${dc}`,
    style,
  };
}

/**
 * Traduire l'erreur Zoho, qui ne veut rien dire pour qui la lit.
 *
 * Zoho n'ouvre plus l'accès IMAP sur le plan gratuit aux nouveaux inscrits :
 * un compte personnel gratuit échouera donc au test, et le message brut
 * ("Invalid credentials" / "AUTHENTICATE failed") laisse croire à une faute de
 * frappe dans le mot de passe. Ce n'en est pas une — c'est le plan.
 */
function imapHint(raw: string): string {
  const m = raw.toLowerCase();
  if (m.includes("auth") || m.includes("credential") || m.includes("login")) {
    return (
      "Zoho a refusé la connexion. Trois causes, dans l'ordre de fréquence : " +
      "(1) IMAP n'est pas activé — Paramètres → Comptes mail → IMAP ; sur un compte " +
      "personnel gratuit, Zoho ne le propose plus, un plan payant (Mail Lite, ~1 €/mois) " +
      "est requis. (2) Ce n'est pas un mot de passe d'application — il en faut un, " +
      "généré dans Mon compte → Sécurité → Mots de passe d'application (2FA activée), " +
      "jamais le mot de passe de connexion. (3) Mauvais centre de données : .eu ou .com, " +
      "il se lit dans l'URL de votre boîte."
    );
  }
  if (m.includes("timeout") || m.includes("econn") || m.includes("dns") || m.includes("getaddr")) {
    return (
      "Serveur Zoho injoignable. Vérifiez le centre de données (.eu / .com) et le type " +
      "de compte : une adresse sur votre propre domaine utilise imappro.zoho.*, " +
      "un compte Zoho personnel utilise imap.zoho.*."
    );
  }
  return "Vérifiez le centre de données (.eu / .com), l'activation d'IMAP et le mot de passe d'application.";
}

async function getPassword(admin: SupabaseClient, account: Account): Promise<string | null> {
  if (!account.credentials_secret_id) return null;
  const { data } = await admin.rpc("mail_get_credentials", {
    p_secret_id: account.credentials_secret_id,
  });
  return typeof data === "string" && data.length > 0 ? data : null;
}

async function getCronSecret(admin: SupabaseClient): Promise<string | null> {
  const { data } = await admin.rpc("mail_get_secret", { p_name: "crm_mail_cron_secret" });
  return typeof data === "string" ? data : null;
}

/** Secret partagé de l'envoi serveur-à-serveur (connecteur MCP → send). */
async function getInternalSecret(admin: SupabaseClient): Promise<string | null> {
  const { data } = await admin.rpc("mail_get_secret", {
    p_name: "crm_mail_internal_secret",
  });
  return typeof data === "string" && data.length > 0 ? data : null;
}

/**
 * Le dernier message échangé avec CE destinataire sur CETTE fiche, toutes
 * directions confondues — le message auquel on doit s'accrocher.
 *
 * Le filtre porte sur l'adresse et pas seulement sur `prospect_id` : une fiche
 * peut avoir plusieurs interlocuteurs, et répondre au message d'une autre
 * personne casserait le fil chez le destinataire.
 *
 * Le tri et le filtrage se font en mémoire volontairement : exprimer ce `or`
 * en PostgREST demanderait d'inliner l'adresse dans la chaîne de filtre, où un
 * `+` (adresse plus-taguée) se décode en espace. Le volume par fiche est de
 * quelques dizaines de lignes.
 */
async function findThreadParent(
  admin: SupabaseClient,
  prospectId: string,
  counterpart: string
): Promise<{ parent: ThreadRow | null; rows: ThreadRow[] }> {
  const { data } = await admin
    .from("emails")
    .select("direction, to_email, from_email, subject, message_id, thread_key, received_at")
    .eq("prospect_id", prospectId)
    .not("message_id", "is", null)
    .order("received_at", { ascending: false })
    .limit(100);

  const rows = (data ?? []) as ThreadRow[];
  const wanted = counterpart.toLowerCase();
  const parent =
    rows.find((r) =>
      r.direction === "sortant"
        ? (r.to_email ?? "").toLowerCase() === wanted
        : (r.from_email ?? "").toLowerCase() === wanted
    ) ?? null;
  return { parent, rows };
}

/** Le `thread_key` qu'un nouveau message doit porter : celui de son parent, à
 *  défaut le `message_id` du parent, à défaut le sien (c'est une racine). */
async function resolveThreadKey(
  admin: SupabaseClient,
  inReplyTo: string | null,
  ownMessageId: string
): Promise<string> {
  if (!inReplyTo) return ownMessageId;
  const { data } = await admin
    .from("emails")
    .select("thread_key, message_id")
    .eq("message_id", inReplyTo)
    .limit(1)
    .maybeSingle();
  if (!data) return ownMessageId;
  return data.thread_key ?? data.message_id ?? ownMessageId;
}

/** Écrit le curseur UID. Appelé après CHAQUE message : c'est ce qui empêche un
 *  worker tué de faire reperdre le travail déjà fait. */
async function writeCursor(
  admin: SupabaseClient,
  accountId: string,
  uidValidity: number,
  lastUid: number
): Promise<void> {
  await admin
    .from("email_accounts")
    .update({ sync_cursor: { uidValidity, lastUid } })
    .eq("id", accountId);
}

/**
 * Relève un compte : une fenêtre bornée de nouveaux messages depuis le curseur
 * UID, rattachement, insertion idempotente (message_id unique), classification
 * si le budget le permet.
 *
 * Trois garanties, dans cet ordre d'importance :
 *  1. le curseur avance après chaque message traité — un message analysé n'est
 *     jamais re-analysé, même si le worker meurt à l'itération suivante ;
 *  2. un message qui fait planter l'analyse est journalisé, le curseur avance
 *     QUAND MÊME : un mail malformé ne bloque pas la file pour toujours ;
 *  3. la boucle rend la main sur `deadline` — ce n'est pas une erreur, le tour
 *     de cron suivant reprend là où on s'est arrêté.
 */
async function syncAccount(
  admin: SupabaseClient,
  account: Account,
  deadline: number
): Promise<SyncOutcome> {
  const password = await getPassword(admin, account);
  if (!password) throw new Error("Identifiants introuvables dans le Vault");

  const client = new ImapFlow({
    host: account.imap_host,
    port: 993,
    secure: true,
    auth: { user: account.email_address, pass: password },
    logger: false,
    socketTimeout: 30000,
  });

  await client.connect();
  let imported = 0;
  let scanned = 0;
  let parsedBytes = 0;
  let lastUid: number | null = null;
  let stopped: StopReason = "caught_up";
  let brokeEarly = false;

  try {
    const lock = await client.getMailboxLock("INBOX");
    try {
      const mailbox = client.mailbox as { uidValidity: bigint; uidNext: number };
      const uidValidity = Number(mailbox.uidValidity);
      const cursor = account.sync_cursor ?? {};

      // Premier passage (ou boîte réinitialisée) : on pose le curseur sans
      // importer l'historique — le CRM ne lit que ce qui arrive ensuite.
      if (cursor.uidValidity !== uidValidity || typeof cursor.lastUid !== "number") {
        const start = mailbox.uidNext - 1;
        await writeCursor(admin, account.id, uidValidity, start);
        return { imported: 0, scanned: 0, stopped_reason: "cursor_reset", last_uid: start };
      }

      lastUid = cursor.lastUid;
      const highest = mailbox.uidNext - 1; // plus grand UID possible dans la boîte
      const from = cursor.lastUid + 1;
      if (from > highest) {
        return { imported: 0, scanned: 0, stopped_reason: "caught_up", last_uid: lastUid };
      }

      // Fenêtre FERMÉE, jamais `${from}:*`.
      const to = Math.min(from + BATCH - 1, highest);
      stopped = to >= highest ? "caught_up" : "batch_done";

      // Chargé une seule fois par relève, et seulement si un message en a
      // besoin — l'ancien code rechargeait jusqu'à 2000 prospects PAR MESSAGE.
      let websites: WebsiteRow[] | null = null;
      const loadWebsites = async (): Promise<WebsiteRow[]> =>
        (websites ??= await loadProspectWebsites(admin));

      // --- Temps 1 : les enveloppes seules (uid, taille, expéditeur, fil).
      // Aucun corps ne traverse le réseau : c'est quasi gratuit, et c'est ce
      // qui permet de décider AVANT de télécharger quoi que ce soit.
      const heads: Head[] = [];
      for await (const msg of client.fetch(
        `${from}:${to}`,
        { uid: true, size: true, envelope: true },
        { uid: true }
      )) {
        if (msg.uid < from || msg.uid > to) continue; // quirk imapflow
        const sender = msg.envelope?.from?.[0];
        heads.push({
          uid: msg.uid,
          size: msg.size ?? 0,
          messageId: msg.envelope?.messageId ?? null,
          inReplyTo: msg.envelope?.inReplyTo ?? null,
          subject: msg.envelope?.subject ?? null,
          date: msg.envelope?.date ?? null,
          fromAddress: (sender?.address ?? "").toLowerCase() || null,
          fromName: sender?.name || null,
        });
      }
      heads.sort((a, b) => a.uid - b.uid); // curseur strictement croissant

      // --- Temps 2 : message par message, dans l'ordre des UID.
      for (const head of heads) {
        if (Date.now() > deadline) {
          stopped = "deadline";
          brokeEarly = true;
          break;
        }
        // Un message trop gros ne consomme pas le budget d'analyse : il n'est
        // jamais analysé. On ne s'arrête que si un message ANALYSABLE ferait
        // déborder — et jamais avant d'en avoir traité au moins un, sinon un
        // gros message analysable bloquerait la file pour toujours.
        const parseable = head.size <= MAX_PARSE_BYTES;
        if (parseable && parsedBytes > 0 && parsedBytes + head.size > PARSE_BUDGET_BYTES) {
          stopped = "bytes_budget";
          brokeEarly = true;
          break;
        }

        scanned++;
        try {
          let parsed: ParsedMail | null = null;
          if (parseable) {
            const full = await client.fetchOne(
              String(head.uid),
              { uid: true, source: true },
              { uid: true }
            );
            const source = full ? full.source : null;
            if (source) {
              parsedBytes += source.length;
              // skipTextToHtml / skipTextLinks : mailparser construirait
              // `textAsHtml` et linkifierait le corps — du CPU pour un champ
              // que le CRM ne lit jamais. `skipHtmlToText` reste par défaut :
              // c'est lui qui donne `parsed.text` sur un message HTML seul,
              // et ce texte-là, on l'affiche.
              parsed = await simpleParser(source, {
                skipTextToHtml: true,
                skipTextLinks: true,
              });
            }
          } else {
            console.log(
              `crm-mail: uid=${head.uid} (${head.size} octets) trop gros — importé depuis son enveloppe, sans corps`
            );
          }

          if (await ingestMessage(admin, account, head, parsed, uidValidity, deadline, loadWebsites)) {
            imported++;
          }
        } catch (e) {
          // Un message illisible ne doit pas bloquer la file : on le trace et
          // on avance le curseur quand même, juste en dessous.
          console.error(
            `crm-mail: message uid=${head.uid} ignoré — ${e instanceof Error ? e.message : String(e)}`
          );
        }

        lastUid = Math.max(lastUid ?? 0, head.uid);
        await writeCursor(admin, account.id, uidValidity, lastUid);
      }

      // Plage parcourue jusqu'au bout : toute la fenêtre est examinée, même si
      // des UID y manquaient (messages supprimés). Sans ce rattrapage, un trou
      // de plus de BATCH UID bloquerait la file indéfiniment.
      if (!brokeEarly && (lastUid ?? 0) < to) {
        lastUid = to;
        await writeCursor(admin, account.id, uidValidity, to);
      }
    } finally {
      lock.release();
    }
  } finally {
    // Sortir d'un fetch en cours laisse la connexion à mi-course : on tente un
    // logout poli, mais sans jamais laisser le budget partir dedans.
    let timer: ReturnType<typeof setTimeout> | undefined;
    await Promise.race([
      client.logout().catch(() => {}),
      new Promise((r) => (timer = setTimeout(r, 3000))),
    ]);
    if (timer !== undefined) clearTimeout(timer);
    try {
      client.close();
    } catch {
      /* déjà fermée */
    }
  }

  return { imported, scanned, stopped_reason: stopped, last_uid: lastUid };
}

/** État de la boîte + taille des prochains messages, sans rien télécharger.
 *  `size` et `envelope` viennent de FETCH RFC822.SIZE / ENVELOPE : le serveur
 *  répond sans que le corps traverse le réseau, donc aucun coût CPU. */
async function probeAccount(
  admin: SupabaseClient,
  account: Account
): Promise<Record<string, unknown>> {
  const password = await getPassword(admin, account);
  if (!password) throw new Error("Identifiants introuvables dans le Vault");

  const client = new ImapFlow({
    host: account.imap_host,
    port: 993,
    secure: true,
    auth: { user: account.email_address, pass: password },
    logger: false,
    socketTimeout: 20000,
  });

  await client.connect();
  try {
    const lock = await client.getMailboxLock("INBOX");
    try {
      const mailbox = client.mailbox as {
        uidValidity: bigint;
        uidNext: number;
        exists: number;
      };
      const uidValidity = Number(mailbox.uidValidity);
      const cursor = account.sync_cursor ?? {};
      const highest = mailbox.uidNext - 1;
      const from = typeof cursor.lastUid === "number" ? cursor.lastUid + 1 : highest;
      const to = Math.min(from + BATCH - 1, highest);

      const messages: Array<Record<string, unknown>> = [];
      if (from <= highest) {
        for await (const msg of client.fetch(
          `${from}:${to}`,
          { uid: true, size: true, envelope: true },
          { uid: true }
        )) {
          if (msg.uid < from) continue;
          messages.push({
            uid: msg.uid,
            size: msg.size,
            date: msg.envelope?.date ?? null,
            from: msg.envelope?.from?.[0]?.address ?? null,
            subject: (msg.envelope?.subject ?? "").slice(0, 120),
          });
        }
      }

      return {
        email: account.email_address,
        uidValidity,
        uidNext: mailbox.uidNext,
        exists: mailbox.exists,
        cursor,
        window: { from, to, highest },
        messages,
      };
    } finally {
      lock.release();
    }
  } finally {
    await client.logout().catch(() => {});
  }
}

/** Ce que l'enveloppe IMAP donne à elle seule — assez pour identifier,
 *  rattacher et dater un message sans en télécharger le corps. */
type Head = {
  uid: number;
  size: number;
  messageId: string | null;
  inReplyTo: string | null;
  subject: string | null;
  date: Date | null;
  fromAddress: string | null;
  fromName: string | null;
};

/** Ce que le CRM lit d'un message analysé. */
type ParsedMail = {
  from?: { value?: Array<{ address?: string; name?: string }> };
  subject?: string;
  text?: string;
  html?: string | false;
  messageId?: string;
  inReplyTo?: string;
  date?: Date;
  headers?: { get(name: string): unknown; has(name: string): boolean };
};

/**
 * Insère un message. `parsed` est null quand le corps a été volontairement
 * laissé de côté (message trop gros) : l'enveloppe prend alors le relais pour
 * tout ce qui compte — qui écrit, à quel fil ça répond, quand.
 *
 * `true` si une ligne `emails` a été créée (l'idempotence par `message_id`
 * fait que rien n'est réinséré).
 */
async function ingestMessage(
  admin: SupabaseClient,
  account: Account,
  head: Head,
  parsed: ParsedMail | null,
  uidValidity: number,
  deadline: number,
  loadWebsites: () => Promise<WebsiteRow[]>
): Promise<boolean> {
  const fromAddr = parsed?.from?.value?.[0];
  const senderEmail = (fromAddr?.address ?? head.fromAddress ?? "").toLowerCase();
  if (!senderEmail) return false;
  // On ignore ce que la boîte s'envoie à elle-même.
  if (senderEmail === account.email_address.toLowerCase()) return false;

  const inReplyTo = parsed?.inReplyTo ?? head.inReplyTo ?? null;
  const prospectId = await matchProspect(admin, senderEmail, inReplyTo, loadWebsites);

  const messageId =
    parsed?.messageId ??
    head.messageId ??
    `<crm-sans-id-${uidValidity}-${head.uid}@${account.email_address}>`;
  // Même héritage que le chemin sortant : une conversation entière porte la
  // même racine côté CRM comme côté boîte mail.
  const threadKey = await resolveThreadKey(admin, inReplyTo, messageId);

  const receivedAt = (parsed?.date ?? head.date ?? new Date()).toISOString();
  // Corps absent : on le DIT, au lieu de laisser une fiche vide qui ferait
  // croire à un message sans contenu.
  const bodyText = parsed
    ? parsed.text ?? null
    : `[Corps non importé — message de ${(head.size / 1024 / 1024).toFixed(1)} Mo. À ouvrir dans Zoho.]`;

  const { data: inserted } = await admin
    .from("emails")
    .upsert(
      {
        prospect_id: prospectId,
        direction: "entrant",
        from_name: fromAddr?.name || head.fromName || null,
        from_email: senderEmail,
        to_email: account.email_address,
        subject: parsed?.subject ?? head.subject ?? null,
        body_text: bodyText,
        body_html: typeof parsed?.html === "string" ? parsed.html : null,
        message_id: messageId,
        in_reply_to: inReplyTo,
        thread_key: threadKey,
        mailbox: account.email_address,
        received_at: receivedAt,
        is_read: false,
        triage: "a_traiter",
      },
      { onConflict: "message_id", ignoreDuplicates: true }
    )
    .select("id")
    .maybeSingle();

  if (!inserted?.id) return false;
  if (prospectId) {
    await handleIncomingReply(
      admin,
      inserted.id,
      prospectId,
      {
        subject: parsed?.subject ?? head.subject ?? null,
        text: parsed?.text ?? null,
        date: parsed?.date ?? head.date ?? null,
        headers: parsed?.headers,
      },
      deadline
    );
  }
  return true;
}

type WebsiteRow = { id: string; domain: string };

/** Les domaines des prospects, normalisés une bonne fois. Chargé au plus une
 *  fois par relève (voir `loadWebsites` dans syncAccount) : cette requête
 *  partait auparavant pour CHAQUE message reçu. */
async function loadProspectWebsites(admin: SupabaseClient): Promise<WebsiteRow[]> {
  const { data } = await admin
    .from("prospects")
    .select("id, website")
    .not("website", "is", null)
    .limit(2000);
  const rows: WebsiteRow[] = [];
  for (const c of data ?? []) {
    const domain = String(c.website ?? "")
      .toLowerCase()
      .replace(/^https?:\/\//, "")
      .replace(/^www\./, "")
      .split(/[/?#]/)[0];
    if (domain) rows.push({ id: c.id, domain });
  }
  return rows;
}

/** Rattachement, dans l'ordre : email exact du prospect → fil de réponse
 *  (in_reply_to) → domaine du site web (jamais un domaine grand public).
 *  Sans correspondance : null — Bora rattache depuis « Non rattachés ». */
async function matchProspect(
  admin: SupabaseClient,
  senderEmail: string,
  inReplyTo: string | null,
  loadWebsites: () => Promise<WebsiteRow[]>
): Promise<string | null> {
  // 1. adresse exacte
  const { data: byEmail } = await admin
    .from("prospects")
    .select("id")
    .ilike("email", senderEmail)
    .limit(1)
    .maybeSingle();
  if (byEmail) return byEmail.id;

  // 2. réponse à un message envoyé par le CRM
  if (inReplyTo) {
    const { data: byThread } = await admin
      .from("emails")
      .select("prospect_id")
      .eq("message_id", inReplyTo)
      .not("prospect_id", "is", null)
      .limit(1)
      .maybeSingle();
    if (byThread?.prospect_id) return byThread.prospect_id;
  }

  // 3. domaine du site web
  const domain = senderEmail.split("@")[1] ?? "";
  if (!domain || PUBLIC_DOMAINS.has(domain)) return null;

  for (const { id, domain: site } of await loadWebsites()) {
    if (site === domain || site.endsWith(`.${domain}`) || domain.endsWith(`.${site}`) || site === `www.${domain}`) {
      return id;
    }
  }
  return null;
}

// ---------------------------------------------------------------------------
// Arrivée d'une réponse rattachée — la règle, dans l'ordre :
//  1. classification d'abord (si un fournisseur IA est configuré) — elle
//     seule sait reconnaître une absence écrite à la main ;
//  2. absence classée → la relance est DÉCALÉE au lendemain du retour,
//     jamais annulée, et le statut ne bouge pas ;
//  3. réponse automatique (en-têtes) non classée absence → on ne touche à
//     rien : un robot ne compte jamais comme une réponse ;
//  4. vraie réponse (ni auto, ni absence, ni hors-sujet) → la fiche est
//     tenue à jour : last_contact_at, a_appeler → contacte, relance
//     annulée — la carte remonte dans « À faire » avec l'action proposée.
// Les tâches « RDV … » ne sont jamais touchées.
// ---------------------------------------------------------------------------

/**
 * Combien de temps le classifieur a le droit de prendre, ou 0 s'il ne doit pas
 * être appelé du tout.
 *
 * Option (a) du cahier des charges — plutôt qu'une seconde fonction/queue (b).
 * Justification : le repli existe déjà et il est gratuit. Un email inséré sans
 * intent porte `triage='a_traiter'` et la carte « Réponses reçues » offre son
 * bouton « ✨ Analyser », qui refait exactement ce tri via le fournisseur
 * configuré sur Vercel (lib/ai/triage.ts). Une queue ajouterait une fonction,
 * un déclencheur et une sémantique de réessai pour le même résultat. Ici, il
 * n'y a qu'un budget à respecter.
 *
 * Le plafond dynamique compte autant que la réserve : le SDK Anthropic était
 * réglé sur 25 s de timeout, soit plus que le budget entier de la relève — un
 * seul appel lent suffisait à faire sauter la réponse.
 */
function classifyBudget(deadline: number): number {
  const left = deadline - Date.now();
  if (left < CLASSIFY_RESERVE_MS) return 0;
  return Math.min(15_000, left - 1_000);
}

async function handleIncomingReply(
  admin: SupabaseClient,
  emailId: string,
  prospectId: string,
  parsed: {
    subject?: string | null;
    text?: string | null;
    date?: Date | null;
    headers?: { get(name: string): unknown; has(name: string): boolean };
  },
  deadline: number
) {
  // L'insertion de l'email est déjà faite : la classification ne peut plus
  // empêcher Bora de voir la réponse, elle ne fait que l'enrichir.
  // Sans corps (message trop gros pour être analysé), il n'y a rien à classer :
  // la fiche remonte quand même, avec la carte « à trier ».
  const text = (parsed.text ?? "").slice(0, 4000);
  const budget = text ? classifyBudget(deadline) : 0;
  const proposal =
    budget > 0
      ? await classifyReply(
          admin,
          emailId,
          { subject: parsed.subject ?? "", text },
          budget
        )
      : null;

  if (proposal?.intent === "absence") {
    const due = proposal.dueAtISO ?? new Date(Date.now() + 7 * 86400000).toISOString();
    const targets = await openNonRdvTasks(admin, prospectId);
    if (targets.length > 0) {
      await admin.from("tasks").update({ due_at: due }).in("id", targets);
    }
    return;
  }
  if (isAutoReply(parsed)) return;
  if (proposal?.intent === "hors_sujet") return;

  await handleRealReply(admin, prospectId, (parsed.date ?? new Date()).toISOString());
}

async function openNonRdvTasks(
  admin: SupabaseClient,
  prospectId: string
): Promise<string[]> {
  const { data } = await admin
    .from("tasks")
    .select("id, title")
    .eq("prospect_id", prospectId)
    .eq("status", "a_faire");
  return (data ?? [])
    .filter((t: { title: string }) => !t.title.startsWith("RDV"))
    .map((t: { id: string }) => t.id);
}

/** En-têtes standard des réponses automatiques (absence, robots, listes). */
function isAutoReply(parsed: {
  headers?: { get(name: string): unknown; has(name: string): boolean };
}): boolean {
  const h = parsed.headers;
  if (!h || typeof h.get !== "function") return false;
  const auto = String(h.get("auto-submitted") ?? "").toLowerCase();
  if (auto && auto !== "no") return true;
  if (h.has("x-autoreply") || h.has("x-autorespond")) return true;
  const prec = String(h.get("precedence") ?? "").toLowerCase();
  return prec.includes("auto_reply") || prec.includes("bulk") || prec.includes("junk");
}

/**
 * Une vraie réponse d'un prospect : last_contact_at mis à jour, un prospect
 * « À appeler » passe « Contacté », et la relance en attente est annulée —
 * la carte « Réponses reçues » remonte dans À faire avec l'action suivante
 * proposée. Les tâches « RDV … » ne sont jamais touchées.
 */
async function handleRealReply(
  admin: SupabaseClient,
  prospectId: string,
  receivedAt: string
) {
  const { data: prospect } = await admin
    .from("prospects")
    .select("id, status, last_contact_at, status_locked, confidence_locked")
    .eq("id", prospectId)
    .maybeSingle();
  if (!prospect) return;

  const patch: Record<string, unknown> = {};
  if (
    !prospect.last_contact_at ||
    new Date(receivedAt).getTime() > new Date(prospect.last_contact_at).getTime()
  ) {
    patch.last_contact_at = receivedAt;
  }
  // Une réponse reçue est un fait fort — mais si Bora a fixé l'étape à la
  // main, son choix prime : on ne la réécrit jamais par-dessus (la fiche
  // affichera une suggestion). Même règle que lib/crm/status.ts, appliquée
  // ici parce que l'edge function (Deno) ne partage pas le code Next.
  if (prospect.status === "a_appeler" && !prospect.status_locked) {
    patch.status = "contacte";
    patch.status_auto_reason = "une réponse est arrivée par email";
    patch.status_auto_at = new Date().toISOString();
  }
  // Une nouvelle réponse rend l'ancien niveau de confiance caduc : la fiche
  // repasse honnêtement « à évaluer » (le recalcul IA se fait côté app, au
  // traitement de la réponse) — jamais par-dessus un niveau fixé à la main.
  // Même règle que lib/crm/confidence.ts, ré-appliquée ici (Deno).
  if (!prospect.confidence_locked) {
    patch.confidence_level = null;
    patch.confidence_reason = null;
    patch.confidence_at = new Date().toISOString();
  }
  if (Object.keys(patch).length > 0) {
    await admin.from("prospects").update(patch).eq("id", prospect.id);
  }

  const targets = await openNonRdvTasks(admin, prospectId);
  if (targets.length > 0) {
    await admin.from("tasks").update({ status: "annule" }).in("id", targets);
  }
}

/** 09:00 heure de Bruxelles pour un jour donné, en ISO UTC (DST correct). */
function brusselsNineAM(date: string): string {
  const guess = new Date(`${date}T09:00:00Z`);
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat("en-US", {
      timeZone: "Europe/Brussels",
      hour12: false,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
    })
      .formatToParts(guess)
      .map((p) => [p.type, p.value])
  ) as Record<string, string>;
  const asUTC = Date.UTC(
    Number(parts.year),
    Number(parts.month) - 1,
    Number(parts.day),
    Number(parts.hour === "24" ? "0" : parts.hour),
    Number(parts.minute),
    Number(parts.second)
  );
  const offsetMs = asUTC - guess.getTime();
  return new Date(guess.getTime() - offsetMs).toISOString();
}

// ---------------------------------------------------------------------------
// Classification de la réponse — même contrat de fournisseur que le reste :
// AGENT_PROVIDER=anthropic + ANTHROPIC_API_KEY/_MODEL (API Messages, SDK
// officiel), ou <FOURNISSEUR>_API_KEY/_BASE_URL/_MODEL au format OpenAI, en
// secrets de l'edge function. Absents → on ne saisit rien, tri manuel.
// ---------------------------------------------------------------------------

const INTENTS = [
  "interesse",
  "demande_info",
  "pas_interesse",
  "rappel_plus_tard",
  "absence",
  "hors_sujet",
] as const;

/** Appelle le fournisseur configuré. null si absent, en panne ou hors format. */
async function callClassifier(
  system: string,
  user: string,
  timeoutMs: number
): Promise<string | null> {
  const name = (Deno.env.get("AGENT_PROVIDER") ?? "minimax").trim();

  if (name.toLowerCase() === "anthropic") {
    const apiKey = Deno.env.get("ANTHROPIC_API_KEY");
    if (!apiKey) return null;
    try {
      // maxRetries: 0 — un réessai doublerait le temps réservé.
      const client = new Anthropic({ apiKey, timeout: timeoutMs, maxRetries: 0 });
      const response = await client.messages.create({
        model: Deno.env.get("ANTHROPIC_MODEL") ?? "claude-opus-5",
        max_tokens: 300,
        system,
        messages: [{ role: "user", content: user }],
      });
      if (response.stop_reason === "refusal") return null;
      const text = response.content
        .filter((b): b is Anthropic.TextBlock => b.type === "text")
        .map((b) => b.text)
        .join("");
      return text || null;
    } catch {
      return null;
    }
  }

  const prefix = name.toUpperCase().replace(/[^A-Z0-9]/g, "_");
  const apiKey = Deno.env.get(`${prefix}_API_KEY`);
  const baseUrl = Deno.env.get(`${prefix}_BASE_URL`)?.replace(/\/+$/, "");
  const model = Deno.env.get(`${prefix}_MODEL`);
  if (!apiKey || !baseUrl || !model) return null;

  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    const res = await fetch(`${baseUrl}/chat/completions`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
      body: JSON.stringify({
        model,
        temperature: 0,
        max_tokens: 300,
        messages: [
          { role: "system", content: system },
          { role: "user", content: user },
        ],
      }),
      signal: controller.signal,
    });
    clearTimeout(timer);
    if (!res.ok) return null;
    const data = await res.json();
    const content = data?.choices?.[0]?.message?.content;
    return typeof content === "string" ? content : null;
  } catch {
    return null;
  }
}

/**
 * Classe la réponse et remplit la carte « Réponses reçues » (intent, résumé,
 * date proposée). Classification pure : elle ne touche NI au statut NI aux
 * tâches — c'est handleIncomingReply qui applique la règle. null si le
 * fournisseur est absent, en panne ou hors format (tri manuel).
 */
async function classifyReply(
  admin: SupabaseClient,
  emailId: string,
  mail: { subject: string; text: string },
  timeoutMs: number
): Promise<{ intent: (typeof INTENTS)[number]; dueAtISO: string | null } | null> {
  const today = new Date().toISOString().slice(0, 10);
  const system = `Tu tries la réponse email d'un prospect belge à un email de prospection. Nous sommes le ${today}.
Réponds UNIQUEMENT avec un objet JSON :
{
  "intent": une valeur parmi ${JSON.stringify(INTENTS)},
  "date_rappel": date d'action déduite au format "YYYY-MM-DD", sinon null — pour une absence ("je suis en congé jusqu'au 20"), le LENDEMAIN du retour,
  "action": la prochaine action proposée, en une courte phrase française,
  "resume": résumé de la réponse en une phrase,
  "confidence": nombre entre 0 et 1
}`;

  try {
    const content = await callClassifier(
      system,
      `Sujet : ${mail.subject}\n\n${mail.text}`,
      timeoutMs
    );
    if (!content) return null; // pas configuré ou en panne : tri manuel

    const start = content.indexOf("{");
    const end = content.lastIndexOf("}");
    if (start === -1 || end <= start) return null;
    const parsed = JSON.parse(content.slice(start, end + 1));

    const intent = INTENTS.includes(parsed.intent) ? parsed.intent : null;
    if (!intent) return null;
    const dateOk =
      typeof parsed.date_rappel === "string" && /^\d{4}-\d{2}-\d{2}$/.test(parsed.date_rappel)
        ? parsed.date_rappel
        : null;
    const dueAtISO = dateOk ? brusselsNineAM(dateOk) : null;
    const confidence =
      typeof parsed.confidence === "number" && parsed.confidence >= 0 && parsed.confidence <= 1
        ? parsed.confidence
        : null;

    await admin
      .from("emails")
      .update({
        intent,
        intent_confidence: confidence,
        intent_summary:
          [parsed.resume, parsed.action].filter((s) => typeof s === "string" && s).join(" — ").slice(0, 400) || null,
        proposed_due_at: dueAtISO,
      })
      .eq("id", emailId);

    return { intent, dueAtISO };
  } catch {
    // classification optionnelle : jamais bloquante pour la relève
    return null;
  }
}
