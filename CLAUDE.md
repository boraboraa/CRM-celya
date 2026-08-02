# Celya CRM — mémoire projet

Fichier lu automatiquement par Claude Code. Traite tout ce qui suit comme du
contexte acquis : ne le redemande pas.

---

## Ce que c'est

CRM personnel de **Bora Dogrul** (Celya), construit le 1–2 août 2026. Objectif :
après chaque appel client, noter ce qui s'est dit et planifier la relance. En
septembre 2026, des étudiants rejoignent l'équipe et doivent avoir leur propre
accès — **un commercial ne voit que ses clients assignés**. C'est l'exigence
non négociable qui a dicté l'architecture.

Contrainte posée par Bora : **zéro euro de coût récurrent**.

Ce CRM correspond à la ligne « Smart CRM » du catalogue Celya. Il est donc à la
fois outil interne et produit potentiellement revendable — le code est écrit
pour Bora, sans dépendance à un projet tiers sous licence contraignante.

---

## Coordonnées

| Élément | Valeur |
|---|---|
| Projet Supabase | `wyqgbihwkfvzxlzoxvvf` (eu-west-1, plan gratuit, PG 17) |
| URL API | `https://wyqgbihwkfvzxlzoxvvf.supabase.co` |
| Org Supabase | `pnabxknxmyhbasturuyy` — **2 projets actifs sur 2**, plafond atteint |
| Edge function | `crm-admin` (v2, `verify_jwt: true`) |
| Compte admin | `dogrulbora@gmail.com` |
| Équipe Vercel | `bora` (`team_pPDHLPxzzBYl4oq0J1cnZiUX`) |
| Dépôt GitHub | `https://github.com/boraboraa/CRM-celya` (branche `main`) — **public, à passer en privé** |

L'URL et la clé publiable sont en dur dans `lib/env.ts`, surchargeables par
`NEXT_PUBLIC_SUPABASE_URL` / `NEXT_PUBLIC_SUPABASE_ANON_KEY`. C'est volontaire :
la clé anon est publique par conception, toute la sécurité est en base.

**Ne jamais écrire la clé service_role dans le dépôt.** Elle n'est utilisée que
par l'edge function, où Supabase l'injecte automatiquement.

---

## Stack

Next.js 15 (App Router) · React 19 · TypeScript strict · Tailwind 3.4 ·
Supabase (Postgres + Auth + RLS) · déployé sur Vercel.

Pas de librairie de composants : les styles vivent dans `app/globals.css`
(`.card`, `.btn-primary`, `.input`, `.chip`…). Thème sombre Celya —
fond `#0A0E1A`, dégradé `#22D3EE → #4F7BFF → #A855F7`.

---

## Modèle de sécurité — l'invariant à ne jamais casser

Tout repose sur la **RLS Postgres**, pas sur le code applicatif. Même si une
page oublie un filtre, la base refuse. C'est le choix structurant du projet ;
ne le contourne jamais en passant par le service_role côté serveur Next.

Trois fonctions `security definer` portent la logique :

```sql
is_member()            -- compte existant et actif
is_admin()             -- actif et rôle admin
can_see_client(owner)  -- admin, ou propriétaire, ou fiche non assignée
```

Règles effectives :

- **admin** — voit et modifie tout, gère l'équipe
- **commercial** — ses clients assignés + le vivier non assigné (`owner_id is null`)
- **inactif** — peut se connecter, ne voit rien

Garde-fous supplémentaires : un trigger `guard_profile_privileges` empêche un
non-admin de modifier son propre `role` ou `is_active` ; le rôle `anon` n'a
aucun droit sur les tables.

Vérifié empiriquement le 2 août : un compte commercial ne voit pas les fiches
d'un autre, ne peut pas s'auto-promouvoir admin (`P0001`), ne peut pas appeler
`crm-admin` (403), et la clé publique seule renvoie `42501`.

---

## Base de données

| Table | Rôle |
|---|---|
| `crm_users` | comptes équipe : `role` (admin/commercial), `is_active`, `must_change_password` |
| `clients` | fiche prospect/client : société + contact principal fusionnés, `status`, `value_estimate`, `owner_id` |
| `activities` | notes d'appel, emails, réunions — l'historique |
| `tasks` | relances : `due_at`, `priority`, `status` |
| `emails` | emails entrants/sortants rattachés à un client (phase 2, table prête) |

Triggers utiles : une activité met à jour `clients.last_contact_at` ; une tâche
recalcule `clients.next_action_at` (la plus proche échéance ouverte).

**La table s'appelle `crm_users`, pas `profiles`.** Le projet Supabase hébergeait
l'ancienne app de comptabilité, qui avait déjà un `profiles`. Ce schéma comptable
a été entièrement supprimé le 2 août à la demande de Bora, sauvegarde remise
au préalable.

### Choix de modélisation assumé

Une seule entité `clients` fusionne société et contact principal, sans entité
« opportunité » séparée. C'est plus simple que le standard (Société → Contacts →
Affaires) que suivent tous les CRM du marché. **Décision explicite de Bora**,
prise en connaissance des limites : impossible de gérer plusieurs interlocuteurs
chez un même client, ni deux affaires en parallèle. À rouvrir le jour où ça
coince — la migration reste faisable.

---

## Comptes et mots de passe

Il n'y a **aucun envoi d'email** dans le parcours d'authentification, et c'est
délibéré : ça évite de dépendre d'un SMTP.

