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
optionnel) · `mcp-handler` + `@modelcontextprotocol/sdk` + `zod` (connecteur MCP,
voir plus bas) · déployé sur Vercel.

Pas de librairie de composants : les styles vivent dans `app/globals.css`
(`.card`, `.btn-primary`, `.input`, `.chip`…). Thème sombre Celya —
fond `#0A0E1A`, dégradé `#22D3EE → #4F7BFF → #A855F7`.

---

## Modèle de sécurité — l'invariant à ne jamais casser

Tout repose sur la **RLS Postgres**, pas sur le code applicatif. Même si une
page oublie un filtre, la base refuse. C'est le choix structurant du projet ;
ne le contourne jamais en passant par le service_role côté serveur Next.

**Unique exception sanctionnée : le connecteur MCP** (voir « Connecteur MCP »
plus bas). Il agit en `service_role` — c'est structurellement nécessaire — mais
l'exception est encapsulée : le jeton OAuth n'est délivré qu'au compte **admin**
(un commercial verrait sinon tous les prospects, RLS contournée), et le serveur
MCP n'ouvre que les tables CRM. Aucune autre partie du code Next ne doit toucher
au `service_role`.

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
| `prospects` | fiche prospect : société + contact principal fusionnés, `status` (l'étape), `status_locked` / `status_locked_at` (le verrou), `status_auto_reason` / `status_auto_at` (pourquoi l'étape a bougé seule), `proposal_sent_at`, `value_estimate`, `probability` + `weighted_value` (**conservées en base mais plus affichées ni saisies**, voir Confiance), `confidence_level` / `confidence_reason` / `confidence_locked` / `confidence_at` (la confiance IA, migration `011`), `owner_id`, `next_action_at`, `last_contact_at` |
| `activities` | l'historique des échanges : `note`, `email`, `rendez_vous` (`prospect_id`) + `is_draft` (brouillon, hors chronologie), `is_exchange` (la note atteste-t-elle d'un échange réel) et `outcome` (colonne de 001, réactivée le 7 août : `'sans_reponse'` = « Appelé, pas de réponse » — un résultat, pas un échange) |
| `tasks` | relances : `due_at`, `priority`, `status` (`prospect_id`) |
| `emails` | emails entrants/sortants (`prospect_id`, `message_id` unique = idempotence, `in_reply_to`) + tri des réponses (`triage`, `intent`, `intent_confidence`, `intent_summary`, `proposed_due_at`) |
| `email_accounts` | boîte SMTP/IMAP de Bora : hôtes Zoho, `credentials_secret_id` (→ Vault), `last_sync_at`, `sync_cursor`, `sync_error` — RLS fermée |
| `mcp_oauth_clients` / `mcp_oauth_codes` / `mcp_oauth_tokens` | état du serveur OAuth du connecteur MCP (migration `008`) — **RLS fermée sans policy** comme `email_accounts`, seul le `service_role` y accède. Ne pas « corriger » l'absence de policy. |

Triggers utiles : une activité met à jour `prospects.last_contact_at` ; une
tâche recalcule `prospects.next_action_at` (la plus proche échéance ouverte).
C'est `next_action_at` qui pilote « À faire ».

**Vue `prospect_action_state`** (migration `012`, 7 août) : par prospect, le
dernier événement réel du journal (`last_kind` : email_sortant / email_entrant /
appel_sans_reponse / echange / rendez_vous / note_interne, brouillons exclus),
`last_at`, `last_email_sent_at`, `last_reply_at`. `security_invoker = on` — la
RLS des tables de base s'applique au lecteur, un commercial n'y voit que ses
fiches. C'est elle qui alimente la ligne « dernière action » des cartes, la
zone « En attente de réponse » (`last_kind = 'email_sortant'`) et le filtre
« Emails envoyés ». Le module `lib/crm/lastAction.ts` (neutre) porte les
libellés et pictogrammes.

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

### L'étape suit les FAITS, jamais le texte (migration `009`, 4 août)

L'étape était déduite en lisant des mots dans les notes — c'est ainsi qu'un
prospect s'est retrouvé en « Rendez-vous » sans qu'aucun rendez-vous ne soit
posé. **La règle vit désormais dans `lib/crm/status.ts`, écrite une seule fois**
et partagée par les server actions, le connecteur MCP et l'affichage de la
fiche :

| Étape | Le fait qui la justifie — et rien d'autre |
|---|---|
| `a_appeler` | défaut : aucun échange enregistré |
| `contacte` | un email envoyé/reçu, un rendez-vous, ou une note **attestée** |
| `rendez_vous` | une activité `rendez_vous` datée, **ou** une relance « RDV avec … » ouverte. Jamais un « RDV » lu en texte libre |
| `proposition` | le geste explicite « j'ai envoyé une proposition » (`proposal_sent_at`). En cas de doute, rien ne bouge |
| `gagne` / `perdu` | **jamais automatiques** — décisions humaines irréversibles |

