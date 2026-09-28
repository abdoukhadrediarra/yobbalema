-- =============================================================================
-- YOBBALEMA — Schéma Supabase (Phase 0 : fondation commune)
-- =============================================================================
-- À exécuter dans Supabase : Dashboard > SQL Editor > New query > coller > Run.
-- Correspond au Document de référence technique YOBBALEMA (v3).
--
-- Ce fichier est idempotent autant que possible (IF NOT EXISTS), mais il est
-- prévu pour être exécuté une seule fois sur un projet Supabase neuf.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 0. EXTENSIONS
-- -----------------------------------------------------------------------------
create extension if not exists "pgcrypto";   -- gen_random_uuid()
create extension if not exists "postgis";    -- types géographiques + ST_DWithin

-- -----------------------------------------------------------------------------
-- 1. TYPES ÉNUMÉRÉS
-- -----------------------------------------------------------------------------
do $$ begin
  create type role_utilisateur as enum ('client', 'chauffeur', 'receveur_bus', 'commercant');
exception when duplicate_object then null; end $$;

do $$ begin
  create type categorie_vehicule as enum ('standard', 'confort', 'pro', 'moto', 'jakarta', 'tiak_tiak');
exception when duplicate_object then null; end $$;

do $$ begin
  create type statut_verif as enum ('en_attente', 'verifie', 'rejete');
exception when duplicate_object then null; end $$;

do $$ begin
  create type statut_trip as enum ('ouvert', 'complet', 'termine', 'annule');
exception when duplicate_object then null; end $$;

do $$ begin
  create type statut_reservation as enum ('en_attente', 'confirmee', 'annulee');
exception when duplicate_object then null; end $$;

do $$ begin
  create type statut_ride as enum ('en_attente', 'assignee', 'en_cours', 'terminee', 'expiree', 'annulee');
exception when duplicate_object then null; end $$;

do $$ begin
  create type moyen_paiement as enum ('wave', 'orange_money', 'especes');
exception when duplicate_object then null; end $$;

do $$ begin
  create type source_paiement as enum ('trip', 'ride', 'delivery');
exception when duplicate_object then null; end $$;

do $$ begin
  create type categorie_montant as enum ('trajet', 'produits', 'livraison');
exception when duplicate_object then null; end $$;

do $$ begin
  create type type_commerce as enum ('pharmacie', 'restaurant', 'marche');
exception when duplicate_object then null; end $$;

do $$ begin
  create type type_livraison as enum ('colis', 'repas', 'pharmacie', 'marche');
exception when duplicate_object then null; end $$;

do $$ begin
  create type statut_livraison as enum (
    'en_attente_devis', 'devis_envoye', 'approuvee', 'en_livraison', 'livree', 'annulee'
  );
exception when duplicate_object then null; end $$;

-- -----------------------------------------------------------------------------
-- 2. PROFILS (étend auth.users)
-- -----------------------------------------------------------------------------
create table if not exists public.profiles (
  id             uuid primary key references auth.users (id) on delete cascade,
  prenom         text,
  nom            text,
  telephone      text,
  role           role_utilisateur not null default 'client',
  cni_url        text,
  permis_url     text,
  statut_verif   statut_verif not null default 'en_attente',
  note_moyenne   numeric(2, 1),
  created_at     timestamptz not null default now()
);

comment on table public.profiles is 'Profil métier associé à chaque compte auth.users.';

-- Création automatique du profil à l'inscription, à partir des métadonnées
-- passées par le client dans supabase.auth.signUp({ options: { data: {...} } }).
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.profiles (id, prenom, nom, telephone, role)
  values (
    new.id,
    new.raw_user_meta_data ->> 'prenom',
    new.raw_user_meta_data ->> 'nom',
    new.raw_user_meta_data ->> 'telephone',
    coalesce(new.raw_user_meta_data ->> 'role', 'client')::role_utilisateur
  );
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- -----------------------------------------------------------------------------
-- 3. VÉHICULES
-- -----------------------------------------------------------------------------
create table if not exists public.vehicles (
  id                uuid primary key default gen_random_uuid(),
  user_id           uuid not null references public.profiles (id) on delete cascade,
  categorie         categorie_vehicule not null,
  marque            text,
  modele            text,
  immatriculation   text,
  carte_grise_url   text,
  created_at        timestamptz not null default now()
);

create index if not exists vehicles_user_id_idx on public.vehicles (user_id);

-- -----------------------------------------------------------------------------
-- 4. TARIFICATION
-- -----------------------------------------------------------------------------
create table if not exists public.pricing_config (
  id             uuid primary key default gen_random_uuid(),
  categorie      categorie_vehicule not null unique,
  tarif_km_min   numeric(8, 2) not null,
  tarif_km_max   numeric(8, 2) not null,
  tarif_km_base  numeric(8, 2) not null
);

insert into public.pricing_config (categorie, tarif_km_min, tarif_km_max, tarif_km_base)
values
  ('standard', 130, 190, 150),
  ('confort',  150, 220, 175),
  ('pro',      170, 250, 200)
on conflict (categorie) do nothing;

create table if not exists public.driver_pricing (
  id               uuid primary key default gen_random_uuid(),
  driver_id        uuid not null references public.profiles (id) on delete cascade,
  categorie        categorie_vehicule not null,
  tarif_km_choisi  numeric(8, 2) not null,
  updated_at       timestamptz not null default now(),
  unique (driver_id, categorie)
);

-- Le tarif choisi doit rester dans la fourchette définie par pricing_config.
create or replace function public.check_tarif_dans_fourchette()
returns trigger
language plpgsql
as $$
declare
  v_min numeric(8,2);
  v_max numeric(8,2);
begin
  select tarif_km_min, tarif_km_max into v_min, v_max
  from public.pricing_config where categorie = new.categorie;

  if v_min is null then
    raise exception 'categorie_inconnue: aucune configuration tarifaire pour %', new.categorie;
  end if;

  if new.tarif_km_choisi < v_min or new.tarif_km_choisi > v_max then
    raise exception 'tarif_hors_fourchette: doit être entre % et % FCFA/km pour la catégorie %',
      v_min, v_max, new.categorie;
  end if;

  return new;
end;
$$;

drop trigger if exists driver_pricing_check on public.driver_pricing;
create trigger driver_pricing_check
  before insert or update on public.driver_pricing
  for each row execute function public.check_tarif_dans_fourchette();

-- Tarif moyen pratiqué par catégorie (affiché au chauffeur au moment de fixer son prix).
create or replace view public.tarif_moyen_par_categorie as
  select categorie, round(avg(tarif_km_choisi), 2) as tarif_moyen, count(*) as nb_chauffeurs
  from public.driver_pricing
  group by categorie;

-- -----------------------------------------------------------------------------
-- 5. PARAMÈTRES DE CONFIGURATION (app_config)
-- -----------------------------------------------------------------------------
create table if not exists public.app_config (
  cle          text primary key,
  valeur       text not null,
  description  text
);

insert into public.app_config (cle, valeur, description) values
  ('rayon_initial_km', '0.5', 'Rayon initial de diffusion d''une course à la demande, en kilomètres.'),
  ('rayon_increment_km', '0.5', 'Incrément appliqué au rayon à chaque relance sans chauffeur.'),
  ('delai_relance_secondes', '120', 'Délai avant élargissement du rayon si aucun chauffeur ne valide.'),
  ('delai_expiration_secondes', '120', 'Délai de validité d''une offre waxalé avant expiration.'),
  ('commission_pct', '5', 'Pourcentage de commission de la plateforme, prélevé au bénéficiaire (chauffeur/commerçant).')
on conflict (cle) do nothing;
