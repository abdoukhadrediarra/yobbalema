-- =============================================================================
-- YOBBALEMA — 05 : configuration des services + durcissement de la sécurité
-- Exécuter après 04_rls_policies.sql
-- =============================================================================
-- Ce fichier :
--   * ajoute les paramètres de configuration des services (app_config)
--   * ajoute les colonnes nécessaires (tracé des bus, devis, description…)
--   * ferme des failles des politiques RLS de 04 : toute modification d'état
--     (course, réservation, livraison, dette…) passera désormais UNIQUEMENT par
--     les fonctions du fichier 06, jamais par un UPDATE direct du client
--   * crée les buckets de stockage privés (pièces d'identité, ordonnances)
--   * active le temps réel (Realtime) sur les tables utiles

-- -----------------------------------------------------------------------------
-- 1. PARAMÈTRES
-- -----------------------------------------------------------------------------
insert into public.app_config (cle, valeur, description) values
  ('nb_relances_max', '2', 'Nombre d''élargissements du rayon avant expiration d''une course (expiration = (nb+1) x délai).'),
  ('tarif_minimum', '500', 'Prix minimum d''une course ou livraison, en FCFA.'),
  ('offre_min_pct', '50', 'Une offre waxalé ne peut pas être inférieure à ce pourcentage du tarif de base.'),
  ('verification_requise', 'false', 'true = seuls les comptes vérifiés (statut_verif = verifie) peuvent agir comme chauffeur / receveur / commerçant.'),
  ('mode_test_paiements', 'true', 'true = Wave / Orange Money sont SIMULÉS (confirmés immédiatement). Mettre false en production quand les Edge Functions de paiement existent : seul « espèces » restera possible sans elles.'),
  ('bus_vitesse_defaut_kmh', '18', 'Vitesse utilisée pour l''ETA d''un bus si sa vitesse mesurée est absente.'),
  ('bus_position_max_age_s', '120', 'Un bus dont la dernière position date de plus de N secondes n''est plus affiché.'),
  ('bus_rayon_arret_m', '400', 'Distance maximale entre l''utilisateur et le tracé d''une ligne pour qu''elle soit proposée.'),
  ('livraison_rayon_initial_km', '2', 'Rayon initial de diffusion d''une livraison approuvée autour du point de collecte.'),
  ('livraison_rayon_increment_km', '1', 'Incrément du rayon de diffusion des livraisons.'),
  ('livraison_delai_relance_s', '120', 'Délai entre deux élargissements du rayon de diffusion des livraisons.'),
  ('livraison_rayon_max_km', '10', 'Rayon maximal de diffusion d''une livraison.')
on conflict (cle) do nothing;

create or replace function public.cfg(p_cle text)
returns text language sql stable security definer set search_path = public as $$
  select valeur from public.app_config where cle = p_cle
$$;

create or replace function public.cfg_num(p_cle text)
returns numeric language sql stable security definer set search_path = public as $$
  select valeur::numeric from public.app_config where cle = p_cle
$$;

create or replace function public.cfg_bool(p_cle text)
returns boolean language sql stable security definer set search_path = public as $$
  select coalesce((select valeur = 'true' from public.app_config where cle = p_cle), false)
$$;

-- -----------------------------------------------------------------------------
-- 2. COLONNES SUPPLÉMENTAIRES
-- -----------------------------------------------------------------------------
-- Bus : terminus + tracé (liste de points [lat, lng]) pour calculer un vrai ETA le long de la ligne
alter table public.bus_lines
  add column if not exists terminus_depart  text,
  add column if not exists terminus_arrivee text,
  add column if not exists trajet           jsonb,
  add column if not exists trajet_geom      geography(linestring, 4326);

create or replace function public.bus_lines_set_geom()
returns trigger language plpgsql as $$
begin
  if new.trajet is not null and jsonb_typeof(new.trajet) = 'array' and jsonb_array_length(new.trajet) >= 2 then
    select ST_MakeLine(array_agg(
             ST_SetSRID(ST_MakePoint((e ->> 1)::float8, (e ->> 0)::float8), 4326) order by ord
           ))::geography
      into new.trajet_geom
      from jsonb_array_elements(new.trajet) with ordinality as t(e, ord);
  else
    new.trajet_geom := null;
  end if;
  return new;
end;
$$;

drop trigger if exists bus_lines_geom_trigger on public.bus_lines;
create trigger bus_lines_geom_trigger
  before insert or update of trajet on public.bus_lines
  for each row execute function public.bus_lines_set_geom();

create index if not exists bus_lines_trajet_idx on public.bus_lines using gist (trajet_geom);

-- Livraison : description libre, lignes de devis, véhicule souhaité, instant d'approbation
alter table public.delivery_orders
  add column if not exists description       text,
  add column if not exists devis_lignes      jsonb,
  add column if not exists devis_note        text,
  add column if not exists vehicule_souhaite text check (vehicule_souhaite in ('voiture', 'moto', 'jakarta', 'tiak_tiak')),
  add column if not exists distance_km       numeric(6, 2),
  add column if not exists approuvee_at      timestamptz;

create or replace function public.delivery_orders_default_statut()
returns trigger language plpgsql as $$
begin
  if new.merchant_id is null and new.statut = 'en_attente_devis' then
    new.statut := 'approuvee';
  end if;
  if new.statut = 'approuvee' and new.approuvee_at is null then
    new.approuvee_at := now();
  end if;
  return new;
end;
$$;

create or replace function public.delivery_orders_set_approuvee_at()
returns trigger language plpgsql as $$
begin
  if new.statut = 'approuvee' and old.statut is distinct from 'approuvee' then
    new.approuvee_at := now();
  end if;
  return new;
end;
$$;

drop trigger if exists delivery_orders_approuvee_trigger on public.delivery_orders;
create trigger delivery_orders_approuvee_trigger
  before update on public.delivery_orders
  for each row execute function public.delivery_orders_set_approuvee_at();

-- Paiements : un seul paiement par (source, catégorie de montant)
create unique index if not exists payments_unique_source
  on public.payments (source_type, source_id, categorie_montant);

-- Avis : destinataire de l'avis + un seul avis par auteur et par source
alter table public.reviews add column if not exists destinataire_id uuid references public.profiles (id);
create unique index if not exists reviews_unique_auteur
  on public.reviews (source_type, source_id, auteur_id);

-- -----------------------------------------------------------------------------
-- 3. PROFILS : colonnes protégées + confidentialité
-- -----------------------------------------------------------------------------
-- Un utilisateur ne peut pas s'auto-attribuer la vérification, une note, ni
-- changer de rôle. (Le dashboard Supabase / service_role n'est pas concerné :
-- auth.uid() y est nul.) Les fonctions internes qui doivent modifier ces
-- colonnes posent le drapeau app.bypass_protect.
create or replace function public.profiles_protect_columns()
returns trigger language plpgsql as $$
begin
  if auth.uid() is not null and coalesce(current_setting('app.bypass_protect', true), '') <> 'on' then
    new.statut_verif := old.statut_verif;
    new.note_moyenne := old.note_moyenne;
    new.role := old.role;
    new.id := old.id;
  end if;
  return new;
end;
$$;

drop trigger if exists profiles_protect_trigger on public.profiles;
create trigger profiles_protect_trigger
  before update on public.profiles
  for each row execute function public.profiles_protect_columns();

-- Profil public minimal (prénom, note, rôle) : lisible par tout utilisateur connecté.
create or replace view public.profils_publics as
  select id, prenom, note_moyenne, role from public.profiles;
grant select on public.profils_publics to authenticated;

-- Deux personnes sont "en relation" si elles partagent une course, une
-- réservation ou une livraison. Seules elles peuvent lire le profil complet
-- (téléphone compris) l'une de l'autre.
create or replace function public.est_en_relation_avec(p_other uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select
    exists (select 1 from public.ride_requests r
             where (r.client_id = auth.uid() and r.driver_id = p_other)
                or (r.driver_id = auth.uid() and r.client_id = p_other))
    or exists (select 1 from public.reservations rs join public.trips t on t.id = rs.trip_id
             where (rs.passager_id = auth.uid() and t.driver_id = p_other)
                or (t.driver_id = auth.uid() and rs.passager_id = p_other))
    or exists (select 1 from public.delivery_orders d left join public.merchants m on m.id = d.merchant_id
             where (d.client_id = auth.uid() and (d.chauffeur_id = p_other or m.owner_id = p_other))
                or (d.chauffeur_id = auth.uid() and (d.client_id = p_other or m.owner_id = p_other))
                or (m.owner_id = auth.uid() and (d.client_id = p_other or d.chauffeur_id = p_other)))
$$;

drop policy if exists "profiles_select_authenticated" on public.profiles;
create policy "profiles_select_self_or_related" on public.profiles
  for select to authenticated
  using (id = auth.uid() or public.est_en_relation_avec(id));

-- -----------------------------------------------------------------------------
-- 4. FERMETURE DES ÉCRITURES DIRECTES (tout passe par les fonctions du fichier 06)
-- -----------------------------------------------------------------------------
-- Courses à la demande : lecture réservée au client et au chauffeur concernés.
drop policy if exists "ride_requests_select" on public.ride_requests;
drop policy if exists "ride_requests_insert_own" on public.ride_requests;
drop policy if exists "ride_requests_update_client_cancel" on public.ride_requests;
drop policy if exists "ride_requests_update_driver_progress" on public.ride_requests;
create policy "ride_requests_select_involved" on public.ride_requests
  for select to authenticated using (auth.uid() = client_id or auth.uid() = driver_id);

-- Réservations : création / confirmation / annulation via fonctions uniquement.
drop policy if exists "reservations_insert_own" on public.reservations;
drop policy if exists "reservations_update_involved" on public.reservations;

-- Livraisons : lecture réservée aux personnes concernées.
drop policy if exists "delivery_orders_select_involved" on public.delivery_orders;
drop policy if exists "delivery_orders_insert_own" on public.delivery_orders;
drop policy if exists "delivery_orders_update_involved" on public.delivery_orders;
create policy "delivery_orders_select_involved" on public.delivery_orders
  for select to authenticated using (
    auth.uid() = client_id
    or auth.uid() = chauffeur_id
    or auth.uid() in (select owner_id from public.merchants where merchants.id = delivery_orders.merchant_id)
  );

-- Avis : création via la fonction noter() uniquement.
drop policy if exists "reviews_insert_own" on public.reviews;

-- Lignes de bus / commerces : réservés aux rôles concernés.
drop policy if exists "bus_lines_insert_own" on public.bus_lines;
create policy "bus_lines_insert_receveur" on public.bus_lines
  for insert to authenticated with check (
    auth.uid() = receveur_id
    and exists (select 1 from public.profiles p where p.id = auth.uid() and p.role = 'receveur_bus')
  );

drop policy if exists "merchants_insert_own" on public.merchants;
create policy "merchants_insert_commercant" on public.merchants
  for insert to authenticated with check (
    auth.uid() = owner_id
    and exists (select 1 from public.profiles p where p.id = auth.uid() and p.role = 'commercant')
  );

-- Le statut de vérification d'un commerçant ne se modifie pas soi-même.
create or replace function public.merchants_protect_columns()
returns trigger language plpgsql as $$
begin
  if auth.uid() is not null then
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

drop trigger if exists merchants_protect_trigger on public.merchants;
create trigger merchants_protect_trigger
  before insert or update on public.merchants
  for each row execute function public.merchants_protect_columns();

-- Trajets : le chauffeur doit avoir un rôle chauffeur, posséder le véhicule, ne pas être bloqué.
create or replace function public.trips_before_insert()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  v_p public.profiles;
begin
  select * into v_p from public.profiles where id = new.driver_id;
  if v_p.role is distinct from 'chauffeur' then
    raise exception 'acces_refuse: seul un chauffeur peut publier un trajet';
  end if;
  if public.cfg_bool('verification_requise') and v_p.statut_verif <> 'verifie' then
    raise exception 'compte_non_verifie: faites vérifier votre identité pour publier un trajet';
  end if;
  if not exists (select 1 from public.vehicles where id = new.vehicle_id and user_id = new.driver_id) then
    raise exception 'vehicule_invalide: ce véhicule ne vous appartient pas';
  end if;
  if public.has_unpaid_debt(new.driver_id) then
    raise exception 'compte_bloque: dette de commission impayée';
  end if;
  if new.date_heure_depart <= now() then
    raise exception 'date_passee: la date de départ doit être dans le futur';
  end if;
  return new;
end;
$$;

drop trigger if exists trips_before_insert_trigger on public.trips;
create trigger trips_before_insert_trigger
  before insert on public.trips
  for each row execute function public.trips_before_insert();

-- -----------------------------------------------------------------------------
-- 5. STOCKAGE (buckets privés)
-- -----------------------------------------------------------------------------
-- Convention de chemin : <user_id>/<nom_de_fichier>. Chaque utilisateur ne voit
-- que son propre dossier ; le commerçant concerné peut lire l'ordonnance d'une
-- commande qui lui est adressée.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values
  ('documents',   'documents',   false, 5242880, array['image/jpeg', 'image/png', 'image/webp', 'application/pdf']),
  ('ordonnances', 'ordonnances', false, 5242880, array['image/jpeg', 'image/png', 'image/webp', 'application/pdf'])
on conflict (id) do nothing;

drop policy if exists "documents_owner_all" on storage.objects;
create policy "documents_owner_all" on storage.objects
  for all to authenticated
  using (bucket_id = 'documents' and (storage.foldername(name))[1] = auth.uid()::text)
  with check (bucket_id = 'documents' and (storage.foldername(name))[1] = auth.uid()::text);

drop policy if exists "ordonnances_owner_all" on storage.objects;
create policy "ordonnances_owner_all" on storage.objects
  for all to authenticated
  using (bucket_id = 'ordonnances' and (storage.foldername(name))[1] = auth.uid()::text)
  with check (bucket_id = 'ordonnances' and (storage.foldername(name))[1] = auth.uid()::text);

drop policy if exists "ordonnances_select_merchant" on storage.objects;
create policy "ordonnances_select_merchant" on storage.objects
  for select to authenticated
  using (
    bucket_id = 'ordonnances'
    and exists (
      select 1 from public.delivery_orders d
      join public.merchants m on m.id = d.merchant_id
      where d.photo_ordonnance_url = storage.objects.name and m.owner_id = auth.uid()
    )
  );

-- -----------------------------------------------------------------------------
-- 6. TEMPS RÉEL
-- -----------------------------------------------------------------------------
do $$
declare t text;
begin
  foreach t in array array['ride_requests', 'delivery_orders', 'reservations', 'bus_positions', 'driver_ledger', 'trips']
  loop
    begin
      execute format('alter publication supabase_realtime add table public.%I', t);
    exception
      when duplicate_object then null;
      when undefined_object then null;
    end;
  end loop;
end $$;
