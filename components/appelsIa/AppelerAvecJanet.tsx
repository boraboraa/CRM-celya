"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { appelerAvecJanetAction } from "@/app/appels-ia-actions";
import type { SuiviFiche } from "@/lib/appelsIa/lectures";
import { POINT_APPEL, STATUT_APPEL_LABEL, STATUT_FILE_LABEL } from "@/lib/appelsIa/libelles";
import { relative } from "@/lib/constants";
import { Icone } from "@/components/ui";
import { useSondage } from "@/components/appelsIa/sondage";
import {
  appelFini,
  appelVivant,
  fileVivante,
  libelleAppel,
  pointAppel,
  quandFileLong,
} from "@/components/appelsIa/format";

type Avis = { ton: "ok" | "attente" | "erreur"; texte: string };

/** Classes complètes (règle JIT) : bleu = normal, ambre = attention, rose = refus. */
const TON_AVIS: Record<Avis["ton"], string> = {
  ok: "bg-celya-blue/10 text-blue-200 ring-blue-400/25",
  attente: "bg-amber-500/[0.08] text-amber-200 ring-amber-400/25",
  erreur: "bg-rose-500/10 text-rose-300 ring-rose-400/20",
};

/** Un appel vient-il de se terminer entre deux lectures ? (→ rafraîchir le journal) */
function vientDeFinir(avant: SuiviFiche, apres: SuiviFiche): boolean {
  const a = apres.appel;
  if (!a || !appelFini(a.statut)) return false;
  const b = avant.appel;
  return !b || b.id !== a.id || !appelFini(b.statut);
}

/**
 * « Appeler avec Janet », sur la fiche — ADMIN SEUL (la page ne le rend que
 * pour lui ; l'action le revérifie).
 *
 * Un clic met la fiche EN TÊTE de la file ; le moteur compose tout de suite
 * s'il en a le droit, sinon il dit pourquoi (« En file. Hors de la fenêtre
 * d'appel… »). Pas d'affichage optimiste, et c'est voulu : ce qu'il faut
 * montrer — « Janet appelle » ou « en file, parce que… » — est précisément ce
 * qu'on ignore avant la réponse. Le bouton dit « Lancement… » en attendant.
 *
 * Puis le composant SUIT l'appel (sondage de /api/appels-ia/suivi : 6 s, puis
 * 20 s, arrêt à 50 min — ou dès que l'appel est terminé et la file plus en
 * attente). À la fin d'un appel, `router.refresh()` : le journal de la fiche
 * reçoit ce que Janet y a écrit.
 *
 * Au chargement, il montre l'état existant (appel en cours, ligne de file,
 * dernier appel) ; il ne sonde d'emblée que si un appel est en cours ou que
 * la ligne de file est sur le point de passer.
 */
