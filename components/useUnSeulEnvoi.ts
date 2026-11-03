"use client";

import { useRef } from "react";
import { creerVerrou, type Verrou } from "@/lib/unSeulEnvoi";

/** Le verrou d'un composant (lib/unSeulEnvoi.ts) — un par composant monté. */
export function useUnSeulEnvoi(): Verrou {
  const v = useRef<Verrou | null>(null);
  if (!v.current) v.current = creerVerrou();
  return v.current;
}
