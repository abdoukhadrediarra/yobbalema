-- =============================================================================
-- YOBBALEMA — Row Level Security
-- Exécuter après 03_schema_bus_delivery.sql
-- =============================================================================
-- Principe général : lecture assez ouverte (nécessaire pour la recherche de
-- trajets/chauffeurs/commerçants proches), écriture strictement limitée au
-- propriétaire de la ligne, sauf pour les tables gérées uniquement par des
-- fonctions security definer (driver_ledger, payments) ou par la clé
-- service_role (pricing_config, app_config).

alter table public.profiles          enable row level security;
alter table public.vehicles          enable row level security;
alter table public.pricing_config    enable row level security;
alter table public.driver_pricing    enable row level security;
alter table public.app_config        enable row level security;
alter table public.trips             enable row level security;
alter table public.reservations      enable row level security;
alter table public.ride_requests     enable row level security;
alter table public.payments          enable row level security;
alter table public.driver_ledger     enable row level security;
alter table public.bus_lines         enable row level security;
alter table public.bus_positions     enable row level security;
alter table public.merchants         enable row level security;
alter table public.delivery_orders   enable row level security;
alter table public.reviews           enable row level security;

-- -----------------------------------------------------------------------------
-- PROFILES
-- -----------------------------------------------------------------------------
-- Lecture ouverte aux utilisateurs connectés : nécessaire pour afficher le nom
-- et la note d'un chauffeur/passager dans le détail d'une course.
create policy "profiles_select_authenticated" on public.profiles
  for select to authenticated using (true);

create policy "profiles_update_self" on public.profiles
  for update to authenticated using (auth.uid() = id) with check (auth.uid() = id);
-- Pas de policy insert/delete : la création passe uniquement par le trigger
-- handle_new_user (security definer), jamais par un insert direct du client.

-- -----------------------------------------------------------------------------
-- VEHICLES
-- -----------------------------------------------------------------------------
create policy "vehicles_select_authenticated" on public.vehicles
  for select to authenticated using (true);

create policy "vehicles_insert_own" on public.vehicles
  for insert to authenticated with check (auth.uid() = user_id);

create policy "vehicles_update_own" on public.vehicles
  for update to authenticated using (auth.uid() = user_id) with check (auth.uid() = user_id);

create policy "vehicles_delete_own" on public.vehicles
  for delete to authenticated using (auth.uid() = user_id);

-- -----------------------------------------------------------------------------
-- PRICING_CONFIG / APP_CONFIG (lecture publique, écriture réservée au dashboard)
-- -----------------------------------------------------------------------------
create policy "pricing_config_select_all" on public.pricing_config
  for select to authenticated, anon using (true);

create policy "app_config_select_all" on public.app_config
  for select to authenticated, anon using (true);
-- Aucune policy insert/update/delete : seule la clé service_role (donc le
-- dashboard Supabase ou une Edge Function admin) peut modifier ces réglages.

-- -----------------------------------------------------------------------------
-- DRIVER_PRICING
-- -----------------------------------------------------------------------------
create policy "driver_pricing_select_all" on public.driver_pricing
  for select to authenticated, anon using (true);

create policy "driver_pricing_upsert_own" on public.driver_pricing
  for insert to authenticated with check (auth.uid() = driver_id);

create policy "driver_pricing_update_own" on public.driver_pricing
  for update to authenticated using (auth.uid() = driver_id) with check (auth.uid() = driver_id);

-- -----------------------------------------------------------------------------
-- TRIPS
-- -----------------------------------------------------------------------------
create policy "trips_select_all" on public.trips
  for select to authenticated, anon using (true);

create policy "trips_insert_own" on public.trips
  for insert to authenticated with check (auth.uid() = driver_id);

create policy "trips_update_own" on public.trips
  for update to authenticated using (auth.uid() = driver_id) with check (auth.uid() = driver_id);

-- -----------------------------------------------------------------------------
-- RESERVATIONS
-- -----------------------------------------------------------------------------
create policy "reservations_select_involved" on public.reservations
  for select to authenticated using (
    auth.uid() = passager_id
    or auth.uid() in (select driver_id from public.trips where trips.id = reservations.trip_id)
  );

create policy "reservations_insert_own" on public.reservations
  for insert to authenticated with check (auth.uid() = passager_id);

create policy "reservations_update_involved" on public.reservations
  for update to authenticated using (
    auth.uid() = passager_id
    or auth.uid() in (select driver_id from public.trips where trips.id = reservations.trip_id)
  );

-- -----------------------------------------------------------------------------
-- RIDE_REQUESTS (waxalé)
-- -----------------------------------------------------------------------------
-- Un chauffeur doit voir les demandes en attente (pour le matching par rayon,
-- filtré côté application/RPC sur la distance) ; le client voit toujours les siennes.
create policy "ride_requests_select" on public.ride_requests
  for select to authenticated using (
    statut = 'en_attente'
    or auth.uid() = client_id
    or auth.uid() = driver_id
  );

