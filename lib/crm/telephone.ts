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