Trois invariants, à ne pas casser : l'auto-classification **n'avance que sur un
fait non ambigu**, **ne recule jamais** une étape toute seule, et **ne passe
jamais par-dessus un choix humain**. Chaque avancement automatique inscrit son
événement déclencheur (`status_auto_reason`), affiché sur la fiche.

**Le verrou — le point critique.** Dès que Bora fixe une étape à la main
(glisser-déposer dans le pipeline, clic sur une étape de la fiche, formulaire,
ou `mettre_a_jour_statut` du connecteur), `status_locked` passe à vrai et
l'auto-classification ne réécrit plus rien : au mieux elle affiche une
suggestion discrète (« un RDV a été posé — passer en Rendez-vous ? »), que Bora
accepte ou ignore. Sans ce verrou, le système se bat contre l'utilisateur : il
corrige, l'IA remet l'erreur au tour suivant. « Rendre la main à l'assistant »
déverrouille, en petit, sous l'étape.

**Une note atteste-t-elle d'un échange ?** Un email et un rendez-vous daté sont
des faits lisibles sans interprétation ; une note peut être un compte rendu
d'appel autant qu'un simple repérage. D'où `activities.is_exchange`, et la
répartition des défauts — **à conserver** :

- **interface** (« Noter un échange ») : trois natures de note depuis le
  7 août — « J'ai réellement eu cet échange » (défaut, `is_exchange: true`),
  « **Appelé, pas de réponse** » (`is_exchange: false` + `outcome:
  'sans_reponse'`, tracé au journal **même sans texte** — c'est le résultat
  que la carte affiche) et « Note de repérage » (`is_exchange: false`) ;
- **connecteur MCP** (`ajouter_note`) : **`echange: false`** par défaut, à
  déclarer explicitement. C'est ainsi qu'une note de repérage écrite par Claude
  ne fait plus passer une fiche en « Contacté ». (Le cœur partagé accepte
  `noAnswer` ; l'outil MCP ne l'expose pas encore.)

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

### Confiance IA — Chaud / Tiède / Froid (migration `011`, 4 août au soir)

**La probabilité chiffrée à la main est retirée de l'interface** (décision de
Bora, 4 août au soir) : plus de champ %, plus de montants ni de valeur pondérée
sur les cartes du pipeline et dans la liste. Les colonnes `probability` et
`weighted_value` **restent en base, intouchées** (rien de destructif — le
connecteur MCP les expose toujours). La « Valeur estimée » reste saisie et
affichée sur la fiche uniquement.

À la place : une **confiance à trois niveaux**, estimée par l'IA
(`lib/crm/confidence.ts`, même contrat fournisseur que le reste) à partir des
signaux réels — contenu des échanges (notes, emails envoyés, réponses reçues),
étape du pipeline, silence, RDV posé, proposition. Stockée dans
`confidence_level` (`chaud`/`tiede`/`froid`, `null` = « à évaluer ») avec sa
**raison courte** (`confidence_reason` : « réponse positive reçue », « sans
réponse depuis 12 jours »), affichée sur la carte du pipeline, dans la liste
et en tête de fiche (`ConfidenceBadge`, `ConfidenceControl`).

Les règles, calquées sur la règle des faits :

- **Suggestion, pas vérité** : Bora corrige d'un clic (trois chips en tête de
  fiche) — la correction **verrouille** (`confidence_locked`, même logique que
  `status_locked`), l'IA ne réécrit plus rien ; « Rendre la main à
  l'assistant » déverrouille et ré-estime.
- **Recalcul sur ÉVÉNEMENT, jamais à l'affichage** : échange consigné
  (`saveExchangeCore`, donc UI + MCP), changement d'étape (fiche, drag,
  formulaire, suggestion acceptée, outil MCP `mettre_a_jour_statut`), email
  envoyé, réponse traitée (Accepter du tri), relance créée. Bouton
  « ✨ Réévaluer » sur la fiche pour forcer. À la **relève IMAP**, l'edge
  function `crm-mail` ne fait que remettre la fiche « à évaluer » sur une
  vraie réponse (sauf verrou) — le recalcul IA se fait côté app.
- **Jamais un faux niveau** : IA indisponible → rien n'est écrit (le niveau
  précédent reste) et rien ne se bloque ; pas assez d'éléments (aucun échange)
  → `null`, badge « À évaluer ». Sans clé IA le recalcul est un no-op
  immédiat.
- Un **brouillon** ne déclenche ni ne pèse rien.

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

