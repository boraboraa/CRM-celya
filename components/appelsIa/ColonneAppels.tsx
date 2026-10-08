"use client";

import { useState } from "react";
import Link from "next/link";
import type { AppelResume, EtatAppels } from "@/lib/appelsIa/lectures";
import { POINT_APPEL, STATUT_APPEL_LABEL } from "@/lib/appelsIa/libelles";
import { EtiquetteJanet, Icone } from "@/components/ui";
import { useSondage } from "@/components/appelsIa/sondage";
import {
  heureCourte,
  libelleAppel,
  pointAppel,
  quandFile,
} from "@/components/appelsIa/format";

/**
 * La colonne « Appels » du tableau de bord — ADMIN SEUL (la page ne la rend
 * que pour lui, et seulement si la migration 025 est là).
 *
 * Elle dit, et rien d'autre : l'appel en cours et la file ; les chiffres du
 * jour ; le fil des derniers appels ; pourquoi le moteur ne compose pas, s'il
 * ne compose pas ; et où tout se règle (/appels-ia).
 *
 * Rendue d'abord côté serveur (`lireEtatAppels`, lu en parallèle du reste de
 * la page), elle se tient ensuite à jour en sondant /api/appels-ia/etat — mais
 * SEULEMENT tant qu'un appel est en cours ou que la file n'est pas vide. Une
 * journée calme ne coûte aucune requête.
 */
export function ColonneAppels({ initial }: { initial: EtatAppels }) {
  const [etat, setEtat] = useState(initial);
  // Un nouveau rendu serveur (navigation, revalidation) l'emporte sur la
  // dernière lecture sondée : c'est lui le plus frais à cet instant.
  const [initialVu, setInitialVu] = useState(initial);
  if (initial !== initialVu) {
    setInitialVu(initial);
    setEtat(initial);
  }

  const actif = etat.enCours !== null || etat.file.total > 0;
  useSondage<EtatAppels>(
    "/api/appels-ia/etat",
    actif,
    (d) => {
      // Une réponse « indisponible » (session perdue, droit retiré) ne vide
      // pas la colonne : on garde ce qu'on sait.
      if (d?.disponible) setEtat(d);
    }
  );

  const { enCours, file, jour, derniers, refus } = etat;
  const prochaine = file.prochaines.find((l) => l.statut === "en_attente") ?? null;
  const enPause = Boolean(etat.reglages?.pause_cause);

  return (
    <section aria-labelledby="colonne-appels-titre">
      <h2
        id="colonne-appels-titre"
        className="mb-3 flex items-center gap-2 font-display text-sm font-semibold uppercase tracking-wider text-slate-400"
      >
        Appels
        <EtiquetteJanet compact titre="Les appels de Janet, l'IA vocale" />
      </h2>

      <div className="card animate-rise divide-y divide-white/[0.05]">
        {/* ---- L'appel en cours, la file, et ce qui bloque ---- */}
        <div className="space-y-1.5 px-4 py-3">
          {enCours ? (
            <p className="flex min-w-0 items-center gap-2 text-sm">
              <span
                aria-hidden
                className={`h-2 w-2 shrink-0 rounded-full ${POINT_APPEL.en_cours}`}
              />
              <LienFiche
                appel={enCours}
                className="min-w-0 truncate font-medium text-slate-100"
              />
              <span className="shrink-0 text-xs text-blue-200">
                {STATUT_APPEL_LABEL[enCours.statut] ?? enCours.statut}
              </span>
            </p>
          ) : (
            <p className="text-sm text-slate-500">Aucun appel en cours.</p>
          )}
          {enCours && (
            <p className="pl-4 text-[11px] text-slate-400">
              Essai {enCours.essai}/3
              {enCours.mode_test ? " · test" : ""}
            </p>
          )}

          <p className="text-xs text-slate-400">
            {file.total === 0 ? (
              "File vide."
            ) : (
              <>
                File : <span className="font-medium text-slate-200">{file.total}</span>{" "}
                fiche{file.total > 1 ? "s" : ""}
                {prochaine && (
                  <>
                    {" "}
                    · ensuite{" "}
                    {prochaine.prospect_id ? (
                      <Link
                        href={`/prospects/${prochaine.prospect_id}`}
                        prefetch={false}
                        className="text-slate-200 underline-offset-2 hover:text-celya-blue hover:underline"
                      >
                        {prochaine.societe ?? "une fiche"}
                      </Link>
                    ) : (
                      (prochaine.societe ?? "une fiche")
                    )}{" "}
                    <span suppressHydrationWarning>{quandFile(prochaine.pas_avant)}</span>
                  </>
                )}
              </>
            )}
          </p>

          {/* Pourquoi le moteur ne compose pas — une ligne, discrète. Ambre
              seulement pour une PAUSE : c'est elle qui demande un geste. */}
          {refus && (
            <p
              className={`flex items-start gap-1.5 text-[11px] leading-snug ${
                enPause ? "text-amber-300" : "text-slate-500"
              }`}
            >
              {enPause && <Icone nom="alerte" className="mt-px h-3 w-3" />}
              <span>{refus}</span>
            </p>
          )}
        </div>

        {/* ---- Les chiffres du jour ---- */}
        <dl className="grid grid-cols-3 divide-x divide-white/[0.05] text-center">
          {(
            [
              ["Appelés", jour.appeles],
              ["Joints", jour.joints],
              ["RDV", jour.rdv],
            ] as const
          ).map(([libelle, n]) => (
            <div key={libelle} className="px-2 py-2.5">
              <dt className="text-[10px] font-medium uppercase tracking-wider text-slate-500">
                {libelle}
              </dt>
              <dd className="mt-0.5 font-display text-lg font-semibold tabular-nums text-slate-50">
                {n}
              </dd>
            </div>
          ))}
        </dl>

        {/* ---- Le fil des derniers appels : une ligne chacun ---- */}
        {derniers.length === 0 ? (
          <p className="px-4 py-3 text-xs text-slate-500">
            Janet n&apos;a encore passé aucun appel.
          </p>
        ) : (
          <ul className="px-2 py-1.5">
            {derniers.map((a) => (
              <li key={a.id}>
                <LigneAppel appel={a} />
              </li>
            ))}
          </ul>
        )}

        <div className="px-4 py-2.5">
          <Link
            href="/appels-ia"
            prefetch={false}
            className="text-xs font-medium text-celya-blue underline-offset-2 hover:underline"
          >
            Réglages et file →
          </Link>
        </div>
      </div>
    </section>
  );
}