L'admin crée les comptes depuis `/equipe` avec un mot de passe provisoire qu'il
transmet de vive voix. L'utilisateur le change dans `/compte`. Mot de passe
oublié → l'admin le réinitialise. Tout passe par l'edge function `crm-admin`,
appelée uniquement depuis les server actions avec le JWT de l'appelant.

---

## Écrans

`/dashboard` (Aujourd'hui) · `/pipeline` (kanban glisser-déposer) ·
`/clients` + `/clients/[id]` + `/clients/import` · `/taches` ·
`/equipe` (admin) · `/compte`

Toute l'interface est en **français**, vouvoiement.

---

## Conventions

- Mutations = **server actions** dans `app/actions.ts`, jamais d'appel Supabase
  en écriture depuis un composant client.
- Pages de données = server components avec `export const dynamic = "force-dynamic"`.
- Composants client uniquement quand il faut de l'état local (`QuickNote`,
  `PipelineBoard`, `ImportWizard`, formulaires avec `useActionState`).
- Dates : tout est stocké en UTC, converti via `lib/time.ts` en heure de
  Bruxelles. Ne jamais faire `new Date(valeurDuFormulaire)` côté serveur.
- Classes Tailwind conditionnelles : les écrire en entier dans un `Record`
  (voir `STATUS_CHIP`), jamais par interpolation — le JIT ne les verrait pas.

---

## Déploiement

```bash
npm install
npx vercel --prod
```

Aucune variable d'environnement à configurer.

Migrations SQL : appliquées via le MCP Supabase, copies dans
`supabase/migrations/`. Edge function : déployée via le MCP Supabase avec
`verify_jwt: true`.

---

## Pièges déjà rencontrés — ne pas les redécouvrir

**Insertion groupée PostgREST.** Tous les objets d'un même `insert` doivent
avoir exactement les mêmes clés, sinon `PGRST102: All object keys must match`.
D'où le remplissage systématique à `null` dans `importClientsAction`.

**Triggers et MCP.** Les triggers `on auth.users` ne se déclenchent pas quand
l'insertion vient du MCP Supabase. L'edge function fait donc un `upsert` sur
`crm_users` plutôt qu'un `update`, pour ne pas dépendre du trigger.

**Vercel Hobby.** Les CGU réservent le plan gratuit à un usage non commercial.
Cloudflare n'a pas cette clause. À arbitrer si le CRM devient central.

**Supabase gratuit.** Un projet se met en pause après une semaine sans activité,
et la lecture d'un projet en pause renvoie des tables vides — ce qui m'a fait
conclure à tort que la base était vide. Toujours vérifier `status` avant.

**Suppression d'un bucket Storage.** Impossible en SQL (`protect_delete`) et
l'API bucket exige la clé service_role. À faire depuis le tableau de bord.

---

## Reste à faire

1. **Déployer sur Vercel** — toujours pas fait. Confirmé le 2 août : le
   connecteur MCP renvoie bien `403 forbidden` à la création de projet (il ne
   peut que déployer dans un projet existant). Marche à suivre : sur vercel.com
   (équipe `bora`), Add New → Project → importer `boraboraa/CRM-celya` → Deploy.
   Aucune variable d'environnement requise (coordonnées en dur dans
   `lib/env.ts`) ; chaque push sur `main` redéploiera ensuite tout seul.
   Vérifier après coup : `/` redirige vers `/login`, connexion admin, les cinq
   écrans, création + suppression d'un client de test.
2. **Passer le dépôt GitHub en privé** (Settings → General → Change visibility)
   — ce fichier expose les coordonnées de l'infra et l'email admin.
3. **Changer le mot de passe admin** depuis Mon compte : celui d'origine suit
   un motif devinable et la page de connexion est publique.
4. **Phase 2 : réception des emails.** `gocelya.com` est sur **Mailgun** (le
   plan gratuit inclut 1 route entrante, suffisant). `celya.be` est sur **Zoho**,
   qui a retiré IMAP et le transfert automatique de son offre gratuite → il
   faudra Zoho Mail Lite (~1 €/mois) ou basculer le MX vers ForwardEmail.net.
   Rattachement par adresse exacte, jamais par domaine grand public ; stocker
   `message_id` (contrainte unique = idempotence) et `in_reply_to` pour le fil.
5. Supprimer le bucket Storage `documents`, vide mais toujours présent.
6. Activer la protection contre les mots de passe compromis (tableau de bord
   Supabase → Authentication).

---

## Alternatives déjà évaluées — ne pas refaire la recherche

Seize projets open source audités les 1–2 août. Un seul candidat sérieux :
**NextCRM** (`pdovhomilja/nextcrm-app`, MIT) — isolation par utilisateur réelle
et IMAP intégré, testé en local et vérifié empiriquement. Écarté pour l'instant :
mainteneur unique, version 0.21, pas de français, sécurité applicative et non en
base, et beaucoup de modules inutiles ici.

Écartés aussi : **Atomic CRM** (policies `using (true)`, inbound Postmark payant),
**Twenty** (permissions par ligne payantes, 2 Go Docker), **EspoCRM** (serveur
PHP), et tous ceux en **AGPL** (customermates, atlas, klickbee) qui obligeraient
à publier le code en cas de revente en SaaS.

---

## Tenir ce fichier à jour

Quand une coordonnée change, qu'un piège est levé ou qu'une décision est prise,
mets ce fichier à jour dans le même commit. C'est la mémoire du projet.
