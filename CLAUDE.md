# Celya CRM — mémoire projet

Fichier lu automatiquement par Claude Code. Traite tout ce qui suit comme du
contexte acquis : ne le redemande pas.

---

## Ce que c'est

CRM personnel de **Bora Dogrul** (Celya), construit le 1–2 août 2026 et
**simplifié le 3 août** : Bora démarche bien les entreprises par téléphone —
c'est son canal d'acquisition — mais **il n'appelle jamais depuis le CRM**, et
le CRM n'est pas un journal d'appels. Il répond à deux questions : *où en est
ce prospect* et *quand dois-je le relancer*. Du téléphone il reste exactement
deux choses : le numéro sur la fiche (lien `tel:` cliquable) et l'étape
« À appeler » (le panier d'entrée des entreprises à démarcher).
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
| Edge functions | `crm-admin` (`verify_jwt: true`) · `crm-mail` (`verify_jwt: false` — auth interne : JWT vérifié pour save/send, secret Vault pour la relève cron) |
| Compte admin | `dogrulbora@gmail.com` |
| Équipe Vercel | `bora` (`team_pPDHLPxzzBYl4oq0J1cnZiUX`) |
| URL de production | `https://celya-accounting-app.vercel.app` |
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
Supabase (Postgres + Auth + RLS) · `@anthropic-ai/sdk` (fournisseur IA
optionnel) · déployé sur Vercel.

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
| `prospects` | fiche prospect : société + contact principal fusionnés, `status` (l'étape), `value_estimate`, `owner_id`, `next_action_at`, `last_contact_at` |
| `activities` | l'historique des échanges : `note`, `email`, `rendez_vous` (`prospect_id`) |
| `tasks` | relances : `due_at`, `priority`, `status` (`prospect_id`) |
| `emails` | emails entrants/sortants (`prospect_id`, `message_id` unique = idempotence, `in_reply_to`) + tri des réponses (`triage`, `intent`, `intent_confidence`, `intent_summary`, `proposed_due_at`) |
| `email_accounts` | boîte SMTP/IMAP de Bora : hôtes Zoho, `credentials_secret_id` (→ Vault), `last_sync_at`, `sync_cursor`, `sync_error` — RLS fermée |

Triggers utiles : une activité met à jour `prospects.last_contact_at` ; une
tâche recalcule `prospects.next_action_at` (la plus proche échéance ouverte).
C'est `next_action_at` qui pilote « À faire ».

**La table s'appelle `crm_users`, pas `profiles`.** Le projet Supabase hébergeait
l'ancienne app de comptabilité, qui avait déjà un `profiles`. Ce schéma comptable
a été entièrement supprimé le 2 août à la demande de Bora, sauvegarde remise
au préalable.

### Les six étapes — et la règle qui remplace la mécanique

Statuts (`prospect_status`) : `a_appeler` → `contacte` → `rendez_vous` →
`proposition` → `gagne` / `perdu` (migration `007_simplification`, 3 août :
sans_reponse/contact_etabli/rappel_programme → contacte, rdv → rendez_vous ;
`activity_type` réduit à note/email/rendez_vous, appel/reunion/whatsapp/
linkedin migrés vers note ; colonnes `call_attempts`, `last_outcome`,
`last_call_slot` supprimées).

**« À appeler » est une colonne, pas une mécanique** : le panier d'entrée des
entreprises à démarcher. **La mise en sommeil ne passe plus par un statut** :
un prospect dont la prochaine action tombe dans trois mois n'apparaît pas dans
« À faire » avant sa date. C'est la date qui décide, jamais l'étape.

Le geste central est `saveExchangeAction` (`app/actions.ts`) : note au journal,
étape si elle change, et relance à une date précise — **jamais de doublon** :
la tâche ouverte existante est re-datée, les surnuméraires annulées ; un
prospect passé en Perdu n'a plus de relance ouverte. `normalizeStatus`
(`lib/constants.ts`) tolère en lecture les anciennes valeurs de statut —
garde-fou permanent, à ne pas retirer.

**Les dates sont de vrais champs** (`components/DateField.tsx`) : un
`<input type="date">` (avec l'heure pour un rendez-vous), et des raccourcis
« Demain / +3 jours / +1 semaine / +1 mois / +3 mois » qui **remplissent le
champ** au lieu de s'y substituer. Toujours modifiable à la main — c'était le
défaut le plus gênant de la V1 (préréglages seuls, impossible de saisir « le
14 octobre »).

### Choix de modélisation assumé

Une seule entité `prospects` fusionne société et contact principal, sans entité
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

## Écrans — trois, pas cinq

`/dashboard` (**À faire**) · `/prospects` (+ `/prospects/[id]`,
`/prospects/nouveau`, `/prospects/import`) · `/equipe` (admin) ·
et en périphérie : `/compte` (avec les liens admin vers `/reglages-email` et
`/emails`) · `/acces-refuse`. `/taches` redirige vers `/dashboard`,
`/pipeline` vers `/prospects?vue=colonnes`, `/clients` vers `/prospects`
(next.config.mjs).

- **À faire** — ce qui échoit aujourd'hui et ce qui est en retard, tous
  prospects confondus (les tâches ouvertes, En retard puis Aujourd'hui), plus
  les « Réponses reçues » de la boîte Zoho. Une relance au 14 octobre n'y
  remonte que le 14 octobre.
- **Prospects** — une seule liste, filtres (recherche, étape) et **bascule
  liste ↔ colonnes par étape** (glisser-déposer) : la vue en colonnes est un
  mode d'affichage de la même liste, plus une page distincte.
- **Équipe** — inchangé.

Sur la fiche : « Noter un échange » (note + type note/email/rendez_vous +
étape + prochaine action datée, bouton ✨ qui propose), historique, relances,
composeur email. Toute l'interface est en **français**, vouvoiement.

## Saisie assistée par IA

L'abstraction fournisseur vit dans `lib/ai/provider.ts` : `AGENT_PROVIDER`
choisit le fournisseur. Deux familles :

- **`anthropic`** : API Messages via le SDK officiel `@anthropic-ai/sdk` —
  `ANTHROPIC_API_KEY` (requis), `ANTHROPIC_MODEL` (défaut `claude-opus-5`),
  `ANTHROPIC_VISION_MODEL` et `ANTHROPIC_BASE_URL` optionnels. Pas de
  paramètre `temperature` (retiré des modèles récents). **Claude n'offre pas
  de résidence des données en Europe à ce jour** : acceptable pour extraire
  des coordonnées publiques, à réexaminer avant d'analyser le contenu privé
  des réponses de prospects.
- **Tout autre nom** : API chat completions au format OpenAI —
  `<FOURNISSEUR>_API_KEY` / `_BASE_URL` / `_MODEL` / `_VISION_MODEL`.
  Aujourd'hui `MINIMAX_*` (variables déjà sur Vercel) ; revenir en arrière =
  remettre `AGENT_PROVIDER=minimax`, jamais de réécriture.

### L'extraction — le cahier des charges (ne pas régresser)

C'est la fonction sur laquelle Bora s'appuie pour remplir sa liste
(`extractProspectAction`, `app/ai-actions.ts`) :

- **Ne jamais deviner** : un champ absent revient à `null` — la règle est dans
  le prompt ET dans la validation.
- **L'étape suit une règle, pas un jugement** : tout prospect extrait entre en
  `a_appeler`, sauf échange explicitement déjà eu → `contacte`. Écrit dans le
  prompt, revalidé en code (toute autre valeur → `a_appeler`).
- **Le modèle extrait, le code range** : normalisation des numéros au format
  belge `+32 …` (`normalizeBelgianPhone` — déterministe, un numéro implausible
  revient à null), validation des emails et sites, détection de doublons
  (téléphone / email / société normalisés) — tout en TypeScript.
- **Sortie structurée** : schéma strict avec `status`, `confidence` par champ
  et `raw_notes` ; hors format ou panne → `{ unavailable: true }` et le
  formulaire s'ouvre vide. Une panne du modèle ne bloque jamais la prospection.
- **Incertitude signalée** : champs sous 0,7 de confiance surlignés en orange
  dans le formulaire (cyan = déduit, orange = à vérifier).
- **Ancré dans le réel** : trois exemples few-shot dans le prompt (fiche
  Google Maps liégeoise, signature d'email bruxelloise, ligne d'annuaire
  gantoise). Ces exemples valent plus que les instructions — les conserver.

Mêmes principes pour `analyzeNoteAction` (note d'échange → étape, date réelle,
contact, résumé — proposés, jamais appliqués sans clic) et pour le tri des
réponses email. **L'IA propose, elle n'exécute pas.** Tout passe côté serveur
(aucune clé en `NEXT_PUBLIC_*`, le module jette s'il est importé côté client).

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
- **L'email tient le statut à jour, dès l'arrivée** : une vraie réponse d'un
  prospect met `last_contact_at` à jour, fait passer un `a_appeler` en
  `contacte` et annule la relance en attente — la carte remonte dans
  « À faire » avec l'action suivante proposée. Une **réponse automatique**
  (détection déterministe par en-têtes : `Auto-Submitted`, `X-Autoreply`,
  `Precedence`) **ne compte pas comme une réponse** : rien n'est touché à
  l'arrivée ; si la classification IA la reconnaît comme absence, le rappel
  est décalé au lendemain du retour, jamais annulé. Les tâches « RDV … » ne
  sont jamais touchées.
- **Tri des réponses** : même contrat fournisseur que la saisie assistée — à
  la relève si les secrets IA sont posés sur l'edge function, sinon bouton ✨
  Analyser (fournisseur Vercel). Intention (intéressé, demande d'info, pas
  intéressé, recontacter plus tard, absence, hors sujet), date convertie,
  confiance. Cartes « Réponses reçues » avec Accepter / Modifier / Ignorer.
- Le **centre de données** Zoho (`.eu` ou `.com`) se choisit dans
  `/reglages-email` (il se lit dans l'URL de la boîte) ; la connexion IMAP est
  testée immédiatement à l'enregistrement pour désopacifier les erreurs Zoho.

---

## Conventions

- Mutations = **server actions** dans `app/actions.ts`, jamais d'appel Supabase
  en écriture depuis un composant client.
- Pages de données = server components avec `export const dynamic = "force-dynamic"`.
- Composants client uniquement quand il faut de l'état local (`QuickNote`,
  `PipelineBoard`, `DateField`, `TaskRow`, `ImportWizard`, formulaires avec
  `useActionState`).
- Dates : tout est stocké en UTC, converti via `lib/time.ts` en heure de
  Bruxelles. Ne jamais faire `new Date(valeurDuFormulaire)` côté serveur —
  passer par `dateInputToISO` / `localInputToISO`.
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
D'où le remplissage systématique à `null` dans l'import CSV.

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

**Renommer une table ou une valeur d'enum ne suit pas le corps des fonctions.**
Les politiques RLS et leurs sous-requêtes sont des arbres d'expressions : elles
suivent un `alter … rename`. Le corps des fonctions plpgsql/sql, lui, est du
texte brut — toujours vérifier `bump_last_contact` / `sync_next_action` et
consorts dans la même migration.

**Ordre migration ↔ déploiement — la règle à ne jamais enfreindre.** Le 3 août,
la base a été migrée (`clients` → `prospects`) *avant* que le code correspondant
ne soit en ligne : la production a interrogé `public.clients` disparue et toutes
les pages de données ont renvoyé « Could not find the table 'public.clients' in
the schema cache ». **Toute migration doit rester compatible avec le code déjà
en production** — vue de compatibilité, colonne conservée le temps d'une
transition — **ou bien le code part en premier et la migration suit. Jamais
l'inverse.** Un renommage sec (table ou valeurs d'enum) exige que le code soit
déployé dans le même geste. Pour la migration 007, le code lisait les deux
jeux de statuts (`normalizeStatus`) avant la bascule ; ce garde-fou reste en
place.

**`email_accounts` : RLS activée sans aucune politique — c'est voulu, ne pas le
« corriger ».** L'audit de sécurité Supabase (et n'importe quel lint RLS) signale
« RLS enabled, no policy » sur cette table et proposera d'ajouter une politique.
**Ignorer.** Sans politique, la table est fermée à *tous* les rôles clients
(`anon`, `authenticated`) et n'est accessible qu'aux fonctions serveur en
`service_role` (l'edge function `crm-mail`) — exactement ce qu'on veut, puisque
c'est elle qui porte `credentials_secret_id`, la référence vers le mot de passe
de la boîte mail de Bora dans le Vault. Y ajouter la moindre politique
l'ouvrirait. Les autres avertissements de l'audit (`is_admin`, `is_member`,
`can_see_prospect`, `mail_account_status` exécutables par `authenticated`) sont
le fonctionnement normal des fonctions d'appui de la RLS ; `mail_account_status`
a été relue le 3 août — elle ne renvoie aucun secret, seulement un booléen
« des identifiants existent », et n'est ouverte qu'aux admins. Rien à changer.

---

## Reste à faire

1. **Activer la boîte Zoho** (le code est en production) :
   dans Zoho Mail, créer un mot de passe d'application (Sécurité → Mots de
   passe d'application) et vérifier qu'IMAP est activé (Paramètres → Comptes
   mail) ; puis Mon compte → Réglages de la boîte → adresse, mot de passe,
   centre de données (`.eu` ou `.com` — il se lit dans l'URL de la boîte). La
   connexion est testée immédiatement. Vérification : envoyer depuis une fiche
   vers une adresse à soi, répondre, contrôler que la réponse remonte sur la
   fiche en moins de 5 minutes ; tester un message sans correspondance (→ Non
   rattachés) et une réponse d'absence (→ relance décalée, pas annulée).
2. **Classification automatique à la relève** (optionnel) : poser les secrets
   IA sur l'edge function — `AGENT_PROVIDER=anthropic ANTHROPIC_API_KEY=…`
   (ou `AGENT_PROVIDER=minimax MINIMAX_*=…`), via `supabase secrets set` ou le
   tableau de bord. Sans eux, le bouton ✨ Analyser des cartes fait le même
   travail via le fournisseur configuré sur Vercel.
3. **Activer Claude sur Vercel** (optionnel) : `AGENT_PROVIDER=anthropic` +
   `ANTHROPIC_API_KEY` dans les variables du projet Vercel. Repasser sur
   MiniMax = remettre `AGENT_PROVIDER=minimax`. Rappel : pas de résidence des
   données en Europe chez Anthropic à ce jour — OK pour des coordonnées
   publiques, à réexaminer avant d'analyser le contenu privé des réponses.
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
