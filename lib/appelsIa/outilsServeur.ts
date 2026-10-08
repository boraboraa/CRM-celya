/**
 * Exécuter un outil de Janet pendant l'appel — SERVEUR, en service_role.
 *
 * L'outil agit sur la fiche de l'APPEL EN COURS, désigné par l'id signé de
 * l'annexe — jamais par un id venu du modèle. Un appel qui n'est plus en cours
 * n'exécute plus rien. Sa sortie part telle quelle à Janet : elle dit, en
 * français, quoi répondre ensuite.
 *
 * Mode test : rien n'est écrit (ni rendez-vous, ni opposition) ; Janet reçoit
 * la même réponse, marquée « test ».
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import { poserRendezVous } from "@/lib/crm/agenda";
import { lireReglages } from "@/lib/appelsIa/acces";
import { fenetreDe } from "@/lib/appelsIa/regles";
import { creneauxLibres, lireArguments, refusRdv, type Occupation } from "@/lib/appelsIa/outils";
import { lireDeclaration } from "@/lib/appelsIa/resultat";
import { instantBruxelles, jourHeureFr, partiesBruxelles, FENETRE_DEFAUT, type Fenetre } from "@/lib/appelsIa/calendrier";

const EN_COURS = ["composition", "sonnerie", "en_ligne"];

type AppelOutil = {
  id: string;
  statut: string;
  mode_test: boolean;
  prospect_id: string | null;
  proprietaire_id: string | null;
  numero_compose: string;
};

/** Les rendez-vous du PROPRIÉTAIRE de la fiche : c'est son agenda qui reçoit la démonstration. */
async function occupations(admin: SupabaseClient, proprietaireId: string | null): Promise<Occupation[]> {
  if (!proprietaireId) return [];
  const { data, error } = await admin
    .from("meetings")
    .select("starts_at, ends_at")
    .eq("owner_id", proprietaireId)
    .in("status", ["prevu", "confirme", "reporte"])
    .gte("ends_at", new Date().toISOString())
    .lte("starts_at", new Date(Date.now() + 40 * 86400_000).toISOString());
  if (error) throw new Error(`Agenda illisible : ${error.message}`);
  return ((data ?? []) as { starts_at: string; ends_at: string }[]).map((m) => ({ debut: new Date(m.starts_at), fin: new Date(m.ends_at) }));
}

