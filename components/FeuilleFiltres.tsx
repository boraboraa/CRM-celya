"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Icone } from "@/components/ui";
import { FeuilleBas } from "@/components/FeuilleBas";
import { ListeOptionsPerimetre } from "@/components/PucePerimetre";

/** Un choix de la feuille : un lien déjà construit par la page (des chaînes). */
export type LienFiltre = { href: string; label: string; actif: boolean };
type OptionPerimetre = LienFiltre & { personne: boolean };
/** Le menu « Région » : des liens rangés par groupe (31 choix : un menu, pas des puces). */
export type MenuRegion = { tous: LienFiltre; groupes: [string, LienFiltre[]][] };

/**
 * /prospects sur téléphone (19/10) : la recherche reste à l'écran, TOUT le
 * reste — vue, périmètre, étape, tri, « Emails envoyés », « À débriefer » —
 * passe dans UNE feuille, derrière une puce « Filtres ». Les filtres posés
 * restent visibles en puces retirables, sous la recherche : la première fiche
 * remonte dans le premier écran sans qu'aucun filtre ne disparaisse en silence.
 *
 * Aucun filtre n'est calculé ici : chaque choix est un lien construit par la
 * page (`hrefProspects`, lib/crm/filtresProspects.ts).
 */
export function FeuilleFiltres({
  nbActifs,
  vues,
  perimetre,
  etapes,
  tris,
  raccourcis,
  regions = null,
}: {
  nbActifs: number;
  vues: LienFiltre[];
  perimetre: OptionPerimetre[] | null;
  etapes: LienFiltre[];
  /** null en colonnes (on n'y trie pas). */
  tris: LienFiltre[] | null;
  raccourcis: LienFiltre[];
  regions?: MenuRegion | null;
}) {
  const router = useRouter();
  const [ouvert, setOuvert] = useState(false);
  const fermer = () => setOuvert(false);
  return (
    <>
      <button
        type="button"
        onClick={() => setOuvert(true)}
        aria-haspopup="dialog"
        className={`inline-flex min-h-[44px] shrink-0 items-center gap-1.5 rounded-xl px-3.5 text-sm ring-1 transition active:scale-[0.98] ${
          nbActifs > 0
            ? "bg-celya-blue/15 text-blue-100 ring-celya-blue/40"
            : "bg-white/[0.03] text-slate-300 ring-white/10"
        }`}
      >
        <Icone nom="reglages" className="h-4 w-4" />
        Filtres
        {nbActifs > 0 && (
          <span className="rounded-full bg-celya-blue px-1.5 text-[11px] font-semibold text-white">
            {nbActifs}
          </span>
        )}
      </button>

      <FeuilleBas ouvert={ouvert} onFermer={fermer} titre="Filtres">
        <div className="space-y-5">
          {vues.length > 0 && (
            <Groupe titre="Affichage">
              <Segments liens={vues} onChoisir={fermer} />
            </Groupe>
          )}
          {perimetre && (
            <Groupe titre="Les fiches de">
              <ListeOptionsPerimetre options={perimetre} onChoisir={fermer} />
            </Groupe>
          )}
          <Groupe titre="Raccourcis">
            <Puces liens={raccourcis} onChoisir={fermer} />
          </Groupe>
          <Groupe titre="Étape">
            <Puces liens={etapes} onChoisir={fermer} />
          </Groupe>
          {regions && (
            <Groupe titre="Région">
              <select
                aria-label="Région"
                className="input min-h-[44px]"
                value={
                  [regions.tous, ...regions.groupes.flatMap(([, l]) => l)].find((l) => l.actif)?.href ??
                  regions.tous.href
                }
                onChange={(e) => {
                  fermer();
                  router.push(e.target.value, { scroll: false });
                }}
              >
                <option value={regions.tous.href}>{regions.tous.label}</option>
                {regions.groupes.map(([groupe, liens]) => (
                  <optgroup key={groupe} label={groupe}>
                    {liens.map((l) => (
                      <option key={l.href} value={l.href}>
                        {l.label}
                      </option>
                    ))}
                  </optgroup>
                ))}
              </select>
            </Groupe>
          )}
          {tris && (
            <Groupe titre="Trier par">
              {/* Cinq tris depuis « Commune » (28/10) : des puces qui passent
                  à la ligne — une rangée de segments débordait à 360 px. */}
              <Puces liens={tris} onChoisir={fermer} />
            </Groupe>
          )}
        </div>
      </FeuilleBas>
    </>
  );
}

function Groupe({ titre, children }: { titre: string; children: React.ReactNode }) {
  return (
    <section>
      <h3 className="label">{titre}</h3>
      {children}
    </section>
  );
}

function Segments({ liens, onChoisir }: { liens: LienFiltre[]; onChoisir: () => void }) {
  return (
    <div className="flex rounded-xl bg-white/[0.03] p-1 ring-1 ring-white/10">
      {liens.map((l) => (
        <Link
          prefetch={false}
          key={l.href}
          href={l.href}
          onClick={onChoisir}
          aria-current={l.actif ? "true" : undefined}
          className={`flex min-h-[44px] flex-1 items-center justify-center rounded-lg px-2 text-center text-sm leading-tight transition ${
            l.actif ? "bg-white/[0.09] text-slate-50 ring-1 ring-white/15" : "text-slate-400"
          }`}
        >
          {l.label}
        </Link>
      ))}
    </div>
  );
}

function Puces({ liens, onChoisir }: { liens: LienFiltre[]; onChoisir: () => void }) {
  return (
    <div className="flex flex-wrap gap-2">
      {liens.map((l) => (
        <Link
          prefetch={false}
          key={l.href + l.label}
          href={l.href}
          onClick={onChoisir}
          aria-current={l.actif ? "true" : undefined}
          className={`inline-flex min-h-[44px] items-center gap-1.5 rounded-xl px-3.5 text-sm ring-1 transition ${
            l.actif
              ? "bg-celya-blue/15 text-blue-100 ring-celya-blue/40"
              : "bg-white/[0.03] text-slate-300 ring-white/10"
          }`}
        >
          {l.actif && <Icone nom="coche" className="h-3.5 w-3.5" />}
          {l.label}
        </Link>
      ))}
    </div>
  );
}
