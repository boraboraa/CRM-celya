/**
 * Ce qui ne sert pas tous les jours, replié : les réglages avancés — d'abord
 * la CONNEXION (clé OpenAI, identifiant et mot de passe SIP, posés UNE fois),
 * puis fenêtre, durées, plafonds, limites du compte, trunk, voix, modèle — et
 * les scripts d'appel. En bas de « Numéro & test » et de « Campagnes ».
 *
 * Composant SERVEUR. `connexionOuverte` (lien « Connexion technique à
 * finaliser → », `?connexion=1#connexion`) déplie le panneau côté serveur :
 * une ancre seule n'ouvre pas un `<details>` fermé. Ancres : `#connexion`, et
 * `#reglages-avances` pour le lien « Modifier » du récapitulatif.
 */

import type { PageAppels } from "@/lib/appelsIa/lectures";
import type { ReglagesAppels } from "@/lib/appelsIa/acces";
import { enMinutes, heureFr } from "@/lib/appelsIa/calendrier";
import { Reglages } from "./Reglages";
import { Scripts } from "./Scripts";
import { Repliable, TitreCarte } from "./commun";
import { LigneControle, type LigneControleVue } from "./LigneControle";

export function Replis({
  page,
  r,
  maintenant,
  connexion,
  connexionOuverte,
}: {
  page: PageAppels;
  r: ReglagesAppels;
  maintenant: Date;
  /** Les trois lignes de la connexion (secrets en écriture seule). */
  connexion: LigneControleVue[];
  connexionOuverte: boolean;
}) {
  const posees = connexion.filter((l) => l.fait).length;
  const debut = heureFr(enMinutes(r.fenetre_debut.slice(0, 5)));
  const fin = heureFr(enMinutes(r.fenetre_fin.slice(0, 5)));
  return (
    <div className="space-y-4">
      <div id="reglages-avances" className="scroll-mt-24">
        <Repliable
          titre="Réglages avancés"
          compte={`${posees === connexion.length ? "connexion posée" : "connexion à finaliser"} · ${debut}–${fin} · ${r.plafond_heure}/h · ${r.plafond_jour}/jour`}
          icone="reglages"
          ouvert={connexionOuverte}
        >
          <section id="connexion" className="mb-6 scroll-mt-24 rounded-xl bg-white/[0.02] p-3.5 ring-1 ring-white/[0.06] sm:p-4">
            <TitreCarte
              icone="cadenas"
              aside={
                <span className={posees === connexion.length ? "text-xs text-emerald-300" : "text-xs text-amber-300"}>
                  {posees} / {connexion.length}
                </span>
              }
            >
              Connexion
            </TitreCarte>
            <p className="mb-3 text-xs leading-relaxed text-slate-400">
              Se pose une seule fois. Les valeurs partent dans le coffre-fort de Supabase (Vault) et ne
              s&apos;affichent plus jamais, ici ni ailleurs ; pour en changer, posez-en une nouvelle.
            </p>
            <ul className="divide-y divide-white/[0.06]">
              {connexion.map((l) => (
                <LigneControle key={l.element} l={l} />
              ))}
            </ul>
          </section>
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