export async function executerOutilServeur(
  admin: SupabaseClient,
  appelId: string,
  nom: string,
  brut: unknown
): Promise<Record<string, unknown>> {
  const lu = lireArguments(nom, brut);
  if (!lu.ok) return { ok: false, erreur: lu.erreur };

  const { data, error } = await admin
    .from("appels_ia")
    .select("id, statut, mode_test, prospect_id, proprietaire_id, numero_compose")
    .eq("id", appelId)
    .maybeSingle();
  if (error || !data) return { ok: false, erreur: "Appel inconnu." };
  const appel = data as AppelOutil;
  if (!EN_COURS.includes(appel.statut)) return { ok: false, erreur: "Cet appel est terminé." };
  const test = appel.mode_test;

  let fenetre: Fenetre = FENETRE_DEFAUT;
  try {
    fenetre = fenetreDe(await lireReglages(admin));
  } catch {
    /* la fenêtre par défaut */
  }

  switch (lu.nom) {
    case "creneaux": {
      const libres = creneauxLibres(await occupations(admin, appel.proprietaire_id), new Date(), {
        fenetre,
        jourSouhaite: lu.args.jour,
        moment: lu.args.moment,
      });
      if (!libres.length) {
        return { ok: true, creneaux: [], consigne: "Aucun créneau libre : dites que le responsable rappellera pour fixer la démonstration." };
      }
      return {
        ok: true,
        creneaux: libres,
        consigne: "Proposez deux de ces créneaux, avec le jour et l'heure. Pour réserver, appelez rdv avec le « debut » exact.",
      };
    }

    case "rdv": {
      const refus = refusRdv(lu.args.debut, await occupations(admin, appel.proprietaire_id), new Date(), fenetre);
      if (refus) return { ok: false, erreur: refus };
      const [jour, heure] = lu.args.debut.split("T");
      const [h, m] = heure.split(":").map(Number);
      const libelle = jourHeureFr(instantBruxelles(jour, h * 60 + m));
      if (test) {
        return { ok: true, test: true, libelle, consigne: `(Appel de test : rien n'est posé.) Confirmez la démonstration le ${libelle}.` };
      }
      if (!appel.prospect_id || !appel.proprietaire_id) return { ok: false, erreur: "Fiche introuvable : dites que le responsable rappellera." };
      const { data: fiche } = await admin.from("prospects").select("company_name").eq("id", appel.prospect_id).maybeSingle();
      const notes = [
        lu.args.interlocuteur ? `Avec : ${lu.args.interlocuteur}` : null,
        lu.args.email ? `Email : ${lu.args.email}` : null,
        lu.args.notes,
        "Posé par Janet pendant son appel.",
      ]
        .filter(Boolean)
        .join("\n");
      const r = await poserRendezVous(admin, appel.proprietaire_id, {
        prospectId: appel.prospect_id,
        kind: "prospect",
        title: `Démo Celya — ${(fiche as { company_name?: string } | null)?.company_name ?? "prospect"}`,
        startsAt: lu.args.debut,
        dureeMin: 30,
        notes,
      });
      if (r.error || !r.id) return { ok: false, erreur: "Le rendez-vous n'a pas pu être posé : dites que le responsable rappellera pour le fixer." };
      await admin.from("appels_ia").update({ meeting_id: r.id }).eq("id", appel.id);
      return { ok: true, libelle, consigne: `Confirmez : démonstration de 30 minutes le ${libelle}. Puis notez le résultat, saluez, et terminez.` };
    }

    case "opposition": {
      if (!test) {
        const { error: e } = await admin.from("appels_ia_opposition").upsert(
          {
            numero: appel.numero_compose,
            motif: lu.args.motif ?? "Ne veut plus être appelé",
            source: "appel",
            appel_id: appel.id,
            prospect_id: appel.prospect_id,
          },
          { onConflict: "numero", ignoreDuplicates: true }
        );
        if (e) return { ok: false, erreur: "L'opposition n'a pas pu être enregistrée : promettez quand même de ne plus rappeler, et terminez." };
        await admin.from("appels_ia").update({ opposition: true }).eq("id", appel.id);
      }
      return { ok: true, ...(test ? { test: true } : {}), consigne: "C'est noté. Excusez-vous en une phrase, saluez, puis appelez fin_appel." };
    }

    case "noter_resultat": {
      const d = lireDeclaration(lu.args);
      if (!d) return { ok: false, erreur: "Il faut resultat (interesse, rappeler, refus ou barrage), resume et decideur." };
      // Pas de rappel dans le passé : une date passée est ignorée, et on le dit.
      const aujourdhui = partiesBruxelles(new Date()).ymd;
      const datePassee = Boolean(d.rappelerLe && d.rappelerLe < aujourdhui);
      await admin
        .from("appels_ia")
        .update({ declaration: { ...d, rappelerLe: datePassee ? null : d.rappelerLe }, interlocuteur: d.interlocuteur })
        .eq("id", appel.id);
      return {
        ok: true,
        ...(datePassee ? { remarque: "La date de rappel est dans le passé : elle est ignorée." } : {}),
        consigne: "Noté. Saluez la personne, puis appelez fin_appel avec le motif conversation_terminee.",
      };
    }

    case "fin_appel":
      await admin.from("appels_ia").update({ fin_motif_janet: lu.args.motif }).eq("id", appel.id);
      return { ok: true };
  }
}
