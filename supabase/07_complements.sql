-- =============================================================================
-- YOBBALEMA — 07 : compléments fonctionnels
-- Exécuter après 06_service_functions.sql (rejouable)
-- =============================================================================
--   1. Administrateurs (back-office)
--   2. Notifications (table + déclencheurs) et jetons d'appareils (push mobile)
--   3. Position en direct des chauffeurs
--   4. Bus : plusieurs bus par ligne, recherche par trajet A -> B
--   5. Avis : livraisons et commerçants
--   6. Livraison marchande : repli sur le commerçant suivant, expiration des devis
--   7. Modification d'un trajet publié
--   8. Fonctions d'administration

-- -----------------------------------------------------------------------------
-- 0. Nouveaux paramètres
-- -----------------------------------------------------------------------------
insert into public.app_config (cle, valeur, description) values
  ('devis_reponse_delai_s', '300', 'Délai laissé au commerçant pour répondre à une commande, avant de la proposer au suivant.'),
  ('devis_validite_min', '30', 'Durée pendant laquelle un devis reste valable pour le client.')
on conflict (cle) do nothing;

-- -----------------------------------------------------------------------------
-- 1. ADMINISTRATEURS
-- -----------------------------------------------------------------------------
-- Aucune politique RLS : la table n'est lisible / modifiable que par le SQL Editor
-- ou la clé service_role. Ajouter un administrateur :
--   insert into admins (user_id) select id from profiles where ... ;
create table if not exists public.admins (
  user_id    uuid primary key references public.profiles (id) on delete cascade,
  created_at timestamptz not null default now()
);
alter table public.admins enable row level security;

create or replace function public.is_admin()
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.admins where user_id = auth.uid())
$$;

create or replace function public.assert_admin()
returns void language plpgsql stable security definer set search_path = public as $$
begin
  if auth.uid() is null then raise exception 'non_authentifie: connexion requise'; end if;
  if not public.is_admin() then raise exception 'acces_refuse: réservé aux administrateurs'; end if;
end;
$$;

drop policy if exists "profiles_select_admin" on public.profiles;
create policy "profiles_select_admin" on public.profiles for select to authenticated using (public.is_admin());

drop policy if exists "driver_ledger_select_admin" on public.driver_ledger;
create policy "driver_ledger_select_admin" on public.driver_ledger for select to authenticated using (public.is_admin());

drop policy if exists "payments_select_admin" on public.payments;
create policy "payments_select_admin" on public.payments for select to authenticated using (public.is_admin());

drop policy if exists "documents_admin_select" on storage.objects;
create policy "documents_admin_select" on storage.objects
  for select to authenticated using (bucket_id = 'documents' and public.is_admin());

-- -----------------------------------------------------------------------------
-- 2. NOTIFICATIONS
-- -----------------------------------------------------------------------------
create table if not exists public.notifications (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null references public.profiles (id) on delete cascade,
  type       text not null,
  titre      text not null,
  corps      text,
  data       jsonb not null default '{}'::jsonb,
  lu         boolean not null default false,
  created_at timestamptz not null default now()
);
create index if not exists notifications_user_idx on public.notifications (user_id, created_at desc);
alter table public.notifications enable row level security;

drop policy if exists "notifications_select_own" on public.notifications;
create policy "notifications_select_own" on public.notifications for select to authenticated using (user_id = auth.uid());

-- Jetons d'appareils pour les notifications push (utilisés par l'application mobile).
create table if not exists public.device_tokens (
  token      text primary key,
  user_id    uuid not null references public.profiles (id) on delete cascade,
  plateforme text not null check (plateforme in ('android', 'ios', 'web')),
  updated_at timestamptz not null default now()
);
alter table public.device_tokens enable row level security;
drop policy if exists "device_tokens_own" on public.device_tokens;
create policy "device_tokens_own" on public.device_tokens for all to authenticated
  using (user_id = auth.uid()) with check (user_id = auth.uid());

create or replace function public._notifier(p_user uuid, p_type text, p_titre text, p_corps text default null, p_data jsonb default '{}'::jsonb)
returns void language plpgsql security definer set search_path = public as $$
begin
  if p_user is null then return; end if;
  insert into public.notifications (user_id, type, titre, corps, data) values (p_user, p_type, p_titre, p_corps, coalesce(p_data, '{}'::jsonb));
end;
$$;
revoke all on function public._notifier(uuid, text, text, text, jsonb) from public, anon, authenticated;

create or replace function public.notifications_marquer_lues(p_ids uuid[] default null)
returns integer language plpgsql security definer set search_path = public as $$
declare n integer;
begin
  if auth.uid() is null then raise exception 'non_authentifie: connexion requise'; end if;
  update public.notifications set lu = true
   where user_id = auth.uid() and lu = false and (p_ids is null or id = any (p_ids));
  get diagnostics n = row_count;
  return n;
end;
$$;

-- ---- Déclencheurs de notification --------------------------------------------
create or replace function public._prenom(p_id uuid) returns text
language sql stable security definer set search_path = public as $$
  select coalesce(prenom, 'Quelqu''un') from public.profiles where id = p_id
$$;

create or replace function public.trg_notif_ride() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.statut is distinct from old.statut then
    if new.statut = 'assignee' and old.statut = 'en_attente' then
      perform public._notifier(new.client_id, 'course_acceptee', 'Chauffeur trouvé',
        public._prenom(new.driver_id) || ' arrive pour votre course.', jsonb_build_object('ride_id', new.id));
    elsif new.statut = 'en_attente' and old.statut = 'assignee' then
      perform public._notifier(new.client_id, 'course_desistement', 'Le chauffeur s''est désisté',
        'Nous cherchons un autre chauffeur pour vous.', jsonb_build_object('ride_id', new.id));
    elsif new.statut = 'en_cours' then
      perform public._notifier(new.client_id, 'course_demarree', 'Course démarrée', 'Bon voyage !', jsonb_build_object('ride_id', new.id));
    elsif new.statut = 'terminee' then
      perform public._notifier(new.client_id, 'course_terminee', 'Course terminée', 'Merci ! Vous pouvez noter votre chauffeur.', jsonb_build_object('ride_id', new.id));
    elsif new.statut = 'expiree' then
      perform public._notifier(new.client_id, 'course_expiree', 'Aucun chauffeur disponible',
        'Réessayez, ou proposez un prix plus attractif avec le waxalé.', jsonb_build_object('ride_id', new.id));
    elsif new.statut = 'annulee' and old.statut = 'assignee' then
      perform public._notifier(old.driver_id, 'course_annulee', 'Course annulée', 'Le client a annulé la course.', jsonb_build_object('ride_id', new.id));
    end if;
  end if;
  return new;
