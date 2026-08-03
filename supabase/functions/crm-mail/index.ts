// Celya CRM — boîte Zoho dans les deux sens.
// - save_account : enregistre le compte (mot de passe d'application → Vault)
// - send         : envoi SMTP depuis la boîte de Bora + journalisation
// - sync         : relève IMAP (pg_cron toutes les 5 min, ou bouton admin)
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
      case "save_account": {
        if (callerRole !== "admin") return json({ error: "Réservé aux administrateurs" }, 403);

        const email = String(payload.email_address ?? "").trim().toLowerCase();
        const password = String(payload.app_password ?? "");
        const dc = payload.datacenter === "eu" ? "eu" : "com";

        if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email)) {
          return json({ error: "Adresse email invalide" }, 400);
        }
        if (password.length < 8) {
          return json({ error: "Mot de passe d'application requis" }, 400);
        }

        const smtpHost = `smtppro.zoho.${dc}`;
        const imapHost = `imappro.zoho.${dc}`;

        // Test de connexion IMAP immédiat : les erreurs Zoho sont opaques,
        // autant les attraper à l'enregistrement (mauvais centre de données,
        // IMAP non activé, mot de passe erroné).
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
            user_id: callerId,
            email_address: email,
            smtp_host: smtpHost,
            imap_host: imapHost,
            credentials_secret_id: secretId,
            sync_error: testError,
          },
          { onConflict: "email_address" }
        );
        if (upErr) return json({ error: upErr.message }, 400);

        return json({ ok: true, tested: testError === null, test_error: testError });
      }

      // ---------------------------------------------------------------
      case "send": {
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
        // Même règle que can_see_prospect : admin, propriétaire, ou vivier.
        if (
          callerRole !== "admin" &&
          prospect.owner_id !== null &&
          prospect.owner_id !== callerId
        ) {
          return json({ error: "Prospect non accessible" }, 403);
        }

        const account = await pickAccount(admin, callerId);
        if (!account) {
          return json({ error: "Aucune boîte email configurée (voir Mon compte)" }, 400);
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
          subject,
          text: body,
          messageId,
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
          subject,
          body_text: body,
          message_id: messageId,
          mailbox: account.email_address,
          received_at: now,
          is_read: true,
          triage: "accepte",
        });

        await admin.from("activities").insert({
          prospect_id: prospect.id,
          author_id: callerId,
          type: "email",
          subject,
          body: body.slice(0, 2000),
          occurred_at: now,
        });

        return json({ ok: true, message_id: messageId });
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

        let imported = 0;
        for (const account of accounts as Account[]) {
          try {
            imported += await syncAccount(admin, account);
            await admin
              .from("email_accounts")
              .update({ last_sync_at: new Date().toISOString(), sync_error: null })
              .eq("id", account.id);
          } catch (e) {
            await admin
              .from("email_accounts")
              .update({
                last_sync_at: new Date().toISOString(),
                sync_error: e instanceof Error ? e.message : String(e),
              })
              .eq("id", account.id);
          }
        }
        return json({ ok: true, accounts: accounts.length, imported });
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

