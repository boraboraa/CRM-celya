# Celya CRM — mémoire projet

Fichier lu automatiquement par Claude Code. Traite tout ce qui suit comme du
contexte acquis : ne le redemande pas.

---

## Ce que c'est

CRM personnel de **Bora Dogrul** (Celya), construit le 1–2 août 2026, refondu le
3 août en **poste de travail d'appels** : Bora prospecte au téléphone, seul —
il cherche un numéro, il appelle, il note. L'écran d'accueil est une file
d'appels (« qui j'appelle maintenant ? »), le mail est secondaire et réactif.
En septembre 2026, des étudiants rejoignent l'équipe et doivent avoir leur
propre accès — **un commercial ne voit que ses prospects assignés**. C'est
l'exigence non négociable qui a dicté l'architecture.

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
| Edge functions | `crm-admin` (v2, `verify_jwt: true`) · `crm-mail` (v1, `verify_jwt: false` — auth interne : JWT vérifié pour save/send, secret Vault pour la relève cron) |
| Compte admin | `dogrulbora@gmail.com` |
| Équipe Vercel | `bora` (`team_pPDHLPxzzBYl4oq0J1cnZiUX`) |
| URL de production | `https://celya-accounting-app.vercel.app` — vérifiée de bout en bout le 2 août |
| Projet Vercel | `celya-accounting-app` — ancien projet de l'app comptable réutilisé, relié au dépôt (push sur `main` = redéploiement auto). À renommer en `celya-crm`, voir Reste à faire |
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
is_member()              -- compte existant et actif
is_admin()               -- actif et rôle admin
can_see_prospect(owner)  -- admin, ou propriétaire, ou fiche non assignée
```

Règles effectives :

- **admin** — voit et modifie tout, gère l'équipe
- **commercial** — ses prospects assignés + le vivier non assigné (`owner_id is null`)
- **inactif** — peut se connecter, ne voit rien

Garde-fous supplémentaires : un trigger `guard_profile_privileges` empêche un
non-admin de modifier son propre `role` ou `is_active` ; le rôle `anon` n'a
aucun droit sur les tables ; `email_accounts` n'a **aucune policy** (fermée à
`anon` et `authenticated`, seule l'edge function `crm-mail` y accède) et les
emails non rattachés ne sont visibles que par l'admin.

Vérifié empiriquement le 2 août : un compte commercial ne voit pas les fiches
d'un autre, ne peut pas s'auto-promouvoir admin (`P0001`), ne peut pas appeler
`crm-admin` (403), et la clé publique seule renvoie `42501`.

---

## Base de données

| Table | Rôle |
|---|---|
| `crm_users` | comptes équipe : `role` (admin/commercial), `is_active`, `must_change_password` |
| `prospects` | fiche prospect : société + contact principal fusionnés, `status`, `value_estimate`, `owner_id`, cadence d'appels (`call_attempts`, `last_outcome`, `last_call_slot`) |
| `activities` | notes d'appel, emails, réunions — l'historique (`prospect_id`) |
| `tasks` | rappels/relances : `due_at`, `priority`, `status` (`prospect_id`) |
| `emails` | emails entrants/sortants (`prospect_id`, `message_id` unique = idempotence, `in_reply_to`) + tri des réponses (`triage`, `intent`, `intent_confidence`, `intent_summary`, `proposed_due_at`) |
| `email_accounts` | boîte SMTP/IMAP de Bora : hôtes Zoho, `credentials_secret_id` (→ Vault), `last_sync_at`, `sync_cursor`, `sync_error` — RLS fermée |

Triggers utiles : une activité met à jour `prospects.last_contact_at` ; une
tâche recalcule `prospects.next_action_at` (la plus proche échéance ouverte).
C'est `next_action_at` qui pilote la file d'appels.

**`clients` a été renommée `prospects` le 3 août** (migration
`004_prospection_telephonique`) : table, contraintes, index, politiques,
colonnes `client_id` → `prospect_id`, et les fonctions `bump_last_contact` /
`sync_next_action` recréées (le corps des fonctions est du texte : un rename
SQL ne les suit pas). Le mot « client » ne subsiste dans l'interface que pour
un prospect au statut *Gagné*. `/clients` redirige vers `/prospects`
(next.config.mjs).

**La table s'appelle `crm_users`, pas `profiles`.** Le projet Supabase hébergeait
l'ancienne app de comptabilité, qui avait déjà un `profiles`. Ce schéma comptable
a été entièrement supprimé le 2 août à la demande de Bora, sauvegarde remise
au préalable.

### États et cadence d'appels

Statuts (`prospect_status`) : `a_appeler` → `sans_reponse` → `contact_etabli` →
`rappel_programme` → `rdv` → `proposition` → `gagne` / `perdu`. Migration des
anciens : nouveau→a_appeler, contacte→contact_etabli, qualifie→rdv,
negociation→proposition. **`rappel_programme` est l'état de mise en sommeil** :
le prospect disparaît entièrement de la file d'appels jusqu'à sa date
(`next_action_at`), puis y remonte seul.

Résultats d'appel (`CALL_OUTCOMES` dans `lib/constants.ts`) et délais de rappel
par défaut, **modifiables à la main** au moment de l'enregistrement :

| Résultat | Délai | Statut résultant |
|---|---|---|
| `pas_repondu` | 2 j | sans_reponse |
| `repondeur` | 3 j | sans_reponse |
| `barrage_secretaire` | 4 j | sans_reponse |
| `mauvais_numero` | — | perdu (« Numéro invalide ») |
| `refus` | — | perdu (motif à saisir) |
| `rappeler_plus_tard` | date choisie | rappel_programme |
| `interesse` | 2 j | contact_etabli |
| `rdv_fixe` | date du RDV | rdv |

Le helper unique est `planifierRappelAction` (`app/actions.ts`) : statut,
`call_attempts + 1`, `last_outcome`, `last_call_slot` (créneau déduit de
l'heure de Bruxelles), activité au journal, et tâche de rappel — **jamais de
doublon** : la tâche ouverte existante est re-datée, les surnuméraires annulées.

Deux automatismes, jamais de bascule automatique en Perdu :
- **Plafond** : à 6 tentatives sans réponse (`MAX_CALL_ATTEMPTS`), la file
  propose l'archivage (décision humaine, `archiverProspectAction`).
- **Variation d'horaire** : si les 3 derniers appels (déduits de
  `activities.occurred_at`) tombent dans le même créneau, la file en suggère
  un autre (`OTHER_SLOT`).

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

Le projet Supabase est partagé avec l'ancienne app comptable, donc `auth.users`
aussi : un compte qui se connecte sans fiche `crm_users` active est redirigé
vers `/acces-refuse` — page neutre avec bouton de déconnexion, qui ne révèle
rien sur l'état du compte (ni 500, ni « compte en attente »).

---

## Écrans

`/dashboard` (la file d'appels) · `/pipeline` (kanban glisser-déposer) ·
`/prospects` + `/prospects/[id]` + `/prospects/nouveau` (collage IA) +
`/prospects/import` · `/taches` · `/emails` (non rattachés) ·
`/reglages-email` (admin, boîte Zoho) · `/equipe` (admin) · `/compte` ·
`/acces-refuse` (compte connecté sans accès CRM)

La file d'appels répond à une seule question — *qui j'appelle maintenant ?* —
dans l'ordre : **En retard** (rappels passés, les plus anciens d'abord),
**Aujourd'hui**, **Jamais appelés** (statut `a_appeler`), **Réponses reçues**
(boîte Zoho). Chaque ligne : lien `tel:`, dernier résultat, note + boutons de
résultat — enregistrer et passer au suivant tient en deux clics. Un rappel
« dans 3 jours » n'y remonte qu'à son échéance — c'est voulu, il est visible
dans `/taches` entre-temps.

Toute l'interface est en **français**, vouvoiement.

## Saisie assistée par IA

L'abstraction fournisseur vit dans `lib/ai/provider.ts` : `AGENT_PROVIDER`
choisit le fournisseur, `<FOURNISSEUR>_API_KEY` / `_BASE_URL` / `_MODEL` /
`_VISION_MODEL` le configurent (API chat completions, format OpenAI).
Aujourd'hui `MINIMAX_*` (variables déjà sur Vercel, héritées de l'app
comptable) ; un fournisseur hébergé en Europe se branchera **par variable
d'environnement, jamais par réécriture**.

- **Coller → fiche** (`/prospects/nouveau`) : texte ou capture d'écran collés →
  `extractProspectAction` extrait les champs, le formulaire arrive pré-rempli
  (champs déduits surlignés), doublons détectés (téléphone, email, société) et
  signalés sans bloquer. Rien ne s'enregistre sans validation.
- **Note d'appel → structure** (bouton ✨ dans `CallActions`) :
  `analyzeCallNoteAction` propose résultat, date réelle de rappel, contact,
  résumé — un clic Enregistrer déclenche `planifierRappel`.
- **Garde-fous** : tout passe côté serveur (aucune clé en `NEXT_PUBLIC_*`, le
  module jette s'il est importé côté client), sortie validée strictement
  (clés, formats, longueurs), et **une panne du modèle ne bloque jamais la
  prospection** — le formulaire s'ouvre vide, saisie manuelle.
- **L'IA propose, elle n'exécute pas** : aucun envoi, aucun changement de
  statut, aucune création de fiche sans clic humain.

## Boîte Zoho (SMTP + IMAP)

Décision arrêtée : **SMTP + IMAP avec mot de passe d'application**, pas
d'OAuth. Les mails de prospection partent de la boîte Zoho personnelle de Bora
pour que les réponses reviennent dans son fil ; Zoho range lui-même les
messages SMTP dans « Envoyés » — la boîte reste la source de vérité. Aucun
cold mailing. Resend reste réservé à l'agent vocal.

Architecture (edge function `crm-mail`, service_role jamais côté Next) :

- **Credentials** : mot de passe d'application dans **Supabase Vault**,
  accessible uniquement par les RPC `mail_store_credentials` /
  `mail_get_credentials` / `mail_get_secret` (security definer, `execute`
  réservé à `service_role`).
- **Envoi** : `smtppro.zoho.com|eu:465` SSL via nodemailer — ligne `emails`
  `direction='sortant'` avec `message_id`, activité `type='email'`, relance
  J+3 si aucune ouverte.
- **Relève** : `imappro.zoho.com|eu:993` via imapflow + mailparser (jamais
  d'analyseur MIME maison). IMAP IDLE exigerait une connexion permanente,
  impossible sur Vercel → **pg_cron + pg_net toutes les 5 min** (job
  `crm-mail-sync`, secret partagé dans le Vault). Curseur UID par compte,
  premier passage sans import d'historique, idempotence par `message_id`.
- **Rattachement**, dans l'ordre : email exact du prospect → `in_reply_to`
  (fil de réponse CRM) → domaine du site web (liste `PUBLIC_DOMAINS` exclue).
  Sans correspondance → `prospect_id null`, vue `/emails` où l'admin associe
  en un clic. On ne devine pas.
- **Tri des réponses** : même contrat fournisseur qu'en partie B — à la relève
  si les secrets IA sont posés sur l'edge function, sinon bouton ✨ Analyser
  (fournisseur Vercel). Intention (intéressé, demande d'info, pas intéressé,
  rappel plus tard, absence, hors sujet), date convertie, confiance. Cartes
  « Réponses reçues » avec Accepter / Modifier / Ignorer. Une réponse acceptée
  remplace le rappel en cours ; **cas d'absence : le rappel est décalé au
  lendemain du retour, jamais annulé**. Les tâches « RDV … » ne sont jamais
  touchées.
- Le **centre de données** Zoho (`.eu` ou `.com`) se choisit dans
  `/reglages-email` (il se lit dans l'URL de la boîte) ; la connexion IMAP est
  testée immédiatement à l'enregistrement pour désopacifier les erreurs Zoho.

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

Chaque push sur `main` redéploie automatiquement le projet Vercel
`celya-accounting-app` (intégration GitHub). Aucune variable d'environnement à
configurer. Déploiement manuel possible avec `npx vercel --prod`.

Migrations SQL : appliquées via le MCP Supabase, copies dans
`supabase/migrations/`. Edge functions : déployées via le MCP Supabase —
`crm-admin` avec `verify_jwt: true`, `crm-mail` avec `verify_jwt: false`
(le cron pg_net n'a pas de JWT ; l'authentification est faite dans le corps).

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

**Frontière client/serveur.** Ne jamais importer une constante depuis un module
`"use client"` dans un composant serveur : Next.js remplace la valeur par une
référence client inutilisable (`TypeError: NAV_ITEMS is not iterable`, 500 sur
toutes les pages internes) et le build reste vert, car les routes dynamiques ne
s'exécutent pas à la compilation. Les constantes partagées vivent dans un module
neutre — voir `lib/nav.ts`.

**Connecteur MCP Vercel.** Il ne voit pas le projet `celya-accounting-app`
(l'équipe `bora` accessible au connecteur n'en contient pas la trace) : suivi de
déploiement impossible par le MCP. Vérifier la production directement en HTTP,
ou depuis vercel.com.

**Utilisateur créé en SQL dans `auth.users`.** GoTrue plante en
`Database error querying schema` si les colonnes texte de jetons
(`confirmation_token`, `recovery_token`, `email_change*`, `phone_change*`,
`reauthentication_token`) restent à `NULL` : les initialiser à `''`, et créer
la ligne `auth.identities` (provider `email`). Rencontré le 3 août avec le
compte de test E2E.

**Renommer une table ne suit pas le corps des fonctions.** Les politiques RLS
et leurs sous-requêtes sont des arbres d'expressions : elles suivent un
`alter table … rename`. Le corps des fonctions plpgsql/sql, lui, est du texte
brut : `bump_last_contact` et `sync_next_action` référençaient encore
`clients` après le rename et auraient cassé au premier insert — toujours les
recréer dans la même migration.

---

## Reste à faire

1. **Fusionner la branche `claude/celya-crm-phone-prospecting-wmgwry` dans
   `main`.** La base de données est déjà migrée (prospects, états, Zoho) : tant
   que `main` n'est pas mis à jour, la production interroge encore `clients`
   et ses pages de données sont cassées. Les tables étaient vides, l'impact
   est nul, mais la fusion est le premier geste à poser.
2. **Activer la boîte Zoho** (une fois la branche en production) :
   dans Zoho Mail, créer un mot de passe d'application (Sécurité → Mots de
   passe d'application) et vérifier qu'IMAP est activé (Paramètres → Comptes
   mail) ; puis `/reglages-email` → adresse, mot de passe, centre de données
   (`.eu` ou `.com` — il se lit dans l'URL de la boîte). La connexion est
   testée immédiatement. Vérification C5 : envoyer depuis une fiche vers une
   adresse à soi, répondre, contrôler que la réponse remonte sur la fiche en
   moins de 5 minutes ; tester un message sans correspondance (→ Non
   rattachés) et une réponse d'absence (→ rappel décalé, pas annulé).
3. **Classification automatique à la relève** (optionnel) : poser les secrets
   IA sur l'edge function — `supabase secrets set AGENT_PROVIDER=minimax
   MINIMAX_API_KEY=… MINIMAX_BASE_URL=… MINIMAX_MODEL=…` (ou depuis le
   tableau de bord). Sans eux, le bouton ✨ Analyser des cartes fait le même
   travail via le fournisseur configuré sur Vercel.
4. **Renommer le projet Vercel** `celya-accounting-app` → `celya-crm`
   (vercel.com → Settings → General → Project Name), pour que l'URL corresponde
   au contenu. Attention : ce projet portait l'app comptable et le renommage
   change l'URL de production — ne le faire qu'après avoir confirmé que l'app
   comptable n'a plus besoin de ce projet, puis mettre à jour l'URL dans ce
   fichier. Le connecteur MCP ne voit pas ce projet : à faire à la main.
5. **Passer le dépôt GitHub en privé** (Settings → General → Change visibility)
   — ce fichier expose les coordonnées de l'infra et l'email admin.
6. **Changer le mot de passe admin** depuis Mon compte : celui d'origine suit
   un motif devinable et la page de connexion est publique.
7. **Emails entrants `gocelya.com`** (phase ultérieure) : ce domaine est sur
   **Mailgun** (1 route entrante gratuite) — à brancher si un jour la
   prospection part aussi de cette adresse. La boîte `celya.be` passe par
   Zoho : IMAP exige Zoho Mail Lite (~1 €/mois) si l'offre gratuite ne le
   propose plus — à vérifier au moment de connecter.
8. Supprimer le bucket Storage `documents`, vide mais toujours présent.
9. Activer la protection contre les mots de passe compromis (tableau de bord
   Supabase → Authentication).
10. À terme : rendre les délais de rappel par défaut éditables dans des
    réglages (aujourd'hui : défauts dans `lib/constants.ts`, modifiables à la
    main à chaque enregistrement).

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