end;
$$;
drop trigger if exists notif_ride on public.ride_requests;
create trigger notif_ride after update on public.ride_requests for each row execute function public.trg_notif_ride();

create or replace function public.trg_notif_reservation() returns trigger
language plpgsql security definer set search_path = public as $$
declare v_trip public.trips;
begin
  select * into v_trip from public.trips where id = new.trip_id;
  if tg_op = 'INSERT' then
    perform public._notifier(v_trip.driver_id, 'reservation_nouvelle', 'Nouvelle réservation',
      public._prenom(new.passager_id) || ' demande ' || new.nb_places || ' place(s) : ' || v_trip.depart_label || ' → ' || v_trip.arrivee_label,
      jsonb_build_object('trip_id', new.trip_id, 'reservation_id', new.id));
  elsif new.statut is distinct from old.statut then
    if new.statut = 'confirmee' then
      perform public._notifier(new.passager_id, 'reservation_confirmee', 'Réservation confirmée',
        v_trip.depart_label || ' → ' || v_trip.arrivee_label, jsonb_build_object('trip_id', new.trip_id, 'reservation_id', new.id));
    elsif new.statut = 'annulee' and v_trip.statut <> 'annule' then
      if auth.uid() = new.passager_id then
        perform public._notifier(v_trip.driver_id, 'reservation_annulee', 'Réservation annulée',
          public._prenom(new.passager_id) || ' a annulé sa réservation.', jsonb_build_object('trip_id', new.trip_id));
      else
        perform public._notifier(new.passager_id, 'reservation_refusee', 'Réservation non retenue',
          'Le chauffeur n''a pas pu retenir votre réservation : ' || v_trip.depart_label || ' → ' || v_trip.arrivee_label, jsonb_build_object('trip_id', new.trip_id));
      end if;
    end if;
  end if;
  return new;
end;
$$;
drop trigger if exists notif_reservation on public.reservations;
create trigger notif_reservation after insert or update on public.reservations for each row execute function public.trg_notif_reservation();

create or replace function public.trg_notif_trip() returns trigger
language plpgsql security definer set search_path = public as $$
declare r record;
begin
  if new.statut is distinct from old.statut and new.statut in ('annule', 'termine') then
    for r in select passager_id, statut from public.reservations where trip_id = new.id and statut <> 'annulee' loop
      if new.statut = 'annule' then
        perform public._notifier(r.passager_id, 'trajet_annule', 'Trajet annulé',
          new.depart_label || ' → ' || new.arrivee_label || ' a été annulé par le chauffeur.', jsonb_build_object('trip_id', new.id));
      elsif r.statut = 'confirmee' then
        perform public._notifier(r.passager_id, 'trajet_termine', 'Trajet terminé', 'Vous pouvez noter votre chauffeur.', jsonb_build_object('trip_id', new.id));
      end if;
    end loop;
  end if;
  return new;
end;
$$;
drop trigger if exists notif_trip on public.trips;
create trigger notif_trip after update on public.trips for each row execute function public.trg_notif_trip();

