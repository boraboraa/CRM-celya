/**
 * La RECHERCHE de prospects — écrite une fois, pour la liste `/prospects` et
 * pour la recherche globale de l'en-tête (⌘K ou « / », 18/10).
 *
 * Elle ne borne RIEN : elle part toujours sur le client de l'utilisateur, donc
 * sous la RLS (`can_see_prospect`). Un commercial ne retrouve que ce qu'il voit
 * déjà ; ce module ne décide que de CE QUI CORRESPOND au texte tapé.
 *
 * Société, contact, email, ville — et le TÉLÉPHONE, que l'ancienne recherche
 * ignorait : les numéros sont stockés « +32 81 22 33 44 » ou « 081 22 33 44 »,
 * un `ilike` sur « 081223344 » ne trouvait jamais rien. Le téléphone se
 * compare donc CHIFFRE À CHIFFRE, séparateurs ignorés, préfixe belge (0, 32,
 * 0032) retiré des deux côtés.
 *
 * La saisie est NETTOYÉE avant d'entrer dans le filtre PostgREST : une virgule
 * ou une parenthèse y casse la syntaxe `or(...)` (« Garage Dupont, Liège »
 * renvoyait une erreur au lieu de résultats), et `%` / `_` sont des jokers.
 *
 * Module NEUTRE, sans import : exécuté tel quel par `npm run test:recherche`.
 */

/** Nombre minimal de chiffres pour chercher un numéro (moins = trop large). */
export const CHIFFRES_MIN = 4;

/** Le texte tapé, sans ce qui casserait le filtre ou servirait de joker. */
export function nettoyerRecherche(q: string | null | undefined): string {
  return (q ?? "")
    .replace(/[,()%_\\*:"]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 80);
}

/**
 * Les chiffres d'un numéro, préfixe belge retiré : « +32 81 22 33 44 »,
 * « 0032 81… » et « 081 22 33 44 » donnent tous « 81223344 ». null s'il y a
 * moins de CHIFFRES_MIN chiffres, ou s'il y a des lettres : « Garage 2000 »
 * est un nom, pas un numéro.
 */
export function chiffresTelephone(q: string | null | undefined): string | null {
  const t = (q ?? "").trim();
  if (!t || /[a-zà-ÿ]/i.test(t)) return null;
  let d = t.replace(/\D/g, "");
  if (d.startsWith("0032")) d = d.slice(4);
  else if (d.startsWith("32") && t.trim().startsWith("+")) d = d.slice(2);
  else if (d.startsWith("0")) d = d.slice(1);
  return d.length >= CHIFFRES_MIN ? d : null;
}

/**
 * Le filtre PostgREST `or(...)`, ou null s'il n'y a rien à chercher. Le
 * téléphone passe par une expression régulière (`imatch`) qui accepte
 * n'importe quels séparateurs entre les chiffres.
 */
export function filtreRecherche(q: string | null | undefined): string | null {
  const t = nettoyerRecherche(q);
  if (!t) return null;
  const like = `%${t}%`;
  const parts = [
    `company_name.ilike.${like}`,
    `contact_name.ilike.${like}`,
    `email.ilike.${like}`,
    `city.ilike.${like}`,
  ];
  const d = chiffresTelephone(t);
  if (d) parts.push(`phone.imatch.${d.split("").join("[^0-9]*")}`);
  return parts.join(",");
}

/**
 * La même règle, sur une ligne déjà lue — pour vérifier qu'un résultat
 * correspond (tests) sans base. Miroir exact de `filtreRecherche`.
 */
export function correspond(
  p: {
    company_name: string;
    contact_name?: string | null;
    email?: string | null;
    city?: string | null;
    phone?: string | null;
  },
  q: string | null | undefined
): boolean {
  const t = nettoyerRecherche(q).toLowerCase();
  if (!t) return true;
  const champs = [p.company_name, p.contact_name, p.email, p.city];
  if (champs.some((c) => (c ?? "").toLowerCase().includes(t))) return true;
  const d = chiffresTelephone(t);
  if (!d || !p.phone) return false;
  return new RegExp(d.split("").join("[^0-9]*")).test(p.phone);
}
