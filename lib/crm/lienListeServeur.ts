import { cookies } from "next/headers";
import { FILTRES_COOKIE, lienListeProspects } from "./filtresProspects";

/**
 * Le lien « retour à la liste » côté SERVEUR (fiche, import, création,
 * « À faire ») : la liste retenue du jour, lue dans le cookie `celya_filtres`
 * et revalidée comme une URL (lib/crm/filtresProspects.ts).
 */
export async function lienListeServeur(): Promise<string> {
  return lienListeProspects((await cookies()).get(FILTRES_COOKIE)?.value, new Date());
}
