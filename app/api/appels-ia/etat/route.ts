/**
 * L'état du moteur pour la colonne « Appels » du tableau de bord, sondé tant
 * qu'un appel est en cours ou que la file n'est pas vide. Sous la session de
 * l'utilisateur : admin seul (RLS).
 */

import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { lireEtatAppels } from "@/lib/appelsIa/lectures";

export async function GET() {
  const supabase = await createClient();
  const etat = await lireEtatAppels(supabase);
  return NextResponse.json(etat, { headers: { "Cache-Control": "no-store" } });
}
