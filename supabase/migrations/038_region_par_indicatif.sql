-- 038 — La région devinée par l'indicatif du fixe (29/10/2026, décision de Bora).
--
-- 53 fiches sur 128 n'ont ni commune ni adresse : aucune région, rien à
-- afficher dans la nouvelle pastille de la liste. Beaucoup ont pourtant un
-- FIXE, et l'indicatif dit la zone : 02 → Bruxelles (commune à préciser),
-- 081 → Namur, 04 (fixe, 9 chiffres) → Liège… Un GSM (10 chiffres), un
-- numéro spécial (0800, 090x, 070, 077, 078) ou étranger ne disent rien ;
-- les zones à cheval sur deux provinces (056, 067) non plus.
--
-- La règle vit en SQL, comme `lieu_de` (034), pour tous les écrivains.
-- Recopie TS : `regionDeTelephone` (lib/crm/regions.ts), jeu de cas commun
-- lib/crm/indicatifs.cas.json (test:regions ET la recette 038).
--
-- ORDRE : la commune et l'adresse d'abord (034, inchangé) ; l'indicatif
-- SEULEMENT si elles n'ont rien donné. Une région fixée à la main n'est
-- jamais écrasée. Le trigger écoute désormais aussi `phone` (CREATE OR
-- REPLACE TRIGGER : aucun DROP).
--
-- Reprise UNE fois : les fiches sans région dont le fixe parle reçoivent la
-- région de l'indicatif, `updated_at` préservé (GUC `celya.reprise_lieu`,
-- comme la 034). Défaire :
--   update prospects set region = null
--    where region = region_de_telephone(phone)
--      and nullif(btrim(city), '') is null and nullif(btrim(address), '') is null;

create or replace function public.region_de_telephone(p_tel text)
returns text language plpgsql immutable set search_path = public as $$
declare
  n text := regexp_replace(coalesce(p_tel, ''), '[^0-9]', '', 'g');
begin
  if n like '0032%' then
    n := '0' || substr(n, 5);
  elsif n like '32%' and btrim(coalesce(p_tel, '')) like '+%' then
    n := '0' || substr(n, 3);
  end if;
  if length(n) <> 9 or left(n, 1) <> '0' then return null; end if;
  if n ~ '^0(800|90|70|77|78)' then return null; end if;
  return case left(n, 2)
    when '02' then 'Bruxelles (commune à préciser)'
    when '03' then 'Anvers'
    when '04' then 'Liège'
    when '09' then 'Flandre orientale'
    else case left(n, 3)
      when '010' then 'Brabant wallon'
      when '011' then 'Limbourg'
      when '012' then 'Limbourg'
      when '013' then 'Brabant flamand'
      when '014' then 'Anvers'
      when '015' then 'Anvers'
      when '016' then 'Brabant flamand'
      when '019' then 'Liège'
      when '050' then 'Flandre occidentale'
      when '051' then 'Flandre occidentale'
      when '052' then 'Flandre orientale'
      when '053' then 'Flandre orientale'
      when '054' then 'Flandre orientale'
      when '055' then 'Flandre orientale'
      when '057' then 'Flandre occidentale'
      when '058' then 'Flandre occidentale'
      when '059' then 'Flandre occidentale'
      when '060' then 'Hainaut'
      when '061' then 'Luxembourg'
      when '063' then 'Luxembourg'
      when '064' then 'Hainaut'
      when '065' then 'Hainaut'
      when '068' then 'Hainaut'
      when '069' then 'Hainaut'
      when '071' then 'Hainaut'
      when '080' then 'Liège'
      when '081' then 'Namur'
      when '082' then 'Namur'
      when '083' then 'Namur'
      when '084' then 'Luxembourg'
      when '085' then 'Liège'
      when '086' then 'Luxembourg'
      when '087' then 'Liège'
      when '089' then 'Limbourg'
    end
  end;
end $$;
grant execute on function public.region_de_telephone(text) to authenticated;

create or replace function public.prospects_lieu()
returns trigger language plpgsql set search_path = public as $$
declare
  v record;
  sans_lieu boolean := nullif(btrim(new.city), '') is null and nullif(btrim(new.address), '') is null;
begin
  if tg_op = 'INSERT' then
    select * into v from public.lieu_de(new.city, new.address, case when sans_lieu then new.company_name end);
    new.city := coalesce(v.commune, new.city);
    if new.region is null then new.region := v.region; end if;
  elsif new.city is distinct from old.city or new.address is distinct from old.address then
    select * into v from public.lieu_de(new.city, new.address, case when sans_lieu then new.company_name end);
    if new.city is distinct from old.city then new.city := coalesce(v.commune, new.city); end if;
    if new.region is not distinct from old.region then new.region := v.region; end if;
  elsif tg_op = 'UPDATE' and sans_lieu and new.phone is distinct from old.phone
        and new.region is not distinct from old.region
        and old.region is not distinct from public.region_de_telephone(old.phone) then
    -- 038 : la région venait de l'ancien numéro — elle suit le nouveau.
    new.region := null;
  end if;
  -- 038 : rien de la commune ni de l'adresse → l'indicatif du fixe.
  if new.region is null then
    new.region := public.region_de_telephone(new.phone);
  end if;
  if tg_op = 'UPDATE' and current_setting('celya.reprise_lieu', true) = 'on' then
    new.updated_at := old.updated_at;
  end if;
  return new;
end $$;

create or replace trigger prospects_lieu
  before insert or update of city, address, region, phone on public.prospects
  for each row execute function public.prospects_lieu();

-- ---------- Reprise : une fois ----------
select set_config('celya.reprise_lieu', 'on', true);
update public.prospects
   set region = public.region_de_telephone(phone)
 where region is null
   and public.region_de_telephone(phone) is not null;
select set_config('celya.reprise_lieu', 'off', true);
