/**
 * Google Maps — de la CONSTRUCTION D'URL, rien d'autre.
 *
 * Pas de clé API, pas d'OAuth, pas de facturation, pas de géocodage, pas de
 * carte encastrée. Google publie un format d'URL public
 * (https://developers.google.com/maps/documentation/urls/get-started) qui, sur
 * téléphone, ouvre directement l'application Maps. Tant que le portefeuille
 * tient sur un écran, tout le reste serait du coût pour un bénéfice nul.
 *
 * Module PUR : aucun réseau, aucun Supabase, aucun React — testé par
 * lib/crm/maps.test.ts (`npm run test:maps`).
 *
 * DEUX RÈGLES qui viennent du terrain, à ne pas défaire :
 *
 *   · `prospects.country` n'est JAMAIS lu. Les 13 fiches de Rémi portent
 *     toutes country='Belgique' — la valeur PAR DÉFAUT de la colonne, jamais
 *     corrigée — alors qu'elles sont lyonnaises. S'en servir enverrait Rémi à
 *     600 km. La ville, elle, est saisie : c'est elle qui désambiguïse.
 *   · Ce que l'utilisateur a saisi n'est JAMAIS réécrit. Un lien collé est
 *     renvoyé tel quel ; une adresse part telle quelle dans la requête.
 *
 * SÉCURITÉ — la valeur vient de l'utilisateur et finit dans un href :
 *   · tout est parsé par `new URL()` dans un try/catch ; une URL invalide est
 *     du texte, pas un lien ;
 *   · seuls les schémas http et https sont acceptés. `javascript:`, `data:`,
 *     `file:` et tout le reste ne produisent AUCUN lien — le texte s'affiche,
 *     et rien n'est cliquable ;
 *   · la liste blanche porte sur le NOM D'HÔTE SEUL, **ancré des deux côtés**
 *     (`estHoteMaps`, unique juge du module — personne ne refait ce test à la
 *     main). Sans l'ancre de fin, `maps.google.com.evil.com` et
 *     `maps.app.goo.gl.evil.com` étaient reconnus comme des liens Maps et
 *     renvoyés TELS QUELS dans un href, sous un bouton « 📍 Ouvrir dans Maps »
 *     qui inspire confiance : le sosie d'hôte est exactement l'attaque que
 *     cette liste doit arrêter. Un port explicite est refusé au passage : un
 *     vrai lien Maps n'en porte jamais ;
 *   · tout <a> construit à partir d'ici porte target="_blank" et
 *     rel="noopener noreferrer" (voir components/BoutonsMaps.tsx).
 */

/**
 * Longueur maximale stockée pour une adresse (fiche) ou un lieu (rendez-vous).
 * Généreuse À DESSEIN : une URL Google Maps dépasse allègrement les 300
 * caractères des autres champs texte, et **une URL coupée est une URL morte**.
 */
export const ADRESSE_MAX = 1000;

/** Domaines Google (google.fr, www.google.co.uk, maps.google.be…). */
const HOTES_GOOGLE = /^(www\.)?(maps\.)?google\.[a-z]{2,3}(\.[a-z]{2,3})?$/i;
/** Raccourcisseurs Google. */
const HOTES_COURTS = /^(maps\.app\.goo\.gl|goo\.gl)$/i;

/**
 * L'URL pointe-t-elle vraiment Google Maps ? **Le seul juge du module** : ce
 * test ne se refait nulle part à la main, c'est cette duplication qui avait
 * laissé passer le sosie d'hôte dans les notes.
 *
 * `hostname` et non `host` : le port ne fait pas partie du nom d'hôte, et
 * l'ancre `$` est ce qui ferme la porte à « maps.google.com.evil.com ». Un
 * port explicite est refusé séparément — aucun lien Maps réel n'en porte, et
 * ne rien accepter d'inutile coûte zéro.
 */
export function estHoteMaps(url: URL): boolean {
  if (url.port) return false;
  const hote = url.hostname.toLowerCase();
  if (HOTES_COURTS.test(hote)) {
    // maps.app.goo.gl ne sert qu'à Maps ; goo.gl est générique.
    return hote === "maps.app.goo.gl" || url.pathname.startsWith("/maps");
  }
  if (HOTES_GOOGLE.test(hote)) {
    // maps.google.* est déjà Maps ; google.* exige le chemin /maps.
    return hote.startsWith("maps.") || url.pathname.startsWith("/maps");
  }
  return false;
}

/** Un préfixe de schéma d'URL (« https: », « javascript: »…). */
const SCHEMA = /^[a-z][a-z0-9+.-]*:/i;

