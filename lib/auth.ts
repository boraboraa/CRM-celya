import { cache } from "react";
import { createClient } from "@/lib/supabase/server";
import type { Profile } from "@/lib/types";

export type Session = {
  userId: string;
  email: string;
  me: Profile | null;
};

/** Utilisateur connecté + sa fiche CRM (null si le compte n'existe pas encore). */
export const getSession = cache(async (): Promise<Session | null> => {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return null;

  const { data: me } = await supabase
    .from("crm_users")
    .select("*")
    .eq("id", user.id)
    .maybeSingle();

  return { userId: user.id, email: user.email ?? "", me: (me as Profile) ?? null };
});

export async function requireMember(): Promise<Session & { me: Profile }> {
  const session = await getSession();
  if (!session?.me?.is_active) {
    throw new Error("Compte inactif");
  }
  return session as Session & { me: Profile };
}
