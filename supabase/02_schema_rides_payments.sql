-- =============================================================================
-- YOBBALEMA — Trajets, réservations, courses à la demande, paiements
-- Exécuter après 01_schema_core.sql
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1. TRAJETS INTERURBAINS
-- -----------------------------------------------------------------------------
create table if not exists public.trips (
  id                  uuid primary key default gen_random_uuid(),
  driver_id           uuid not null references public.profiles (id) on delete cascade,
  vehicle_id          uuid not null references public.vehicles (id) on delete restrict,
  depart_label        text not null,
  arrivee_label       text not null,
  depart_lat          double precision not null,
  depart_lng          double precision not null,
  arrivee_lat         double precision not null,
  arrivee_lng         double precision not null,
  depart_geom         geography(point, 4326),
  arrivee_geom        geography(point, 4326),
  date_heure_depart   timestamptz not null,
  places_dispo        smallint not null check (places_dispo >= 0),
  prix_place          numeric(10, 2) not null check (prix_place > 0),
  statut              statut_trip not null default 'ouvert',
  created_at          timestamptz not null default now()
);

create or replace function public.trips_set_geom()
returns trigger language plpgsql as $$
begin
  new.depart_geom := ST_SetSRID(ST_MakePoint(new.depart_lng, new.depart_lat), 4326)::geography;
  new.arrivee_geom := ST_SetSRID(ST_MakePoint(new.arrivee_lng, new.arrivee_lat), 4326)::geography;
  return new;
end;
$$;

drop trigger if exists trips_geom_trigger on public.trips;
create trigger trips_geom_trigger
  before insert or update of depart_lat, depart_lng, arrivee_lat, arrivee_lng
  on public.trips
  for each row execute function public.trips_set_geom();

create index if not exists trips_depart_geom_idx on public.trips using gist (depart_geom);
create index if not exists trips_driver_id_idx on public.trips (driver_id);
create index if not exists trips_statut_idx on public.trips (statut);

-- -----------------------------------------------------------------------------
-- 2. RÉSERVATIONS (trajets interurbains)
-- -----------------------------------------------------------------------------
create table if not exists public.reservations (
  id           uuid primary key default gen_random_uuid(),
  trip_id      uuid not null references public.trips (id) on delete cascade,
  passager_id  uuid not null references public.profiles (id) on delete cascade,
  nb_places    smallint not null check (nb_places > 0),
  statut       statut_reservation not null default 'en_attente',
  created_at   timestamptz not null default now()
);

create index if not exists reservations_trip_id_idx on public.reservations (trip_id);
create index if not exists reservations_passager_id_idx on public.reservations (passager_id);

-- Décrémente les places disponibles à la confirmation d'une réservation.
create or replace function public.reservations_decrement_places()
returns trigger language plpgsql as $$
begin
  if new.statut = 'confirmee' and (tg_op = 'INSERT' or old.statut <> 'confirmee') then
    update public.trips
       set places_dispo = places_dispo - new.nb_places,
           statut = case when places_dispo - new.nb_places <= 0 then 'complet' else statut end
     where id = new.trip_id and places_dispo >= new.nb_places;

    if not found then
      raise exception 'places_insuffisantes: plus assez de places disponibles sur ce trajet';
    end if;
  end if;
  return new;
end;
$$;

drop trigger if exists reservations_decrement_trigger on public.reservations;
create trigger reservations_decrement_trigger
  before insert or update on public.reservations
  for each row execute function public.reservations_decrement_places();

-- -----------------------------------------------------------------------------
-- 3. COURSES À LA DEMANDE (VTC + waxalé)
-- -----------------------------------------------------------------------------
create table if not exists public.ride_requests (
  id                uuid primary key default gen_random_uuid(),
  client_id         uuid not null references public.profiles (id) on delete cascade,
  categorie         categorie_vehicule not null,
  depart_label      text not null,
  arrivee_label     text not null,
  depart_lat        double precision not null,
  depart_lng        double precision not null,
  arrivee_lat       double precision not null,
  arrivee_lng       double precision not null,
  depart_geom       geography(point, 4326),
  arrivee_geom      geography(point, 4326),
  distance_km       numeric(6, 2) not null,
  tarif_base        numeric(10, 2) not null,
  montant_offert    numeric(10, 2),              -- rempli si le client propose son prix (waxalé)
  rayon_km          numeric(4, 2) not null default 0.5,
  statut            statut_ride not null default 'en_attente',
  driver_id         uuid references public.profiles (id),
  created_at        timestamptz not null default now(),
  derniere_relance  timestamptz not null default now(),
  expire_at         timestamptz not null default (now() + interval '2 minutes')
);

create or replace function public.ride_requests_set_geom()
returns trigger language plpgsql as $$
begin
  new.depart_geom := ST_SetSRID(ST_MakePoint(new.depart_lng, new.depart_lat), 4326)::geography;
  new.arrivee_geom := ST_SetSRID(ST_MakePoint(new.arrivee_lng, new.arrivee_lat), 4326)::geography;
  return new;
end;
$$;

drop trigger if exists ride_requests_geom_trigger on public.ride_requests;
create trigger ride_requests_geom_trigger
  before insert or update of depart_lat, depart_lng, arrivee_lat, arrivee_lng
  on public.ride_requests
  for each row execute function public.ride_requests_set_geom();

create index if not exists ride_requests_depart_geom_idx on public.ride_requests using gist (depart_geom);
create index if not exists ride_requests_statut_idx on public.ride_requests (statut);
create index if not exists ride_requests_client_id_idx on public.ride_requests (client_id);
create index if not exists ride_requests_driver_id_idx on public.ride_requests (driver_id);

