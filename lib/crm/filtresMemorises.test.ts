// npm run test:filtres-memorises — les filtres de /prospects GARDÉS AU RETOUR
// (cookie `celya_filtres`, 3/11) et le garde-fou « pas de href en dur vers la
// liste ».
import assert from "node:assert/strict";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import {
  FILTRES_COOKIE,
  LISTE_PROSPECTS,
  chaineFiltres,
  hrefProspects,
  jourBruxelles,
  lienListeProspects,
  lienToutEffacer,
  ligneCookieFiltres,
  ligneEffacerFiltres,
  lireCookieFiltres,
  lireDansCookies,
  minuitBruxelles,
  redirectionListe,
  valeurCookieFiltres,
  cleDefilement,
} from "./filtresProspects.ts";
import { lienOnglet } from "../nav.ts";

let ok = 0;
function cas(nom: string, f: () => void) {
  f();
  ok++;
  console.log(`  ✓ ${nom}`);
}

// Mardi 3 novembre 2026, 15h à Bruxelles (UTC+1 en hiver).
const MAINTENANT = new Date("2026-11-03T14:00:00Z");
const valide = (chaine: string, jour = "2026-11-03") => `${jour}|${chaine}`;

cas("cookie valide : la liste retenue, filtres et tri compris", () => {
  const v = valeurCookieFiltres(
    { statut: "a_rappeler", region: "Namur", secteur: "Garage / carrosserie", tri: "nom", q: " dupont " },
    MAINTENANT
  );
  assert.equal(v, "2026-11-03|q=dupont&statut=a_rappeler&region=Namur&secteur=Garage+%2F+carrosserie&tri=nom");
  assert.deepEqual(lireCookieFiltres(v, MAINTENANT), {
    q: "dupont",
    statut: "a_rappeler",
    region: "Namur",
    secteur: "Garage / carrosserie",
    tri: "nom",
  });
  assert.equal(
    lienListeProspects(v, MAINTENANT),
    "/prospects?q=dupont&statut=a_rappeler&region=Namur&secteur=Garage+%2F+carrosserie&tri=nom"
  );
  // Tel que le navigateur le garde (encodé) comme tel que le serveur le reçoit (décodé).
  assert.equal(lienListeProspects(encodeURIComponent(v), MAINTENANT), lienListeProspects(v, MAINTENANT));
  // La recherche garde son « % » (jamais décodée deux fois).
  const pourcent = valeurCookieFiltres({ q: "50% off" }, MAINTENANT);
  assert.equal(lireCookieFiltres(pourcent, MAINTENANT)?.q, "50% off");
  assert.equal(lireCookieFiltres(encodeURIComponent(pourcent), MAINTENANT)?.q, "50% off");
});

cas("seuls les FILTRES sont retenus — ni la vue, ni le périmètre (ils ont leurs cookies)", () => {
  assert.equal(chaineFiltres({ vue: "colonnes", perimetre: "moi", statut: "gagne" }), "statut=gagne");
  assert.equal(chaineFiltres({ vue: "colonnes", perimetre: "equipe" }), "");
  assert.equal(chaineFiltres({ q: "   " }), "", "pas de q vide");
  assert.equal(chaineFiltres({ tri: "priorite" }), "", "le tri par défaut ne se retient pas");
});

cas("cookie trafiqué : il ne vaut pas plus qu'une URL trafiquée", () => {
  // Étape retirée, métier inventé, région inconnue, tri et raccourci absurdes.
  const t1 = valide("statut=contacte&secteur=Boulangerie&region=Atlantide&tri=constructor&filtre=__proto__");
  assert.equal(lireCookieFiltres(t1, MAINTENANT), null);
  assert.equal(lienListeProspects(t1, MAINTENANT), LISTE_PROSPECTS);
  // Clés inconnues : ignorées ; seules les bonnes passent.
  const t2 = valide("perimetre=<uuid-de-bora>&vue=colonnes&redirect=https://evil.example&statut=a_appeler");
  assert.equal(lienListeProspects(t2, MAINTENANT), "/prospects?statut=a_appeler");
  // Injection d'URL : le lien reste TOUJOURS sous /prospects, même origine.
  for (const brut of [
    valide("//evil.example"),
    valide("?statut=a_appeler#//evil"),
    valide("statut=a_appeler&q=%0D%0ASet-Cookie:x=1"),
    "2026-11-03|https://evil.example/?statut=a_appeler",
    "javascript:alert(1)",
    "%E0%A4%A",
    "|",
    "",
  ]) {
    const lien = lienListeProspects(brut, MAINTENANT);
    assert.ok(lien === LISTE_PROSPECTS || lien.startsWith(`${LISTE_PROSPECTS}?`), `${brut} → ${lien}`);
    assert.ok(!/[\r\n]/.test(lien), "aucun saut de ligne brut dans le lien");
  }
  // La recherche est bornée.
  assert.equal(lireCookieFiltres(valide(`q=${"x".repeat(5000)}`), MAINTENANT)?.q?.length, 200);
});

