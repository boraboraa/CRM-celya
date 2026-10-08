/**
 * L'en-tête de l'écran Appels IA : l'état du moteur en une phrase, la pause
 * s'il y en a une, ce qui manque avant le premier appel, les deux
 * interrupteurs (général, mode test) et les compteurs du jour.
 *
 * Composant SERVEUR : il ne passe aux composants clients que des données
 * (chaînes, nombres, booléens) — jamais une fonction.
 */

import { Icone } from "@/components/ui";
import { BandeauPause } from "./BandeauPause";
import { Interrupteur } from "./Interrupteur";
import { Aide, TitreCarte } from "./commun";
import type { PhraseEtat, TonEtat } from "./format";

/** Classes entières (règle JIT). Bleu = en marche, neutre = calme, ambre = attention. */
const POINT: Record<TonEtat, string> = {
  marche: "bg-celya-blue",
  calme: "bg-slate-500",
  attention: "bg-amber-400",
};
const TITRE: Record<TonEtat, string> = {
  marche: "font-display text-lg font-semibold text-slate-50",
  calme: "font-display text-lg font-semibold text-slate-200",
  attention: "font-display text-lg font-semibold text-amber-200",
};

function Tuile({ label, valeur, alerte = false }: { label: string; valeur: string | number; alerte?: boolean }) {
  return (
    <div className={alerte ? "bg-amber-500/10 px-3 py-2.5" : "bg-space px-3 py-2.5"}>
      <p
        className={
          alerte
            ? "font-display text-lg font-semibold text-amber-300"
            : "font-display text-lg font-semibold text-slate-100"
        }
      >
        {valeur}
      </p>
      <p className={alerte ? "text-[11px] text-amber-300/80" : "text-[11px] text-slate-500"}>{label}</p>
    </div>
  );
}

export function EtatMoteur({
  phrase,
  pause,
  aRegler,
  actif,
  modeTest,
  gsm,
  plafondJour,
  jour,
  fileTotal,
}: {
  phrase: PhraseEtat;
  pause: { cause: string; depuis: string | null } | null;
  /** Ce qui manque avant le premier appel (numéros, secrets). */
  aRegler: string[];
  actif: boolean;
  modeTest: boolean;
  /** Le GSM de test, lisible, ou null. */
  gsm: string | null;
  plafondJour: number;
  jour: { appeles: number; joints: number; rdv: number };
  fileTotal: number;
}) {
  return (
    <section className="card p-4 sm:p-5" aria-label="État du moteur">
      <TitreCarte
        icone="telephone"
        aside={
          modeTest ? (
            <span className="chip bg-amber-500/15 text-amber-300 ring-amber-400/25">
              <Icone nom="alerte" className="h-3 w-3" />
              Mode test
            </span>
          ) : (
            <span className="chip bg-white/[0.05] text-slate-300 ring-white/10">Appels réels</span>
          )
        }
      >
        État du moteur
      </TitreCarte>

      <div className="flex items-start gap-3">
        <span
          aria-hidden
          className={`mt-2 h-2.5 w-2.5 shrink-0 rounded-full ${POINT[phrase.ton]}`}
        />
        <div className="min-w-0">
          <p className={TITRE[phrase.ton]}>{phrase.titre}</p>
          {phrase.detail && (
            <p className="mt-0.5 break-words text-sm leading-relaxed text-slate-400">{phrase.detail}</p>
          )}
        </div>
      </div>

      {pause && <BandeauPause cause={pause.cause} depuis={pause.depuis} />}

      {aRegler.length > 0 && (
        <div className="mt-4">
          <p className="mb-2 text-xs text-slate-400">Avant le premier appel :</p>
          <div className="flex flex-wrap gap-2">
            {aRegler.map((x) => (
              <span key={x} className="chip bg-amber-500/15 text-amber-300 ring-amber-400/25">
                <Icone nom="alerte" className="h-3 w-3" />
                {x}
              </span>
            ))}
          </div>
        </div>
      )}

      <div className="mt-5 grid gap-5 border-t border-white/[0.06] pt-5 md:grid-cols-2">
        <Interrupteur
          champ="actif"
          valeur={actif}
          libelle="Interrupteur général"
          texteOui="Janet appelle les fiches de la file, une à la fois, dans la fenêtre d'appel et sous les plafonds."
          texteNon="Janet ne compose rien — c'est l'état de départ. L'appel de test reste possible."
          confirmation={
            modeTest
              ? null
              : {
                  versValeur: true,
                  texte:
                    "Le mode test est retiré : Janet appellera de vrais prospects dès que la fenêtre d'appel sera ouverte, et écrira chaque résultat sur leur fiche.",
                  bouton: "Allumer quand même",
                }
          }
        />
        <Interrupteur
          champ="mode_test"
          valeur={modeTest}
          libelle="Mode test"
          attentionSi={true}
          texteOui={`Tout appel part vers le GSM de test${gsm ? ` (${gsm})` : ""}, et rien n'est écrit sur les fiches.`}
          texteNon="Janet appelle les vrais numéros des fiches et écrit chaque résultat au journal."
          confirmation={{
            versValeur: false,
            texte:
              "Janet appellera les vrais numéros des fiches et écrira chaque résultat sur la fiche (résultat d'appel, rendez-vous, relance).",
            bouton: "Retirer le mode test",
          }}
        />
      </div>
      <Aide>
        Une ligne de file garde le mode de son entrée : changer de mode ne transforme jamais une file de
        test en vrais appels.
      </Aide>

      <div className="mt-5 grid grid-cols-2 gap-px overflow-hidden rounded-xl bg-white/[0.06] sm:grid-cols-4">
        <Tuile
          label="Composés aujourd'hui"
          valeur={`${jour.appeles} / ${plafondJour}`}
          alerte={jour.appeles >= plafondJour}
        />
        <Tuile label="Décrochés" valeur={jour.joints} />
        <Tuile label="Rendez-vous posés" valeur={jour.rdv} />
        <Tuile label="En file" valeur={fileTotal} />
      </div>
    </section>
  );
}
