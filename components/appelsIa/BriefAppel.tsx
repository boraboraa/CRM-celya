"use client";

import { useActionState, useEffect, useMemo, useState, useTransition } from "react";
import {
  enregistrerBriefAction,
  preparerBriefAction,
  type EtatAction,
} from "@/app/appels-ia-actions";
import type { BriefLu } from "@/lib/appelsIa/lectures";
import {
  CHAMP_LABEL,
  SOURCE_LABEL,
  type ContenuBrief,
  type InfoBrief,
} from "@/lib/appelsIa/brief";
import { Icone } from "@/components/ui";
import { dateBrief } from "@/components/appelsIa/format";

/** L'ordre de lecture du brief — celui dans lequel Janet le reçoit. */
const ORDRE = ["activite", "qui_demander", "ce_qu_on_sait", "accroche", "solution", "questions"] as const;
type Champ = (typeof ORDRE)[number];
const LISTES: ReadonlySet<Champ> = new Set(["ce_qu_on_sait", "questions"]);

/** Ce qui reste visible quand le brief est replié : de quoi savoir à qui l'on parle. */
const TOUJOURS_VISIBLES: ReadonlySet<Champ> = new Set(["activite", "qui_demander"]);

/** Au-delà, le brief se replie : la fiche se lit d'abord. */
const LONG_ELEMENTS = 4;
const LONG_CARACTERES = 420;

function elements(c: ContenuBrief, k: Champ): InfoBrief[] {
  const v = c[k];
  if (!v) return [];
  return Array.isArray(v) ? v : [v];
}

function texteSaisie(c: ContenuBrief, k: Champ): string {
  return elements(c, k)
    .map((i) => i.texte)
    .join("\n");
}

/** L'état du brief, en une phrase. */
function phraseEtat(brief: BriefLu | null): { texte: string; attention: boolean } {
  if (!brief) {
    return {
      texte: "Pas encore de brief : il sera préparé dès que la fiche entrera dans la file de Janet.",
      attention: false,
    };
  }
  if (brief.etat === "a_preparer") {
    return {
      texte: "À préparer : l'IA s'en charge dans les minutes qui viennent, ou maintenant avec « Préparer avec l'IA ».",
      attention: false,
    };
  }
  if (brief.etat === "minimal") {
    return {
      texte: "Minimal : seulement ce que dit la fiche. Janet appellera quand même et découvrira l'entreprise par ses questions.",
      attention: true,
    };
  }
  const quand = brief.updated_at ?? brief.prepare_at;
  return {
    texte: quand
      ? `Prêt — dernière mise à jour le ${new Date(quand).toLocaleDateString("fr-BE", {
          day: "2-digit",
          month: "2-digit",
          year: "numeric",
          timeZone: "Europe/Brussels",
        })}.`
      : "Prêt.",
    attention: false,
  };
}

/**
 * Le BRIEF D'APPEL d'une fiche — ce que Janet sait avant de composer. ADMIN
 * SEUL (la page ne le rend que pour lui ; les actions le revérifient).
 *
 * Chaque information porte sa SOURCE et sa DATE, en petit : la fiche, le site
 * web, l'IA, Claude, votre saisie, Janet. Puis ce que Janet a appris aux
 * appels précédents, en lecture. Pas de validation : le brief se modifie à
 * tout moment, et c'est la dernière version qui sert au prochain appel.
 *
 * Replié quand il est long — la fiche se lit d'abord.
 */
