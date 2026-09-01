/**
 * Table de cas des liens Maps — exécutable sans framework :
 *
 *   node --experimental-strip-types lib/crm/maps.test.ts
 *
 * (script npm : `npm run test:maps`). Même style que
 * lib/crm/raccourcis.test.ts. Les cas marqués « réel » viennent des fiches
 * réellement en base le 01/09/2026 — dont les lyonnaises de Rémi, qui portent
 * toutes country='Belgique' : la requête ne doit JAMAIS contenir « Belgique ».
 */

import {
  estLienMaps,
  requeteMaps,
  lienMaps,
  lienItineraire,
  adressePrecise,
} from "./maps.ts";

let echecs = 0;

function verifie(nom: string, obtenu: unknown, attendu: unknown) {
  const o = JSON.stringify(obtenu);
  const a = JSON.stringify(attendu);
  if (o !== a) {
    echecs++;
    console.error(`  ✗ ${nom}\n      attendu ${a}\n      obtenu  ${o}`);
  } else {
    console.log(`✓ ${nom}`);
  }
}

const RECHERCHE = "https://www.google.com/maps/search/?api=1&query=";
const ITINERAIRE = "https://www.google.com/maps/dir/?api=1&destination=";

// --- Un lien collé : reconnu, et renvoyé TEL QUEL ---------------------------
const court = "https://maps.app.goo.gl/abc123";
verifie("lien court reconnu", estLienMaps(court), true);
verifie("lien court renvoyé tel quel", lienMaps(court), court);
verifie("lien court : pas d'itinéraire", lienItineraire(court), null);

const place = "https://www.google.com/maps/place/Garage+Boetendael/@50.8,4.3,17z";
verifie("lien place reconnu", estLienMaps(place), true);
verifie("lien place renvoyé tel quel", lienMaps(place), place);
verifie("lien place : pas d'itinéraire", lienItineraire(place), null);

verifie("maps.google.be reconnu", estLienMaps("https://maps.google.be/?q=Eghezee"), true);
verifie("goo.gl/maps reconnu", estLienMaps("https://goo.gl/maps/xyz"), true);
verifie("un site quelconque n'est pas un lien Maps", estLienMaps("https://celya.be"), false);

// --- Du texte : la requête, dans l'ordre de la règle ------------------------
// (a) réel — un code postal dans l'adresse : elle part SEULE.
const eghezee = "Chaussée de Namur 393, 5310 Eghezée";
verifie(
  "code postal présent → adresse seule",
  requeteMaps({ address: eghezee, city: "Namur" }),
  eghezee
);
verifie(
  "code postal présent → lien de recherche",
  lienMaps(eghezee, "Namur"),
  RECHERCHE + encodeURIComponent(eghezee)
);
verifie(
  "code postal présent → itinéraire",
  lienItineraire(eghezee, "Namur"),
  ITINERAIRE + encodeURIComponent(eghezee)
);

// (b) réel — sans code postal, la ville complète l'adresse.
verifie(
  "sans code postal → adresse + ville",
  requeteMaps({ address: "Chaussée de Namur 393", city: "Eghezée" }),
  "Chaussée de Namur 393, Eghezée"
);

// (b) réel — Rémi à Lyon : « Lyon » doit y être, « Belgique » JAMAIS.
const lyon = requeteMaps({ address: "12 rue Garibaldi", city: "Lyon" });
verifie("Lyon → adresse + ville", lyon, "12 rue Garibaldi, Lyon");
verifie("Lyon → jamais le pays", lyon!.includes("Belgique"), false);

// (c) — la ville déjà présente dans l'adresse n'est pas répétée (accents
// ignorés : « eghezee » saisi à la voix vaut « Eghezée »).
verifie(
  "ville déjà dans l'adresse → pas de doublon",
  requeteMaps({ address: "chaussee de namur 393 eghezee", city: "Eghezée" }),
  "chaussee de namur 393 eghezee"
);
// (c) — pas de ville connue : l'adresse seule.
verifie(
  "sans ville → adresse seule",
  requeteMaps({ address: "12 rue Garibaldi" }),
  "12 rue Garibaldi"
);

// --- Sécurité : une URL qui n'est pas en http(s) n'est JAMAIS un href -------
verifie("javascript: → aucun lien", lienMaps("javascript:alert(1)"), null);
verifie("javascript: → aucun itinéraire", lienItineraire("javascript:alert(1)"), null);
verifie("javascript: n'est pas un lien Maps", estLienMaps("javascript:alert(1)"), false);
verifie("data: → aucun lien", lienMaps("data:text/html,<script>x</script>"), null);
verifie("file: → aucun lien", lienMaps("file:///etc/passwd"), null);
verifie(
  "un faux hôte qui contient « google.com/maps » n'est pas reconnu",
  estLienMaps("https://evil.example/google.com/maps"),
  false
);

// --- Vide et blancs ---------------------------------------------------------
verifie("chaîne vide → null", lienMaps("   "), null);
verifie("null → null", lienMaps(null), null);
verifie("vide → requête null", requeteMaps({ address: "   ", city: "Lyon" }), null);
verifie("vide → itinéraire null", lienItineraire(""), null);

// --- L'avertissement « Maps peut se tromper de pays » ----------------------
verifie("code postal → précis", adressePrecise(eghezee), true);
verifie("ville connue → précis", adressePrecise("12 rue Garibaldi", "Lyon"), true);
verifie("ni l'un ni l'autre → à signaler", adressePrecise("12 rue Garibaldi"), false);
verifie("un lien porte sa localisation", adressePrecise(court), true);
verifie("rien de saisi → rien à signaler", adressePrecise(""), true);

if (echecs > 0) {
  console.error(`\n${echecs} vérification(s) en échec.`);
  process.exit(1);
}
console.log("\nTous les cas passent.");