cas("cookie d'un autre jour : ignoré (même si le navigateur le garde)", () => {
  const hier = valide("statut=a_rappeler", "2026-11-02");
  assert.equal(lireCookieFiltres(hier, MAINTENANT), null);
  assert.equal(lienListeProspects(hier, MAINTENANT), LISTE_PROSPECTS);
  assert.equal(lireCookieFiltres("statut=a_rappeler", MAINTENANT), null, "sans date : ignoré");
  assert.equal(lireCookieFiltres(null, MAINTENANT), null);
  assert.equal(lireCookieFiltres(undefined, MAINTENANT), null);
});

cas("minuit, heure de Bruxelles — en hiver comme en été", () => {
  // Hiver (UTC+1) : minuit du 4/11 = 23h00 UTC le 3/11.
  assert.equal(minuitBruxelles(MAINTENANT).toISOString(), "2026-11-03T23:00:00.000Z");
  // Été (UTC+2) : minuit du 16/07 = 22h00 UTC le 15/07.
  assert.equal(minuitBruxelles(new Date("2026-07-15T09:00:00Z")).toISOString(), "2026-07-15T22:00:00.000Z");
  // 23h30 à Bruxelles le 3/11 (22h30 UTC) : encore le 3, expire dans 30 min.
  assert.equal(jourBruxelles(new Date("2026-11-03T22:30:00Z")), "2026-11-03");
  assert.equal(minuitBruxelles(new Date("2026-11-03T22:30:00Z")).toISOString(), "2026-11-03T23:00:00.000Z");
  // 0h30 à Bruxelles le 4/11 (23h30 UTC le 3) : c'est déjà le lendemain.
  assert.equal(jourBruxelles(new Date("2026-11-03T23:30:00Z")), "2026-11-04");
  assert.equal(lireCookieFiltres(valide("statut=gagne"), new Date("2026-11-03T23:30:00Z")), null);
  // Changement d'heure (nuit du 24 au 25/10/2026) : minuit du 25 = 22h00 UTC le 24.
  assert.equal(minuitBruxelles(new Date("2026-10-24T12:00:00Z")).toISOString(), "2026-10-24T22:00:00.000Z");
  assert.equal(minuitBruxelles(new Date("2026-10-25T12:00:00Z")).toISOString(), "2026-10-25T23:00:00.000Z");
  // La ligne de cookie porte cette expiration, SameSite=Lax.
  const ligne = ligneCookieFiltres({ statut: "a_appeler" }, MAINTENANT, true);
  assert.match(ligne, /^celya_filtres=2026-11-03%7Cstatut%3Da_appeler; path=\/; expires=Tue, 03 Nov 2026 23:00:00 GMT; samesite=lax; secure$/);
});

cas("un `?` explicite l'emporte TOUJOURS sur le cookie", () => {
  const c = valide("statut=a_rappeler&secteur=Autre");
  assert.equal(redirectionListe({}, c, MAINTENANT), "/prospects?statut=a_rappeler&secteur=Autre", "/prospects nu → la liste retenue");
  assert.equal(redirectionListe({ filtres: "aucun" }, c, MAINTENANT), null, "liste vide voulue");
  assert.equal(redirectionListe({ vue: "colonnes" }, c, MAINTENANT), null, "la vue seule suffit");
  assert.equal(redirectionListe({ perimetre: "moi" }, c, MAINTENANT), null);
  assert.equal(redirectionListe({ statut: "gagne" }, c, MAINTENANT), null, "un lien partagé");
  assert.equal(redirectionListe({}, null, MAINTENANT), null, "pas de cookie : la liste nue, sans boucle");
  assert.equal(redirectionListe({}, valide("statut=contacte"), MAINTENANT), null, "cookie sans filtre valable : pas de redirection");
  // Le marqueur d'une liste vide voulue : la dernière puce retirée le porte.
  assert.equal(hrefProspects({ statut: "a_appeler" }, { statut: null }), "/prospects?filtres=aucun");
  // Et il disparaît dès qu'on pose un filtre.
  assert.equal(hrefProspects({}, { secteur: "Autre" }), "/prospects?secteur=Autre");
});

cas("« Tout effacer » : le cookie effacé, la liste sans filtre, vue et périmètre gardés", () => {
  assert.equal(ligneEffacerFiltres(), `${FILTRES_COOKIE}=; path=/; max-age=0; samesite=lax`);
  assert.equal(ligneEffacerFiltres(true), `${FILTRES_COOKIE}=; path=/; max-age=0; samesite=lax; secure`);
  // Une liste sans filtre à retenir efface le cookie, elle aussi.
  assert.equal(ligneCookieFiltres({ vue: "colonnes" }, MAINTENANT), ligneEffacerFiltres());
  assert.equal(
    lienToutEffacer({ q: "x", statut: "gagne", secteur: "Autre", region: "Namur", tri: "nom", vue: "colonnes", perimetre: "equipe" }),
    "/prospects?vue=colonnes&perimetre=equipe"
  );
  assert.equal(lienToutEffacer({ statut: "gagne" }), "/prospects?filtres=aucun", "secours : le marqueur");
  // Le cookie effacé, /prospects nu ne redirige plus.
  assert.equal(redirectionListe({}, "", MAINTENANT), null);
});