export function BriefAppel({
  prospectId,
  brief,
}: {
  prospectId: string;
  /** Lu côté serveur (`lireBrief`) ; null = pas encore de brief. */
  brief: BriefLu | null;
}) {
  const contenu: ContenuBrief = brief?.contenu ?? {};
  const appris = brief?.appris ?? [];

  const presents = ORDRE.filter((k) => elements(contenu, k).length > 0);
  const nbElements = presents.reduce((n, k) => n + elements(contenu, k).length, 0) + appris.length;
  const nbCaracteres =
    presents.reduce((n, k) => n + texteSaisie(contenu, k).length, 0) +
    appris.reduce((n, a) => n + a.texte.length, 0);
  const long = nbElements > LONG_ELEMENTS || nbCaracteres > LONG_CARACTERES;

  const [deplie, setDeplie] = useState(false);
  const [edition, setEdition] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [erreurIA, setErreurIA] = useState<string | null>(null);
  const [prepare, startPreparation] = useTransition();

  // L'identifiant de la fiche est lié ICI, côté client : une server action se
  // lie sans problème, et rien ne traverse la frontière que de la donnée.
  const enregistrer = useMemo(() => enregistrerBriefAction.bind(null, prospectId), [prospectId]);
  const [etatForm, envoyer, enregistrement] = useActionState<EtatAction, FormData>(enregistrer, {});

  // Enregistré : le formulaire se referme, le brief relu s'affiche.
  useEffect(() => {
    if (etatForm.ok) {
      setEdition(false);
      setMessage(etatForm.message ?? "Brief enregistré.");
    }
  }, [etatForm]);

  function preparer() {
    setMessage(null);
    setErreurIA(null);
    startPreparation(async () => {
      const r = await preparerBriefAction(prospectId);
      if (r?.error) setErreurIA(r.error);
      else setMessage(r?.message ?? "Brief préparé.");
    });
  }

  const etat = phraseEtat(brief);
  const visibles = long && !deplie ? presents.filter((k) => TOUJOURS_VISIBLES.has(k)) : presents;
  const caches = presents.length - visibles.length + (long && !deplie ? (appris.length > 0 ? 1 : 0) : 0);

  return (
    <div className="card space-y-4 p-5">
      <p className={`text-xs leading-relaxed ${etat.attention ? "text-amber-200" : "text-slate-400"}`}>
        {etat.texte}
      </p>

      {message && (
        <p role="status" className="rounded-xl bg-celya-blue/10 px-3 py-2 text-xs text-blue-200 ring-1 ring-blue-400/25">
          {message}
        </p>
      )}
      {erreurIA && (
        <p role="alert" className="rounded-xl bg-rose-500/10 px-3 py-2 text-xs text-rose-300 ring-1 ring-rose-400/20">
          {erreurIA}
        </p>
      )}

      {edition ? (
        <form action={envoyer} className="space-y-3">
          {ORDRE.map((k) => {
            const liste = LISTES.has(k);
            const id = `brief-${k}`;
            return (
              <div key={k}>
                <label htmlFor={id} className="label">
                  {CHAMP_LABEL[k]}
                  {liste && (
                    <span className="ml-1 normal-case tracking-normal text-slate-500">
                      — une ligne par élément
                    </span>
                  )}
                </label>
                {k === "qui_demander" ? (
                  <input id={id} name={k} defaultValue={texteSaisie(contenu, k)} className="input" />
                ) : (
                  <textarea
                    id={id}
                    name={k}
                    rows={liste ? 4 : 2}
                    defaultValue={texteSaisie(contenu, k)}
                    className="input resize-y"
                  />
                )}
              </div>
            );
          })}
          {etatForm.error && (
            <p role="alert" className="rounded-xl bg-rose-500/10 px-3 py-2 text-xs text-rose-300 ring-1 ring-rose-400/20">
              {etatForm.error}
            </p>
          )}
          <p className="text-[11px] text-slate-500">
            Un champ vidé est retiré du brief ; un champ inchangé garde sa source.
          </p>
          <div className="flex flex-wrap items-center gap-3">
            <button type="submit" disabled={enregistrement} className="btn-primary">
              {enregistrement ? "Enregistrement…" : "Enregistrer le brief"}
            </button>
            <button type="button" onClick={() => setEdition(false)} className="btn-link text-xs">
              Annuler
            </button>
          </div>
        </form>
      ) : (
        <>
          {presents.length === 0 && appris.length === 0 ? (
            <p className="text-sm text-slate-500">
              Rien encore : Janet ne connaît que le nom de l&apos;entreprise.
            </p>
          ) : (
            <dl className="space-y-3">
              {visibles.map((k) => (
                <div key={k}>
                  <dt className="text-[11px] font-medium uppercase tracking-wider text-slate-400">
                    {CHAMP_LABEL[k]}
                  </dt>
                  {LISTES.has(k) ? (
                    <dd>
                      <ul className="mt-1 space-y-1">
                        {elements(contenu, k).map((i, n) => (
                          <li key={n} className="flex gap-2 text-sm leading-snug text-slate-200">
                            <span aria-hidden className="mt-2 h-1 w-1 shrink-0 rounded-full bg-slate-500" />
                            <span className="min-w-0">
                              {i.texte} <Provenance info={i} />
                            </span>
                          </li>
                        ))}
                      </ul>
                    </dd>
                  ) : (
                    <dd className="mt-0.5 text-sm leading-snug text-slate-200">
                      {elements(contenu, k)[0].texte} <Provenance info={elements(contenu, k)[0]} />
                    </dd>
                  )}
                </div>
              ))}
            </dl>
          )}

          {/* Ce que Janet a appris en appelant — en lecture : c'est elle qui l'écrit. */}
          {appris.length > 0 && (!long || deplie) && (
            <div className="border-t border-white/[0.06] pt-3">
              <p className="text-[11px] font-medium uppercase tracking-wider text-slate-400">
                Ce que Janet a appris aux appels précédents
              </p>
              <ul className="mt-1.5 space-y-1.5">
                {appris.map((a, n) => (
                  <li key={a.appel_id ?? n} className="text-sm leading-snug text-slate-300">
                    <span className="mr-1.5 text-[11px] tabular-nums text-slate-500">
                      {dateBrief(a.date) || "—"}
                      {a.essai ? ` · essai ${a.essai}` : ""}
                    </span>
                    {a.texte}
                  </li>
                ))}
              </ul>
            </div>
          )}

          {long && (
            <button type="button" onClick={() => setDeplie((d) => !d)} className="btn-link text-xs">
              <Icone
                nom="chevron"
                className={`h-3 w-3 transition-transform ${deplie ? "rotate-180" : ""}`}
              />
              {deplie ? "Replier le brief" : `Tout le brief (${caches} bloc${caches > 1 ? "s" : ""} de plus)`}
            </button>
          )}

          <div className="flex flex-wrap items-center gap-x-4 gap-y-2 border-t border-white/[0.06] pt-3">
            <button
              type="button"
              onClick={() => {
                setMessage(null);
                setEdition(true);
              }}
              className="btn-link text-xs"
            >
              <Icone nom="note" className="h-3 w-3" />
              Modifier
            </button>
            <button
              type="button"
              onClick={preparer}
              disabled={prepare}
              title="L'IA complète ce qui manque, à partir de la fiche et du site — sans réécrire ce qui est déjà là."
              className="btn-link text-xs"
            >
              <Icone nom="etincelle" className="h-3 w-3" />
              {prepare ? "Préparation…" : "Préparer avec l'IA"}
            </button>
          </div>
        </>
      )}
    </div>
  );
}

/** La source et la date d'une information, en petit, à la suite du texte. */
function Provenance({ info }: { info: InfoBrief }) {
  const date = dateBrief(info.date);
  return (
    <span className="whitespace-nowrap text-[10px] text-slate-500">
      ({SOURCE_LABEL[info.source] ?? info.source}
      {date ? `, ${date}` : ""})
    </span>
  );
}
