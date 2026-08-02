// Celya CRM — gestion des comptes de l'équipe.
// Appelée uniquement côté serveur (server actions Next.js) avec le JWT de
// l'utilisateur connecté. Le service_role reste dans l'edge function.
import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });

Deno.serve(async (req: Request) => {
  if (req.method !== "POST") return json({ error: "Méthode non autorisée" }, 405);

  const admin = createClient(SUPABASE_URL, SERVICE_KEY, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  // ---- Identifier l'appelant ----
  const token = (req.headers.get("Authorization") ?? "").replace(/^Bearer\s+/i, "");
  if (!token) return json({ error: "Non authentifié" }, 401);

  const { data: caller, error: callerErr } = await admin.auth.getUser(token);
  if (callerErr || !caller?.user) return json({ error: "Session invalide" }, 401);

  const { data: me } = await admin
    .from("crm_users")
    .select("id, role, is_active")
    .eq("id", caller.user.id)
    .maybeSingle();

  if (!me || !me.is_active || me.role !== "admin") {
    return json({ error: "Réservé aux administrateurs" }, 403);
  }

  let payload: Record<string, unknown>;
  try {
    payload = await req.json();
  } catch {
    return json({ error: "Corps de requête invalide" }, 400);
  }

  const action = String(payload.action ?? "");

  try {
    switch (action) {
      // ---------------------------------------------------------------
      case "create_user": {
        const email = String(payload.email ?? "").trim().toLowerCase();
        const password = String(payload.password ?? "");
        const fullName = String(payload.full_name ?? "").trim();
        const role = payload.role === "admin" ? "admin" : "commercial";

        if (!email || password.length < 10) {
          return json({ error: "Email requis et mot de passe d'au moins 10 caractères" }, 400);
        }

        const { data, error } = await admin.auth.admin.createUser({
          email,
          password,
          email_confirm: true, // aucun email de confirmation à envoyer
          user_metadata: {
            full_name: fullName || email.split("@")[0],
            role,
            is_active: true,
            must_change_password: true,
          },
        });
        if (error) return json({ error: error.message }, 400);

        // Upsert : ne dépend pas du trigger on_auth_user_created.
        const { error: upsertErr } = await admin.from("crm_users").upsert(
          {
            id: data.user!.id,
            email,
            full_name: fullName || email.split("@")[0],
            role,
            is_active: true,
            must_change_password: true,
          },
          { onConflict: "id" }
        );
        if (upsertErr) return json({ error: upsertErr.message }, 400);

        return json({ ok: true, user_id: data.user!.id });
      }

      // ---------------------------------------------------------------
      case "set_password": {
        const userId = String(payload.user_id ?? "");
        const password = String(payload.password ?? "");
        if (!userId || password.length < 10) {
          return json({ error: "Mot de passe d'au moins 10 caractères requis" }, 400);
        }
        const { error } = await admin.auth.admin.updateUserById(userId, { password });
        if (error) return json({ error: error.message }, 400);
        await admin.from("crm_users").update({ must_change_password: true }).eq("id", userId);
        return json({ ok: true });
      }

      // ---------------------------------------------------------------
      case "set_active": {
        const userId = String(payload.user_id ?? "");
        const isActive = Boolean(payload.is_active);
        if (userId === me.id && !isActive) {
          return json({ error: "Impossible de désactiver son propre compte" }, 400);
        }
        const { error } = await admin
          .from("crm_users")
          .update({ is_active: isActive })
          .eq("id", userId);
        if (error) return json({ error: error.message }, 400);
        return json({ ok: true });
      }

      // ---------------------------------------------------------------
      case "set_role": {
        const userId = String(payload.user_id ?? "");
        const role = payload.role === "admin" ? "admin" : "commercial";
        if (userId === me.id && role !== "admin") {
          return json({ error: "Impossible de retirer son propre rôle admin" }, 400);
        }
        const { error } = await admin.from("crm_users").update({ role }).eq("id", userId);
        if (error) return json({ error: error.message }, 400);
        return json({ ok: true });
      }

      // ---------------------------------------------------------------
      case "delete_user": {
        const userId = String(payload.user_id ?? "");
        if (userId === me.id) {
          return json({ error: "Impossible de supprimer son propre compte" }, 400);
        }
        const { error } = await admin.auth.admin.deleteUser(userId);
        if (error) return json({ error: error.message }, 400);
        return json({ ok: true });
      }

      default:
        return json({ error: `Action inconnue : ${action}` }, 400);
    }
  } catch (e) {
    return json({ error: e instanceof Error ? e.message : "Erreur inattendue" }, 500);
  }
});