cas("l'onglet Prospects rouvre la liste retenue ; les autres onglets ne changent pas", () => {
  const lien = lienListeProspects(valide("secteur=Autre"), MAINTENANT);
  assert.equal(lienOnglet("/prospects", lien), "/prospects?secteur=Autre");
  assert.equal(lienOnglet("/dashboard", lien), "/dashboard");
  assert.equal(lienOnglet("/prospects/ma-liste", lien), "/prospects/ma-liste");
});

cas("lire un cookie dans `document.cookie`", () => {
  const brut = `celya_vue=colonnes; ${FILTRES_COOKIE}=2026-11-03%7Cstatut%3Dgagne; autre=a=b`;
  assert.equal(lireDansCookies(brut, FILTRES_COOKIE), "2026-11-03%7Cstatut%3Dgagne");
  assert.equal(lireDansCookies(brut, "autre"), "a=b");
  assert.equal(lireDansCookies(brut, "absent"), null);
  assert.equal(lienListeProspects(lireDansCookies(brut, FILTRES_COOKIE), MAINTENANT), "/prospects?statut=gagne");
});

cas("la position de défilement se retient par URL de liste", () => {
  assert.equal(cleDefilement("/prospects", "?statut=gagne"), "celya_defilement:/prospects?statut=gagne");
  assert.equal(cleDefilement("/prospects", "statut=gagne"), "celya_defilement:/prospects?statut=gagne");
  assert.equal(cleDefilement("/prospects", ""), "celya_defilement:/prospects");
});

// ─── Le garde-fou : plus aucun retour en dur vers la liste ────────────────
const racine = new URL("../..", import.meta.url).pathname;
function fichiers(dossier: string): string[] {
  const out: string[] = [];
  for (const nom of readdirSync(join(racine, dossier))) {
    const rel = `${dossier}/${nom}`;
    if (statSync(join(racine, rel)).isDirectory()) out.push(...fichiers(rel));
    else if (/\.(tsx?|jsx?)$/.test(rel)) out.push(rel);
  }
  return out;
}

cas("aucun `href=\"/prospects\"` ni `push(\"/prospects\")` en dur dans app/ et components/", () => {
  const fautes: string[] = [];
  const motifs = [
    /href=\{?\s*["'`]\/prospects["'`]/,
    /(?:push|replace|redirect)\(\s*["'`]\/prospects["'`]/,
    /href:\s*["'`]\/prospects["'`]/,
  ];
  for (const f of [...fichiers("app"), ...fichiers("components")]) {
    readFileSync(join(racine, f), "utf8")
      .split("\n")
      .forEach((ligne, i) => {
        if (motifs.some((m) => m.test(ligne))) fautes.push(`${f}:${i + 1} ${ligne.trim()}`);
      });
  }
  assert.deepEqual(fautes, [], "un retour à la liste passe par lienListeProspects / useLienListe / lienListeServeur");
});

cas("les retours à la liste passent bien par l'utilitaire", () => {
  const lire = (f: string) => readFileSync(join(racine, f), "utf8");
  assert.match(lire("app/(app)/prospects/[id]/page.tsx"), /href=\{await lienListeServeur\(\)\}/);
  assert.match(lire("app/(app)/prospects/import/page.tsx"), /href=\{await lienListeServeur\(\)\}/);
  assert.match(lire("app/(app)/prospects/nouveau/page.tsx"), /href=\{await lienListeServeur\(\)\}/);
  assert.match(lire("app/(app)/dashboard/page.tsx"), /lienListe=\{await lienListeServeur\(\)\}/);
  assert.match(lire("components/ZonesAFaire.tsx"), /href=\{lienListe\}/);
  assert.match(lire("components/SupprimerFiche.tsx"), /router\.push\(lienListe\)/);
  assert.match(lire("components/ImportWizard.tsx"), /href=\{lienListe\}/);
  assert.match(lire("components/Nav.tsx"), /lienOnglet\(item\.href, lienListe\)/);
  assert.match(lire("components/BarreOnglets.tsx"), /lienOnglet\(o\.item\.href, lienListe\)/);
  // Le retour « À faire » de la fiche ne change pas.
  assert.match(lire("app/(app)/prospects/[id]/page.tsx"), /<Link href="\/dashboard" className="btn-link text-xs">/);
});

console.log(`\n${ok} OK`);