create policy "ride_requests_insert_own" on public.ride_requests
  for insert to authenticated with check (auth.uid() = client_id);

-- Le client peut annuler sa propre demande tant qu'elle est en attente.
create policy "ride_requests_update_client_cancel" on public.ride_requests
  for update to authenticated
  using (auth.uid() = client_id and statut = 'en_attente')
  with check (auth.uid() = client_id);

-- Le chauffeur assigné peut faire progresser sa propre course (en_cours, terminee).
create policy "ride_requests_update_driver_progress" on public.ride_requests
  for update to authenticated
  using (auth.uid() = driver_id)
  with check (auth.uid() = driver_id);
-- NB : l'assignation initiale (en_attente -> assignee) passe exclusivement par
-- accept_ride_request() (security definer), jamais par un UPDATE direct du
-- client — ces deux policies ne permettent donc pas de contourner le verrou atomique.

-- -----------------------------------------------------------------------------
-- PAYMENTS (lecture seule pour les utilisateurs ; écriture via service_role/Edge Functions)
-- -----------------------------------------------------------------------------
create policy "payments_select_involved" on public.payments
  for select to authenticated using (
    auth.uid() = payeur_id or auth.uid() = beneficiaire_id
  );
-- Aucune policy insert/update pour authenticated : les paiements sont créés par
-- une Edge Function (clé service_role) après confirmation réelle de Wave/Orange
-- Money, ou saisis par le chauffeur via une fonction dédiée pour les espèces
-- (à ajouter lors de l'implémentation du flux de paiement).

-- -----------------------------------------------------------------------------
-- DRIVER_LEDGER (lecture seule pour le chauffeur concerné)
-- -----------------------------------------------------------------------------
create policy "driver_ledger_select_own" on public.driver_ledger
  for select to authenticated using (auth.uid() = driver_id);
-- Écriture exclusivement via les triggers/fonctions security definer déjà définis.

-- -----------------------------------------------------------------------------
-- BUS_LINES / BUS_POSITIONS (lecture publique, écriture par le receveur)
-- -----------------------------------------------------------------------------
create policy "bus_lines_select_all" on public.bus_lines
  for select to authenticated, anon using (true);

create policy "bus_lines_insert_own" on public.bus_lines
  for insert to authenticated with check (auth.uid() = receveur_id);

create policy "bus_lines_update_own" on public.bus_lines
  for update to authenticated using (auth.uid() = receveur_id) with check (auth.uid() = receveur_id);

create policy "bus_positions_select_all" on public.bus_positions
  for select to authenticated, anon using (true);

create policy "bus_positions_upsert_own_line" on public.bus_positions
  for insert to authenticated with check (
    auth.uid() in (select receveur_id from public.bus_lines where bus_lines.id = bus_positions.bus_line_id)
  );

create policy "bus_positions_update_own_line" on public.bus_positions
  for update to authenticated using (
    auth.uid() in (select receveur_id from public.bus_lines where bus_lines.id = bus_positions.bus_line_id)
  );

-- -----------------------------------------------------------------------------
-- MERCHANTS
-- -----------------------------------------------------------------------------
create policy "merchants_select_all" on public.merchants
  for select to authenticated, anon using (true);

create policy "merchants_insert_own" on public.merchants
  for insert to authenticated with check (auth.uid() = owner_id);

create policy "merchants_update_own" on public.merchants
  for update to authenticated using (auth.uid() = owner_id) with check (auth.uid() = owner_id);

-- -----------------------------------------------------------------------------
-- DELIVERY_ORDERS
-- -----------------------------------------------------------------------------
create policy "delivery_orders_select_involved" on public.delivery_orders
  for select to authenticated using (
    auth.uid() = client_id
    or auth.uid() = chauffeur_id
    or auth.uid() in (select owner_id from public.merchants where merchants.id = delivery_orders.merchant_id)
    or (statut = 'approuvee' and chauffeur_id is null) -- visible aux livreurs pour matching
  );

create policy "delivery_orders_insert_own" on public.delivery_orders
  for insert to authenticated with check (auth.uid() = client_id);

-- Le client peut annuler, le commerçant peut envoyer son devis, le livreur fait
-- progresser sa livraison assignée. La transition vers "en_livraison" passe par
-- accept_delivery_order() (security definer) et non par cette policy.
create policy "delivery_orders_update_involved" on public.delivery_orders
  for update to authenticated using (
    auth.uid() = client_id
    or auth.uid() = chauffeur_id
    or auth.uid() in (select owner_id from public.merchants where merchants.id = delivery_orders.merchant_id)
  );

-- -----------------------------------------------------------------------------
-- REVIEWS
-- -----------------------------------------------------------------------------
create policy "reviews_select_all" on public.reviews
  for select to authenticated, anon using (true);

create policy "reviews_insert_own" on public.reviews
  for insert to authenticated with check (auth.uid() = auteur_id);