-- (le déclencheur de livraison est défini plus bas, après l'ajout des colonnes utilisées)

create or replace function public.trg_notif_profile() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.statut_verif is distinct from old.statut_verif then
    if new.statut_verif = 'verifie' then
      perform public._notifier(new.id, 'compte_verifie', 'Compte vérifié', 'Votre identité est validée : toutes les fonctionnalités sont disponibles.');
    elsif new.statut_verif = 'rejete' then
      perform public._notifier(new.id, 'compte_rejete', 'Vérification refusée', 'Vos documents n''ont pas pu être validés. Renvoyez-les depuis votre profil.');
    end if;
  end if;
  return new;
end;
$$;
drop trigger if exists notif_profile on public.profiles;
create trigger notif_profile after update of statut_verif on public.profiles for each row execute function public.trg_notif_profile();

create or replace function public.trg_notif_ledger() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if tg_op = 'INSERT' and new.regle = false then
    perform public._notifier(new.driver_id, 'dette_creee', 'Commission à régler',
      'Vous devez ' || round(new.montant) || ' FCFA de commission. Vos nouvelles missions sont suspendues jusqu''au règlement.');
  elsif tg_op = 'UPDATE' and new.regle = true and old.regle = false then
    perform public._notifier(new.driver_id, 'dette_reglee', 'Commission réglée', 'Merci ! Votre compte est de nouveau actif.');
  end if;
  return new;
end;
$$;
drop trigger if exists notif_ledger on public.driver_ledger;
create trigger notif_ledger after insert or update on public.driver_ledger for each row execute function public.trg_notif_ledger();

create or replace function public.trg_notif_merchant() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.statut_verif is distinct from old.statut_verif and new.statut_verif in ('verifie', 'rejete') then
    perform public._notifier(new.owner_id, 'commerce_' || new.statut_verif::text,
      case when new.statut_verif = 'verifie' then 'Commerce vérifié' else 'Commerce refusé' end,
      case when new.statut_verif = 'verifie' then new.nom_commerce || ' est maintenant proposé aux clients proches.' else 'La vérification de ' || new.nom_commerce || ' a été refusée.' end);
  end if;
  return new;
end;
$$;
drop trigger if exists notif_merchant on public.merchants;
create trigger notif_merchant after update of statut_verif on public.merchants for each row execute function public.trg_notif_merchant();

-- Avis reçu
create or replace function public.trg_notif_review() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  perform public._notifier(new.destinataire_id, 'avis_recu', 'Nouvel avis',
    'Vous avez reçu ' || new.note || ' étoile(s)' || case when new.commentaire is not null and new.commentaire <> '' then ' : « ' || new.commentaire || ' »' else '.' end);
  return new;
end;
$$;
drop trigger if exists notif_review on public.reviews;
create trigger notif_review after insert on public.reviews for each row execute function public.trg_notif_review();

-- -----------------------------------------------------------------------------
-- 3. POSITION EN DIRECT DES CHAUFFEURS
-- -----------------------------------------------------------------------------
create table if not exists public.driver_locations (
  driver_id   uuid primary key references public.profiles (id) on delete cascade,
  lat         double precision not null,
  lng         double precision not null,
  vitesse_kmh numeric(6, 2),
  geom        geography(point, 4326),
  updated_at  timestamptz not null default now()
);
alter table public.driver_locations enable row level security;

create or replace function public.driver_locations_set_geom() returns trigger
language plpgsql as $$
begin
  new.geom := ST_SetSRID(ST_MakePoint(new.lng, new.lat), 4326)::geography;
  new.updated_at := now();
  return new;
end;
$$;
drop trigger if exists driver_locations_geom_trigger on public.driver_locations;
create trigger driver_locations_geom_trigger before insert or update on public.driver_locations
  for each row execute function public.driver_locations_set_geom();

-- Lecture : le chauffeur lui-même, le client dont il a la course / livraison en cours, les admins.
drop policy if exists "driver_locations_select" on public.driver_locations;
create policy "driver_locations_select" on public.driver_locations for select to authenticated using (
  driver_id = auth.uid()
  or public.is_admin()
  or exists (select 1 from public.ride_requests r
              where r.driver_id = driver_locations.driver_id and r.client_id = auth.uid() and r.statut in ('assignee', 'en_cours'))
  or exists (select 1 from public.delivery_orders d
              where d.chauffeur_id = driver_locations.driver_id and d.client_id = auth.uid() and d.statut = 'en_livraison')
);
drop policy if exists "driver_locations_write" on public.driver_locations;
create policy "driver_locations_write" on public.driver_locations for insert to authenticated with check (
  driver_id = auth.uid() and exists (select 1 from public.profiles p where p.id = auth.uid() and p.role = 'chauffeur')
);
drop policy if exists "driver_locations_update" on public.driver_locations;
create policy "driver_locations_update" on public.driver_locations for update to authenticated
  using (driver_id = auth.uid()) with check (driver_id = auth.uid());
drop policy if exists "driver_locations_delete" on public.driver_locations;
create policy "driver_locations_delete" on public.driver_locations for delete to authenticated using (driver_id = auth.uid());

-- -----------------------------------------------------------------------------
-- 4. BUS : PLUSIEURS BUS PAR LIGNE
-- -----------------------------------------------------------------------------
alter table public.bus_positions
  add column if not exists receveur_id uuid references public.profiles (id) on delete cascade,
  add column if not exists bus_label   text;

update public.bus_positions p set receveur_id = l.receveur_id
  from public.bus_lines l where l.id = p.bus_line_id and p.receveur_id is null;

alter table public.bus_positions alter column receveur_id set default auth.uid();
drop index if exists public.bus_positions_one_per_line;
create unique index if not exists bus_positions_one_per_bus on public.bus_positions (bus_line_id, receveur_id);

-- Tout receveur peut faire circuler un bus sur n'importe quelle ligne active (une ligne compte plusieurs bus).
drop policy if exists "bus_positions_upsert_own_line" on public.bus_positions;
drop policy if exists "bus_positions_update_own_line" on public.bus_positions;
drop policy if exists "bus_positions_insert_receveur" on public.bus_positions;
create policy "bus_positions_insert_receveur" on public.bus_positions for insert to authenticated with check (
  receveur_id = auth.uid()
  and exists (select 1 from public.profiles p where p.id = auth.uid() and p.role = 'receveur_bus')
  and exists (select 1 from public.bus_lines l where l.id = bus_line_id and l.actif)
);
drop policy if exists "bus_positions_update_receveur" on public.bus_positions;
create policy "bus_positions_update_receveur" on public.bus_positions for update to authenticated
  using (receveur_id = auth.uid()) with check (receveur_id = auth.uid());
drop policy if exists "bus_positions_delete_receveur" on public.bus_positions;
create policy "bus_positions_delete_receveur" on public.bus_positions for delete to authenticated using (receveur_id = auth.uid());

-- Une ligne ne peut être supprimée que par son créateur (déjà le cas) ; on autorise aussi sa suppression propre.
drop policy if exists "bus_lines_delete_own" on public.bus_lines;
create policy "bus_lines_delete_own" on public.bus_lines for delete to authenticated using (receveur_id = auth.uid());

-- bus_arrivals : une ligne par BUS (et non plus par ligne).
drop function if exists public.bus_arrivals(float8, float8, numeric);
create or replace function public.bus_arrivals(p_lat float8, p_lng float8, p_rayon_m numeric default null)
returns table (
  bus_id uuid, bus_line_id uuid, nom_ligne text, terminus_depart text, terminus_arrivee text,
  bus_lat float8, bus_lng float8, distance_m numeric, eta_minutes numeric,
  vitesse_kmh numeric, statut text, mise_a_jour timestamptz, bus_label text
)
language plpgsql stable security definer set search_path = public as $$
#variable_conflict use_column
declare
  v_me geography := ST_SetSRID(ST_MakePoint(p_lng, p_lat), 4326)::geography;
  v_rayon numeric := coalesce(p_rayon_m, public.cfg_num('bus_rayon_arret_m'));
  v_vdef numeric := public.cfg_num('bus_vitesse_defaut_kmh');
  v_age numeric := public.cfg_num('bus_position_max_age_s');
begin
  return query
  select x.* from (
    with base as (
      select bp.id as pid, bl.id as lid, bl.nom_ligne, bl.terminus_depart, bl.terminus_arrivee, bl.trajet_geom,
             bp.lat, bp.lng, bp.position_geom, bp.updated_at, bp.bus_label,
             greatest(coalesce(nullif(bp.vitesse_estimee, 0), v_vdef), 8)::numeric as v
        from public.bus_lines bl
        join public.bus_positions bp on bp.bus_line_id = bl.id
       where bl.actif and bp.updated_at > now() - make_interval(secs => v_age::float8)
    ),
    routed as (
      select b.*,
             ST_LineLocatePoint(b.trajet_geom::geometry, v_me::geometry) as fu,
             ST_LineLocatePoint(b.trajet_geom::geometry, b.position_geom::geometry) as fb,
             ST_Length(b.trajet_geom) as len
        from base b
       where b.trajet_geom is not null and ST_DWithin(b.trajet_geom, v_me, v_rayon::float8)
    )
    select r.pid as bus_id, r.lid as bus_line_id, r.nom_ligne, r.terminus_depart, r.terminus_arrivee,
           r.lat as bus_lat, r.lng as bus_lng,
           round((abs(r.fu - r.fb) * r.len)::numeric) as distance_m,
           case when r.fb <= r.fu
                then round(((abs(r.fu - r.fb) * r.len / 1000.0) / r.v::float8 * 60)::numeric, 1)
                else null::numeric end as eta_minutes,
           r.v as vitesse_kmh,
           (case when r.fb <= r.fu then 'approche' else 'passe' end)::text as statut,
           r.updated_at as mise_a_jour, r.bus_label
      from routed r
    union all
    select b.pid, b.lid, b.nom_ligne, b.terminus_depart, b.terminus_arrivee, b.lat, b.lng,
           round(ST_Distance(b.position_geom, v_me)::numeric),
           round(((ST_Distance(b.position_geom, v_me) / 1000.0) / b.v::float8 * 60)::numeric, 1),
           b.v, 'approx'::text, b.updated_at, b.bus_label
      from base b
     where b.trajet_geom is null and ST_DWithin(b.position_geom, v_me, 5000)
  ) x
  order by (x.statut = 'passe'), x.eta_minutes nulls last, x.distance_m;
end;
$$;

-- Bus « sur mon trajet » : lignes qui passent près du départ ET de l'arrivée, dans le bon sens.
-- Renvoie aussi la durée estimée du trajet à bord. Une ligne sans bus actif est renvoyée avec le statut « aucun_bus ».
create or replace function public.bus_trajet(
  p_from_lat float8, p_from_lng float8, p_to_lat float8, p_to_lng float8, p_rayon_m numeric default null
) returns table (
  bus_id uuid, bus_line_id uuid, nom_ligne text, terminus_depart text, terminus_arrivee text,
  bus_lat float8, bus_lng float8, distance_m numeric, eta_minutes numeric,
  duree_trajet_min numeric, distance_trajet_m numeric,
  vitesse_kmh numeric, statut text, mise_a_jour timestamptz, bus_label text
)
language plpgsql stable security definer set search_path = public as $$
#variable_conflict use_column
declare
  v_from geography := ST_SetSRID(ST_MakePoint(p_from_lng, p_from_lat), 4326)::geography;
  v_to geography := ST_SetSRID(ST_MakePoint(p_to_lng, p_to_lat), 4326)::geography;
  v_rayon numeric := coalesce(p_rayon_m, public.cfg_num('bus_rayon_arret_m'));
  v_vdef numeric := public.cfg_num('bus_vitesse_defaut_kmh');
  v_age numeric := public.cfg_num('bus_position_max_age_s');
begin
  return query
  select x.* from (
    with lignes as (
      select bl.id as lid, bl.nom_ligne, bl.terminus_depart, bl.terminus_arrivee, bl.trajet_geom,
             ST_LineLocatePoint(bl.trajet_geom::geometry, v_from::geometry) as fu,
             ST_LineLocatePoint(bl.trajet_geom::geometry, v_to::geometry) as fd,
             ST_Length(bl.trajet_geom) as len
        from public.bus_lines bl
       where bl.actif and bl.trajet_geom is not null
         and ST_DWithin(bl.trajet_geom, v_from, v_rayon::float8)
         and ST_DWithin(bl.trajet_geom, v_to, v_rayon::float8)
    ),
    bonnes as (select * from lignes where fu < fd),
    bus as (
      select b.*, bp.id as pid, bp.lat, bp.lng, bp.updated_at, bp.bus_label,
             greatest(coalesce(nullif(bp.vitesse_estimee, 0), v_vdef), 8)::numeric as v,
             ST_LineLocatePoint(b.trajet_geom::geometry, bp.position_geom::geometry) as fb
        from bonnes b
        left join public.bus_positions bp
          on bp.bus_line_id = b.lid and bp.updated_at > now() - make_interval(secs => v_age::float8)
    )
    select b.pid as bus_id, b.lid as bus_line_id, b.nom_ligne, b.terminus_depart, b.terminus_arrivee,
           b.lat as bus_lat, b.lng as bus_lng,
           case when b.pid is null then null::numeric else round((abs(b.fu - b.fb) * b.len)::numeric) end as distance_m,
           case when b.pid is not null and b.fb <= b.fu
                then round(((abs(b.fu - b.fb) * b.len / 1000.0) / b.v::float8 * 60)::numeric, 1)
                else null::numeric end as eta_minutes,
           round((((b.fd - b.fu) * b.len / 1000.0) / coalesce(b.v, v_vdef)::float8 * 60)::numeric, 1) as duree_trajet_min,
           round(((b.fd - b.fu) * b.len)::numeric) as distance_trajet_m,
           b.v as vitesse_kmh,
           (case when b.pid is null then 'aucun_bus' when b.fb <= b.fu then 'approche' else 'passe' end)::text as statut,
           b.updated_at as mise_a_jour, b.bus_label
      from bus b
  ) x
  order by (x.statut in ('passe', 'aucun_bus')), x.eta_minutes nulls last, x.distance_m nulls last;
end;
$$;

-- -----------------------------------------------------------------------------
-- 5. AVIS : livraisons et commerçants
-- -----------------------------------------------------------------------------
alter table public.reviews drop constraint if exists reviews_source_type_check;
alter table public.reviews add constraint reviews_source_type_check
  check (source_type in ('trip', 'ride', 'delivery', 'commerce'));

create or replace function public.noter(p_source_type text, p_source_id uuid, p_note smallint, p_commentaire text default null)
returns public.reviews
language plpgsql security definer set search_path = public as $$
declare
  v_dest uuid;
  v_ride public.ride_requests;
  v_trip public.trips;
  v_del public.delivery_orders;
  v_owner uuid;
  v_row public.reviews;
begin
  if auth.uid() is null then raise exception 'non_authentifie: connexion requise'; end if;
  if p_note is null or p_note < 1 or p_note > 5 then raise exception 'note_invalide: la note doit être entre 1 et 5'; end if;

  if p_source_type = 'ride' then
    select * into v_ride from public.ride_requests where id = p_source_id and statut = 'terminee';
    if v_ride.id is null then raise exception 'avis_impossible: course introuvable ou pas terminée'; end if;
    if auth.uid() = v_ride.client_id then v_dest := v_ride.driver_id;
    elsif auth.uid() = v_ride.driver_id then v_dest := v_ride.client_id;
    else raise exception 'acces_refuse: cette course ne vous concerne pas'; end if;

  elsif p_source_type = 'trip' then
    select * into v_trip from public.trips where id = p_source_id and statut = 'termine';
    if v_trip.id is null then raise exception 'avis_impossible: trajet introuvable ou pas terminé'; end if;
    if not exists (select 1 from public.reservations where trip_id = p_source_id and passager_id = auth.uid() and statut = 'confirmee') then
      raise exception 'acces_refuse: seuls les passagers confirmés peuvent noter ce trajet';
    end if;
    v_dest := v_trip.driver_id;

  elsif p_source_type in ('delivery', 'commerce') then
    select * into v_del from public.delivery_orders where id = p_source_id and statut = 'livree';
    if v_del.id is null then raise exception 'avis_impossible: livraison introuvable ou pas terminée'; end if;
    if p_source_type = 'delivery' then
      -- le client note le livreur ; le livreur note le client
      if auth.uid() = v_del.client_id then v_dest := v_del.chauffeur_id;
      elsif auth.uid() = v_del.chauffeur_id then v_dest := v_del.client_id;
      else raise exception 'acces_refuse: cette livraison ne vous concerne pas'; end if;
    else
      -- le client note le commerçant
      if auth.uid() <> v_del.client_id then raise exception 'acces_refuse: seul le client peut noter le commerçant'; end if;
      select owner_id into v_owner from public.merchants where id = v_del.merchant_id;
      if v_owner is null then raise exception 'avis_impossible: cette livraison n''a pas de commerçant'; end if;
      v_dest := v_owner;
    end if;
  else
    raise exception 'source_invalide: type d''avis inconnu';
  end if;

  insert into public.reviews (source_type, source_id, auteur_id, destinataire_id, note, commentaire)
  values (p_source_type, p_source_id, auth.uid(), v_dest, p_note, p_commentaire)
  returning * into v_row;

  perform set_config('app.bypass_protect', 'on', true);
  update public.profiles
     set note_moyenne = (select round(avg(note)::numeric, 1) from public.reviews where destinataire_id = v_dest)
   where id = v_dest;
  perform set_config('app.bypass_protect', 'off', true);

  return v_row;
exception when unique_violation then
  raise exception 'deja_note: vous avez déjà donné votre avis';
end;
$$;

-- Le chauffeur voit la note du client avant d'accepter.
drop function if exists public.pending_rides_nearby(float8, float8);
create or replace function public.pending_rides_nearby(p_lat float8, p_lng float8)
returns table (
  id uuid, categorie categorie_vehicule,
  depart_label text, arrivee_label text,
  depart_lat float8, depart_lng float8, arrivee_lat float8, arrivee_lng float8,
  distance_km numeric, tarif_base numeric, montant_offert numeric, prix_propose numeric,
  votre_tarif numeric, client_prenom text, distance_client_m numeric,
  rayon_courant_km numeric, expire_at timestamptz, created_at timestamptz,
  client_note numeric
)
language plpgsql stable security definer set search_path = public as $$
#variable_conflict use_column
declare
  v_pt geography := ST_SetSRID(ST_MakePoint(p_lng, p_lat), 4326)::geography;
  v_r0 numeric := public.cfg_num('rayon_initial_km');
  v_inc numeric := public.cfg_num('rayon_increment_km');
  v_delai numeric := public.cfg_num('delai_relance_secondes');
begin
  perform public.assert_actor(array['chauffeur']::role_utilisateur[]);

  return query
  select r.id, r.categorie, r.depart_label, r.arrivee_label,
         r.depart_lat, r.depart_lng, r.arrivee_lat, r.arrivee_lng,
         r.distance_km, r.tarif_base, r.montant_offert,
         coalesce(r.montant_offert, r.tarif_base),
         round(coalesce(dp.tarif_km_choisi, pc.tarif_km_base) * r.distance_km / 25) * 25,
         c.prenom,
         round(ST_Distance(r.depart_geom, v_pt))::numeric,
         v_r0 + floor(extract(epoch from (now() - r.created_at)) / v_delai) * v_inc,
         r.expire_at, r.created_at,
         c.note_moyenne
    from public.ride_requests r
    join public.profiles c on c.id = r.client_id
    join public.pricing_config pc on pc.categorie = r.categorie
    left join public.driver_pricing dp on dp.driver_id = auth.uid() and dp.categorie = r.categorie
   where r.statut = 'en_attente'
     and r.expire_at > now()
     and r.client_id <> auth.uid()
     and exists (select 1 from public.vehicles v where v.user_id = auth.uid() and v.categorie = r.categorie)
     and ST_DWithin(r.depart_geom, v_pt,
           (v_r0 + floor(extract(epoch from (now() - r.created_at)) / v_delai) * v_inc) * 1000)
   order by ST_Distance(r.depart_geom, v_pt) asc;
end;
$$;
revoke execute on function public.pending_rides_nearby(float8, float8) from anon;

-- -----------------------------------------------------------------------------
-- 6. LIVRAISON MARCHANDE : repli et expiration
-- -----------------------------------------------------------------------------
alter table public.delivery_orders
  add column if not exists merchants_ecartes   uuid[] not null default '{}',
  add column if not exists commerce_assigne_at timestamptz not null default now(),
  add column if not exists devis_expire_at     timestamptz,
  add column if not exists motif_annulation    text;

-- Déclencheur de notification des livraisons (après ajout des colonnes)
create or replace function public.trg_notif_delivery() returns trigger
language plpgsql security definer set search_path = public as $$
declare v_owner uuid; v_old_owner uuid;
begin
  select owner_id into v_owner from public.merchants where id = new.merchant_id;

  if tg_op = 'INSERT' then
    if new.merchant_id is not null then
      perform public._notifier(v_owner, 'commande_nouvelle', 'Nouvelle commande',
        public._prenom(new.client_id) || ' attend votre devis (' || new.type::text || ').', jsonb_build_object('delivery_id', new.id));
    end if;
    return new;
  end if;

  -- commande réattribuée à un autre commerçant
  if new.merchant_id is distinct from old.merchant_id and new.merchant_id is not null then
    perform public._notifier(v_owner, 'commande_nouvelle', 'Nouvelle commande',
      public._prenom(new.client_id) || ' attend votre devis (' || new.type::text || ').', jsonb_build_object('delivery_id', new.id));
    perform public._notifier(new.client_id, 'commande_reattribuee', 'Commande transmise à un autre partenaire',
      new.collecte_label || ' va établir votre devis.', jsonb_build_object('delivery_id', new.id));
  end if;

  if new.statut is distinct from old.statut then
    if new.statut = 'devis_envoye' then
      perform public._notifier(new.client_id, 'devis_recu', 'Devis reçu',
        new.collecte_label || ' vous a envoyé un devis. Validez-le pour lancer la livraison.', jsonb_build_object('delivery_id', new.id));
    elsif new.statut = 'approuvee' and old.statut = 'devis_envoye' then
      perform public._notifier(v_owner, 'devis_valide', 'Devis validé', 'Préparez la commande : un livreur va passer la récupérer.', jsonb_build_object('delivery_id', new.id));
    elsif new.statut = 'en_livraison' then
      perform public._notifier(new.client_id, 'livraison_en_route', 'Livreur en route', public._prenom(new.chauffeur_id) || ' a pris en charge votre commande.', jsonb_build_object('delivery_id', new.id));
      perform public._notifier(v_owner, 'livreur_arrive', 'Livreur en route', 'Un livreur vient récupérer la commande.', jsonb_build_object('delivery_id', new.id));
    elsif new.statut = 'livree' then
      perform public._notifier(new.client_id, 'livraison_terminee', 'Commande livrée', 'Vous pouvez noter le livreur et le partenaire.', jsonb_build_object('delivery_id', new.id));
      perform public._notifier(v_owner, 'livraison_terminee', 'Commande livrée', 'La commande a bien été remise au client.', jsonb_build_object('delivery_id', new.id));
    elsif new.statut = 'annulee' and old.statut <> 'annulee' then
      if auth.uid() = new.client_id then
        perform public._notifier(v_owner, 'commande_annulee', 'Commande annulée', 'Le client a annulé sa commande.', jsonb_build_object('delivery_id', new.id));
      else
        perform public._notifier(new.client_id, 'commande_annulee', 'Commande annulée', coalesce(new.motif_annulation, 'Votre commande a été annulée.'), jsonb_build_object('delivery_id', new.id));
      end if;
      if old.chauffeur_id is not null then
        perform public._notifier(old.chauffeur_id, 'commande_annulee', 'Livraison annulée', 'La commande a été annulée.', jsonb_build_object('delivery_id', new.id));
      end if;
    end if;
  end if;
  return new;
end;
$$;
drop trigger if exists notif_delivery on public.delivery_orders;
create trigger notif_delivery after insert or update on public.delivery_orders for each row execute function public.trg_notif_delivery();

-- Transmet la commande au commerçant le plus proche qui ne l'a pas déjà écartée,
-- ou l'annule si personne n'est disponible. Usage interne.
create or replace function public._reassigner_commande(p_id uuid, p_motif_si_aucun text)
returns void language plpgsql security definer set search_path = public as $$
declare
  v_d public.delivery_orders;
  v_m public.merchants;
  v_type type_commerce;
begin
  select * into v_d from public.delivery_orders where id = p_id for update;
  if v_d.id is null then return; end if;
  v_type := case v_d.type when 'pharmacie' then 'pharmacie' when 'repas' then 'restaurant' else 'marche' end;

  select m.* into v_m
    from public.merchants m
   where m.type = v_type
     and m.id <> all (v_d.merchants_ecartes || coalesce(v_d.merchant_id, '00000000-0000-0000-0000-000000000000'::uuid))
     and (m.statut_verif = 'verifie' or not public.cfg_bool('verification_requise'))
   order by m.location_geom <-> ST_SetSRID(ST_MakePoint(v_d.livraison_lng, v_d.livraison_lat), 4326)::geography
   limit 1;

  if v_m.id is null then
    update public.delivery_orders
       set statut = 'annulee', motif_annulation = p_motif_si_aucun,
           merchants_ecartes = merchants_ecartes || coalesce(v_d.merchant_id, '00000000-0000-0000-0000-000000000000'::uuid)
     where id = p_id;
  else
    update public.delivery_orders
       set merchants_ecartes = merchants_ecartes || v_d.merchant_id,
           merchant_id = v_m.id, collecte_label = v_m.nom_commerce, collecte_lat = v_m.lat, collecte_lng = v_m.lng,
           statut = 'en_attente_devis', commerce_assigne_at = now(),
           devis_lignes = null, montant_produits = null, montant_livraison = null, devis_note = null, devis_expire_at = null
     where id = p_id;
  end if;
end;
$$;
revoke all on function public._reassigner_commande(uuid, text) from public, anon, authenticated;

create or replace function public.refuser_commande(p_delivery_id uuid)
returns public.delivery_orders
language plpgsql security definer set search_path = public as $$
declare v_row public.delivery_orders;
begin
  perform public.assert_actor(array['commercant']::role_utilisateur[]);
  select d.* into v_row from public.delivery_orders d
   where d.id = p_delivery_id and d.statut in ('en_attente_devis', 'devis_envoye')
     and exists (select 1 from public.merchants m where m.id = d.merchant_id and m.owner_id = auth.uid());
  if v_row.id is null then raise exception 'commande_introuvable: commande introuvable ou déjà traitée'; end if;

  perform public._reassigner_commande(p_delivery_id, 'Aucun partenaire disponible pour cette commande.');
  select * into v_row from public.delivery_orders where id = p_delivery_id;
  return v_row;
end;
$$;

create or replace function public.envoyer_devis(
  p_delivery_id uuid, p_lignes jsonb, p_montant_livraison numeric, p_note text default null
) returns public.delivery_orders
language plpgsql security definer set search_path = public as $$
declare
  v_total numeric;
  v_row public.delivery_orders;
begin
  perform public.assert_actor(array['commercant']::role_utilisateur[]);

  if p_lignes is null or jsonb_typeof(p_lignes) <> 'array' or jsonb_array_length(p_lignes) = 0 then
    raise exception 'devis_vide: ajoutez au moins une ligne au devis';
  end if;
  if exists (select 1 from jsonb_array_elements(p_lignes) e
              where coalesce(trim(e ->> 'libelle'), '') = '' or coalesce((e ->> 'prix')::numeric, -1) < 0) then
    raise exception 'devis_invalide: chaque ligne doit avoir un libellé et un prix positif';
  end if;
  if p_montant_livraison is null or p_montant_livraison < 0 then
    raise exception 'livraison_invalide: indiquez le prix de la livraison';
  end if;

  select coalesce(sum((e ->> 'prix')::numeric), 0) into v_total from jsonb_array_elements(p_lignes) e;
  if v_total <= 0 then raise exception 'devis_invalide: le total des produits doit être supérieur à 0'; end if;

  update public.delivery_orders d
     set devis_lignes = p_lignes, montant_produits = v_total, montant_livraison = p_montant_livraison, devis_note = p_note,
         statut = 'devis_envoye',
         devis_expire_at = now() + make_interval(mins => public.cfg_num('devis_validite_min')::int)
   where d.id = p_delivery_id
     and d.statut in ('en_attente_devis', 'devis_envoye')
     and exists (select 1 from public.merchants m where m.id = d.merchant_id and m.owner_id = auth.uid())
   returning * into v_row;

  if not found then raise exception 'commande_introuvable: commande introuvable ou déjà traitée'; end if;
  return v_row;
end;
$$;

create or replace function public.annuler_livraison(p_delivery_id uuid)
returns public.delivery_orders
language plpgsql security definer set search_path = public as $$
declare v_row public.delivery_orders;
begin
  if auth.uid() is null then raise exception 'non_authentifie: connexion requise'; end if;
  update public.delivery_orders set statut = 'annulee', motif_annulation = 'Annulée par le client'
   where id = p_delivery_id and client_id = auth.uid()
     and statut in ('en_attente_devis', 'devis_envoye', 'approuvee')
   returning * into v_row;
  if not found then raise exception 'annulation_impossible: commande introuvable ou déjà prise en charge'; end if;
  return v_row;
end;
$$;

-- À appeler régulièrement (par le site pendant l'usage, et idéalement par pg_cron) :
--   select cron.schedule('yobba-expirations', '* * * * *', $$select public.expire_stale_rides(); select public.expire_stale_deliveries();$$);
create or replace function public.expire_stale_deliveries()
returns integer language plpgsql security definer set search_path = public as $$
declare
  r record;
  n integer := 0;
  v_delai numeric := public.cfg_num('devis_reponse_delai_s');
begin
  -- commerçant qui ne répond pas : on passe au suivant
  for r in select id from public.delivery_orders
            where statut = 'en_attente_devis' and merchant_id is not null
              and commerce_assigne_at + make_interval(secs => v_delai::float8) < now()
  loop
    perform public._reassigner_commande(r.id, 'Aucun partenaire n''a répondu à votre commande.');
    n := n + 1;
  end loop;
  -- devis non validé à temps
  update public.delivery_orders set statut = 'annulee', motif_annulation = 'Le devis a expiré sans validation.'
   where statut = 'devis_envoye' and devis_expire_at is not null and devis_expire_at < now();
  return n;
end;
$$;

-- -----------------------------------------------------------------------------
-- 7. MODIFICATION D'UN TRAJET PUBLIÉ
-- -----------------------------------------------------------------------------
-- Prix et date : modifiables tant qu'aucun passager n'a de réservation active.
-- Nombre total de places : modifiable à tout moment, sans descendre sous les places déjà confirmées.
create or replace function public.modifier_trajet(
  p_trip_id uuid, p_prix numeric, p_date timestamptz, p_places_total smallint
) returns public.trips
language plpgsql security definer set search_path = public as $$
declare
  v_trip public.trips;
  v_actives integer;
  v_confirmees integer;
  v_dispo integer;
begin
  perform public.assert_actor(array['chauffeur']::role_utilisateur[]);
  select * into v_trip from public.trips where id = p_trip_id and driver_id = auth.uid() for update;
  if v_trip.id is null then raise exception 'trajet_introuvable: trajet introuvable'; end if;
  if v_trip.statut not in ('ouvert', 'complet') then raise exception 'modification_impossible: ce trajet est clos'; end if;

  select count(*) filter (where statut <> 'annulee'), coalesce(sum(nb_places) filter (where statut = 'confirmee'), 0)
    into v_actives, v_confirmees from public.reservations where trip_id = p_trip_id;

  if (p_prix is distinct from v_trip.prix_place or p_date is distinct from v_trip.date_heure_depart) and v_actives > 0 then
    raise exception 'modification_impossible: le prix et la date ne peuvent plus changer car des passagers ont réservé. Annulez le trajet pour le republier.';
  end if;
  if p_prix < 500 then raise exception 'prix_invalide: le prix minimum est de 500 FCFA'; end if;
  if p_date <= now() then raise exception 'date_passee: la date de départ doit être dans le futur'; end if;
  if p_places_total < 1 or p_places_total > 8 then raise exception 'places_invalides: entre 1 et 8 places'; end if;
  if p_places_total < v_confirmees then
    raise exception 'places_invalides: % place(s) sont déjà confirmées', v_confirmees;
  end if;

  v_dispo := p_places_total - v_confirmees;
  update public.trips
     set prix_place = p_prix, date_heure_depart = p_date, places_dispo = v_dispo,
         statut = case when v_dispo = 0 then 'complet'::statut_trip else 'ouvert'::statut_trip end
   where id = p_trip_id returning * into v_trip;
  return v_trip;
end;
$$;

-- -----------------------------------------------------------------------------
-- 8. ADMINISTRATION
-- -----------------------------------------------------------------------------
create or replace function public.admin_set_verification(p_user uuid, p_statut statut_verif)
returns public.profiles language plpgsql security definer set search_path = public as $$
declare v public.profiles;
begin
  perform public.assert_admin();
  perform set_config('app.bypass_protect', 'on', true);
  update public.profiles set statut_verif = p_statut where id = p_user returning * into v;
  perform set_config('app.bypass_protect', 'off', true);
  if v.id is null then raise exception 'utilisateur_introuvable: compte introuvable'; end if;
  return v;
end;
$$;

-- La protection des colonnes d'un commerce (05) doit laisser passer les fonctions d'administration.
create or replace function public.merchants_protect_columns()
returns trigger language plpgsql as $$
begin
  if auth.uid() is not null and coalesce(current_setting('app.bypass_protect', true), '') <> 'on' then
    if tg_op = 'INSERT' then
      new.statut_verif := 'en_attente';
    else
      new.statut_verif := old.statut_verif;
      new.owner_id := old.owner_id;
    end if;
  end if;
  return new;
end;
$$;

create or replace function public.admin_set_merchant_verification(p_merchant uuid, p_statut statut_verif)
returns public.merchants language plpgsql security definer set search_path = public as $$
declare v public.merchants;
begin
  perform public.assert_admin();
  perform set_config('app.bypass_protect', 'on', true);
  update public.merchants set statut_verif = p_statut where id = p_merchant returning * into v;
  perform set_config('app.bypass_protect', 'off', true);
  if v.id is null then raise exception 'commerce_introuvable: commerce introuvable'; end if;
  return v;
end;
$$;

create or replace function public.admin_regler_dette(p_ledger_id uuid)
returns public.driver_ledger language plpgsql security definer set search_path = public as $$
declare v public.driver_ledger;
begin
  perform public.assert_admin();
  update public.driver_ledger set regle = true, regle_type = 'manuel', regle_at = now()
   where id = p_ledger_id and regle = false returning * into v;
  if v.id is null then raise exception 'dette_introuvable: dette déjà réglée ou introuvable'; end if;
  return v;
end;
$$;

create or replace function public.admin_set_config(p_cle text, p_valeur text)
returns public.app_config language plpgsql security definer set search_path = public as $$
declare v public.app_config;
begin
  perform public.assert_admin();
  if p_valeur is null or trim(p_valeur) = '' then raise exception 'valeur_invalide: la valeur ne peut pas être vide'; end if;
  update public.app_config set valeur = trim(p_valeur) where cle = p_cle returning * into v;
  if v.cle is null then raise exception 'parametre_inconnu: ce paramètre n''existe pas'; end if;
  return v;
end;
$$;

create or replace function public.admin_set_pricing(p_categorie categorie_vehicule, p_min numeric, p_max numeric, p_base numeric)
returns public.pricing_config language plpgsql security definer set search_path = public as $$
declare v public.pricing_config;
begin
  perform public.assert_admin();
  if not (p_min > 0 and p_min <= p_base and p_base <= p_max) then
    raise exception 'tarif_invalide: il faut 0 < minimum <= base <= maximum';
  end if;
  update public.pricing_config set tarif_km_min = p_min, tarif_km_max = p_max, tarif_km_base = p_base
   where categorie = p_categorie returning * into v;
  if v.categorie is null then raise exception 'categorie_inconnue: catégorie sans tarif'; end if;
  return v;
end;
$$;

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
    'chauffeurs_bloques', (select count(distinct driver_id) from public.driver_ledger where regle = false)
  ) into v;
  return v;
end;
$$;

-- -----------------------------------------------------------------------------
-- 9. TEMPS RÉEL + DROITS
-- -----------------------------------------------------------------------------
do $$
declare t text;
begin
  foreach t in array array['notifications', 'driver_locations']
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
    'is_admin()', 'assert_admin()', 'notifications_marquer_lues(uuid[])',
    'modifier_trajet(uuid,numeric,timestamptz,smallint)',
    'admin_set_verification(uuid,statut_verif)', 'admin_set_merchant_verification(uuid,statut_verif)',
    'admin_regler_dette(uuid)', 'admin_set_config(text,text)',
    'admin_set_pricing(categorie_vehicule,numeric,numeric,numeric)', 'admin_stats()'
  ] loop
    execute format('revoke execute on function public.%s from anon', f);
  end loop;
end $$;
