/**
 * « Aucune information ne dépasse de son cadre » (exigence de Bora, 28/10) —
 * la règle, exécutée DANS la page (`page.evaluate`). Elle ne doit donc rien
 * importer ni rien capturer : Playwright la sérialise telle quelle.
 *
 * `pasDeDefilementHorizontal` ne voit que la PAGE ; ici, chaque contenu visible
 * (texte, lien, bouton, champ, pictogramme) est comparé à son CADRE — le plus
 * proche ancêtre qui se voit (fond, bordure, anneau, ombre), ou une ligne de
 * liste ou de tableau — puis à chaque cadre au-dessus, jusqu'à la racine.
 * Trois fautes :
 *
 *  - « dépasse » : le contenu sort de son cadre, ou de son emplacement dans
 *    une rangée flex ou une grille (il chevauche alors le voisin) ;
 *  - « coupé » : un ancêtre `overflow: hidden` le rogne sans « … » — un bouton
 *    à moitié visible, une ligne de texte tranchée ;
 *  - « écrasé » : une troncature qui ne laisse pas trois caractères lisibles ;
 *  - « tronqué sans texte entier » : une troncature « … » sans `title` (le
 *    texte entier au survol) et hors de tout lien ou bouton (le texte entier
 *    au tap, sur la fiche ou dans le dépli).
 *
 * Ce qui défile de lui-même (`overflow: auto | scroll`) n'est pas fautif pour
 * ce qu'il contient — mais un défilement DE CÔTÉ l'est (« défile de côté »),
 * sauf s'il est déclaré voulu par `data-defile`. Un élément fixe (feuille
 * du bas, barre d'onglets) est son propre monde. Tolérance : 1 px.
 */
