-- 014 — Fil de discussion : rattraper les thread_key manquants.
--
-- Aucun changement de schéma : `emails.in_reply_to` et `emails.thread_key`
-- existent déjà. Cette migration ne fait que remplir `thread_key` là où il est
-- resté null, pour que l'invariant « chaque message porte la racine de son
-- fil » soit vrai sur TOUTE la table — c'est ce dont dépend l'héritage posé
-- dans l'edge function crm-mail (send + ingestMessage).
--
-- Pourquoi c'était nécessaire : un premier rétro-remplissage avait bien posé
-- thread_key = message_id sur les 20 lignes d'alors, mais les 19 emails
-- entrants réimportés le 19 août (relève réparée) sont arrivés APRÈS, écrits
-- par une version de crm-mail qui n'écrivait pas encore la colonne.
--
-- La règle est celle du code, pas « thread_key = message_id » aveuglément :
-- un message qui répond à un autre hérite de la racine de son parent. Poser sa
-- propre racine sur une réponse la détacherait du fil auquel elle appartient
-- réellement (cas vu en production : la réponse de Garage Boetendael pointe,
-- via in_reply_to, sur un email sortant du CRM).
--
-- Idempotente : ne touche que les lignes à null.

-- Passe 1 — hériter du parent, en remontant les chaînes de réponses.
do $$
declare
  touched integer;
begin
  for _ in 1..10 loop
    update emails e
       set thread_key = coalesce(p.thread_key, p.message_id)
      from emails p
     where e.thread_key is null
       and e.in_reply_to is not null
       and p.message_id = e.in_reply_to
       and coalesce(p.thread_key, p.message_id) is not null;
    get diagnostics touched = row_count;
    exit when touched = 0;
  end loop;
end $$;

-- Passe 2 — tout ce qui reste n'a pas de parent connu : c'est une racine.
update emails
   set thread_key = message_id
 where thread_key is null
   and message_id is not null;