/** Un code postal belge (4 chiffres) ou français (5) — bornes exigées. */
const CODE_POSTAL = /(?<!\d)\d{4,5}(?!\d)/;

/**
 * L'URL si la valeur en est une ET qu'elle est en http(s) ; null sinon.
 * `absolue` distingue « ce n'est pas une URL du tout » (du texte, qu'on peut
 * chercher dans Maps) de « c'est une URL, mais pas une qu'on ouvrira » —
 * cette dernière ne doit produire aucun lien.
 */
function lireUrl(valeur: string): { url: URL | null; absolue: boolean } {
  if (!SCHEMA.test(valeur)) return { url: null, absolue: false };
  try {
    const url = new URL(valeur);
    if (url.protocol !== "http:" && url.protocol !== "https:") {
      return { url: null, absolue: true };
    }
    return { url, absolue: true };
  } catch {
    // « Rue: 12 » et consorts : ça ressemblait à un schéma, ce n'en est pas un.
    return { url: null, absolue: false };
  }
}

/** Comparaison souple : minuscules, sans accents (« Eghezée » ≡ « eghezee »). */
function plie(s: string): string {
  return s
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase();
}

/** La valeur est-elle un lien Google Maps (collé depuis l'application) ? */
export function estLienMaps(valeur: string | null | undefined): boolean {
  const v = (valeur ?? "").trim();
  if (!v) return false;
  const { url } = lireUrl(v);
  if (!url) return false;
  return estHoteMaps(url);
}

/**
 * La requête envoyée à Maps, DANS CET ORDRE — et jamais `country`, jamais le
 * nom de la société :
 *   a) l'adresse porte déjà un code postal → elle part SEULE ;
 *   b) sinon, la ville est renseignée et absente de l'adresse → « adresse, ville » ;
 *   c) sinon → l'adresse seule.
 */
export function requeteMaps(p: {
  address?: string | null;
  city?: string | null;
}): string | null {
  const adresse = (p.address ?? "").trim();
  if (!adresse) return null;

  if (CODE_POSTAL.test(adresse)) return adresse;

  const ville = (p.city ?? "").trim();
  if (!ville) return adresse;
  if (plie(adresse).includes(plie(ville))) return adresse;

  return `${adresse}, ${ville}`;
}

/**
 * Le lien « Ouvrir dans Maps ».
 *   · un lien Maps collé est renvoyé TEL QUEL (on ne réécrit pas la saisie) ;
 *   · du texte devient une recherche Maps ;
 *   · une URL qui n'est pas en http(s) — ou une valeur vide — ne donne RIEN.
 */
export function lienMaps(
  valeur: string | null | undefined,
  ville?: string | null
): string | null {
  const v = (valeur ?? "").trim();
  if (!v) return null;

  const { url, absolue } = lireUrl(v);
  if (url) {
    if (estHoteMaps(url)) return v;
    // Une autre URL http(s) : on la cherche telle quelle, faute de mieux.
  } else if (absolue) {
    return null; // javascript:, data:, file:… : du texte, jamais un href.
  }

  const requete = requeteMaps({ address: v, city: ville });
  if (!requete) return null;
  return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(requete)}`;
}

/**
 * Le lien « Y aller » (itinéraire).
 *
 * null pour un lien Maps — notamment un lien court `maps.app.goo.gl`, dont on
 * ne peut PAS extraire la destination sans le résoudre (donc sans réseau, donc
 * sans clé). Le bouton ne s'affiche alors simplement pas : Maps propose
 * l'itinéraire au tap suivant.
 */
export function lienItineraire(
  valeur: string | null | undefined,
  ville?: string | null
): string | null {
  const v = (valeur ?? "").trim();
  if (!v) return null;

  const { url, absolue } = lireUrl(v);
  if (url) return null; // une URL ne nomme pas une destination exploitable
  if (absolue) return null; // javascript:, data:… : rien de cliquable

  const requete = requeteMaps({ address: v, city: ville });
  if (!requete) return null;
  return `https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(requete)}`;
}

/**
 * La valeur est-elle assez précise pour que Maps ne se trompe pas de pays ?
 * Un code postal, ou une ville connue — sinon « 12 rue Garibaldi » peut
 * atterrir n'importe où. Sert l'avertissement ambre du champ de saisie.
 */
export function adressePrecise(
  valeur: string | null | undefined,
  ville?: string | null
): boolean {
  const v = (valeur ?? "").trim();
  if (!v) return true; // rien de saisi : rien à signaler
  if (estLienMaps(v)) return true; // un lien porte sa propre localisation
  return CODE_POSTAL.test(v) || (ville ?? "").trim().length > 0;
}
