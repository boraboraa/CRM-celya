/**
 * Écrire la fin d'un appel — SERVEUR, en service_role.
 *
 * Lit le contexte, demande le plan au module PUR `planFin.ts`, et l'applique :
 *   1. le journal de la fiche, par `saveExchangeCore`, AU NOM DU PROPRIÉTAIRE
 *      de la fiche — exactement comme s'il avait consigné l'appel lui-même :
 *      même règle d'échange, même avancée d'étape par les faits (jamais
 *      « Perdu », jamais de verrou), même recalcul de confiance ;
 *   2. la relance pour le propriétaire, s'il en faut une et qu'aucune relance
 *      n'est déjà ouverte sur la fiche (Janet ne re-date jamais une relance
 *      posée par un humain) — jamais avant un rendez-vous à venir (024) ;
 *   3. la ligne apprise, au brief ;
 *   4. la ligne de file (essai suivant, ou fin du cycle) ;
 *   5. l'appel lui-même — EN DERNIER : c'est ce qui libère le verrou « un seul
 *      appel en cours ». Garanti par un `finally`.
 * Idempotent : un appel déjà terminé n'est pas réécrit.
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import { saveExchangeCore } from "@/lib/crm/exchange";
import { prochainRdvAVenir } from "@/lib/crm/agenda";
import { STATUTS_ACTIFS, lireReglages } from "@/lib/appelsIa/acces";
import { fenetreDe } from "@/lib/appelsIa/regles";
import { FENETRE_DEFAUT, instantBruxelles, jourHeureFr, type Fenetre } from "@/lib/appelsIa/calendrier";
import { machinesDe, planifierFin, type ContexteFin, type PlanFin } from "@/lib/appelsIa/planFin";
import { normaliserAppris } from "@/lib/appelsIa/brief";
import type { RapportAppel } from "../../supabase/functions/_shared/appels/rapport.ts";

type AppelLu = {
  id: string;
  statut: string;
  essai: number;
  mode_test: boolean;
  file_id: string | null;
  prospect_id: string | null;
  proprietaire_id: string | null;
  numero_compose: string;
  meeting_id: string | null;
  created_at: string;
};

/** `reessayer` : rien n'a été écrit et l'annexe doit renvoyer (ou poser sa trace minimale). */
export type IssueFin = { ok: boolean; chainer: boolean; message: string; reessayer?: boolean };

async function contexte(admin: SupabaseClient, appel: AppelLu, rapport: RapportAppel): Promise<ContexteFin> {
  const [file, fiche, anterieurs, opposition, recents, rdvPose] = await Promise.all([
    appel.file_id
      ? admin.from("appels_ia_file").select("id, appels_ia_campagnes(statut)").eq("id", appel.file_id).maybeSingle()
      : Promise.resolve({ data: null, error: null }),
    appel.prospect_id
      ? admin.from("prospects").select("id, company_name").eq("id", appel.prospect_id).maybeSingle()
      : Promise.resolve({ data: null, error: null }),
    appel.prospect_id && !appel.mode_test
      ? admin
          .from("appels_ia")
          .select("classement, created_at")
          .eq("prospect_id", appel.prospect_id)
          .eq("mode_test", false)
          .eq("statut", "termine")
          .neq("id", appel.id)
      : Promise.resolve({ data: [], error: null }),
    admin.from("appels_ia_opposition").select("numero").eq("numero", appel.numero_compose).maybeSingle(),
    admin
      .from("appels_ia")
      .select("erreur_cote")
      .lt("created_at", appel.created_at)
      .not("statut", "in", `(${STATUTS_ACTIFS.join(",")})`)
      .order("created_at", { ascending: false })
      .limit(3),
    appel.meeting_id
      ? admin.from("meetings").select("starts_at").eq("id", appel.meeting_id).maybeSingle()
      : Promise.resolve({ data: null, error: null }),
  ]);

  const fileLue = file.data as { id: string; appels_ia_campagnes: { statut: string } | null } | null;
  const { machines, dejaHumain } = machinesDe((anterieurs.data ?? []) as { classement: string | null; created_at: string }[]);
  let pannesAvant = 0;
  for (const a of (recents.data ?? []) as { erreur_cote: string | null }[]) {
    if (a.erreur_cote === "nous" || a.erreur_cote === "neutre") pannesAvant++;
    else break;
  }
  let fenetre: Fenetre = FENETRE_DEFAUT;
  try {
    fenetre = fenetreDe(await lireReglages(admin));
  } catch {
    /* la fenêtre par défaut suffit à dater un essai */
  }
  const rdv = appel.prospect_id && !appel.mode_test ? await prochainRdvAVenir(admin, appel.prospect_id) : null;
  return {
    appel: { id: appel.id, essai: appel.essai, mode_test: appel.mode_test, file_id: appel.file_id, prospect_id: appel.prospect_id },
    file: fileLue
      ? { id: fileLue.id, campagneStatut: (fileLue.appels_ia_campagnes?.statut ?? "active") as "active" | "pause" | "terminee" }
      : null,
    fiche: (fiche.data as { id: string; company_name: string } | null) ?? null,
    rapport,
    machinesAnterieures: machines,
    dejaHumain,
    // Dernier contrôle d'opposition, À L'ÉCRITURE. Illisible : fermé — le
    // cycle s'arrête plutôt que de rappeler un numéro peut-être opposé.
    opposition: opposition.error ? true : Boolean(opposition.data),
    rdvAVenir: Boolean(rdv),
    rdvLibelle: rdvPose.data ? jourHeureFr(new Date((rdvPose.data as { starts_at: string }).starts_at)) : null,
    pannesAvant,
    maintenant: new Date(),
    fenetre,
  };
}

