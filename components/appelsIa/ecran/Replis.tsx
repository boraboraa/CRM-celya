/**
 * Ce qui ne sert pas tous les jours, replié : les réglages avancés (fenêtre,
 * durées, plafonds, limites du compte, trunk, voix, modèle) et les scripts
 * d'appel. En bas de « Mise en route » et de « Campagnes », sans encombrer
 * ni l'une ni l'autre.
 *
 * Composant SERVEUR. L'ancre `#reglages-avances` est celle du lien « Modifier »
 * du récapitulatif de l'assistant.
 */

import type { PageAppels } from "@/lib/appelsIa/lectures";
import type { ReglagesAppels } from "@/lib/appelsIa/acces";
import { enMinutes, heureFr } from "@/lib/appelsIa/calendrier";
import { Reglages } from "./Reglages";
import { Scripts } from "./Scripts";
import { Repliable } from "./commun";

export function Replis({ page, r, maintenant }: { page: PageAppels; r: ReglagesAppels; maintenant: Date }) {
  const debut = heureFr(enMinutes(r.fenetre_debut.slice(0, 5)));
  const fin = heureFr(enMinutes(r.fenetre_fin.slice(0, 5)));
  return (
    <div className="space-y-4">
      <div id="reglages-avances" className="scroll-mt-24">
        <Repliable titre="Réglages avancés" compte={`${debut}–${fin} · ${r.plafond_heure}/h · ${r.plafond_jour}/jour`} icone="reglages">
          <Reglages
            r={{
              fenetre_debut: r.fenetre_debut,
              fenetre_fin: r.fenetre_fin,
              plafond_heure: r.plafond_heure,
              plafond_jour: r.plafond_jour,
              limite_compte_heure: r.limite_compte_heure,
              limite_compte_jour: r.limite_compte_jour,
              duree_max_s: r.duree_max_s,
              sonnerie_max_s: r.sonnerie_max_s,
              trunk_url: r.trunk_url,
              voix: r.voix,
              modele: r.modele,
              modele_delegation: r.modele_delegation,
            }}
          />
        </Repliable>
      </div>
      <Scripts scripts={page.scripts} maintenant={maintenant} />
    </div>
  );
}
