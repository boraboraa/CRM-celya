"use client";

import { useRef, useState } from "react";
import { addActivityAction } from "@/app/actions";
import { ACTIVITY_LABEL } from "@/lib/constants";
import type { ActivityType } from "@/lib/types";

const TYPES: ActivityType[] = ["appel", "email", "reunion", "whatsapp", "note"];

export function QuickNote({ clientId }: { clientId: string }) {
  const [type, setType] = useState<ActivityType>("appel");
  const formRef = useRef<HTMLFormElement>(null);

  return (
    <form
      ref={formRef}
      action={async (fd) => {
        await addActivityAction(fd);
        formRef.current?.reset();
        setType("appel");
      }}
      className="card p-5"
    >
      <input type="hidden" name="client_id" value={clientId} />
      <input type="hidden" name="type" value={type} />

      <div className="mb-4 flex flex-wrap gap-1.5">
        {TYPES.map((t) => (
          <button
            key={t}
            type="button"
            onClick={() => setType(t)}
            className={`rounded-lg px-3 py-1.5 text-xs font-medium ring-1 transition ${
              type === t
                ? "bg-celya-gradient text-slate-950 ring-transparent"
                : "bg-white/[0.04] text-slate-400 ring-white/10 hover:text-slate-200"
            }`}
          >
            {ACTIVITY_LABEL[t]}
          </button>
        ))}
      </div>

      <textarea
        name="body"
        rows={3}
        required
        className="input resize-y"
        placeholder={
          type === "appel"
            ? "Ce qui s'est dit pendant l'appel, ce qu'il/elle attend, objections…"
            : "Notez ce qu'il faut retenir."
        }
      />

      <div className="mt-3 grid gap-3 sm:grid-cols-3">
        <div>
          <label className="label" htmlFor="outcome">
            Résultat
          </label>
          <select id="outcome" name="outcome" className="input" defaultValue="">
            <option value="">—</option>
            <option value="Intéressé">Intéressé</option>
            <option value="À rappeler">À rappeler</option>
            <option value="Pas joignable">Pas joignable</option>
            <option value="Rendez-vous fixé">Rendez-vous fixé</option>
            <option value="Pas intéressé">Pas intéressé</option>
            <option value="Devis demandé">Devis demandé</option>
          </select>
        </div>

        <div>
          <label className="label" htmlFor="duration_min">
            Durée (min)
          </label>
          <input
            id="duration_min"
            name="duration_min"
            inputMode="numeric"
            className="input"
            placeholder="8"
          />
        </div>

        <div>
          <label className="label" htmlFor="follow_up_days">
            Relancer dans
          </label>
          <select
            id="follow_up_days"
            name="follow_up_days"
            className="input"
            defaultValue="3"
          >
            <option value="none">Pas de relance</option>
            <option value="1">1 jour</option>
            <option value="2">2 jours</option>
            <option value="3">3 jours</option>
            <option value="7">1 semaine</option>
            <option value="14">2 semaines</option>
            <option value="30">1 mois</option>
          </select>
        </div>
      </div>

      <input
        type="hidden"
        name="follow_up_title"
        value="Relancer après le dernier échange"
      />

      <div className="mt-4 flex items-center gap-3">
        <button type="submit" className="btn-primary">
          Enregistrer
        </button>
        <span className="text-xs text-slate-500">
          Une relance est créée automatiquement selon le délai choisi.
        </span>
      </div>
    </form>
  );
}