/** Le nom de la société, lien vers la fiche quand il y en a une. */
function LienFiche({ appel, className }: { appel: AppelResume; className: string }) {
  const nom = appel.societe ?? "Fiche";
  if (!appel.prospect_id) return <span className={className}>{nom}</span>;
  return (
    <Link
      href={`/prospects/${appel.prospect_id}`}
      prefetch={false}
      className={`${className} underline-offset-2 hover:text-celya-blue hover:underline`}
    >
      {nom}
    </Link>
  );
}

/** Une ligne du fil : point de couleur · société — résultat · heure. */
function LigneAppel({ appel: a }: { appel: AppelResume }) {
  const point = POINT_APPEL[pointAppel(a)] ?? POINT_APPEL.sans_reponse;
  const libelle = libelleAppel(a);
  // Le résumé de Janet, tel qu'elle l'a écrit, en infobulle : la ligne reste
  // une ligne, le détail est sur la fiche.
  const infobulle = [
    `${a.societe ?? "Fiche"} — ${libelle}`,
    a.mode_test ? "(appel de test)" : null,
    a.statut === "echec" && a.erreur_message ? a.erreur_message : a.resume,
  ]
    .filter(Boolean)
    .join("\n");

  const contenu = (
    <>
      <span aria-hidden className={`h-2 w-2 shrink-0 rounded-full ${point}`} />
      <span className="min-w-0 flex-1 truncate">
        <span className="text-slate-200">{a.societe ?? "Fiche"}</span>
        <span className="text-slate-400">
          {" "}
          — {libelle}
          {a.mode_test ? " (test)" : ""}
        </span>
      </span>
      <span suppressHydrationWarning className="shrink-0 tabular-nums text-slate-500">
        {heureCourte(a.created_at)}
      </span>
    </>
  );

  const classes =
    "flex min-w-0 items-center gap-2 rounded-lg px-2 py-1.5 text-xs transition";
  return a.prospect_id ? (
    <Link
      href={`/prospects/${a.prospect_id}`}
      prefetch={false}
      title={infobulle}
      className={`${classes} hover:bg-white/[0.04]`}
    >
      {contenu}
    </Link>
  ) : (
    <div title={infobulle} className={classes}>
      {contenu}
    </div>
  );
}
