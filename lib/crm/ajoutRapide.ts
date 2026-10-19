/**
 * L'ajout rapide du téléphone (19/10) — « Ce qui s'est passé » lu comme une
 * note. Module NEUTRE et pur : le composant affiche ce qui sera enregistré,
 * la server action l'envoie à `saveExchangeCore`, le test le vérifie.
 *
 * La correspondance est CELLE de `QuickNote` (la note de la fiche), recopiée
 * ici et pas ailleurs :
 *  - un rendez-vous complet (jour ET heure) pose un vrai rendez-vous ;
 *  - un rendez-vous incomplet n'est JAMAIS posé : on dit ce qui manque, et on
 *    ne crée rien tant que l'humain n'a pas complété ou renoncé (« sans le
 *    rendez-vous ») — jamais aujourd'hui par défaut, c'est l'erreur qui a
 *    perdu le RDV du 31/08 ;
 *  - « rappeler jeudi » pose une relance ; « pdr » est un appel sans réponse
 *    (pas un échange) ; « devis envoyé », la proposition ;
 *  - le texte part au journal TEL QUEL ;
 *  - c'est un ÉCHANGE RÉEL par défaut (décision de Bora, 19/10), sauf
 *    « Repéré, pas encore contacté » — une note de repérage : la fiche reste
 *    « À appeler ».
 * L'étape n'est jamais demandée : elle suit les faits (`applyAutoStatus`).
 */
import type { Raccourci } from "./raccourcis.ts";

/** L'événement de fenêtre qui ouvre la feuille (le « ＋ » de la barre du bas). */
export const OUVRIR_AJOUT = "celya:ajout-rapide";

/** Ce que la server action passe à `saveExchangeCore` (sans `prospectId`). */
export type EchangeRapide = {
  type: "note" | "rendez_vous";
  note: string;
  contactName: string | null;
  /** « YYYY-MM-DDTHH:mm » pour un rendez-vous, « YYYY-MM-DD » pour une relance. */
  dateLocale: string | null;
  rdvLieu: string | null;
  rdvFin: string | null;
  isExchange: boolean;
  noAnswer: boolean;
  proposalSent: boolean;
};

export type LectureRapide = {
  /** null : rien à consigner (ligne vide), ou bloqué (`manque`). */
  echange: EchangeRapide | null;
  /** Un rendez-vous lu sans jour ou sans heure : on ne crée rien tel quel. */
  manque: "jour" | "heure" | null;
  /** Ce qui sera enregistré, en clair — les pastilles sous le champ. */
  pastilles: string[];
};

const JOURS = ["dim.", "lun.", "mar.", "mer.", "jeu.", "ven.", "sam."];

/** « mar. 21/10 » — une date « YYYY-MM-DD » sans fuseau (pas de décalage). */
export function jourCourt(ymd: string): string {
  const [a, m, j] = ymd.slice(0, 10).split("-").map(Number);
  const d = new Date(Date.UTC(a, m - 1, j));
  return `${JOURS[d.getUTCDay()]} ${String(j).padStart(2, "0")}/${String(m).padStart(2, "0")}`;
}

/** « 11h », « 11h30 » — la forme des phrases. */
export function heureCourte(hm: string): string {
  const [h, m] = hm.split(":");
  return `${Number(h)}h${m && m !== "00" ? m : ""}`;
}

export function lireCeQuiSestPasse(
  texte: string,
  r: Raccourci | null,
  options: {
    /** « Repéré, pas encore contacté » : une note de repérage, pas un échange. */
    repere?: boolean;
    /** L'humain a renoncé au rendez-vous incomplet : le texte part en note. */
    sansRdv?: boolean;
    /** Le contact saisi dans le champ prime sur celui lu dans le texte. */
    contactSaisi?: string | null;
  } = {}
): LectureRapide {
  const note = texte.trim();
  if (!note) return { echange: null, manque: null, pastilles: [] };

  const rdv = r?.rdv && !options.sansRdv ? r.rdv : null;
  if (rdv && rdv.manque) {
    return {
      echange: null,
      manque: rdv.manque,
      pastilles: [rdv.manque === "jour" ? "Rendez-vous : quel jour ?" : "Rendez-vous : quelle heure ?"],
    };
  }
  // « rdv » seul, sans jour ni heure : même chose qu'une heure manquante.
  if (rdv && !rdv.debut) {
    return { echange: null, manque: "jour", pastilles: ["Rendez-vous : quel jour ?"] };
  }

  const pastilles: string[] = [];
  const rdvComplet = Boolean(rdv);
  const type: EchangeRapide["type"] = rdvComplet ? "rendez_vous" : "note";
  if (rdv) {
    const fin = rdv.fin && rdv.fin.length >= 16 ? rdv.fin.slice(11, 16) : null;
    pastilles.push(
      `Rendez-vous ${jourCourt(rdv.debut)} à ${heureCourte(rdv.debut.slice(11, 16))}` +
        (fin ? `–${heureCourte(fin)}` : "") +
        (rdv.lieu ? ` · ${rdv.lieu}` : "")
    );
  }
  const relance = !rdvComplet && r?.relance ? r.relance.date : null;
  if (relance) pastilles.push(`Relance ${jourCourt(relance)}`);

  const noAnswer = type === "note" && Boolean(r?.sansReponse);
  if (noAnswer) pastilles.push("Appelé, pas de réponse");
  const proposalSent = Boolean(r?.propositionEnvoyee);
  if (proposalSent) pastilles.push("Proposition envoyée");

  const contactLu = r?.contact ?? null;
  const contactName = options.contactSaisi?.trim() || contactLu;
  if (contactLu && !options.contactSaisi?.trim()) pastilles.push(`Contact : ${contactLu}`);

  // Un rendez-vous est un fait par construction ; une note ne l'est que si
  // elle n'est pas un repérage — et un appel sans réponse n'en est jamais un.
  const isExchange = type === "rendez_vous" ? true : !options.repere && !noAnswer;
  if (type === "note" && !noAnswer) {
    pastilles.push(isExchange ? "Échange réel" : "Repérage — reste « À appeler »");
  }

  return {
    manque: null,
    pastilles,
    echange: {
      type,
      note,
      contactName: contactName ?? null,
      dateLocale: rdv ? rdv.debut : relance,
      rdvLieu: rdv?.lieu ?? null,
      rdvFin: rdv?.fin && rdv.fin.length >= 16 ? rdv.fin.slice(0, 16) : null,
      isExchange,
      noAnswer,
      proposalSent,
    },
  };
}