comment on column public.ride_requests.rayon_km is
  'Rayon de diffusion courant ; élargi de rayon_increment_km (app_config) toutes les
   delai_relance_secondes tant que statut = en_attente (logique portée côté application
   ou Edge Function planifiée, cf. section 5.2 du document de référence).';

-- -----------------------------------------------------------------------------
-- 4. PAIEMENTS
-- -----------------------------------------------------------------------------
create table if not exists public.payments (
  id                  uuid primary key default gen_random_uuid(),
  source_type         source_paiement not null,
  source_id           uuid not null,
  categorie_montant   categorie_montant not null default 'trajet',
  payeur_id           uuid references public.profiles (id),
  beneficiaire_id     uuid references public.profiles (id),
  moyen               moyen_paiement not null,
  montant             numeric(10, 2) not null check (montant >= 0),
  commission_pct      numeric(4, 2) not null default 5,
  statut_transaction  text not null default 'confirme',
  reference_externe   text,
  created_at          timestamptz not null default now()
);

create index if not exists payments_source_idx on public.payments (source_type, source_id);
create index if not exists payments_beneficiaire_idx on public.payments (beneficiaire_id);
create index if not exists payments_payeur_idx on public.payments (payeur_id);

-- -----------------------------------------------------------------------------
-- 5. REGISTRE DE DETTE DE COMMISSION (driver_ledger)
-- -----------------------------------------------------------------------------
-- Règle confirmée : UNE SEULE course payée en espèces avec commission non réglée
-- (regle = false) suffit à bloquer le chauffeur pour toute nouvelle course, quel
-- que soit le module (interurbain, à la demande, livraison). Voir has_unpaid_debt().
create table if not exists public.driver_ledger (
  id           uuid primary key default gen_random_uuid(),
  driver_id    uuid not null references public.profiles (id) on delete cascade,
  payment_id   uuid references public.payments (id),
  montant      numeric(10, 2) not null,
  regle        boolean not null default false,
  regle_type   text check (regle_type in ('auto', 'manuel')),
  regle_at     timestamptz,
  created_at   timestamptz not null default now()
);

create index if not exists driver_ledger_driver_id_idx on public.driver_ledger (driver_id);
create index if not exists driver_ledger_impaye_idx on public.driver_ledger (driver_id) where regle = false;

-- Un paiement en espèces à un chauffeur crée automatiquement la dette de 5 %.
-- (Les commerçants — merchants — ne sont jamais concernés : ils sont réglés par
-- la plateforme séparément, cf. section 5.4 du document de référence.)
create or replace function public.payments_creer_dette_especes()
returns trigger language plpgsql as $$
declare
  v_role role_utilisateur;
begin
  if new.moyen = 'especes' and new.beneficiaire_id is not null then
    select role into v_role from public.profiles where id = new.beneficiaire_id;

    if v_role = 'chauffeur' then
      insert into public.driver_ledger (driver_id, payment_id, montant)
      values (new.beneficiaire_id, new.id, round(new.montant * new.commission_pct / 100, 2));
    end if;
  end if;
  return new;
end;
$$;

drop trigger if exists payments_ledger_trigger on public.payments;
create trigger payments_ledger_trigger
  after insert on public.payments
  for each row execute function public.payments_creer_dette_especes();

-- Vérifie si un chauffeur a une dette impayée (bloque l'attribution de courses).
create or replace function public.has_unpaid_debt(p_driver_id uuid)
returns boolean
language sql
stable
as $$
  select exists (
    select 1 from public.driver_ledger
    where driver_id = p_driver_id and regle = false
  );
$$;

-- Règlement manuel d'une dette par le chauffeur (à appeler depuis une Edge
-- Function, après confirmation réelle du virement Wave/Orange Money — jamais
-- directement depuis le client, d'où security definer + vérification interne).
create or replace function public.regler_dette_manuelle(p_ledger_id uuid)
returns public.driver_ledger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_row public.driver_ledger;
begin
  update public.driver_ledger
     set regle = true, regle_type = 'manuel', regle_at = now()
   where id = p_ledger_id and driver_id = auth.uid() and regle = false
   returning * into v_row;

  if not found then
    raise exception 'dette_introuvable: dette déjà réglée ou introuvable';
  end if;

  return v_row;
end;
$$;

-- -----------------------------------------------------------------------------
-- 6. FONCTIONS D'ACCEPTATION ATOMIQUE (waxalé)
-- -----------------------------------------------------------------------------
-- Verrou atomique : la clause WHERE statut = 'en_attente' garantit qu'un seul
-- appel concurrent peut réussir, même si plusieurs chauffeurs valident en même
-- temps (cf. Figure 5 du document de référence).
create or replace function public.accept_ride_request(p_ride_id uuid)
returns public.ride_requests
language plpgsql
security definer
set search_path = public
as $$
declare
  v_driver_id uuid := auth.uid();
  v_role role_utilisateur;
  v_row public.ride_requests;
begin
  select role into v_role from public.profiles where id = v_driver_id;
  if v_role is distinct from 'chauffeur' then
    raise exception 'acces_refuse: seul un chauffeur peut valider une course';
  end if;

  if public.has_unpaid_debt(v_driver_id) then
    raise exception 'compte_bloque: dette de commission impayée sur une course précédente';
  end if;

  update public.ride_requests
     set statut = 'assignee', driver_id = v_driver_id
   where id = p_ride_id and statut = 'en_attente' and expire_at > now()
   returning * into v_row;

  if not found then
    raise exception 'course_indisponible: déjà assignée, annulée ou expirée';
  end if;

  return v_row;
end;
$$;

comment on function public.accept_ride_request is
  'Appelée par le client Flutter/Angular via supabase.rpc(''accept_ride_request'', {p_ride_id}).
   Un seul chauffeur peut réussir même en cas de validation simultanée.';
