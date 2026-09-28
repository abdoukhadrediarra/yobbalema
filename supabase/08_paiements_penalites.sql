-- =============================================================================
-- YOBBALEMA — 08 : paiements en ligne + règles d'annulation
-- Exécuter après 07_complements.sql (rejouable)
-- =============================================================================
--   1. Paiements en ligne : intentions de paiement, confirmation, déduction
--      automatique de la dette de commission
--   2. Soldes « à reverser » et versements aux chauffeurs / commerçants
--   3. Règles d'annulation et suspension (configurables, désactivées par défaut)
--
-- Principe des paiements numériques : le client paie la plateforme (Wave / Orange
-- Money). Une Edge Function crée la session de paiement chez l'opérateur ; c'est le
-- WEBHOOK de l'opérateur (vérifié) — jamais le navigateur — qui confirme le paiement
-- via confirmer_intent(). La plateforme doit ensuite reverser au bénéficiaire son net
-- (montant − 5 %) : le solde à reverser est suivi ici et les versements sont
-- enregistrés par un administrateur.

insert into public.app_config (cle, valeur, description) values
  ('paiements_fournisseurs', 'wave,orange_money', 'Moyens de paiement en ligne proposés (hors mode test) : wave, orange_money.'),
  ('paiement_delai_min', '30', 'Durée de validité d''une tentative de paiement en ligne.'),
  ('desistements_chauffeur_max', '0', 'Désistements d''un chauffeur (après acceptation) tolérés sur la fenêtre avant suspension. 0 = règle désactivée.'),
  ('annulations_client_max', '0', 'Annulations par un client (après acceptation par un chauffeur) tolérées sur la fenêtre avant suspension. 0 = règle désactivée.'),
  ('abus_fenetre_jours', '7', 'Fenêtre de comptage des désistements / annulations.'),
  ('abus_suspension_heures', '24', 'Durée de la suspension automatique.')
on conflict (cle) do nothing;

-- -----------------------------------------------------------------------------
-- 1. PAIEMENTS EN LIGNE
-- -----------------------------------------------------------------------------
alter table public.payments drop constraint if exists payments_statut_check;
alter table public.payments add constraint payments_statut_check
  check (statut_transaction in ('en_attente', 'confirme', 'echoue'));

create table if not exists public.payment_intents (
  id           uuid primary key default gen_random_uuid(),
  -- référence courte envoyée à l'opérateur (client_reference / order_id)
  ref_courte   text not null unique default ('YB' || upper(substr(replace(gen_random_uuid()::text, '-', ''), 1, 12))),
  kind         text not null check (kind in ('paiement', 'dette')),
  payer_id     uuid not null references public.profiles (id),
  payment_ids  uuid[] not null default '{}',
  ledger_ids   uuid[] not null default '{}',
  montant      numeric(10, 2) not null check (montant > 0),
  provider     text not null check (provider in ('wave', 'orange_money')),
  provider_ref text,
  checkout_url text,
  notif_token  text,
  statut       text not null default 'cree' check (statut in ('cree', 'en_attente', 'reussi', 'echoue', 'expire')),
  detail       text,
  created_at   timestamptz not null default now(),
  expires_at   timestamptz not null,
  confirmed_at timestamptz
);
create unique index if not exists payment_intents_provider_ref_idx
  on public.payment_intents (provider, provider_ref) where provider_ref is not null;
create index if not exists payment_intents_payer_idx on public.payment_intents (payer_id, created_at desc);
alter table public.payment_intents enable row level security;

drop policy if exists "payment_intents_select" on public.payment_intents;
create policy "payment_intents_select" on public.payment_intents for select to authenticated
  using (payer_id = auth.uid() or public.is_admin());

-- Versements de la plateforme aux bénéficiaires (enregistrés par un admin).
create table if not exists public.versements (
  id                uuid primary key default gen_random_uuid(),
  beneficiaire_id   uuid not null references public.profiles (id),
  montant           numeric(10, 2) not null check (montant > 0),
  moyen             moyen_paiement not null check (moyen <> 'especes'),
  reference_externe text,
  note              text,
  created_by        uuid references public.profiles (id),
  created_at        timestamptz not null default now()
);
alter table public.versements enable row level security;
drop policy if exists "versements_select" on public.versements;
create policy "versements_select" on public.versements for select to authenticated
  using (beneficiaire_id = auth.uid() or public.is_admin());