export function AppelerAvecJanet({
  prospectId,
  suivi,
}: {
  prospectId: string;
  /** L'état lu côté serveur (`lireSuiviFiche`) — de la donnée, rien d'autre. */
  suivi: SuiviFiche;
}) {
  const router = useRouter();
  const [etat, setEtat] = useState(suivi);
  // Un nouveau rendu serveur (après l'action, ou `router.refresh()`) prime.
  const [suiviVu, setSuiviVu] = useState(suivi);
  if (suivi !== suiviVu) {
    setSuiviVu(suivi);
    setEtat(suivi);
  }
  const etatRef = useRef(etat);
  useEffect(() => {
    etatRef.current = etat;
  });

  const [avis, setAvis] = useState<Avis | null>(null);
  const [suivre, setSuivre] = useState(false);
  const [relance, setRelance] = useState(0);
  const [pending, startTransition] = useTransition();

  const appel = etat.appel;
  const file = etat.file;
  const enLigne = appelVivant(appel?.statut);
  const enFile = fileVivante(file);
  // Une ligne de file qui ne passera que demain ne mérite pas qu'on sonde dès
  // l'ouverture de la fiche ; après un clic, si (voir `suivre`).
  const imminente =
    enFile && (file!.statut === "en_cours" || Date.parse(file!.pas_avant) <= Date.now() + 60_000);
  const actif = enLigne || (enFile && (suivre || imminente));

  useSondage<SuiviFiche>(
    `/api/appels-ia/suivi?prospect=${encodeURIComponent(prospectId)}`,
    actif,
    (d) => {
      if (!d?.disponible) return;
      const avant = etatRef.current;
      setEtat(d);
      if (vientDeFinir(avant, d)) router.refresh();
    },
    relance
  );

  function appeler() {
    setAvis(null);
    startTransition(async () => {
      const r = await appelerAvecJanetAction(prospectId);
      if (r?.error) {
        setAvis({ ton: "erreur", texte: r.error });
        return;
      }
      const texte = r?.message ?? "C'est parti.";
      setAvis({ ton: texte.startsWith("En file") ? "attente" : "ok", texte });
      setSuivre(true);
      setRelance((n) => n + 1);
    });
  }

  return (
    <div className="card space-y-3 p-5">
      <button
        type="button"
        onClick={appeler}
        disabled={pending || enLigne}
        className="btn-ghost w-full"
      >
        <Icone nom="telephone" className="h-3.5 w-3.5" />
        {pending ? "Lancement…" : enLigne ? "Janet est en train d'appeler" : "Appeler avec Janet"}
      </button>

      {avis && (
        <p
          role={avis.ton === "erreur" ? "alert" : "status"}
          className={`rounded-xl px-3 py-2 text-xs leading-relaxed ring-1 ${TON_AVIS[avis.ton]}`}
        >
          {avis.texte}
        </p>
      )}

      <div aria-live="polite" className="space-y-1.5 text-xs">
        {/* L'appel en cours */}
        {appel && enLigne && (
          <p className="flex items-center gap-2 text-sm text-slate-100">
            <span aria-hidden className={`h-2 w-2 shrink-0 rounded-full ${POINT_APPEL.en_cours}`} />
            {STATUT_APPEL_LABEL[appel.statut] ?? appel.statut}
            <span className="text-xs text-slate-400">
              · essai {appel.essai}/3{appel.mode_test ? " · test" : ""}
            </span>
          </p>
        )}

        {/* La ligne de file qui attend son tour */}
        {file && enFile && !enLigne && (
          <p className="text-slate-300" suppressHydrationWarning>
            <span className="font-medium text-slate-100">En file</span> · essai{" "}
            {Math.min(file.essais + 1, 3)}/3 · {quandFileLong(file.pas_avant)}
            {file.mode_test ? " · test" : ""}
          </p>
        )}
        {file && enFile && !enLigne && file.derniere_note && (
          <p className="text-slate-500">{file.derniere_note}</p>
        )}

        {/* Le dernier appel terminé : résultat, puis ce que Janet en a dit */}
        {appel && !enLigne && (
          <div className="space-y-1">
            <p className="flex items-center gap-2 text-slate-300">
              <span
                aria-hidden
                className={`h-2 w-2 shrink-0 rounded-full ${POINT_APPEL[pointAppel(appel)] ?? POINT_APPEL.sans_reponse}`}
              />
              <span>
                <span className="text-slate-400" suppressHydrationWarning>
                  Dernier appel {relative(appel.fin_at ?? appel.created_at)} —{" "}
                </span>
                <span className="font-medium text-slate-100">{libelleAppel(appel)}</span>
                {appel.mode_test ? <span className="text-slate-500"> (test)</span> : null}
              </span>
            </p>
            {appel.interlocuteur && (
              <p className="text-slate-400">Interlocuteur : {appel.interlocuteur}</p>
            )}
            {appel.statut === "echec" ? (
              appel.erreur_message && (
                <p className="text-slate-400">
                  {appel.erreur_cote === "nous" ? "Panne de notre côté : " : ""}
                  {appel.erreur_message}
                </p>
              )
            ) : (
              appel.resume && (
                <p className="whitespace-pre-line leading-relaxed text-slate-300">{appel.resume}</p>
              )
            )}
          </div>
        )}

        {/* Un cycle clos : pourquoi la fiche n'est plus dans la file */}
        {file && !enFile && file.fin_motif && (
          <p className="text-slate-500">
            File : {(STATUT_FILE_LABEL[file.statut] ?? file.statut).toLowerCase()} — {file.fin_motif}
          </p>
        )}

        {!appel && !file && (
          <p className="text-slate-500">Janet n&apos;a jamais appelé cette fiche.</p>
        )}
      </div>
    </div>
  );
}
