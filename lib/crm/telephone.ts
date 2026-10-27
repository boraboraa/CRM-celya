/**
 * Le lien `tel:` d'un numéro de fiche — UNE fois, pour tous les boutons
 * « Appeler » (fiche, liste, « À faire », agenda). Module neutre et pur.
 *
 * On garde les chiffres et le « + » initial, rien d'autre : « +32 81 22 33 44 »,
 * « 081/22.33.44 » et « 0032 (81) 22 33 44 » composent le même numéro. Sans
 * un seul chiffre, pas de lien — un bouton « Appeler » qui ne compose rien
 * est pire que pas de bouton.
 */
export function lienTel(numero: string | null | undefined): string | null {
  const brut = (numero ?? "").trim();
  const chiffres = brut.replace(/\D/g, "");
  if (chiffres.length < 3) return null;
  return `tel:${brut.startsWith("+") ? "+" : ""}${chiffres}`;
}

/**
 * Normalise un numéro au format belge « +32 … ». Déterministe :
 *  - « 0470 12 34 56 », « 04/223.45.67 », « 0032 470 … », « +32(0)470 … »
 *    deviennent « +32 470 12 34 56 » / « +32 4 223 45 67 » ;
 *  - un numéro étranger (+33…, +49…) est conservé tel quel, compacté ;
 *  - tout ce qui ne ressemble pas à un numéro plausible revient à null —
 *    un numéro inventé coûte une relance perdue.
 */
export function normalizeBelgianPhone(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  let s = raw.trim();
  if (!s) return null;

  // « +32(0)470… » → « +32470… »
  s = s.replace(/\(0\)/g, "");
  // On ne garde que les chiffres et un éventuel + de tête.
  const plus = s.startsWith("+");
  let digits = s.replace(/\D/g, "");
  if (!plus && digits.startsWith("00")) {
    digits = digits.slice(2);
    return formatInternational(digits);
  }
  if (plus) return formatInternational(digits);

  // Format national belge : 0 + 8 ou 9 chiffres.
  if (digits.startsWith("0") && (digits.length === 9 || digits.length === 10)) {
    return formatBelgianNSN(digits.slice(1));
  }
  return null;
}

function formatInternational(digits: string): string | null {
  if (digits.startsWith("32")) {
    // « +32 0470 12 34 56 » : le 0 national ne se garde pas après l'indicatif.
    const nsn = digits.slice(2).replace(/^0/, "");
    return formatBelgianNSN(nsn);
  }
  // Numéro étranger : plausible entre 8 et 15 chiffres (E.164), sinon null.
  if (digits.length < 8 || digits.length > 15) return null;
  return `+${digits}`;
}

function formatBelgianNSN(nsn: string): string | null {
  if (nsn.length === 9) {
    // Mobile — toujours 4XX en Belgique. Tout autre préfixe (ex. un 06
    // français collé en format national) n'est PAS transformé en +32 :
    // on n'invente jamais un numéro.
    if (nsn[0] !== "4") return null;
    return `+32 ${nsn.slice(0, 3)} ${nsn.slice(3, 5)} ${nsn.slice(5, 7)} ${nsn.slice(7)}`;
  }
  if (nsn.length === 8) {
    // Fixe : zone à un chiffre (Bruxelles 2, Anvers 3, Liège 4, Gand 9)…
    if ("2349".includes(nsn[0])) {
      return `+32 ${nsn[0]} ${nsn.slice(1, 4)} ${nsn.slice(4, 6)} ${nsn.slice(6)}`;
    }
    // …ou zone à deux chiffres (065 Mons, 081 Namur…).
    return `+32 ${nsn.slice(0, 2)} ${nsn.slice(2, 4)} ${nsn.slice(4, 6)} ${nsn.slice(6)}`;
  }
  return null;
}