export function controlerCadres(selecteur: string): string[] {
  const racine = document.querySelector(selecteur) ?? document.body;
  const TOL = 1;
  const fautes: string[] = [];
  const vus = new Set<string>();

  const nom = (el: Element): string => {
    const c = typeof (el as HTMLElement).className === "string" ? (el as HTMLElement).className : "";
    const classes = c.split(/\s+/).filter(Boolean).slice(0, 4).join(".");
    return `${el.tagName.toLowerCase()}${classes ? "." + classes : ""}`;
  };
  const extrait = (el: Element): string =>
    ((el as HTMLElement).getAttribute?.("aria-label") ?? el.textContent ?? "").replace(/\s+/g, " ").trim().slice(0, 40);
  const transparent = (couleur: string) => couleur === "transparent" || /rgba\([^)]*,\s*0\)$/.test(couleur);

  const seVoit = (el: Element): boolean => {
    const s = getComputedStyle(el);
    if (!transparent(s.backgroundColor) || s.backgroundImage !== "none") return true;
    if (s.boxShadow !== "none") return true;
    for (const cote of ["Top", "Right", "Bottom", "Left"] as const) {
      // Une bordure de séparation (divide-y) ne fait pas un cadre ; un
      // contour complet, si.
      if (cote !== "Top" && parseFloat(s[`border${cote}Width`]) > 0 && !transparent(s[`border${cote}Color`])) return true;
    }
    return false;
  };
  const estCadre = (el: Element) =>
    ["LI", "TR", "TD", "TH"].includes(el.tagName) || el.hasAttribute("data-cadre") || seVoit(el);
  /**
   * Un EMPLACEMENT : un élément d'une rangée flex ou d'une grille. Sans fond,
   * il ne se voit pas — mais un texte qui en sort chevauche son voisin (le
   * mot trop long d'un titre sur le bloc « Reprogrammer » d'à côté).
   */
  const estEmplacement = (el: Element) => {
    const p = el.parentElement;
    if (!p) return false;
    let d = getComputedStyle(p).display;
    for (let q: Element | null = p; d === "contents" && q.parentElement; ) {
      q = q.parentElement;
      d = getComputedStyle(q).display;
    }
    return d.includes("flex") || d.includes("grid");
  };

  const invisible = (el: Element): boolean => {
    for (let p: Element | null = el; p && p !== document.body; p = p.parentElement) {
      const s = getComputedStyle(p);
      if (s.display === "none" || s.visibility === "hidden" || parseFloat(s.opacity) === 0) return true;
      // .sr-only : 1 px rogné — fait pour les lecteurs d'écran.
      if (s.position === "absolute" && s.clip !== "auto" && s.clip !== "") return true;
    }
    return false;
  };

  type Boite = { left: number; right: number; top: number; bottom: number };
  const boiteDuContenu = (el: Element): Boite | null => {
    const interactif = el.matches("a[href], button, input, select, textarea, svg, img, [role=button]");
    if (interactif) {
      const r = el.getBoundingClientRect();
      if (!r.width || !r.height) return null;
      // Une marge NÉGATIVE agrandit la zone de tap au-delà du dessin (la case
      // « Fait » : 20 px dessinés, 44 px qui répondent) — c'est voulu, et
      // invisible : on mesure ce qui se voit.
      const s = getComputedStyle(el);
      const m = (v: string) => Math.max(0, -parseFloat(v) || 0);
      return {
        left: r.left + m(s.marginLeft),
        right: r.right - m(s.marginRight),
        top: r.top + m(s.marginTop),
        bottom: r.bottom - m(s.marginBottom),
      };
    }
    // Un texte : l'étendue PEINTE de ses nœuds de texte directs.
    let b: Boite | null = null;
    for (const n of Array.from(el.childNodes)) {
      if (n.nodeType !== Node.TEXT_NODE || !n.textContent?.trim()) continue;
      const range = document.createRange();
      range.selectNodeContents(n);
      for (const r of Array.from(range.getClientRects())) {
        if (!r.width) continue;
        b = b
          ? { left: Math.min(b.left, r.left), right: Math.max(b.right, r.right), top: Math.min(b.top, r.top), bottom: Math.max(b.bottom, r.bottom) }
          : { left: r.left, right: r.right, top: r.top, bottom: r.bottom };
      }
    }
    return b;
  };
  const sort = (b: Boite, c: DOMRect) =>
    b.left < c.left - TOL || b.right > c.right + TOL || b.top < c.top - TOL || b.bottom > c.bottom + TOL;

  const noter = (texte: string) => {
    if (!vus.has(texte)) {
      vus.add(texte);
      fautes.push(texte);
    }
  };

  // Un défilement DE CÔTÉ cache ce qu'il porte : sur téléphone, les chiffres
  // du classement étaient tous hors de l'écran, dans un tableau qui glissait.
  // Permis seulement quand il est voulu et se voit (`data-defile` : la rangée
  // d'étapes du pipeline, par exemple).
  for (const el of Array.from(racine.querySelectorAll<HTMLElement>("*"))) {
    const s = getComputedStyle(el);
    if (!["auto", "scroll"].includes(s.overflowX) || invisible(el)) continue;
    if (el.scrollWidth > el.clientWidth + TOL && !el.closest("[data-defile]")) {
      noter(`défile de côté : ${nom(el)} cache ${el.scrollWidth - el.clientWidth} px — « ${extrait(el)} »`);
    }
  }

  const contenus = racine.querySelectorAll("*");
  for (const el of Array.from(contenus)) {
    if (el.closest("svg") && el.tagName.toLowerCase() !== "svg") continue;
    if (invisible(el) || el.getClientRects().length === 0) continue;
    if (getComputedStyle(el).position === "fixed") continue;

    // La troncature « … » sur l'élément lui-même.
    const se = getComputedStyle(el);
    const he = el as HTMLElement;
    if (se.textOverflow === "ellipsis" && he.scrollWidth > he.clientWidth + TOL) {
      // Une troncature qui ne laisse rien lire n'en est plus une : le nom
      // réduit à « C… » par une colonne qui a glissé.
      const em = parseFloat(se.fontSize) || 16;
      if (he.clientWidth < 3 * em) {
        noter(`écrasé : « ${extrait(el)} » (${nom(el)}) ne garde que ${Math.round(he.clientWidth)} px`);
        continue;
      }
      const titre = el.closest("[title]");
      // Un champ se lit en entier au tap, dans le champ lui-même.
      const tap = el.matches("input, select, textarea") || el.closest("a[href], button, summary, label, [role=button]");
      if (!titre && !tap) noter(`tronqué sans texte entier : « ${extrait(el)} » (${nom(el)})`);
      continue;
    }

    const b = boiteDuContenu(el);
    if (!b) continue;

    for (let a = el.parentElement; a && a !== document.documentElement; a = a.parentElement) {
      const s = getComputedStyle(a);
      if (s.position === "fixed") break;
      // `display: contents` n'a pas de boîte : ce n'est ni un cadre ni un
      // emplacement, ses enfants sont ceux du parent.
      if (s.display === "contents") continue;
      const r = a.getBoundingClientRect();
      const rogne = s.overflowX !== "visible" || s.overflowY !== "visible";
      if (rogne && ["auto", "scroll"].includes(s.overflowX) && ["auto", "scroll"].includes(s.overflowY)) break;
      if (rogne && sort(b, r)) {
        // Le texte d'une troncature est rogné par l'élément qui porte le « … ».
        if (s.textOverflow === "ellipsis") {
          const ha = a as HTMLElement;
          if (ha.scrollWidth > ha.clientWidth + TOL && !a.closest("[title]") && !a.closest("a[href], button, summary, label, [role=button]")) {
            noter(`tronqué sans texte entier : « ${extrait(a)} » (${nom(a)})`);
          }
          break;
        }
        const xSeul = ["auto", "scroll"].includes(s.overflowX);
        const ySeul = ["auto", "scroll"].includes(s.overflowY);
        const horsX = b.left < r.left - TOL || b.right > r.right + TOL;
        const horsY = b.top < r.top - TOL || b.bottom > r.bottom + TOL;
        if ((horsX && !xSeul) || (horsY && !ySeul)) {
          noter(`coupé : « ${extrait(el)} » (${nom(el)}) par ${nom(a)}`);
        }
        break;
      }
      if ((estCadre(a) || estEmplacement(a)) && sort(b, r)) {
        noter(
          `dépasse : « ${extrait(el)} » (${nom(el)}) sort de ${nom(a)} de ${Math.round(
            Math.max(r.left - b.left, b.right - r.right, r.top - b.top, b.bottom - r.bottom)
          )} px`
        );
        break;
      }
      if (a === racine) break;
    }
    if (fautes.length >= 25) break;
  }
  return fautes;
}
