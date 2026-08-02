# Celya CRM

Suivi clients, notes d'appel et relances. Next.js 15 + Supabase (EU), multi-utilisateurs
avec rôles. Hébergement Vercel + Supabase en plan gratuit.

## Déploiement (une seule fois)

```bash
npm install
npx vercel --prod        # crée le projet « celya-crm » sur ton compte Vercel
```

Rien d'autre à configurer : les coordonnées Supabase publiques sont dans `lib/env.ts`.
Elles peuvent être surchargées par des variables d'environnement Vercel
(`NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`) si le projet change.

## Développement local

```bash
npm run dev     # http://localhost:3000
```

## Écrans

| Écran | Rôle |
|---|---|
| Aujourd'hui | relances du jour + en retard, clients sans contact depuis 2 semaines |
| Pipeline | kanban par étape, **glisser-déposer** pour changer le statut (menu déroulant en repli sur mobile) |
| Clients | recherche, filtres, tri · **import CSV** |
| Relances | toutes les relances, filtres aujourd'hui / en retard / terminées |
| Équipe | création de comptes, rôles, activation, réinitialisation de mot de passe (admin) |

### Import CSV

`/clients/import` — séparateur détecté automatiquement (virgule ou point-virgule
des exports Excel FR/BE), BOM géré, guillemets et virgules dans les cellules gérés.
Les colonnes sont mises en correspondance automatiquement à partir d'en-têtes
FR/EN/NL, avec correction manuelle possible. Les montants « 4.800,00 € » et
« 4,800.00 » sont tous deux reconnus. Les lignes dont l'email existe déjà sont
ignorées et listées dans le rapport de fin. Maximum 2000 lignes par fichier,
insertion par lots de 200.

> PostgREST impose que **tous les objets d'une insertion groupée aient exactement
> les mêmes clés** (erreur `PGRST102` sinon). C'est pourquoi `importClientsAction`
> construit chaque ligne avec l'intégralité des colonnes, à `null` si vide.

## Base de données

Projet Supabase `wyqgbihwkfvzxlzoxvvf` (région eu-west-1).
Migrations appliquées : voir `supabase/migrations/`.

| Table | Rôle |
|---|---|
| `crm_users` | comptes de l'équipe (rôle admin / commercial, activation) |
| `clients` | fiches prospects et clients, statut, valeur, responsable |
| `activities` | notes d'appel, emails, réunions — l'historique |
| `tasks` | relances avec échéance et priorité |
| `emails` | emails entrants/sortants rattachés à un client (phase 2) |

La sécurité repose entièrement sur la RLS Postgres : un commercial ne voit que
ses clients assignés et le vivier non assigné ; un admin voit tout ; un compte
inactif ne voit rien.

## Edge function

`crm-admin` — création de comptes, réinitialisation de mot de passe, activation,
changement de rôle. Réservée aux admins, appelée uniquement depuis les server
actions Next.js (le service_role ne quitte jamais Supabase).

## Attention

Ce projet Supabase contenait le schéma de l'app comptabilité (tables `organisations`,
`transactions`, `invoices`, … toutes vides). Elles ont été laissées intactes.
Le CRM utilise `crm_users` et non `profiles` pour éviter toute collision.
La fonction `handle_new_user()` a été réécrite pour le CRM ; la version comptable
d'origine reste récupérable dans la migration `20260604113910`.