async function pickAccount(admin: SupabaseClient, userId: string): Promise<Account | null> {
  const { data } = await admin
    .from("email_accounts")
    .select("id, user_id, email_address, smtp_host, imap_host, credentials_secret_id, sync_cursor")
    .order("created_at", { ascending: true });
  const list = (data ?? []) as Account[];
  return list.find((a) => a.user_id === userId) ?? list[0] ?? null;
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

/** Relève un compte : nouveaux messages depuis le curseur UID, rattachement,
 *  insertion idempotente (message_id unique), classification si configurée. */
async function syncAccount(admin: SupabaseClient, account: Account): Promise<number> {
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
  try {
    const lock = await client.getMailboxLock("INBOX");
    try {
      const mailbox = client.mailbox as { uidValidity: bigint; uidNext: number };
      const uidValidity = Number(mailbox.uidValidity);
      const cursor = account.sync_cursor ?? {};

      // Premier passage (ou boîte réinitialisée) : on pose le curseur sans
      // importer l'historique — le CRM ne lit que ce qui arrive ensuite.
      if (cursor.uidValidity !== uidValidity || typeof cursor.lastUid !== "number") {
        await admin
          .from("email_accounts")
          .update({ sync_cursor: { uidValidity, lastUid: mailbox.uidNext - 1 } })
          .eq("id", account.id);
        return 0;
      }

      const from = cursor.lastUid + 1;
      let maxUid = cursor.lastUid;

      for await (const msg of client.fetch(
        `${from}:*`,
        { uid: true, source: true },
        { uid: true }
      )) {
        if (msg.uid < from) continue; // quirk IMAP : x:* renvoie le dernier message
        maxUid = Math.max(maxUid, msg.uid);

        const parsed = await simpleParser(msg.source);
        const fromAddr = parsed.from?.value?.[0];
        const senderEmail = (fromAddr?.address ?? "").toLowerCase();
        if (!senderEmail) continue;
        // On ignore ce que la boîte s'envoie à elle-même.
        if (senderEmail === account.email_address.toLowerCase()) continue;

        const prospectId = await matchProspect(
          admin,
          senderEmail,
          parsed.inReplyTo ?? null
        );

        const { data: inserted } = await admin
          .from("emails")
          .upsert(
            {
              prospect_id: prospectId,
              direction: "entrant",
              from_name: fromAddr?.name || null,
              from_email: senderEmail,
              to_email: account.email_address,
              subject: parsed.subject ?? null,
              body_text: parsed.text ?? null,
              body_html: typeof parsed.html === "string" ? parsed.html : null,
              message_id: parsed.messageId ?? `<crm-sans-id-${uidValidity}-${msg.uid}@${account.email_address}>`,
              in_reply_to: parsed.inReplyTo ?? null,
              mailbox: account.email_address,
              received_at: (parsed.date ?? new Date()).toISOString(),
              is_read: false,
              triage: "a_traiter",
            },
            { onConflict: "message_id", ignoreDuplicates: true }
          )
          .select("id")
          .maybeSingle();

        if (inserted?.id) {
          imported++;
          if (prospectId) {
            await handleIncomingReply(admin, inserted.id, prospectId, parsed);
          }
        }
      }

      if (maxUid > cursor.lastUid) {
        await admin
          .from("email_accounts")
          .update({ sync_cursor: { uidValidity, lastUid: maxUid } })
          .eq("id", account.id);
      }
    } finally {
      lock.release();
    }
  } finally {
    await client.logout().catch(() => {});
  }
  return imported;
}

/** Rattachement, dans l'ordre : email exact du prospect → fil de réponse
 *  (in_reply_to) → domaine du site web (jamais un domaine grand public).
 *  Sans correspondance : null — Bora rattache depuis « Non rattachés ». */
async function matchProspect(
  admin: SupabaseClient,
  senderEmail: string,
  inReplyTo: string | null
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

  const { data: candidates } = await admin
    .from("prospects")
    .select("id, website")
    .not("website", "is", null)
    .limit(2000);
  for (const c of candidates ?? []) {
    const site = String(c.website ?? "")
      .toLowerCase()
      .replace(/^https?:\/\//, "")
      .replace(/^www\./, "")
      .split(/[/?#]/)[0];
    if (site && (site === domain || site.endsWith(`.${domain}`) || domain.endsWith(`.${site}`) || site === `www.${domain}`)) {
      return c.id;
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

async function handleIncomingReply(
  admin: SupabaseClient,
  emailId: string,
  prospectId: string,
  parsed: {
    subject?: string | null;
    text?: string | null;
    date?: Date | null;
    headers?: { get(name: string): unknown; has(name: string): boolean };
  }
) {
  const proposal = await classifyReply(admin, emailId, {
    subject: parsed.subject ?? "",
    text: (parsed.text ?? "").slice(0, 4000),
  });

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
    .select("id, status, last_contact_at")
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
  if (prospect.status === "a_appeler") patch.status = "contacte";
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
async function callClassifier(system: string, user: string): Promise<string | null> {
  const name = (Deno.env.get("AGENT_PROVIDER") ?? "minimax").trim();

  if (name.toLowerCase() === "anthropic") {
    const apiKey = Deno.env.get("ANTHROPIC_API_KEY");
    if (!apiKey) return null;
    try {
      const client = new Anthropic({ apiKey, timeout: 25000, maxRetries: 1 });
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
    const timer = setTimeout(() => controller.abort(), 25000);
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
  mail: { subject: string; text: string }
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
      `Sujet : ${mail.subject}\n\n${mail.text}`
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
