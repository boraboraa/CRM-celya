"use client";

import { useState } from "react";
import { reglerAppelsAction } from "@/app/appels-ia-actions";
import { numeroLisible } from "@/lib/appelsIa/numeros";
import { Aide, Retour } from "./commun";
import { useFormulaire } from "./formulaire";

export type ReglagesFormulaire = {
  fenetre_debut: string;
  fenetre_fin: string;
  plafond_heure: number;
  plafond_jour: number;
  limite_compte_heure: number;
  limite_compte_jour: number;
  duree_max_s: number;
  sonnerie_max_s: number;
  numero_appelant: string | null;
  gsm_test: string | null;
  trunk_url: string;
  voix: string;
  modele: string;
  modele_delegation: string;
  mode_test: boolean;
};

/** Un groupe de champs, titré : la fenêtre, les plafonds, les numéros… */
function Groupe({ titre, children }: { titre: string; children: React.ReactNode }) {
  return (
    <fieldset className="min-w-0 space-y-3 rounded-xl bg-white/[0.02] p-3.5 ring-1 ring-white/[0.06] sm:p-4">
      <legend className="px-1 text-xs font-medium text-slate-300">{titre}</legend>
      {children}
    </fieldset>
  );
}

function Champ({
  id,
  label,
  children,
}: {
  id: string;
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div className="min-w-0">
      <label className="label" htmlFor={id}>
        {label}
      </label>
      {children}
    </div>
  );
}

/**
 * Les réglages du moteur, en un formulaire. Les bornes des champs sont celles
 * de l'action et de la base ; les plafonds restent SOUS les limites du compte
 * Telnyx (contrainte en base) — l'écran le dit en ambre avant l'envoi, la base
 * refuserait de toute façon.
 */