-- Un paiement numérique confirmé : déduit automatiquement les dettes de commission
-- du chauffeur bénéficiaire, dans la limite de son net (dettes entières, plus anciennes d'abord).
create or replace function public._appliquer_paiement_confirme(p_payment uuid)
returns void language plpgsql security definer set search_path = public as $$
declare
  v_p public.payments;
  v_reste numeric;
  d record;
begin
  select * into v_p from public.payments where id = p_payment;
  if v_p.id is null or v_p.moyen = 'especes' or v_p.beneficiaire_id is null then return; end if;
  if (select role from public.profiles where id = v_p.beneficiaire_id) <> 'chauffeur' then return; end if;

  v_reste := round(v_p.montant * (100 - v_p.commission_pct) / 100, 2);
  for d in select id, montant from public.driver_ledger
            where driver_id = v_p.beneficiaire_id and regle = false order by created_at loop
    exit when d.montant > v_reste;
    update public.driver_ledger set regle = true, regle_type = 'auto', regle_at = now() where id = d.id;
    v_reste := v_reste - d.montant;
  end loop;
end;
$$;
revoke all on function public._appliquer_paiement_confirme(uuid) from public, anon, authenticated;

-- Création d'un paiement (usage interne) : espèces = confirmé ; numérique en mode test =
-- confirmé (simulé) ; numérique en mode réel = EN ATTENTE jusqu'à confirmation par l'opérateur.
create or replace function public._creer_paiement(
  p_source source_paiement, p_source_id uuid, p_cat categorie_montant,
  p_payeur uuid, p_benef uuid, p_moyen moyen_paiement, p_montant numeric
) returns public.payments
language plpgsql security definer set search_path = public as $$
declare
  v_pay public.payments;
  v_test boolean := public.cfg_bool('mode_test_paiements');
  v_statut text;
begin
  if p_moyen <> 'especes' and not v_test
     and p_moyen::text <> all (string_to_array(coalesce(public.cfg('paiements_fournisseurs'), ''), ',')) then
    raise exception 'paiement_en_ligne_indisponible: ce moyen de paiement n''est pas disponible pour le moment';
  end if;

  v_statut := case when p_moyen = 'especes' or v_test then 'confirme' else 'en_attente' end;

  insert into public.payments
    (source_type, source_id, categorie_montant, payeur_id, beneficiaire_id,
     moyen, montant, commission_pct, statut_transaction, reference_externe)
  values
    (p_source, p_source_id, p_cat, p_payeur, p_benef, p_moyen, p_montant,
     public.cfg_num('commission_pct'), v_statut,
     case when p_moyen <> 'especes' and v_test then 'SIMULATION' else null end)
  returning * into v_pay;

  if p_moyen <> 'especes' and v_statut = 'confirme' then
    perform public._appliquer_paiement_confirme(v_pay.id);
  end if;
  return v_pay;
end;
$$;
revoke all on function public._creer_paiement(source_paiement, uuid, categorie_montant, uuid, uuid, moyen_paiement, numeric)
  from public, anon, authenticated;

-- Le payeur choisit Wave ou Orange Money pour ce qu'il doit ; une intention est créée
-- (l'Edge Function payments-checkout ouvre ensuite la session chez l'opérateur).
create or replace function public.demander_paiement(p_source source_paiement, p_source_id uuid, p_provider moyen_paiement)
returns public.payment_intents
language plpgsql security definer set search_path = public as $$
declare
  v_ids uuid[];
  v_total numeric;
  v_row public.payment_intents;
begin
  if auth.uid() is null then raise exception 'non_authentifie: connexion requise'; end if;
  if public.cfg_bool('mode_test_paiements') then
    raise exception 'paiement_simule: en mode test, les paiements en ligne sont simulés et déjà confirmés';
  end if;
  if p_provider = 'especes' or p_provider::text <> all (string_to_array(coalesce(public.cfg('paiements_fournisseurs'), ''), ',')) then
    raise exception 'paiement_en_ligne_indisponible: ce moyen de paiement n''est pas disponible pour le moment';
  end if;

  select array_agg(id), sum(montant) into v_ids, v_total from public.payments
   where source_type = p_source and source_id = p_source_id and payeur_id = auth.uid() and statut_transaction = 'en_attente';
  if v_ids is null then raise exception 'aucun_paiement_du: rien à payer pour cette opération'; end if;

  -- une nouvelle tentative remplace les précédentes non abouties
  update public.payment_intents set statut = 'expire', detail = coalesce(detail, 'remplacée par une nouvelle tentative')
   where payment_ids && v_ids and statut in ('cree', 'en_attente');
  update public.payments set moyen = p_provider where id = any (v_ids);

  insert into public.payment_intents (kind, payer_id, payment_ids, montant, provider, expires_at)
  values ('paiement', auth.uid(), v_ids, v_total, p_provider::text,
          now() + make_interval(mins => public.cfg_num('paiement_delai_min')::int))
  returning * into v_row;
  return v_row;
end;
$$;

-- Règlement EN LIGNE des commissions dues (toutes les dettes impayées du chauffeur).
create or replace function public.demander_paiement_dette(p_provider moyen_paiement)
returns public.payment_intents
language plpgsql security definer set search_path = public as $$
declare
  v_ids uuid[];
  v_total numeric;
  v_row public.payment_intents;
begin
  perform public.assert_actor(array['chauffeur']::role_utilisateur[]);
  if public.cfg_bool('mode_test_paiements') then
    raise exception 'paiement_simule: en mode test, utilisez le règlement simulé';
  end if;
  if p_provider = 'especes' or p_provider::text <> all (string_to_array(coalesce(public.cfg('paiements_fournisseurs'), ''), ',')) then
    raise exception 'paiement_en_ligne_indisponible: ce moyen de paiement n''est pas disponible pour le moment';
  end if;

  select array_agg(id), sum(montant) into v_ids, v_total from public.driver_ledger
   where driver_id = auth.uid() and regle = false;
  if v_ids is null then raise exception 'aucune_dette: vous n''avez aucune commission à régler'; end if;

  update public.payment_intents set statut = 'expire', detail = coalesce(detail, 'remplacée par une nouvelle tentative')
   where kind = 'dette' and payer_id = auth.uid() and statut in ('cree', 'en_attente');

  insert into public.payment_intents (kind, payer_id, ledger_ids, montant, provider, expires_at)
  values ('dette', auth.uid(), v_ids, v_total, p_provider::text,
          now() + make_interval(mins => public.cfg_num('paiement_delai_min')::int))
  returning * into v_row;
  return v_row;
end;
$$;

-- CONFIRMATION (clé service_role uniquement : appelée par l'Edge Function de webhook,
-- après vérification de la signature de l'opérateur). Idempotente.
--   p_ref      : notre référence courte OU l'identifiant de l'opérateur
--   p_statut   : 'reussi' | 'echoue' | 'expire'
--   p_montant  : montant annoncé par l'opérateur (contrôlé)
create or replace function public.confirmer_intent(
  p_ref text, p_statut text, p_montant numeric default null, p_provider_ref text default null, p_detail text default null
) returns public.payment_intents
language plpgsql security definer set search_path = public as $$
declare
  v_i public.payment_intents;
  v_n integer;
  pid uuid;
  v_pay public.payments;
begin
  select * into v_i from public.payment_intents where ref_courte = p_ref or provider_ref = p_ref for update;
  if v_i.id is null then raise exception 'intent_introuvable: aucune tentative de paiement pour cette référence'; end if;
  if v_i.statut = 'reussi' then return v_i; end if;   -- rejeu du webhook : rien à refaire

  if p_statut = 'reussi' then
    if p_montant is not null and round(p_montant) <> round(v_i.montant) then
      -- l'argent reçu ne correspond pas : on ne confirme rien, un humain doit vérifier
      update public.payment_intents
         set detail = 'montant_incoherent: attendu ' || round(v_i.montant) || ', reçu ' || round(p_montant),
             provider_ref = coalesce(provider_ref, p_provider_ref)
       where id = v_i.id returning * into v_i;
      return v_i;
    end if;

    if v_i.kind = 'paiement' then
      update public.payments set statut_transaction = 'confirme', reference_externe = coalesce(p_provider_ref, v_i.provider_ref, v_i.ref_courte)
       where id = any (v_i.payment_ids) and statut_transaction = 'en_attente';
      get diagnostics v_n = row_count;
      for pid in select unnest(v_i.payment_ids) loop
        perform public._appliquer_paiement_confirme(pid);
      end loop;
      if v_n = 0 then
        p_detail := coalesce(p_detail, '') || ' doublon: paiement déjà confirmé par une autre tentative, remboursement à vérifier';
      end if;
      for v_pay in select * from public.payments where id = any (v_i.payment_ids) loop
        perform public._notifier(v_pay.beneficiaire_id, 'paiement_recu', 'Paiement reçu',
          round(v_pay.montant) || ' FCFA payés en ligne (net après commission : ' || round(v_pay.montant * (100 - v_pay.commission_pct) / 100) || ' FCFA).',
          jsonb_build_object('payment_id', v_pay.id));
      end loop;
      perform public._notifier(v_i.payer_id, 'paiement_confirme', 'Paiement confirmé', round(v_i.montant) || ' FCFA payés. Merci !');
    else
      update public.driver_ledger set regle = true, regle_type = 'manuel', regle_at = now()
       where id = any (v_i.ledger_ids) and regle = false;
      perform public._notifier(v_i.payer_id, 'dette_reglee', 'Commission réglée', 'Votre paiement est confirmé : votre compte est de nouveau actif.');
    end if;

    update public.payment_intents
       set statut = 'reussi', confirmed_at = now(), provider_ref = coalesce(provider_ref, p_provider_ref),
           detail = nullif(trim(coalesce(p_detail, '')), '')
     where id = v_i.id returning * into v_i;

  elsif p_statut in ('echoue', 'expire') then
    update public.payment_intents set statut = p_statut, detail = coalesce(p_detail, detail)
     where id = v_i.id and statut in ('cree', 'en_attente') returning * into v_i;
    if v_i.id is null then select * into v_i from public.payment_intents where ref_courte = p_ref or provider_ref = p_ref; end if;
    if p_statut = 'echoue' then
      perform public._notifier(v_i.payer_id, 'paiement_echoue', 'Paiement non abouti', 'Le paiement n''a pas été validé. Vous pouvez réessayer.');
    end if;
  else
    raise exception 'statut_invalide: statut de paiement inconnu';
  end if;
  return v_i;
end;
$$;
revoke all on function public.confirmer_intent(text, text, numeric, text, text) from public, anon, authenticated;
grant execute on function public.confirmer_intent(text, text, numeric, text, text) to service_role;

-- Mise à jour de la session ouverte chez l'opérateur (service_role : Edge Function payments-checkout).
create or replace function public.enregistrer_session_paiement(p_intent uuid, p_provider_ref text, p_url text, p_notif_token text default null)
returns public.payment_intents
language plpgsql security definer set search_path = public as $$
declare v public.payment_intents;
begin
  update public.payment_intents
     set provider_ref = p_provider_ref, checkout_url = p_url, notif_token = p_notif_token, statut = 'en_attente'
   where id = p_intent and statut in ('cree', 'en_attente') returning * into v;
  if v.id is null then raise exception 'intent_introuvable: tentative inconnue ou déjà terminée'; end if;
  return v;
end;
$$;
revoke all on function public.enregistrer_session_paiement(uuid, text, text, text) from public, anon, authenticated;
grant execute on function public.enregistrer_session_paiement(uuid, text, text, text) to service_role;

create or replace function public.expire_stale_payments()
returns integer language plpgsql security definer set search_path = public as $$
declare n integer;
begin
  update public.payment_intents set statut = 'expire', detail = coalesce(detail, 'délai dépassé')
   where statut in ('cree', 'en_attente') and expires_at < now();
  get diagnostics n = row_count;
  return n;
end;
$$;

-- -----------------------------------------------------------------------------
-- 2. SOLDES ET VERSEMENTS
-- -----------------------------------------------------------------------------
-- solde à reverser = net des paiements numériques confirmés − dettes déduites automatiquement − versements
create or replace function public._a_verser(p_user uuid)
returns numeric language sql stable security definer set search_path = public as $$
  select coalesce((select sum(round(montant * (100 - commission_pct) / 100, 2)) from public.payments
                    where beneficiaire_id = p_user and moyen <> 'especes' and statut_transaction = 'confirme'), 0)
       - coalesce((select sum(montant) from public.driver_ledger where driver_id = p_user and regle_type = 'auto'), 0)
       - coalesce((select sum(montant) from public.versements where beneficiaire_id = p_user), 0)
$$;

create or replace function public.mon_solde()
returns jsonb language plpgsql stable security definer set search_path = public as $$
begin
  if auth.uid() is null then raise exception 'non_authentifie: connexion requise'; end if;
  return jsonb_build_object(
    'a_verser', public._a_verser(auth.uid()),
    'en_attente_de_paiement', coalesce((select sum(round(montant * (100 - commission_pct) / 100, 2)) from public.payments
        where beneficiaire_id = auth.uid() and moyen <> 'especes' and statut_transaction = 'en_attente'), 0),
    'dettes_deduites', coalesce((select sum(montant) from public.driver_ledger where driver_id = auth.uid() and regle_type = 'auto'), 0),
    'deja_verse', coalesce((select sum(montant) from public.versements where beneficiaire_id = auth.uid()), 0)
  );
end;
$$;

create or replace function public.admin_soldes()
returns table (beneficiaire_id uuid, prenom text, nom text, telephone text, role role_utilisateur, a_verser numeric)
language plpgsql stable security definer set search_path = public as $$
begin
  perform public.assert_admin();
  return query
  select p.id, p.prenom, p.nom, p.telephone, p.role, public._a_verser(p.id)
    from public.profiles p
   where p.id in (select pay.beneficiaire_id from public.payments pay where pay.beneficiaire_id is not null and pay.moyen <> 'especes')
     and public._a_verser(p.id) > 0
   order by public._a_verser(p.id) desc;
end;
$$;

create or replace function public.admin_enregistrer_versement(
  p_beneficiaire uuid, p_montant numeric, p_moyen moyen_paiement, p_reference text default null, p_note text default null
) returns public.versements
language plpgsql security definer set search_path = public as $$
declare
  v_solde numeric;
  v public.versements;
begin
  perform public.assert_admin();
  v_solde := public._a_verser(p_beneficiaire);
  if p_montant is null or p_montant <= 0 or p_montant > v_solde then
    raise exception 'montant_invalide: le versement doit être compris entre 1 et % FCFA (solde à reverser)', round(v_solde);
  end if;
  if p_moyen = 'especes' then raise exception 'moyen_invalide: choisissez Wave ou Orange Money'; end if;
  insert into public.versements (beneficiaire_id, montant, moyen, reference_externe, note, created_by)
  values (p_beneficiaire, p_montant, p_moyen, p_reference, p_note, auth.uid()) returning * into v;
  perform public._notifier(p_beneficiaire, 'versement_effectue', 'Versement effectué',
    round(p_montant) || ' FCFA vous ont été envoyés par ' || case p_moyen when 'wave' then 'Wave' else 'Orange Money' end || '.');
  return v;
end;
$$;

-- -----------------------------------------------------------------------------
-- 3. RÈGLES D'ANNULATION ET SUSPENSION
-- -----------------------------------------------------------------------------
alter table public.profiles add column if not exists suspendu_jusqua timestamptz;

create or replace function public.profiles_protect_columns()
returns trigger language plpgsql as $$
begin
  if auth.uid() is not null and coalesce(current_setting('app.bypass_protect', true), '') <> 'on' then
    new.statut_verif := old.statut_verif;
    new.note_moyenne := old.note_moyenne;
    new.role := old.role;
    new.id := old.id;
    new.suspendu_jusqua := old.suspendu_jusqua;
  end if;
  return new;
end;
$$;

create table if not exists public.abus_events (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null references public.profiles (id) on delete cascade,
  type       text not null check (type in ('desistement_chauffeur', 'annulation_client')),
  ride_id    uuid,
  created_at timestamptz not null default now()
);
create index if not exists abus_events_user_idx on public.abus_events (user_id, type, created_at desc);
alter table public.abus_events enable row level security;   -- aucune politique : réservé aux fonctions internes

create or replace function public._enregistrer_abus(p_user uuid, p_type text, p_ride uuid)
returns void language plpgsql security definer set search_path = public as $$
declare
  v_max numeric := case p_type when 'desistement_chauffeur' then public.cfg_num('desistements_chauffeur_max')
                                else public.cfg_num('annulations_client_max') end;
  v_jusqua timestamptz;
begin
  if p_user is null then return; end if;
  insert into public.abus_events (user_id, type, ride_id) values (p_user, p_type, p_ride);
  if v_max > 0 and (select count(*) from public.abus_events
                     where user_id = p_user and type = p_type
                       and created_at > now() - make_interval(days => public.cfg_num('abus_fenetre_jours')::int)) >= v_max then
    v_jusqua := now() + make_interval(hours => public.cfg_num('abus_suspension_heures')::int);
    perform set_config('app.bypass_protect', 'on', true);
    update public.profiles set suspendu_jusqua = v_jusqua where id = p_user;
    perform set_config('app.bypass_protect', 'off', true);
    perform public._notifier(p_user, 'compte_suspendu', 'Compte suspendu temporairement',
      case p_type when 'desistement_chauffeur' then 'Trop de désistements récents.' else 'Trop d''annulations récentes après acceptation par un chauffeur.' end
      || ' Vous pourrez de nouveau utiliser Yobbalema à partir du ' || to_char(v_jusqua at time zone 'UTC', 'DD/MM à HH24:MI') || ' (UTC).');
  end if;
end;
$$;
revoke all on function public._enregistrer_abus(uuid, text, uuid) from public, anon, authenticated;

create or replace function public.trg_abus_ride() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if old.statut = 'assignee' and new.statut = 'en_attente' and old.driver_id is not null then
    perform public._enregistrer_abus(old.driver_id, 'desistement_chauffeur', new.id);
  elsif old.statut = 'assignee' and new.statut = 'annulee' then
    perform public._enregistrer_abus(new.client_id, 'annulation_client', new.id);
  end if;
  return new;
end;
$$;
drop trigger if exists abus_ride on public.ride_requests;
create trigger abus_ride after update of statut on public.ride_requests for each row execute function public.trg_abus_ride();

-- assert_actor : refuse toute action à un compte suspendu.
create or replace function public.assert_actor(p_roles role_utilisateur[])
returns public.profiles
language plpgsql stable security definer set search_path = public as $$
declare
  v public.profiles;
begin
  if auth.uid() is null then
    raise exception 'non_authentifie: connexion requise';
  end if;
  select * into v from public.profiles where id = auth.uid();
  if v.id is null then
    raise exception 'profil_introuvable: profil manquant pour ce compte';
  end if;
  if not (v.role = any (p_roles)) then
    raise exception 'acces_refuse: votre rôle (%) ne permet pas cette action', v.role;
  end if;
  if v.suspendu_jusqua is not null and v.suspendu_jusqua > now() then
    raise exception 'compte_suspendu: votre compte est suspendu jusqu''au % (UTC) en raison d''annulations répétées.',
      to_char(v.suspendu_jusqua at time zone 'UTC', 'DD/MM à HH24:MI');
  end if;
  if public.cfg_bool('verification_requise') and v.role <> 'client' and v.statut_verif <> 'verifie' then
    raise exception 'compte_non_verifie: faites vérifier votre identité pour utiliser cette fonction';
  end if;
  return v;
end;
$$;

create or replace function public.admin_lever_suspension(p_user uuid)
returns public.profiles language plpgsql security definer set search_path = public as $$
declare v public.profiles;
begin
  perform public.assert_admin();
  perform set_config('app.bypass_protect', 'on', true);
  update public.profiles set suspendu_jusqua = null where id = p_user returning * into v;
  perform set_config('app.bypass_protect', 'off', true);
  if v.id is null then raise exception 'utilisateur_introuvable: compte introuvable'; end if;
  delete from public.abus_events where user_id = p_user;
  return v;
end;
$$;

-- Statistiques : ajout des indicateurs de paiement.
create or replace function public.admin_stats()
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare v jsonb;
begin
  perform public.assert_admin();
  select jsonb_build_object(
    'utilisateurs', (select coalesce(jsonb_object_agg(role, n), '{}'::jsonb) from (select role, count(*) n from public.profiles group by role) t),
    'verifications_en_attente', (select count(*) from public.profiles where statut_verif = 'en_attente' and (cni_url is not null or permis_url is not null)),
    'commerces_en_attente', (select count(*) from public.merchants where statut_verif = 'en_attente'),
    'courses_terminees', (select count(*) from public.ride_requests where statut = 'terminee'),
    'courses_aujourdhui', (select count(*) from public.ride_requests where created_at >= date_trunc('day', now())),
    'courses_en_attente', (select count(*) from public.ride_requests where statut = 'en_attente' and expire_at > now()),
    'livraisons_livrees', (select count(*) from public.delivery_orders where statut = 'livree'),
    'trajets_ouverts', (select count(*) from public.trips where statut in ('ouvert', 'complet') and date_heure_depart > now()),
    'bus_actifs', (select count(*) from public.bus_positions where updated_at > now() - make_interval(secs => public.cfg_num('bus_position_max_age_s')::float8)),
    'volume_paiements', (select coalesce(sum(montant), 0) from public.payments where statut_transaction = 'confirme'),
    'commissions_generees', (select coalesce(round(sum(montant * commission_pct / 100)), 0) from public.payments where statut_transaction = 'confirme'),
    'dettes_en_cours', (select coalesce(sum(montant), 0) from public.driver_ledger where regle = false),
    'chauffeurs_bloques', (select count(distinct driver_id) from public.driver_ledger where regle = false),
    'paiements_en_attente', (select count(*) from public.payments where statut_transaction = 'en_attente'),
    'a_verser_total', (select coalesce(sum(greatest(public._a_verser(b.id), 0)), 0)
                         from (select distinct beneficiaire_id as id from public.payments where beneficiaire_id is not null and moyen <> 'especes') b),
    'anomalies_paiement', (select count(*) from public.payment_intents where detail like 'montant_incoherent%' or detail like '%doublon%'),
    'comptes_suspendus', (select count(*) from public.profiles where suspendu_jusqua > now())
  ) into v;
  return v;
end;
$$;

-- -----------------------------------------------------------------------------
-- 4. TEMPS RÉEL + DROITS
-- -----------------------------------------------------------------------------
do $$
declare t text;
begin
  foreach t in array array['payment_intents', 'payments']
  loop
    begin
      execute format('alter publication supabase_realtime add table public.%I', t);
    exception
      when duplicate_object then null;
      when undefined_object then null;
    end;
  end loop;
end $$;

do $$
declare f text;
begin
  foreach f in array array[
    'demander_paiement(source_paiement,uuid,moyen_paiement)', 'demander_paiement_dette(moyen_paiement)',
    'expire_stale_payments()', 'mon_solde()', 'admin_soldes()',
    'admin_enregistrer_versement(uuid,numeric,moyen_paiement,text,text)', 'admin_lever_suspension(uuid)'
  ] loop
    execute format('revoke execute on function public.%s from anon', f);
  end loop;
end $$;
