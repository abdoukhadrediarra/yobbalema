-- =============================================================================
-- YOBBALEMA — Bus TATA, commerçants et livraison
-- Exécuter après 02_schema_rides_payments.sql
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1. BUS TATA (mode « receveur » intégré à l'app principale)
-- -----------------------------------------------------------------------------
create table if not exists public.bus_lines (
  id            uuid primary key default gen_random_uuid(),
  receveur_id   uuid not null references public.profiles (id) on delete cascade,
  nom_ligne     text not null,
  actif         boolean not null default true,
  created_at    timestamptz not null default now()
);

create index if not exists bus_lines_receveur_idx on public.bus_lines (receveur_id);

create table if not exists public.bus_positions (
  id                uuid primary key default gen_random_uuid(),
  bus_line_id       uuid not null references public.bus_lines (id) on delete cascade,
  lat               double precision not null,
  lng               double precision not null,
  position_geom     geography(point, 4326),
  vitesse_estimee   numeric(5, 2),          -- km/h, pour le calcul d'ETA distance/vitesse
  updated_at        timestamptz not null default now()
);

create or replace function public.bus_positions_set_geom()
returns trigger language plpgsql as $$
begin
  new.position_geom := ST_SetSRID(ST_MakePoint(new.lng, new.lat), 4326)::geography;
  new.updated_at := now();
  return new;
end;
$$;

drop trigger if exists bus_positions_geom_trigger on public.bus_positions;
create trigger bus_positions_geom_trigger
  before insert or update of lat, lng
  on public.bus_positions
  for each row execute function public.bus_positions_set_geom();

create index if not exists bus_positions_geom_idx on public.bus_positions using gist (position_geom);
create index if not exists bus_positions_line_idx on public.bus_positions (bus_line_id);

-- Une seule position "courante" par ligne : on upsert plutôt que d'accumuler
-- un historique (le document de référence ne demande pas d'historique).
create unique index if not exists bus_positions_one_per_line on public.bus_positions (bus_line_id);

-- Fonction utilitaire : bus les plus proches d'un point donné (rayon en km).
create or replace function public.bus_positions_proches(
  p_lat double precision,
  p_lng double precision,
  p_rayon_km double precision default 2
)
returns table (
  bus_line_id uuid,
  nom_ligne text,
  lat double precision,
  lng double precision,
  vitesse_estimee numeric,
  distance_m double precision,
  updated_at timestamptz
)
language sql
stable
as $$
  select bl.id, bl.nom_ligne, bp.lat, bp.lng, bp.vitesse_estimee,
         ST_Distance(bp.position_geom, ST_SetSRID(ST_MakePoint(p_lng, p_lat), 4326)::geography) as distance_m,
         bp.updated_at
  from public.bus_positions bp
  join public.bus_lines bl on bl.id = bp.bus_line_id and bl.actif
  where ST_DWithin(bp.position_geom, ST_SetSRID(ST_MakePoint(p_lng, p_lat), 4326)::geography, p_rayon_km * 1000)
  order by distance_m asc;
$$;

-- -----------------------------------------------------------------------------
-- 2. COMMERÇANTS PARTENAIRES
-- -----------------------------------------------------------------------------
create table if not exists public.merchants (
  id             uuid primary key default gen_random_uuid(),
  owner_id       uuid not null references public.profiles (id) on delete cascade,
  type           type_commerce not null,
  nom_commerce   text not null,
  lat            double precision not null,
  lng            double precision not null,
  location_geom  geography(point, 4326),
  statut_verif   statut_verif not null default 'en_attente',
  created_at     timestamptz not null default now()
);

create or replace function public.merchants_set_geom()
returns trigger language plpgsql as $$
begin
  new.location_geom := ST_SetSRID(ST_MakePoint(new.lng, new.lat), 4326)::geography;
  return new;
end;
$$;

drop trigger if exists merchants_geom_trigger on public.merchants;
create trigger merchants_geom_trigger
  before insert or update of lat, lng
  on public.merchants
  for each row execute function public.merchants_set_geom();

create index if not exists merchants_geom_idx on public.merchants using gist (location_geom);

-- Commerçant le plus proche d'un point donné, pour un type donné (ex: pharmacie).
create or replace function public.merchant_le_plus_proche(
  p_lat double precision,
  p_lng double precision,
  p_type type_commerce
)
returns public.merchants
language sql
stable
as $$
  select m.*
  from public.merchants m
  where m.type = p_type and m.statut_verif = 'verifie'
  order by m.location_geom <-> ST_SetSRID(ST_MakePoint(p_lng, p_lat), 4326)::geography
  limit 1;
$$;

-- -----------------------------------------------------------------------------
-- 3. LIVRAISON (colis simple + livraison marchande avec devis)
-- -----------------------------------------------------------------------------
create table if not exists public.delivery_orders (
  id                     uuid primary key default gen_random_uuid(),
  client_id              uuid not null references public.profiles (id) on delete cascade,
  type                   type_livraison not null,
  merchant_id            uuid references public.merchants (id),
  photo_ordonnance_url   text,
  collecte_label         text not null,
  collecte_lat           double precision not null,
  collecte_lng           double precision not null,
  collecte_geom          geography(point, 4326),
  livraison_label        text not null,
  livraison_lat          double precision not null,
  livraison_lng          double precision not null,
  livraison_geom         geography(point, 4326),
  montant_produits       numeric(10, 2),      -- rempli par le commerçant (devis)
  montant_livraison      numeric(10, 2),
  chauffeur_id           uuid references public.profiles (id),
  statut                 statut_livraison not null default 'en_attente_devis',
  created_at             timestamptz not null default now()
);

create or replace function public.delivery_orders_set_geom()
returns trigger language plpgsql as $$
begin
  new.collecte_geom := ST_SetSRID(ST_MakePoint(new.collecte_lng, new.collecte_lat), 4326)::geography;
  new.livraison_geom := ST_SetSRID(ST_MakePoint(new.livraison_lng, new.livraison_lat), 4326)::geography;
  return new;
end;
$$;

drop trigger if exists delivery_orders_geom_trigger on public.delivery_orders;
create trigger delivery_orders_geom_trigger
  before insert or update of collecte_lat, collecte_lng, livraison_lat, livraison_lng
  on public.delivery_orders
  for each row execute function public.delivery_orders_set_geom();

create index if not exists delivery_orders_collecte_geom_idx on public.delivery_orders using gist (collecte_geom);
create index if not exists delivery_orders_statut_idx on public.delivery_orders (statut);
create index if not exists delivery_orders_client_idx on public.delivery_orders (client_id);
create index if not exists delivery_orders_chauffeur_idx on public.delivery_orders (chauffeur_id);

comment on column public.delivery_orders.type is
  'colis/repas : livraison simple, prix basé sur la distance (pas de devis).
   pharmacie/marche : livraison marchande — merchant_id renseigné, montant_produits
   rempli par le commerçant après examen de la commande/ordonnance (cf. Figure 6).';

-- Livraison simple (colis) : pas de commerçant, donc pas d'étape de devis.
create or replace function public.delivery_orders_default_statut()
returns trigger language plpgsql as $$
begin
  if new.merchant_id is null and new.statut = 'en_attente_devis' then
    new.statut := 'approuvee'; -- passe directement à la recherche d'un livreur
  end if;
  return new;
end;
$$;

drop trigger if exists delivery_orders_statut_trigger on public.delivery_orders;
create trigger delivery_orders_statut_trigger
  before insert on public.delivery_orders
  for each row execute function public.delivery_orders_default_statut();

-- Acceptation atomique d'une livraison par un livreur (même principe que le waxalé).
create or replace function public.accept_delivery_order(p_delivery_id uuid)
returns public.delivery_orders
language plpgsql
security definer
set search_path = public
as $$
declare
  v_driver_id uuid := auth.uid();
  v_role role_utilisateur;
  v_row public.delivery_orders;
begin
  select role into v_role from public.profiles where id = v_driver_id;
  if v_role is distinct from 'chauffeur' then
    raise exception 'acces_refuse: seul un chauffeur/livreur peut valider une livraison';
  end if;

  if public.has_unpaid_debt(v_driver_id) then
    raise exception 'compte_bloque: dette de commission impayée sur une course précédente';
  end if;

  update public.delivery_orders
     set statut = 'en_livraison', chauffeur_id = v_driver_id
   where id = p_delivery_id and statut = 'approuvee'
   returning * into v_row;

  if not found then
    raise exception 'livraison_indisponible: déjà prise en charge ou pas encore approuvée';
  end if;

  return v_row;
end;
$$;

-- -----------------------------------------------------------------------------
-- 4. AVIS
-- -----------------------------------------------------------------------------
create table if not exists public.reviews (
  id           uuid primary key default gen_random_uuid(),
  source_type  text not null check (source_type in ('trip', 'ride')),
  source_id    uuid not null,
  auteur_id    uuid not null references public.profiles (id) on delete cascade,
  note         smallint not null check (note between 1 and 5),
  commentaire  text,
  created_at   timestamptz not null default now()
);

create index if not exists reviews_source_idx on public.reviews (source_type, source_id);