export function Reglages({ r }: { r: ReglagesFormulaire }) {
  const { etat, onSubmit, enCours, ref } = useFormulaire(reglerAppelsAction);

  // Les quatre nombres qui se surveillent l'un l'autre : suivis à la frappe.
  const [plafondHeure, setPlafondHeure] = useState(String(r.plafond_heure));
  const [plafondJour, setPlafondJour] = useState(String(r.plafond_jour));
  const [limiteHeure, setLimiteHeure] = useState(String(r.limite_compte_heure));
  const [limiteJour, setLimiteJour] = useState(String(r.limite_compte_jour));
  const [numero, setNumero] = useState(r.numero_appelant ? numeroLisible(r.numero_appelant) : "");
  const [gsm, setGsm] = useState(r.gsm_test ? numeroLisible(r.gsm_test) : "");

  const depasseHeure = Number(plafondHeure) > Number(limiteHeure);
  const depasseJour = Number(plafondJour) > Number(limiteJour);

  return (
    <form ref={ref} onSubmit={onSubmit} className="space-y-4">
      <div className="grid gap-4 md:grid-cols-2">
        <Groupe titre="Fenêtre d'appel">
          <div className="grid grid-cols-2 gap-3">
            <Champ id="fenetre_debut" label="Début">
              <input
                id="fenetre_debut"
                name="fenetre_debut"
                type="time"
                step={60}
                required
                defaultValue={r.fenetre_debut.slice(0, 5)}
                className="input"
              />
            </Champ>
            <Champ id="fenetre_fin" label="Fin">
              <input
                id="fenetre_fin"
                name="fenetre_fin"
                type="time"
                step={60}
                required
                defaultValue={r.fenetre_fin.slice(0, 5)}
                className="input"
              />
            </Champ>
          </div>
          <Aide>Heure de Bruxelles, du lundi au vendredi. Les jours fériés belges sont exclus d&apos;office.</Aide>
        </Groupe>

        <Groupe titre="Durées">
          <div className="grid grid-cols-2 gap-3">
            <Champ id="duree_max_s" label="Appel max. (s)">
              <input
                id="duree_max_s"
                name="duree_max_s"
                type="number"
                inputMode="numeric"
                min={60}
                max={330}
                required
                defaultValue={r.duree_max_s}
                className="input"
              />
            </Champ>
            <Champ id="sonnerie_max_s" label="Sonnerie max. (s)">
              <input
                id="sonnerie_max_s"
                name="sonnerie_max_s"
                type="number"
                inputMode="numeric"
                min={15}
                max={120}
                required
                defaultValue={r.sonnerie_max_s}
                className="input"
              />
            </Champ>
          </div>
          <Aide>
            Un appel dure 330 s au plus (5 min 30) : l&apos;annexe qui le porte est coupée à 400 s. La
            sonnerie va de 15 à 120 s.
          </Aide>
        </Groupe>

        <Groupe titre="Plafonds de Janet">
          <div className="grid grid-cols-2 gap-3">
            <Champ id="plafond_heure" label="Par heure">
              <input
                id="plafond_heure"
                name="plafond_heure"
                type="number"
                inputMode="numeric"
                min={1}
                max={60}
                required
                value={plafondHeure}
                onChange={(e) => setPlafondHeure(e.target.value)}
                className="input"
              />
            </Champ>
            <Champ id="plafond_jour" label="Par jour">
              <input
                id="plafond_jour"
                name="plafond_jour"
                type="number"
                inputMode="numeric"
                min={1}
                max={1000}
                required
                value={plafondJour}
                onChange={(e) => setPlafondJour(e.target.value)}
                className="input"
              />
            </Champ>
          </div>
          {depasseHeure || depasseJour ? (
            <Aide attention>
              {depasseHeure && depasseJour
                ? "Les deux plafonds dépassent les limites du compte Telnyx"
                : depasseHeure
                  ? "Le plafond par heure dépasse la limite du compte Telnyx"
                  : "Le plafond par jour dépasse la limite du compte Telnyx"}{" "}
              : la base refusera l&apos;enregistrement.
            </Aide>
          ) : (
            <Aide>Les appels de test comptent aussi : Telnyx les facture et les compte.</Aide>
          )}
        </Groupe>

        <Groupe titre="Limites du compte Telnyx">
          <div className="grid grid-cols-2 gap-3">
            <Champ id="limite_compte_heure" label="Par heure">
              <input
                id="limite_compte_heure"
                name="limite_compte_heure"
                type="number"
                inputMode="numeric"
                min={1}
                max={1000}
                required
                value={limiteHeure}
                onChange={(e) => setLimiteHeure(e.target.value)}
                className="input"
              />
            </Champ>
            <Champ id="limite_compte_jour" label="Par jour">
              <input
                id="limite_compte_jour"
                name="limite_compte_jour"
                type="number"
                inputMode="numeric"
                min={1}
                max={10000}
                required
                value={limiteJour}
                onChange={(e) => setLimiteJour(e.target.value)}
                className="input"
              />
            </Champ>
          </div>
          <Aide>Celles de votre compte Telnyx. Les plafonds de Janet restent dessous : la base refuse sinon.</Aide>
        </Groupe>

        <Groupe titre="Numéros">
          <Champ id="numero_appelant" label="Numéro appelant">
            <input
              id="numero_appelant"
              name="numero_appelant"
              type="tel"
              inputMode="tel"
              autoComplete="off"
              value={numero}
              onChange={(e) => setNumero(e.target.value)}
              placeholder="0480 …"
              className="input"
            />
          </Champ>
          <Aide attention={!numero.trim()}>
            Le 0480 présenté aux prospects. Tant qu&apos;il est vide, le moteur refuse de composer.
          </Aide>
          <Champ id="gsm_test" label="GSM de test">
            <input
              id="gsm_test"
              name="gsm_test"
              type="tel"
              inputMode="tel"
              autoComplete="off"
              value={gsm}
              onChange={(e) => setGsm(e.target.value)}
              placeholder="04xx xx xx xx"
              className="input"
            />
          </Champ>
          <Aide attention={!gsm.trim()}>
            {r.mode_test
              ? "Tant que le mode test est mis, tous les appels partent vers ce numéro."
              : "Le numéro que vise l'appel de test (et tous les appels, en mode test)."}
            {!gsm.trim() && " Vide : aucun appel de test possible."}
          </Aide>
        </Groupe>

        <Groupe titre="Connexion et voix">
          <Champ id="trunk_url" label="URL du trunk SIP">
            <input
              id="trunk_url"
              name="trunk_url"
              required
              autoComplete="off"
              spellCheck={false}
              defaultValue={r.trunk_url}
              placeholder="sips:sip.telnyx.com:5061"
              className="input font-mono text-xs"
            />
          </Champ>
          <div className="grid gap-3 sm:grid-cols-2">
            <Champ id="voix" label="Voix">
              <input
                id="voix"
                name="voix"
                required
                autoComplete="off"
                spellCheck={false}
                defaultValue={r.voix}
                className="input font-mono text-xs"
              />
            </Champ>
            <Champ id="modele_delegation" label="Modèle de délégation">
              <input
                id="modele_delegation"
                name="modele_delegation"
                required
                autoComplete="off"
                spellCheck={false}
                defaultValue={r.modele_delegation}
                className="input font-mono text-xs"
              />
            </Champ>
          </div>
          <Aide>
            Le modèle de délégation appelle les outils (créneaux, rendez-vous, opposition) pendant
            l&apos;appel. Modèle de conversation : <span className="font-mono">{r.modele}</span> (fixé).
          </Aide>
        </Groupe>
      </div>

      <Retour etat={etat} />

      <div className="flex flex-wrap items-center gap-3">
        <button type="submit" disabled={enCours} className="btn-primary">
          {enCours ? "Enregistrement…" : "Enregistrer les réglages"}
        </button>
        <span className="text-xs text-slate-500">Un numéro vidé est retiré.</span>
      </div>
    </form>
  );
}