- **À faire** — **trois zones, jamais mélangées** (refonte du 7 août) :
  1. « **À appeler / à rappeler** » — les tâches échues (En retard puis
     Aujourd'hui) : appel jamais passé, appel sans réponse, relance échue.
     Une relance au 14 octobre n'y remonte que le 14 octobre.
  2. « **En attente de réponse** » — les fiches dont le dernier événement est
     un mail sortant (`prospect_action_state`). Zone **calme** : jamais « en
     retard », chaque ligne dit « Mail envoyé il y a X · Remonte le <date> ».
     Dès que la relance « si pas de réponse » échoit, la fiche passe en
     zone 1 — jamais dans les deux à la fois.
  3. « **Réponses reçues** » — la boîte Zoho, agir maintenant. Une fiche qui
     a répondu ne traîne pas en zone 1 (ses relances hors « RDV » en sont
     exclues le temps du tri).
- **Prospects** — une seule liste, filtres (recherche, étape) et **bascule
  liste ↔ colonnes par étape** (glisser-déposer) : la vue en colonnes est un
  mode d'affichage de la même liste, plus une page distincte. Chaque carte
  (liste ET pipeline) porte la **dernière action** — canal + résultat + date
  relative : « 📧 Mail envoyé · il y a 2 j », « 📞 Appelé, pas de réponse ·
  il y a 3 j » (`LastActionLine`, `lib/crm/lastAction.ts`). La colonne
  « Dernier contact » de la liste a cédé sa place à « Dernière action ».
  Bouton-filtre « **📧 Emails envoyés** » (`?filtre=emails`) : seulement les
  fiches à qui un mail est parti, triées par date du dernier envoi, colonne
  « Dernier mail » ajoutée.
- **Équipe** — inchangé.

**La fiche se lit d'abord — elle ne s'ouvre pas sur des formulaires** (refonte
du 4 août). De haut en bas :

1. **qui c'est**, et l'étape (les six pastilles cliquables, l'état du verrou,
   la suggestion éventuelle) ;
2. **PROCHAINE ACTION**, bien visible : l'action concrète en attente et sa date
   (« RDV avec … · Rendez-vous le 20 août, 14:00 (dans 16 jours) · En attente
   de réponse de Sébastien — email envoyé le 4 août »), avec ses gestes
   rapides — consigner un échange, marquer fait, reporter (+1j / +3j / +1sem,
   et champ de date pour « le 14 octobre ». Le bloc vire au rouge s'il est en
   retard, au bleu pour un rendez-vous. **Dérivé de façon déterministe** de la
   relance ouverte et du dernier événement du journal (`lib/crm/nextAction.ts`)
   — aucune clé IA nécessaire ;
3. **CHRONOLOGIE** : fil vertical, du plus récent au plus ancien, chaque
   événement typé et daté (échange noté, note interne, email envoyé, réponse
   reçue, rendez-vous) — pastille de couleur et puce de type, la nature de
   l'échange se lit avant le texte ;
4. **puis seulement** les formulaires : « Noter un échange » (note + type +
   la nature de la note + la case proposition + étape + prochaine action
   datée, bouton ✨ qui propose), composeur email, planifier une relance,
   modifier la fiche.

En colonne latérale : les chiffres de l'affaire (valeur estimée seule — la
probabilité n'est plus affichée), les relances, et l'espace **Brouillons**.
En tête de fiche, sous le contact : la **confiance** (badge + raison +
correction manuelle, voir la section Confiance IA). Toute l'interface est en
**français**, vouvoiement.

### Les brouillons ne sont pas des échanges

Un texte jamais envoyé (`activities.is_draft`) **ne figure pas dans la
chronologie**, ne compte pour aucun fait d'étape et ne touche pas à
`last_contact_at` (le trigger `bump_last_contact` l'ignore). Il vit dans
l'espace « Brouillons » de la colonne latérale, et se supprime d'un clic.

**Corbeille sur chaque entrée du journal** — admin uniquement, revérifié côté
serveur, via server action (aucun SQL côté client). Confirmation en deux temps,
inline : la question dit ce qui disparaît, et le ton s'endurcit pour un email
réellement envoyé ou reçu, qui est une trace et non un brouillon.

## Direction visuelle (4 août)

Outil ouvert toute la journée : lisible d'un coup d'œil, sans saturation.

- **Une couleur franche par étape**, la même partout où l'étape apparaît
  (badge, bandeau de colonne du pipeline, pastille du compteur, liseré gauche
  des cartes, halo de la colonne cible pendant le drag) : ardoise → cyan →
  bleu → **ambre** (Proposition, « ça chauffe ») → émeraude / rose. Les
  Records de classes complètes vivent dans `lib/constants.ts` (`STATUS_CHIP`,
  `STATUS_DOT`, `STATUS_ICON`, `STATUS_EDGE`) et dans `PipelineBoard`
  (bandeaux, compteurs, cibles de drag) — jamais d'interpolation (règle JIT).
- **La couleur ne porte jamais seule** : libellé + pictogramme (`STATUS_ICON`)
  l'accompagnent (daltonisme).
- **Confiance = badge « chaleur »** (`ConfidenceBadge` dans `ui.tsx`,
  `CONFIDENCE_*` dans `constants.ts`) : Chaud orange, Tiède ambre, Froid
  bleu-ardoise, « À évaluer » neutre — toujours avec libellé + pictogramme
  (♨ / ◐ / ❄ / …). Sur les cartes du pipeline, la liste et la tête de fiche,
  avec la raison courte.
- **Contraste hiérarchisé** : titres quasi blancs (`slate-50`), texte
  secondaire jamais plus délavé que `slate-400` (#94A3B8) quand il doit se
  lire. Le dégradé Celya reste réservé aux **actions principales** ; ce sont
  les couleurs d'étape qui différencient.
- **Motion sobre** (150–250 ms, `globals.css`) : `card-lift` (survol qui
  soulève), `animate-rise` (apparition des listes et colonnes), `animate-pop`
  (étape qui vient d'être choisie), colonne cible illuminée dans sa propre
  teinte. `prefers-reduced-motion` neutralise tout.

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

Mêmes principes pour `analyzeNoteAction` (note d'échange → date réelle,
contact, résumé) et pour le tri des réponses email. **L'IA propose, elle
n'exécute pas.** Tout passe côté serveur (aucune clé en `NEXT_PUBLIC_*`, le
module jette s'il est importé côté client).

**L'étape, elle, n'est plus jamais poussée par le modèle** (correctif du
4 août) : `analyzeNoteAction` l'affiche comme suggestion à retenir d'un clic,
et le code arbitre avant même l'affichage — une note qui parle d'un « RDV »
sans date réelle est ramenée à `contacte`, `gagne`/`perdu` sont signalés comme
réservés à l'humain, `proposition` renvoie vers la case explicite. Le champ
`statutReserve` porte cette réserve, en clair, dans le formulaire.

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
  `direction='sortant'` avec `message_id`, activité `type='email'`. **Un mail
  envoyé CLÔT l'action en cours** (correctif du 7 août,
  `lib/crm/emailCadence.ts`, appelé par `sendProspectEmailAction`) : la
  relance ouverte la plus proche (hors « RDV … ») passe « fait », les
  surnuméraires sont annulées, et une relance « Relancer … si pas de
  réponse » part à **+5 jours** (sauf fiche Gagné/Perdu). La fiche va dans
  « En attente de réponse » — plus jamais « en retard » juste après un envoi
  (c'était le bug : la relance n'était créée que « si aucune n'existait »,
  l'ancienne restait ouverte).
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

## Connecteur MCP « Celya CRM »

Le CRM s'expose à Claude comme **connecteur personnalisé** (« Custom connector »)
sous le nom **Celya CRM**, description « Prospection Celya — prospects, statuts,
relances ». C'est le socle du « système d'action » de Bora : Claude peut ajouter
un prospect, changer un statut, poser une relance, lister ce qu'il y a à faire —
**et rien d'autre**. Pas de SQL brut, pas d'accès à la comptabilité, pas au reste
du projet Supabase.

**Hébergé dans l'app Next.js**, pas de service séparé. Route MCP servie par
`mcp-handler` (v1) à **`/[transport]/route.ts`** → endpoint **`/mcp`** (SSE
désactivé, streamable HTTP sans état, sans Redis). L'URL du connecteur à coller
dans Claude est donc `https://<domaine-de-prod>/mcp`.

**Les neuf outils** (noms français, descriptions lues par Claude pour décider) :
`lister_prospects`, `obtenir_prospect`, `a_faire`, `creer_prospect`,
`mettre_a_jour_statut`, `ajouter_note`, `planifier_relance`,
`supprimer_activite`, `importer_prospects`.
Toute opération destructrice ou en lot (`importer_prospects`,
`supprimer_activite`) est d'abord une **simulation** ; l'écriture réelle exige
`confirmer: true`. `creer_prospect` **avertit** en cas de doublon au lieu de
créer (forçable par `forcer: true`).

Trois précautions dictées par la règle des faits (4 août) :

- `mettre_a_jour_statut` **verrouille** la fiche — sa description le dit, pour
  que Claude ne l'emploie que sur demande explicite et préfère `ajouter_note`
  pour un simple compte rendu ;
- `ajouter_note` déclare ses faits : `echange` (**défaut false**), `brouillon`,
  `proposition_envoyee` — et `planifier_relance` passe `isExchange: false`
  (planifier n'est pas échanger) ;
- `supprimer_activite` efface une entrée précise, ou **tous les brouillons**
  d'un prospect d'un coup (`brouillons: true`) — c'est l'outil de nettoyage du
  journal depuis Claude. De fait réservé à l'admin, puisque le jeton OAuth
  n'est délivré qu'à lui.

**Réutilise la logique existante, ne la duplique pas.** Chaque outil est une
enveloppe fine au-dessus du **cœur partagé `lib/crm/`** (extrait le 4 août sans
changement de comportement) : `dedup.ts` (normalisation `+32`, clés de dédup,
`findDuplicates`), `prospects.ts` (`createProspectCore`, `importProspectsCore`),
`exchange.ts` (`saveExchangeCore`), `status.ts` (la règle des faits, le verrou :
`readProspectFacts`, `evaluateStatus`, `applyAutoStatus`, `manualStatusPatch`),
`nextAction.ts` (`deriveNextAction`). Les server actions (`app/actions.ts`,
`app/ai-actions.ts`) et le connecteur appellent **le même code** : un prospect
créé par Claude est indiscernable d'un prospect créé à la main (même dédup, même
`+32`, même cadence de relance, mêmes règles d'étape).

Seule exception assumée : l'edge function `crm-mail` (Deno) ne peut pas importer
le code Next. Elle ré-applique donc la règle à la main sur un seul point — une
réponse reçue fait passer `a_appeler` → `contacte` **sauf si `status_locked`**.
Toute évolution de la règle doit être répercutée là aussi.

**Périmètre strictement CRM.** Le serveur MCP ne touche QUE `prospects`,
`activities`, `tasks` (et `emails` en lecture le jour où un outil l'expose) —
jamais les tables comptables du même projet, jamais d'exécution SQL libre. C'est
sa raison d'être face au connecteur Supabase brut. (Vérifié : les seuls
`.from(...)` du serveur MCP sont ces tables ; aucun `rpc`/`execute_sql`.)

**Authentification OAuth 2.1** (l'UI des connecteurs Claude l'exige ; un simple
Bearer n'y est pas configurable proprement). Serveur d'autorisation minimal mais
conforme, dans l'app :
- Découverte : `/.well-known/oauth-protected-resource` (RFC 9728) →
  `/.well-known/oauth-authorization-server` (RFC 8414).
- Enregistrement dynamique de client (DCR, RFC 7591) : `POST /api/oauth/register`.
- Autorisation avec **PKCE S256** : `/api/oauth/authorize` — page de connexion
  aux couleurs Celya, identité vérifiée par **Supabase Auth** (email + mot de
  passe habituels de Bora).
- Jeton : `/api/oauth/token` (code + PKCE, `refresh_token`). Jetons d'accès =
  **JWT HS256 sans état** (`lib/mcp/jwt.ts`), signés avec une clé dérivée de
  `MCP_OAUTH_SECRET` ou, à défaut, de `SUPABASE_SERVICE_ROLE_KEY`. Vérification
  via `withMcpAuth`.
- **Garde-fou capital** : le jeton n'est délivré qu'à un compte **actif ET
  admin**. Le connecteur agissant en `service_role` (RLS contournée), l'ouvrir à
  un commercial lui donnerait tous les prospects. Mono-utilisateur (Bora) par
  conception.

**`service_role` côté serveur uniquement.** Le serveur MCP l'utilise pour agir
(via `lib/supabase/admin.ts`, qui jette si la clé manque) et **impose** que tout
est rattaché à Bora : `created_by` / `author_id` = sujet du jeton. La clé n'est
JAMAIS dans le dépôt ni en `NEXT_PUBLIC_*` — variable d'environnement Vercel
`SUPABASE_SERVICE_ROLE_KEY` (**à poser, voir Reste à faire** : sans elle, les
outils répondent proprement « service_role manquante » et n'écrivent rien).

Le middleware exempte `/mcp`, `/sse`, `/message`, `/api/oauth`, `/.well-known`
de la redirection cookie (ces routes s'authentifient par jeton, pas par cookie).

**Ajouter le connecteur dans Claude** : Personnaliser → Connecteurs → « + » →
Ajouter un connecteur personnalisé → coller `https://<domaine-de-prod>/mcp` →
suivre l'OAuth (se connecter avec le compte admin).

---

## Vitesse et fluidité (7 août)

Le CRM était lent, et surtout *mou* : chaque geste attendait le serveur avant
que l'écran ne bouge. Mesuré, corrigé, re-mesuré — en local contre la base de
production.

Médianes sur 5 mesures, `npm start` local contre la base de production (le
réseau du poste de mesure ajoute ~140 ms par aller-retour Supabase — c'est
justement ce qui rend le nombre d'allers-retours lisible).

| | avant | après |
|---|---|---|
| Rendu serveur — À faire | 725 ms | **175 ms** |
| Rendu serveur — Prospects (liste / colonnes) | 433 / 440 ms | **164 / 164 ms** |
| Rendu serveur — Fiche prospect | 727 ms | **165 ms** |
| Rendu serveur — Équipe | 548 ms | **160 ms** |
| Cocher une relance : avant que l'écran bouge | 1348 ms | **69 ms** |
| Cocher une relance : réponse serveur | 474 ms | **241 ms** |
| Glisser une carte : avant que l'écran bouge | 6 ms | **5 ms** (déjà optimiste) |
| Glisser une carte : réponse serveur | 503 ms | **247 ms** |
| Rendus serveur déclenchés par le seul affichage de la liste | **17** | **5** |

S'y ajoute, non mesurable ici, le gain de la région : chaque aller-retour
restant passe de ~100–200 ms (traversée de l'Atlantique) à quelques
millisecondes une fois les fonctions dans `dub1`.

Cinq causes, cinq corrections. **Ne pas les défaire.**

**1. Deux appels réseau d'authentification par page.** `auth.getUser()`
interroge Supabase Auth à chaque appel — une fois dans le middleware, une fois
dans `getSession()`, une fois par server action. Or ce projet signe ses jetons
en **ES256** (clés asymétriques) : `auth.getClaims()` vérifie la signature
**en local** contre le JWKS, que `auth-js` met en cache pour tout le processus
(`GLOBAL_JWKS`). Partout où l'identité est lue, c'est donc `getClaims()`.
Le modèle de sécurité est intact : la signature est vérifiée
cryptographiquement, **l'autorisation vient toujours de `crm_users` relu en
base à chaque rendu** (un compte désactivé est coupé à la seconde — vérifié),
et la RLS reste l'unique garde-fou des données. Un jeton révoqué reste valide
jusqu'à son expiration pour la *redirection* seulement : il ne donne accès à
aucune donnée, `is_member()` s'appuyant sur `crm_users`.

**2. Le préchargement des liens de fiche.** Next précharge tout `<Link>` visible :
la liste des prospects déclenchait **un rendu serveur complet de chaque fiche**
— 17 rendus, ~150 requêtes SQL, pour une seule fiche que Bora finira par
ouvrir. Les liens répétés (cartes du pipeline, lignes de la liste, `TaskRow`,
`ReplyCard`) portent donc `prefetch={false}`. Les liens du **menu** gardent le
préchargement : ils sont trois, et désormais bon marché (voir 3).

**3. Squelettes de chargement.** `loading.tsx` sur `/dashboard`, `/prospects`,
`/prospects/[id]`, `/equipe` (silhouettes dans `components/Skeleton.tsx`).
Deux effets : au clic l'écran cible s'affiche tout de suite en silhouette au
lieu de rester figé sur la page précédente, et le préchargement des liens du
menu ne coûte plus que cette coquille. **Conséquence à connaître** : les pages
sont maintenant *diffusées* (streaming) — le squelette arrive avant le
contenu. Un test qui lit le DOM sur l'événement `load` verra le squelette ;
attendre le contenu réel.

**4. Requêtes en série.** La fiche prospect rechargeait activités, emails,
relances et fiche une deuxième fois pour évaluer l'étape : `readProspectFacts`
a été scindé en `factsFromRows` (fonction pure, la règle) et un lecteur, et la
page déduit les faits des lignes **déjà chargées** — quatre allers-retours en
moins. Le tableau « À faire » lançait sa cinquième requête après les quatre
autres : les cinq partent ensemble et le croisement se fait en mémoire. Les
`select("*")` des emails et activités sont réduits aux colonnes affichées.

**5. L'IA sur le chemin critique.** `recalcConfidence` appelait le modèle
**avant** de répondre : glisser une carte ou cocher une relance attendait une
estimation que Bora ne regardait pas à cet instant. Elle part maintenant dans
`after()` (réponse d'abord, estimation ensuite) — les mêmes événements la
déclenchent, seul le moment où le badge se met à jour se décale au chargement
suivant. **Restent synchrones** les deux gestes où Bora attend le résultat :
« ✨ Réévaluer » et « Rendre la main à l'assistant ».

### L'UI optimiste — le motif à reprendre

`useOptimistic` partout, jamais `useState` + `useEffect` de resynchronisation
(qui laissait une fenêtre où des props arrivées entre-temps écrasaient un
geste en cours). Le motif : peindre dans la transition, appeler l'action,
afficher l'erreur s'il y en a une — **le retour en arrière est automatique**,
React rend la main aux données du serveur à la fin de la transition.

```tsx
const [vue, appliquer] = useOptimistic(donneesServeur, reducteur);
startTransition(async () => {
  appliquer(patch);                       // l'écran bouge
  const res = await monAction(fd);        // le serveur suit
  if (res?.error) setErreur(res.error);   // et s'il refuse, vue revient seule
});
```

Couvert ainsi : glisser une carte (`PipelineBoard`), changer d'étape
(`StatusControl`), corriger la confiance (`ConfidenceControl`), consigner un
échange et envoyer un mail (`ProspectJournal` → l'entrée s'inscrit dans la
chronologie, en retrait, marquée « Enregistrement… »), cocher / reporter /
supprimer une relance (`TaskList`), planifier une relance sur une fiche
(`RelancesSection`). Les server actions concernées **renvoient leur issue**
(`ActionState`) au lieu de la garder pour elles — sans quoi il n'y a rien à
annuler.

Deux endroits volontairement NON optimistes, et c'est un choix :
- « ✨ Réévaluer » la confiance — le niveau à afficher est justement ce qu'on
  ignore avant la réponse ;
- « Nouvelle relance » du tableau À faire (`NouvelleRelanceLibre`) — cet écran
  ne montre que ce qui échoit aujourd'hui ; une relance posée au 14 octobre
  n'y a pas sa place, l'y faire apparaître une seconde serait un mensonge.
  Retour immédiat quand même : bouton en attente, champ vidé, confirmation.

### Cache du routeur et région

`next.config.mjs` — `experimental.staleTimes.dynamic = 30` : revenir sur un
écran déjà visité est instantané. Sans risque de fraîcheur, parce que toutes
les mutations passent par des server actions qui appellent `revalidatePath`,
ce qui invalide aussi ce cache. Ne subsiste que la fenêtre où la donnée a
changé **ailleurs** (relève IMAP toutes les 5 min, autre commercial) : 30 s,
compromis assumé.

`vercel.json` — `"regions": ["dub1"]`. Dublin **est** `eu-west-1`, la région du
projet Supabase : les fonctions et la base sont dans le même datacentre au
lieu de se parler d'un continent à l'autre (100–200 ms par aller-retour, et il
y en a plusieurs par écran).

**Vérifié en production le 7 août** : l'en-tête `x-vercel-id` d'une fonction
renvoie `iad1::dub1::…` — le premier segment est le point d'entrée du réseau
(l'edge le plus proche de l'appelant), le second la région d'exécution. C'est
`dub1` qui compte, et c'est bien celui-là. Pour re-contrôler un jour :

```
curl -sD - -o /dev/null https://<domaine>/.well-known/oauth-protected-resource | grep x-vercel-id
```

Attention au piège de lecture : sur une redirection du middleware l'en-tête ne
montre qu'un seul segment (`iad1::…`), parce que le middleware s'exécute sur
l'edge et non dans la région des fonctions. Interroger une vraie fonction.

---

## Conventions

- Mutations = **server actions** dans `app/actions.ts`, jamais d'appel Supabase
  en écriture depuis un composant client.
- Pages de données = server components. **Plus de `force-dynamic`** : ces pages
  lisent les cookies (client Supabase), elles sont donc dynamiques de toute
  façon — la directive n'ajoutait rien et empêchait Next d'emprunter son
  chemin normal. Elle ne reste que sur les routes OAuth. Voir « Vitesse et
  fluidité ».
- Composants client uniquement quand il faut de l'état local (`QuickNote`,
  `PipelineBoard`, `DateField`, `TaskList`, `ImportWizard`, formulaires avec
  `useActionState`).
- **Toute action visible doit être optimiste** : l'écran bouge au clic, le
  serveur suit. Voir « Vitesse et fluidité » pour le motif exact.
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

`vercel.json` fixe la région des fonctions à **`dub1`** (Dublin = `eu-west-1`,
celle de Supabase). À contrôler une fois dans l'interface Vercel — voir
« Vitesse et fluidité ».

Migrations SQL : appliquées via le MCP Supabase, copies dans
`supabase/migrations/` — dernières en date, `009_statut_faits.sql` (verrou,
traçabilité, `is_exchange` / `is_draft`), `010_probabilite.sql` (probabilité +
colonne générée, interface retirée depuis), `011_confiance.sql` (les quatre
colonnes de confiance) et `012_derniere_action.sql` (vue
`prospect_action_state`, index `emails(prospect_id, received_at)`, et la
correction unique des relances laissées « en retard » par l'ancienne cadence
d'envoi — re-datées à envoi + 5 j). Toutes **additives**, donc applicables
avant le déploiement du code sans rien casser en production — `011` a été
appliquée ainsi le 4 août au soir, `012` le 7 août (vérifiée en local sur la
base de prod avant fusion : envoi réel → relance faite + relance +5 j, zones
du tableau de bord, cartes ; prospects réels intacts).

L'edge function `crm-mail` est en ligne en **v3** (4 août au soir) : correctif
`status_locked` + remise « à évaluer » de la confiance sur vraie réponse —
identique au dépôt.

Edge functions : déployées via le MCP Supabase —
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
compte de test E2E. Nuance du 4 août : un `insert into auth.users` en SQL
direct (MCP `execute_sql`) déclenche bien le trigger qui crée la ligne
`crm_users` — la mettre à jour ensuite (`update`), pas l'insérer (doublon
sinon). Le compte de test se supprime après usage : `crm_users`,
`auth.refresh_tokens`, `auth.sessions`, `auth.identities`, puis `auth.users`.

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

**Deviner un statut en lisant du texte : la régression à ne jamais refaire.**
Le 4 août, Garage Boetendael s'est retrouvé en « Rendez-vous » alors qu'aucun
rendez-vous n'était posé — le modèle avait lu « RDV » dans une note et l'étape
avait été appliquée sans confirmation. Deux garde-fous permanents en découlent :
la règle des faits (`lib/crm/status.ts`) et le verrou (`status_locked`). **Si
un jour une étape doit bouger, cherchez le fait qui la justifie ; s'il n'existe
pas, proposez au lieu d'appliquer.**

**Le préchargement des liens coûte un rendu serveur par lien.** Mesuré le
7 août : afficher la liste des prospects déclenchait 17 rendus complets de la
fiche prospect (chacun ~9 requêtes SQL), simplement parce que chaque ligne est
un `<Link>`. Sur une liste de 500 fiches, c'est 500. **Règle : `prefetch={false}`
sur tout lien répété dans une liste** ; le préchargement se garde pour les
quelques liens du menu, et seulement parce qu'un `loading.tsx` le rend bon
marché. Le symptôme n'est pas visible à l'œil nu — il faut compter les requêtes
`?_rsc=` dans l'onglet réseau.

**`getUser()` est un appel réseau, `getClaims()` non.** Chaque
`supabase.auth.getUser()` interroge Supabase Auth. Avec les clés de signature
asymétriques (ce projet : ES256), `getClaims()` vérifie la signature en local
contre un JWKS mis en cache pour tout le processus. Ne pas revenir à
`getUser()` « par prudence » : la sécurité ne vient pas de là, elle vient de
`crm_users` relu en base et de la RLS.

**Un squelette de chargement change ce que voit un test.** Depuis l'ajout des
`loading.tsx`, les pages sont diffusées : l'événement `load` part quand la
silhouette est peinte, pas quand les données sont là. Un test qui lit le DOM
à `load` lira le squelette. Attendre le contenu réel (`networkidle`, ou un
sélecteur du vrai contenu).

**Trier sur une valeur calculée.** PostgREST ne sait pas trier sur une
expression : `weighted_value` est une **colonne générée**, pas un calcul
applicatif. Même réflexe pour tout futur indicateur dérivé qu'on voudra trier.

**Chronologie et faits : filtrer les brouillons partout.** `is_draft` doit être
exclu à trois endroits — la chronologie, la lecture des faits
(`readProspectFacts`) et le trigger `bump_last_contact`. En oublier un remet un
texte jamais envoyé au rang d'échange réel.

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

0. **Activer le connecteur MCP** (le code est en production) : poser la variable
   d'environnement Vercel **`SUPABASE_SERVICE_ROLE_KEY`** (Settings → Environment
   Variables — jamais `NEXT_PUBLIC_*`, jamais dans le dépôt) ; c'est la seule
   config requise. Puis, dans Claude : Personnaliser → Connecteurs → « + » →
   coller `https://<domaine-de-prod>/mcp` → OAuth avec le compte admin.
   Vérification : demander à Claude de créer un prospect de test, contrôler dans
   le CRM le `+32` normalisé et le statut « À appeler », puis le supprimer.
   (Optionnel : `MCP_OAUTH_SECRET` pour découpler la signature des jetons de la
   clé service_role — sinon elle en est dérivée, ce qui suffit.)

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
3. **Rétablir le fournisseur IA en production.** Le 3 août, l'extraction en
   production répond « Assistant indisponible » : le chemin de code est validé
   de bout en bout (fournisseur simulé en local — étape imposée, +32 normalisé,
   incertitudes surlignées), c'est donc la configuration MiniMax côté Vercel
   qui est absente ou invalide — invérifiable par le MCP (le connecteur ne
   voit pas ce projet). Depuis vercel.com → Settings → Environment Variables :
   contrôler `MINIMAX_API_KEY` / `MINIMAX_BASE_URL` / `MINIMAX_MODEL`, **ou**
   activer Claude : `AGENT_PROVIDER=anthropic` + `ANTHROPIC_API_KEY`
   (`ANTHROPIC_MODEL` optionnel, défaut `claude-opus-5`). Repasser sur MiniMax
   = remettre `AGENT_PROVIDER=minimax`. Rappel : pas de résidence des données
   en Europe chez Anthropic à ce jour — OK pour des coordonnées publiques, à
   réexaminer avant d'analyser le contenu privé des réponses. La panne ne
   bloque rien : le formulaire s'ouvre vide, saisie manuelle. **La confiance
   dépend du même fournisseur** : sans lui, les fiches restent « À évaluer »
   (ou gardent leur dernier niveau) — rien ne casse, mais rien ne s'estime.
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
(La région des fonctions est réglée et vérifiée — voir « Vitesse et fluidité ».)

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