/** La relance de Janet pour le propriétaire — jamais par-dessus une relance humaine. */
async function poserRelance(
  admin: SupabaseClient,
  prospectId: string,
  proprietaireId: string,
  relance: NonNullable<PlanFin["relance"]>
): Promise<string | null> {
  if (await prochainRdvAVenir(admin, prospectId)) return null;
  const { data: ouvertes, error } = await admin
    .from("tasks")
    .select("id")
    .eq("prospect_id", prospectId)
    .eq("status", "a_faire")
    .limit(1);
  if (error || (ouvertes?.length ?? 0) > 0) return null;
  const due = instantBruxelles(relance.jour, relance.minutes);
  if (due.getTime() <= Date.now()) return null;
  const { data } = await admin
    .from("tasks")
    .insert({
      prospect_id: prospectId,
      title: relance.titre,
      due_at: due.toISOString(),
      priority: 2,
      assignee_id: proprietaireId,
      created_by: proprietaireId,
    })
    .select("id")
    .maybeSingle();
  return (data as { id: string } | null)?.id ?? null;
}

export async function ecrireFin(admin: SupabaseClient, rapport: RapportAppel): Promise<IssueFin> {
  const { data, error } = await admin
    .from("appels_ia")
    .select("id, statut, essai, mode_test, file_id, prospect_id, proprietaire_id, numero_compose, meeting_id, created_at")
    .eq("id", rapport.appelId)
    .maybeSingle();
  if (error) return { ok: false, chainer: false, reessayer: true, message: `Appel illisible : ${error.message}` };
  if (!data) return { ok: false, chainer: false, message: "Appel inconnu." };
  const appel = data as AppelLu;
  if (!(STATUTS_ACTIFS as readonly string[]).includes(appel.statut)) {
    return { ok: true, chainer: false, message: "Fin déjà écrite." };
  }

  // Le JETON de fin : une seule écriture, même si l'annexe renvoie le rapport
  // (son premier envoi a dépassé son délai alors que Next écrivait encore).
  // Sans lui, deux fins concurrentes écriraient deux fois au journal. Un jeton
  // de plus de 5 minutes est celui d'un écrivain mort : il se reprend.
  const perime = new Date(Date.now() - 5 * 60_000).toISOString();
  const { data: jeton, error: errJeton } = await admin
    .from("appels_ia")
    .update({ fin_prise_at: new Date().toISOString() })
    .eq("id", appel.id)
    .in("statut", [...STATUTS_ACTIFS])
    .or(`fin_prise_at.is.null,fin_prise_at.lt.${perime}`)
    .select("id")
    .maybeSingle();
  if (errJeton) return { ok: false, chainer: false, reessayer: true, message: `Jeton de fin illisible : ${errJeton.message}` };
  if (!jeton) return { ok: true, chainer: false, message: "Fin déjà en cours d'écriture." };

  let plan: PlanFin | null = null;
  let activiteId: string | null = null;
  let relanceId: string | null = null;
  const incidents: string[] = [];
  try {
    plan = planifierFin(await contexte(admin, appel, rapport));

    // 1. Le journal de la fiche, au nom du propriétaire.
    if (plan.journal && appel.prospect_id && appel.proprietaire_id && !appel.mode_test) {
      const j = plan.journal;
      const r = await saveExchangeCore(admin, appel.proprietaire_id, {
        prospectId: appel.prospect_id,
        type: "note",
        resume: j.sujet,
        note: j.corps,
        outcome: j.outcome,
        isExchange: j.isExchange,
        contactName: j.contact,
        motif: j.motifRefus,
      });
      if (r.error) incidents.push(`journal : ${r.error}`);
      activiteId = r.activiteId ?? null;
    }

    // 2. La relance pour le propriétaire.
    if (plan.relance && appel.prospect_id && appel.proprietaire_id && !appel.mode_test) {
      relanceId = await poserRelance(admin, appel.prospect_id, appel.proprietaire_id, plan.relance);
    }

    // 3. Ce que Janet a appris.
    if (plan.appris && appel.prospect_id && !appel.mode_test) {
      const { data: b } = await admin.from("appels_ia_briefs").select("appris").eq("prospect_id", appel.prospect_id).maybeSingle();
      const appris = normaliserAppris([...normaliserAppris((b as { appris?: unknown } | null)?.appris), { ...plan.appris, appel_id: appel.id }]);
      await admin.from("appels_ia_briefs").upsert({ prospect_id: appel.prospect_id, appris }, { onConflict: "prospect_id" });
    }

    // 4. La ligne de file.
    if (plan.file && appel.file_id) {
      const f = plan.file;
      const patch: Record<string, unknown> = { statut: f.statut, derniere_note: f.note.slice(0, 300) };
      if (f.essais !== null) patch.essais = f.essais;
      if (f.statut === "en_attente") patch.pas_avant = f.pasAvant.toISOString();
      else {
        patch.fin_motif = f.motif;
        patch.fin_at = new Date().toISOString();
      }
      await admin.from("appels_ia_file").update(patch).eq("id", appel.file_id).eq("statut", "en_cours");
    }

    // 6. La pause, sur une panne de notre côté.
    if (plan.pause) {
      await admin.from("appels_ia_reglages").update({ pause_cause: plan.pause.slice(0, 500), pause_at: new Date().toISOString() }).eq("id", 1);
    }
  } catch (e) {
    incidents.push(String((e as Error)?.message ?? e));
  } finally {
    // 5. L'appel, EN DERNIER : c'est ce qui libère le verrou.
    const a = plan?.appel;
    const finA = rapport.finA;
    await admin
      .from("appels_ia")
      .update({
        statut: a?.statut ?? "echec",
        session_id: rapport.sessionId,
        classement: a?.classement ?? null,
        resultat: a?.resultat ?? null,
        resume: a?.resume ?? null,
        interlocuteur: a?.interlocuteur ?? null,
        declaration: a?.declaration ?? null,
        fin_motif_janet: a?.fin_motif_janet ?? null,
        transcription: rapport.tours,
        evenements: rapport.evenements,
        outils: rapport.outils,
        raison_fermeture: rapport.raisonFermeture,
        raccroche_par: rapport.raccrochePar,
        decroche_at: rapport.decrocheA,
        fin_at: finA,
        duree_s: rapport.decrocheA ? Math.max(0, Math.round((Date.parse(finA) - Date.parse(rapport.decrocheA)) / 1000)) : 0,
        facture_s: rapport.factureS,
        age_worker_s: rapport.ageWorkerS,
        erreur_cote: a ? a.erreur_cote : "neutre",
        erreur_code: a ? a.erreur_code : "ecriture",
        erreur_message: a ? (incidents.length ? [a.erreur_message, ...incidents].filter(Boolean).join(" · ").slice(0, 500) : a.erreur_message) : incidents.join(" · ").slice(0, 500),
        activite_id: activiteId,
        relance_id: relanceId,
        opposition: a?.opposition ?? false,
      })
      .eq("id", appel.id)
      .in("statut", [...STATUTS_ACTIFS]);
  }
  return { ok: incidents.length === 0, chainer: plan?.chainer ?? false, message: incidents.join(" · ") || "Fin écrite." };
}
