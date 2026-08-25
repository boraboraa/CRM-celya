import {
  STATUS_ORDER,
  STATUS_LABEL,
  SOURCES,
  normalizeStatus,
} from "@/lib/constants";
import type { Prospect, Profile } from "@/lib/types";

export function ProspectForm({
  prospect,
  members,
  action,
  submitLabel = "Enregistrer",
  currentUserId,
  aiFields,
  uncertainFields,
}: {
  prospect?: Partial<Prospect>;
  members: Pick<Profile, "id" | "full_name" | "email">[];
  action: (formData: FormData) => Promise<void>;
  submitLabel?: string;
  currentUserId?: string;
  /** Champs pré-remplis par l'assistant — signalés visuellement. */
  aiFields?: string[];
  /** Champs déduits à faible confiance — surlignés plus fort, à vérifier. */
  uncertainFields?: string[];
}) {
  // Classes complètes, jamais interpolées (le JIT doit les voir).
  const cls = (name: string) =>
    uncertainFields?.includes(name)
      ? "input ring-2 ring-amber-400/70"
      : aiFields?.includes(name)
        ? "input ring-2 ring-celya-cyan/50"
        : "input";
  const status = normalizeStatus(prospect?.status);
  // Une source héritée absente de la liste actuelle reste sélectionnable —
  // sinon l'enregistrement l'effacerait silencieusement.
  const sourceOptions =
    prospect?.source && !SOURCES.includes(prospect.source)
      ? [prospect.source, ...SOURCES]
      : SOURCES;
  return (
    <form action={action} className="space-y-5">
      {prospect?.id && <input type="hidden" name="id" value={prospect.id} />}

      <div className="grid gap-4 sm:grid-cols-2">
        <div className="sm:col-span-2">
          <label className="label" htmlFor="company_name">
            Société *
          </label>
          <input
            id="company_name"
            name="company_name"
            required
            defaultValue={prospect?.company_name ?? ""}
            className={cls("company_name")}
            placeholder="Boulangerie Dupont SRL"
          />
        </div>

        <div>
          <label className="label" htmlFor="contact_name">
            Personne de contact
          </label>
          <input
            id="contact_name"
            name="contact_name"
            defaultValue={prospect?.contact_name ?? ""}
            className={cls("contact_name")}
            placeholder="Marie Dupont"
          />
        </div>

        <div>
          <label className="label" htmlFor="phone">
            Téléphone
          </label>
          <input
            id="phone"
            name="phone"
            type="tel"
            defaultValue={prospect?.phone ?? ""}
            className={cls("phone")}
            placeholder="+32 470 00 00 00"
          />
        </div>

        <div>
          <label className="label" htmlFor="email">
            Email
          </label>
          <input
            id="email"
            name="email"
            type="email"
            defaultValue={prospect?.email ?? ""}
            className={cls("email")}
            placeholder="contact@societe.be"
          />
          <p className="mt-1 text-[11px] text-slate-500">
            Sert à rattacher automatiquement les emails reçus à cette fiche.
          </p>
        </div>

        <div>
          <label className="label" htmlFor="website">
            Site web
          </label>
          <input
            id="website"
            name="website"
            defaultValue={prospect?.website ?? ""}
            className={cls("website")}
            placeholder="societe.be"
          />
        </div>

        <div>
          <label className="label" htmlFor="sector">
            Secteur
          </label>
          <input
            id="sector"
            name="sector"
            defaultValue={prospect?.sector ?? ""}
            className={cls("sector")}
            placeholder="Horeca, garage, cabinet…"
          />
        </div>

        <div>
          <label className="label" htmlFor="city">
            Ville
          </label>
          <input
            id="city"
            name="city"
            defaultValue={prospect?.city ?? ""}
            className={cls("city")}
            placeholder="Bruxelles"
          />
        </div>

        <div>
          <label className="label" htmlFor="status">
            Étape
          </label>
          <select
            id="status"
            name="status"
            defaultValue={status}
            className={cls("status")}
          >
            {STATUS_ORDER.map((s) => (
              <option key={s} value={s}>
                {STATUS_LABEL[s]}
              </option>
            ))}
          </select>
        </div>

        <div>
          <label className="label" htmlFor="source">
            Source
          </label>
          <select
            id="source"
            name="source"
            defaultValue={prospect?.source ?? ""}
            className={cls("source")}
          >
            <option value="">—</option>
            {sourceOptions.map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </select>
        </div>

        {/* Plus de probabilité à saisir : la confiance est estimée par
            l'assistant (et se corrige en tête de fiche). */}
        <div>
          <label className="label" htmlFor="value_estimate">
            Valeur estimée (€)
          </label>
          <input
            id="value_estimate"
            name="value_estimate"
            inputMode="decimal"
            defaultValue={prospect?.value_estimate ?? ""}
            className="input"
            placeholder="4800"
          />
        </div>

        <div>
          <label className="label" htmlFor="owner_id">
            Responsable
          </label>
          {/* Plus d'option « Non assigné » : le vivier est fermé (migration
              016). Une fiche appartient toujours à quelqu'un — sans quoi elle
              était publiée à toute l'équipe, et le formulaire ne le disait
              pas. Assigner à un collègue reste possible, c'est explicite. */}
          <select
            id="owner_id"
            name="owner_id"
            required
            defaultValue={prospect?.owner_id ?? currentUserId ?? ""}
            className="input"
          >
            {members.map((m) => (
              <option key={m.id} value={m.id}>
                {m.full_name ?? m.email}
              </option>
            ))}
          </select>
        </div>

        <div className="sm:col-span-2">
          <label className="label" htmlFor="notes">
            Notes générales
          </label>
          <textarea
            id="notes"
            name="notes"
            rows={3}
            defaultValue={prospect?.notes ?? ""}
            className={`${cls("notes")} resize-y`}
            placeholder="Contexte, besoins, interlocuteurs, contraintes…"
          />
        </div>

        {status === "perdu" && (
          <div className="sm:col-span-2">
            <label className="label" htmlFor="lost_reason">
              Raison de la perte
            </label>
            <input
              id="lost_reason"
              name="lost_reason"
              defaultValue={prospect?.lost_reason ?? ""}
              className="input"
              placeholder="Budget, timing, concurrent…"
            />
          </div>
        )}
      </div>

      <button type="submit" className="btn-primary">
        {submitLabel}
      </button>
    </form>
  );
}
