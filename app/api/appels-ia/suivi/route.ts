/**
 * Le suivi d'appel d'une fiche, sondé par la fiche après « Appeler avec
 * Janet ». Sous la session de l'utilisateur : la RLS (admin seul) borne tout,
 * un non-admin reçoit « indisponible ».
 */

import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { lireSuiviFiche } from "@/lib/appelsIa/lectures";

export async function GET(req: Request) {
  const prospect = new URL(req.url).searchParams.get("prospect") ?? "";
  if (!/^[0-9a-f-]{36}$/.test(prospect)) return NextResponse.json({ disponible: false, appel: null, file: null }, { status: 400 });
  const supabase = await createClient();
  const suivi = await lireSuiviFiche(supabase, prospect);
  return NextResponse.json(suivi, { headers: { "Cache-Control": "no-store" } });
}
