-- =============================================================================
-- YOBBALEMA — 06 : fonctions métier des services
-- Exécuter après 05_services_config_security.sql
-- =============================================================================
-- Toutes ces fonctions sont appelées depuis le site (et plus tard Flutter) via
-- supabase.rpc('nom', { p_... }). Elles vérifient elles-mêmes l'identité et le
-- rôle de l'appelant (auth.uid()), car elles s'exécutent en « security definer »
-- pour pouvoir modifier des lignes que les politiques RLS protègent.

-- -----------------------------------------------------------------------------
-- 0. OUTILS INTERNES
-- -----------------------------------------------------------------------------
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
  if public.cfg_bool('verification_requise') and v.role <> 'client' and v.statut_verif <> 'verifie' then
    raise exception 'compte_non_verifie: faites vérifier votre identité pour utiliser cette fonction';
  end if;
  return v;
end;
$$;

-- Le véhicule d'un utilisateur correspond-il au type demandé pour une livraison ?
create or replace function public.vehicule_compatible(p_user uuid, p_souhaite text)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.vehicles v
    where v.user_id = p_user
      and (
        p_souhaite is null
        or (p_souhaite = 'voiture' and v.categorie in ('standard', 'confort', 'pro'))
        or v.categorie::text = p_souhaite
      )
  )
$$;

-- Création d'un paiement (usage interne). En mode test, Wave / Orange Money sont
-- simulés ; hors mode test, seul « espèces » est accepté tant que les Edge
-- Functions de paiement réelles ne sont pas branchées.
create or replace function public._creer_paiement(
  p_source source_paiement, p_source_id uuid, p_cat categorie_montant,
  p_payeur uuid, p_benef uuid, p_moyen moyen_paiement, p_montant numeric
) returns public.payments
language plpgsql security definer set search_path = public as $$
declare
  v_pay public.payments;
begin
  if p_moyen <> 'especes' and not public.cfg_bool('mode_test_paiements') then
    raise exception 'paiement_en_ligne_indisponible: seul le paiement en espèces est disponible pour le moment';
  end if;

  insert into public.payments
    (source_type, source_id, categorie_montant, payeur_id, beneficiaire_id,
     moyen, montant, commission_pct, statut_transaction, reference_externe)
  values
    (p_source, p_source_id, p_cat, p_payeur, p_benef, p_moyen, p_montant,
     public.cfg_num('commission_pct'), 'confirme',
     case when p_moyen = 'especes' then null else 'SIMULATION' end)
  returning * into v_pay;

  return v_pay;
end;
$$;

revoke all on function public._creer_paiement(source_paiement, uuid, categorie_montant, uuid, uuid, moyen_paiement, numeric)
  from public, anon, authenticated;

-- -----------------------------------------------------------------------------
-- 1. STATUT CHAUFFEUR / DETTE DE COMMISSION
-- -----------------------------------------------------------------------------
create or replace function public.mon_statut_chauffeur()
returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare
  v_p public.profiles;
  v_dettes jsonb;
  v_total numeric;
begin
  if auth.uid() is null then raise exception 'non_authentifie: connexion requise'; end if;
  select * into v_p from public.profiles where id = auth.uid();

  select coalesce(jsonb_agg(jsonb_build_object('id', id, 'montant', montant, 'created_at', created_at) order by created_at), '[]'::jsonb),
         coalesce(sum(montant), 0)
    into v_dettes, v_total
    from public.driver_ledger where driver_id = auth.uid() and regle = false;

  return jsonb_build_object(
    'role', v_p.role,
    'statut_verif', v_p.statut_verif,
    'verification_requise', public.cfg_bool('verification_requise'),
    'bloque', v_total > 0,
    'dette_total', v_total,
    'dettes', v_dettes,
    'mode_test_paiements', public.cfg_bool('mode_test_paiements')
  );
end;
$$;

drop function if exists public.regler_dette_manuelle(uuid);

-- Règlement d'une dette : en mode test, le chauffeur peut simuler son virement.
-- En production, seule regler_dette_admin (clé service_role, appelée par une
-- Edge Function après confirmation réelle Wave / Orange Money) fait foi.
create or replace function public.regler_dette(p_ledger_id uuid)
returns public.driver_ledger
language plpgsql security definer set search_path = public as $$
declare
  v public.driver_ledger;
begin
  if auth.uid() is null then raise exception 'non_authentifie: connexion requise'; end if;
  if not public.cfg_bool('mode_test_paiements') then
    raise exception 'reglement_en_ligne_indisponible: le règlement en ligne sera disponible avec l''intégration Wave / Orange Money';
  end if;

  update public.driver_ledger
     set regle = true, regle_type = 'manuel', regle_at = now()
   where id = p_ledger_id and driver_id = auth.uid() and regle = false
   returning * into v;

  if not found then
    raise exception 'dette_introuvable: dette déjà réglée ou introuvable';
  end if;
  return v;
end;
$$;

create or replace function public.regler_dette_admin(p_ledger_id uuid)
returns public.driver_ledger
language plpgsql security definer set search_path = public as $$
declare
  v public.driver_ledger;
begin
  update public.driver_ledger
     set regle = true, regle_type = 'manuel', regle_at = now()
   where id = p_ledger_id and regle = false
   returning * into v;
  if not found then
    raise exception 'dette_introuvable: dette déjà réglée ou introuvable';
  end if;
  return v;
end;
$$;

revoke all on function public.regler_dette_admin(uuid) from public, anon, authenticated;
grant execute on function public.regler_dette_admin(uuid) to service_role;

-- -----------------------------------------------------------------------------
-- 2. TRAJETS INTERURBAINS
-- -----------------------------------------------------------------------------
create or replace function public.reserver_trajet(p_trip_id uuid, p_nb_places smallint default 1)
returns public.reservations
language plpgsql security definer set search_path = public as $$
declare
  v_trip public.trips;
  v_row public.reservations;
begin
  perform public.assert_actor(array['client', 'chauffeur', 'receveur_bus', 'commercant']::role_utilisateur[]);
  if p_nb_places is null or p_nb_places < 1 then
    raise exception 'places_invalides: choisissez au moins une place';
  end if;

  select * into v_trip from public.trips where id = p_trip_id;
  if v_trip.id is null then raise exception 'trajet_introuvable: ce trajet n''existe pas'; end if;
  if v_trip.driver_id = auth.uid() then raise exception 'reservation_impossible: vous ne pouvez pas réserver votre propre trajet'; end if;
  if v_trip.statut <> 'ouvert' or v_trip.date_heure_depart <= now() then
    raise exception 'trajet_indisponible: ce trajet n''accepte plus de réservations';
  end if;
  if v_trip.places_dispo < p_nb_places then
    raise exception 'places_insuffisantes: il ne reste que % place(s)', v_trip.places_dispo;
  end if;
  if exists (select 1 from public.reservations where trip_id = p_trip_id and passager_id = auth.uid() and statut <> 'annulee') then
    raise exception 'deja_reserve: vous avez déjà une réservation sur ce trajet';
  end if;

  insert into public.reservations (trip_id, passager_id, nb_places, statut)
  values (p_trip_id, auth.uid(), p_nb_places, 'en_attente')
  returning * into v_row;
  return v_row;
end;
$$;

create or replace function public.confirmer_reservation(p_reservation_id uuid)
returns public.reservations
language plpgsql security definer set search_path = public as $$
declare
  v_row public.reservations;
begin
  perform public.assert_actor(array['chauffeur']::role_utilisateur[]);

  update public.reservations r
     set statut = 'confirmee'
   where r.id = p_reservation_id
     and r.statut = 'en_attente'
     and exists (select 1 from public.trips t where t.id = r.trip_id and t.driver_id = auth.uid())
   returning * into v_row;

  if not found then
    raise exception 'reservation_introuvable: réservation introuvable ou déjà traitée';
  end if;
  return v_row;
end;
$$;

create or replace function public.annuler_reservation(p_reservation_id uuid)
returns public.reservations
language plpgsql security definer set search_path = public as $$
declare
  v_res public.reservations;
  v_driver uuid;
begin
  if auth.uid() is null then raise exception 'non_authentifie: connexion requise'; end if;

  select * into v_res from public.reservations where id = p_reservation_id;
  if v_res.id is null then raise exception 'reservation_introuvable: réservation introuvable'; end if;
  select driver_id into v_driver from public.trips where id = v_res.trip_id;
  if auth.uid() not in (v_res.passager_id, v_driver) then
    raise exception 'acces_refuse: cette réservation ne vous concerne pas';
  end if;
  if v_res.statut = 'annulee' then raise exception 'deja_annulee: réservation déjà annulée'; end if;

  if v_res.statut = 'confirmee' then
    update public.trips
       set places_dispo = places_dispo + v_res.nb_places,
           statut = case when statut = 'complet' then 'ouvert' else statut end
     where id = v_res.trip_id;
  end if;

  update public.reservations set statut = 'annulee' where id = p_reservation_id returning * into v_res;
  return v_res;
end;
$$;

create or replace function public.terminer_trajet(p_trip_id uuid)
returns public.trips
language plpgsql security definer set search_path = public as $$
declare
  v_row public.trips;
begin
  perform public.assert_actor(array['chauffeur']::role_utilisateur[]);
  update public.trips set statut = 'termine'
   where id = p_trip_id and driver_id = auth.uid() and statut in ('ouvert', 'complet')
   returning * into v_row;
  if not found then raise exception 'trajet_introuvable: trajet introuvable ou déjà terminé'; end if;
  return v_row;
end;
$$;

create or replace function public.annuler_trajet(p_trip_id uuid)
returns public.trips
language plpgsql security definer set search_path = public as $$
declare
  v_row public.trips;
begin
  perform public.assert_actor(array['chauffeur']::role_utilisateur[]);
  update public.trips set statut = 'annule'
   where id = p_trip_id and driver_id = auth.uid() and statut in ('ouvert', 'complet')
   returning * into v_row;
  if not found then raise exception 'trajet_introuvable: trajet introuvable ou déjà clos'; end if;
  update public.reservations set statut = 'annulee' where trip_id = p_trip_id and statut <> 'annulee';
  return v_row;
end;
$$;

create or replace function public.encaisser_reservation(p_reservation_id uuid, p_moyen moyen_paiement)
returns public.payments
language plpgsql security definer set search_path = public as $$
declare
  v_res public.reservations;
  v_trip public.trips;
begin
  perform public.assert_actor(array['chauffeur']::role_utilisateur[]);

  select r.* into v_res from public.reservations r where r.id = p_reservation_id;
  if v_res.id is null then raise exception 'reservation_introuvable: réservation introuvable'; end if;
  select * into v_trip from public.trips where id = v_res.trip_id;
  if v_trip.driver_id <> auth.uid() then raise exception 'acces_refuse: ce trajet n''est pas le vôtre'; end if;
  if v_res.statut <> 'confirmee' then raise exception 'reservation_non_confirmee: seule une réservation confirmée peut être encaissée'; end if;
  if v_trip.statut <> 'termine' then raise exception 'trajet_non_termine: terminez le trajet avant d''encaisser'; end if;
  if exists (select 1 from public.payments where source_type = 'trip' and source_id = p_reservation_id and categorie_montant = 'trajet') then
    raise exception 'deja_encaisse: cette réservation est déjà payée';
  end if;

  return public._creer_paiement('trip', p_reservation_id, 'trajet', v_res.passager_id, auth.uid(),
                                p_moyen, v_res.nb_places * v_trip.prix_place);
end;
$$;

-- -----------------------------------------------------------------------------
-- 3. COURSES À LA DEMANDE (waxalé)
-- -----------------------------------------------------------------------------
create or replace function public.expire_stale_rides()
returns integer
language plpgsql security definer set search_path = public as $$
declare
  n integer;
begin
  update public.ride_requests set statut = 'expiree'
   where statut = 'en_attente' and expire_at <= now();
  get diagnostics n = row_count;
  return n;
end;
$$;

create or replace function public.create_ride_request(
  p_categorie categorie_vehicule,
  p_depart_label text, p_depart_lat float8, p_depart_lng float8,
  p_arrivee_label text, p_arrivee_lat float8, p_arrivee_lng float8,
  p_distance_km numeric,
  p_montant_offert numeric default null
) returns public.ride_requests
language plpgsql security definer set search_path = public as $$
declare
  v_base numeric;
  v_straight numeric;
  v_dist numeric;
  v_tarif numeric;
  v_min_offre numeric;
  v_row public.ride_requests;
begin
  perform public.assert_actor(array['client', 'chauffeur', 'receveur_bus', 'commercant']::role_utilisateur[]);

  if p_categorie not in ('standard', 'confort', 'pro') then
    raise exception 'categorie_invalide: choisissez Standard, Confort ou Pro';
  end if;

  perform public.expire_stale_rides();
  if exists (select 1 from public.ride_requests
              where client_id = auth.uid() and statut in ('en_attente', 'assignee', 'en_cours')) then
    raise exception 'course_deja_active: vous avez déjà une course en cours';
  end if;

  select tarif_km_base into v_base from public.pricing_config where categorie = p_categorie;
  if v_base is null then raise exception 'tarif_indisponible: pas de tarif pour cette catégorie'; end if;

  v_straight := ST_Distance(
      ST_SetSRID(ST_MakePoint(p_depart_lng, p_depart_lat), 4326)::geography,
      ST_SetSRID(ST_MakePoint(p_arrivee_lng, p_arrivee_lat), 4326)::geography) / 1000.0;
  if v_straight < 0.2 then
    raise exception 'trajet_trop_court: le départ et l''arrivée sont trop proches';
  end if;

  -- La distance routière fournie par le client ne peut pas être inférieure à la
  -- distance à vol d'oiseau (anti-fraude sur le prix) ni excéder 3 fois celle-ci.
  v_dist := round(least(greatest(coalesce(p_distance_km, 0), v_straight), v_straight * 3), 2);
  v_tarif := greatest(public.cfg_num('tarif_minimum'), round(v_dist * v_base / 25) * 25);

  if p_montant_offert is not null then
    v_min_offre := round(v_tarif * public.cfg_num('offre_min_pct') / 100 / 25) * 25;
    if p_montant_offert < v_min_offre then
      raise exception 'offre_trop_basse: votre offre doit être d''au moins % FCFA', v_min_offre;
    end if;
  end if;

  insert into public.ride_requests
    (client_id, categorie, depart_label, depart_lat, depart_lng, arrivee_label, arrivee_lat, arrivee_lng,
     distance_km, tarif_base, montant_offert, rayon_km, expire_at)
  values
    (auth.uid(), p_categorie, p_depart_label, p_depart_lat, p_depart_lng, p_arrivee_label, p_arrivee_lat, p_arrivee_lng,
     v_dist, v_tarif, p_montant_offert, public.cfg_num('rayon_initial_km'),
     now() + make_interval(secs => ((public.cfg_num('nb_relances_max') + 1) * public.cfg_num('delai_relance_secondes'))::float8))
  returning * into v_row;

  return v_row;
end;
$$;

-- Demandes en attente visibles par CE chauffeur : même catégorie que l'un de ses
-- véhicules, dans le rayon courant. Le rayon grandit avec le temps (0,5 km, puis
-- +0,5 km toutes les 2 min…) : les chauffeurs les plus proches voient donc la
-- demande en premier, les autres seulement si personne n'a répondu.
create or replace function public.pending_rides_nearby(p_lat float8, p_lng float8)
returns table (
  id uuid, categorie categorie_vehicule,
  depart_label text, arrivee_label text,
  depart_lat float8, depart_lng float8, arrivee_lat float8, arrivee_lng float8,
  distance_km numeric, tarif_base numeric, montant_offert numeric, prix_propose numeric,
  votre_tarif numeric, client_prenom text, distance_client_m numeric,
  rayon_courant_km numeric, expire_at timestamptz, created_at timestamptz
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
         r.expire_at, r.created_at
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

-- Verrou atomique : « UPDATE ... WHERE statut = 'en_attente' » ne réussit que pour
-- un seul chauffeur, même si plusieurs valident au même instant.
create or replace function public.accept_ride_request(p_ride_id uuid)
returns public.ride_requests
language plpgsql security definer set search_path = public as $$
declare
  v_row public.ride_requests;
begin
  perform public.assert_actor(array['chauffeur']::role_utilisateur[]);

  if public.has_unpaid_debt(auth.uid()) then
    raise exception 'compte_bloque: dette de commission impayée sur une course précédente';
  end if;
  if exists (select 1 from public.ride_requests where driver_id = auth.uid() and statut in ('assignee', 'en_cours')) then
    raise exception 'course_en_cours: terminez votre course actuelle avant d''en accepter une autre';
  end if;

  update public.ride_requests r
     set statut = 'assignee', driver_id = auth.uid()
   where r.id = p_ride_id
     and r.statut = 'en_attente'
     and r.expire_at > now()
     and r.client_id <> auth.uid()
     and exists (select 1 from public.vehicles v where v.user_id = auth.uid() and v.categorie = r.categorie)
   returning * into v_row;

  if not found then
    raise exception 'course_indisponible: déjà prise par un autre chauffeur, annulée, expirée ou d''une autre catégorie';
  end if;
  return v_row;
end;
$$;

create or replace function public.demarrer_course(p_ride_id uuid)
returns public.ride_requests
language plpgsql security definer set search_path = public as $$
declare
  v_row public.ride_requests;
begin
  perform public.assert_actor(array['chauffeur']::role_utilisateur[]);
  update public.ride_requests set statut = 'en_cours'
   where id = p_ride_id and driver_id = auth.uid() and statut = 'assignee'
   returning * into v_row;
  if not found then raise exception 'course_introuvable: course introuvable ou pas au bon statut'; end if;
  return v_row;
end;
$$;

create or replace function public.terminer_course(p_ride_id uuid, p_moyen moyen_paiement)
returns public.payments
language plpgsql security definer set search_path = public as $$
declare
  v_ride public.ride_requests;
  v_pay public.payments;
begin
  perform public.assert_actor(array['chauffeur']::role_utilisateur[]);

  select * into v_ride from public.ride_requests
   where id = p_ride_id and driver_id = auth.uid() and statut = 'en_cours' for update;
  if v_ride.id is null then raise exception 'course_introuvable: course introuvable ou pas en cours'; end if;

  -- Le paiement est créé d'abord : s'il est refusé (mode de paiement indisponible),
  -- la course reste en cours.
  v_pay := public._creer_paiement('ride', v_ride.id, 'trajet', v_ride.client_id, auth.uid(), p_moyen,
                                  coalesce(v_ride.montant_offert, v_ride.tarif_base));
  update public.ride_requests set statut = 'terminee' where id = v_ride.id;
  return v_pay;
end;
$$;

create or replace function public.annuler_course(p_ride_id uuid)
returns public.ride_requests
language plpgsql security definer set search_path = public as $$
declare
  v_row public.ride_requests;
begin
  if auth.uid() is null then raise exception 'non_authentifie: connexion requise'; end if;
  update public.ride_requests set statut = 'annulee'
   where id = p_ride_id and client_id = auth.uid() and statut in ('en_attente', 'assignee')
   returning * into v_row;
  if not found then raise exception 'annulation_impossible: course introuvable, déjà en cours ou terminée'; end if;
  return v_row;
end;
$$;

-- Le chauffeur se désiste : la course retourne dans le pool des demandes.
create or replace function public.chauffeur_desiste(p_ride_id uuid)
returns public.ride_requests
language plpgsql security definer set search_path = public as $$
declare
  v_row public.ride_requests;
begin
  perform public.assert_actor(array['chauffeur']::role_utilisateur[]);
  update public.ride_requests
     set statut = 'en_attente', driver_id = null,
         expire_at = greatest(expire_at, now() + make_interval(secs => public.cfg_num('delai_relance_secondes')::float8))
   where id = p_ride_id and driver_id = auth.uid() and statut = 'assignee'
   returning * into v_row;
  if not found then raise exception 'desistement_impossible: course introuvable ou déjà démarrée'; end if;
  return v_row;
end;
$$;

-- -----------------------------------------------------------------------------
-- 4. BUS TATA
-- -----------------------------------------------------------------------------
-- Bus visibles autour d'un point, avec temps d'arrivée estimé.
--  * Ligne avec tracé : ETA calculé le long du tracé (le bus doit être en amont
--    de l'utilisateur ; sinon statut « passe »).
--  * Ligne sans tracé : estimation à vol d'oiseau dans un rayon de 5 km (« approx »).
create or replace function public.bus_arrivals(p_lat float8, p_lng float8, p_rayon_m numeric default null)
returns table (
  bus_line_id uuid, nom_ligne text, terminus_depart text, terminus_arrivee text,
  bus_lat float8, bus_lng float8, distance_m numeric, eta_minutes numeric,
  vitesse_kmh numeric, statut text, mise_a_jour timestamptz
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
      select bl.id as lid, bl.nom_ligne, bl.terminus_depart, bl.terminus_arrivee, bl.trajet_geom,
             bp.lat, bp.lng, bp.position_geom, bp.updated_at,
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
    select r.lid as bus_line_id, r.nom_ligne, r.terminus_depart, r.terminus_arrivee,
           r.lat as bus_lat, r.lng as bus_lng,
           round((abs(r.fu - r.fb) * r.len)::numeric) as distance_m,
           case when r.fb <= r.fu
                then round(((abs(r.fu - r.fb) * r.len / 1000.0) / r.v::float8 * 60)::numeric, 1)
                else null::numeric end as eta_minutes,
           r.v as vitesse_kmh,
           (case when r.fb <= r.fu then 'approche' else 'passe' end)::text as statut,
           r.updated_at as mise_a_jour
      from routed r
    union all
    select b.lid, b.nom_ligne, b.terminus_depart, b.terminus_arrivee, b.lat, b.lng,
           round(ST_Distance(b.position_geom, v_me)::numeric),
           round(((ST_Distance(b.position_geom, v_me) / 1000.0) / b.v::float8 * 60)::numeric, 1),
           b.v, 'approx'::text, b.updated_at
      from base b
     where b.trajet_geom is null and ST_DWithin(b.position_geom, v_me, 5000)
  ) x
  order by (x.statut = 'passe'), x.eta_minutes nulls last, x.distance_m;
end;
$$;

-- -----------------------------------------------------------------------------
-- 5. LIVRAISON
-- -----------------------------------------------------------------------------
-- Commerçant le plus proche : respecte le réglage verification_requise.
create or replace function public.merchant_le_plus_proche(p_lat float8, p_lng float8, p_type type_commerce)
returns public.merchants
language sql stable security definer set search_path = public as $$
  select m.*
    from public.merchants m
   where m.type = p_type
     and (m.statut_verif = 'verifie' or not public.cfg_bool('verification_requise'))
   order by m.location_geom <-> ST_SetSRID(ST_MakePoint(p_lng, p_lat), 4326)::geography
   limit 1;
$$;

create or replace function public.create_delivery_order(
  p_type type_livraison,
  p_livraison_label text, p_livraison_lat float8, p_livraison_lng float8,
  p_collecte_label text default null, p_collecte_lat float8 default null, p_collecte_lng float8 default null,
  p_distance_km numeric default null,
  p_description text default null,
  p_ordonnance_path text default null,
  p_vehicule text default null
) returns public.delivery_orders
language plpgsql security definer set search_path = public as $$
declare
  v_merchant public.merchants;
  v_type_commerce type_commerce;
  v_base numeric;
  v_straight numeric;
  v_dist numeric;
  v_row public.delivery_orders;
begin
  perform public.assert_actor(array['client', 'chauffeur', 'receveur_bus', 'commercant']::role_utilisateur[]);

  if p_type = 'colis' then
    -- Livraison simple : prix calculé sur la distance, pas de devis.
    if p_collecte_lat is null or p_collecte_lng is null or p_collecte_label is null then
      raise exception 'collecte_manquante: indiquez le point de collecte';
    end if;
    select tarif_km_base into v_base from public.pricing_config where categorie = 'standard';
    v_straight := ST_Distance(
        ST_SetSRID(ST_MakePoint(p_collecte_lng, p_collecte_lat), 4326)::geography,
        ST_SetSRID(ST_MakePoint(p_livraison_lng, p_livraison_lat), 4326)::geography) / 1000.0;
    if v_straight < 0.1 then raise exception 'trajet_trop_court: collecte et livraison trop proches'; end if;
    v_dist := round(least(greatest(coalesce(p_distance_km, 0), v_straight), v_straight * 3), 2);

    insert into public.delivery_orders
      (client_id, type, collecte_label, collecte_lat, collecte_lng, livraison_label, livraison_lat, livraison_lng,
       description, vehicule_souhaite, distance_km, montant_livraison, statut)
    values
      (auth.uid(), 'colis', p_collecte_label, p_collecte_lat, p_collecte_lng, p_livraison_label, p_livraison_lat, p_livraison_lng,
       p_description, p_vehicule, v_dist,
       greatest(public.cfg_num('tarif_minimum'), round(v_dist * v_base / 25) * 25), 'approuvee')
    returning * into v_row;
    return v_row;
  end if;

  -- Livraison marchande : le commerçant le plus proche établit un devis.
  v_type_commerce := case p_type when 'pharmacie' then 'pharmacie' when 'repas' then 'restaurant' else 'marche' end;
  if p_type = 'pharmacie' then
    if p_ordonnance_path is null or p_ordonnance_path not like auth.uid()::text || '/%' then
      raise exception 'ordonnance_manquante: joignez la photo de votre ordonnance';
    end if;
  elsif p_description is null or length(trim(p_description)) < 3 then
    raise exception 'description_manquante: décrivez votre commande';
  end if;

  select * into v_merchant from public.merchant_le_plus_proche(p_livraison_lat, p_livraison_lng, v_type_commerce);
  if v_merchant.id is null then
    raise exception 'aucun_commercant: aucun partenaire de ce type n''est disponible pour le moment';
  end if;

  v_straight := ST_Distance(v_merchant.location_geom,
                            ST_SetSRID(ST_MakePoint(p_livraison_lng, p_livraison_lat), 4326)::geography) / 1000.0;

  insert into public.delivery_orders
    (client_id, type, merchant_id, photo_ordonnance_url, description,
     collecte_label, collecte_lat, collecte_lng, livraison_label, livraison_lat, livraison_lng,
     vehicule_souhaite, distance_km, statut)
  values
    (auth.uid(), p_type, v_merchant.id, p_ordonnance_path, p_description,
     v_merchant.nom_commerce, v_merchant.lat, v_merchant.lng, p_livraison_label, p_livraison_lat, p_livraison_lng,
     p_vehicule, round(v_straight, 2), 'en_attente_devis')
  returning * into v_row;
  return v_row;
end;
$$;

-- Le commerçant répond avec le prix de chaque article + le prix de la livraison.
-- p_lignes : [{"libelle": "Paracétamol 500mg", "prix": 850}, ...]
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
     set devis_lignes = p_lignes, montant_produits = v_total,
         montant_livraison = p_montant_livraison, devis_note = p_note, statut = 'devis_envoye'
   where d.id = p_delivery_id
     and d.statut in ('en_attente_devis', 'devis_envoye')
     and exists (select 1 from public.merchants m where m.id = d.merchant_id and m.owner_id = auth.uid())
   returning * into v_row;

  if not found then raise exception 'commande_introuvable: commande introuvable ou déjà traitée'; end if;
  return v_row;
end;
$$;

create or replace function public.refuser_commande(p_delivery_id uuid)
returns public.delivery_orders
language plpgsql security definer set search_path = public as $$
declare
  v_row public.delivery_orders;
begin
  perform public.assert_actor(array['commercant']::role_utilisateur[]);
  update public.delivery_orders d set statut = 'annulee'
   where d.id = p_delivery_id
     and d.statut in ('en_attente_devis', 'devis_envoye')
     and exists (select 1 from public.merchants m where m.id = d.merchant_id and m.owner_id = auth.uid())
   returning * into v_row;
  if not found then raise exception 'commande_introuvable: commande introuvable ou déjà traitée'; end if;
  return v_row;
end;
$$;

create or replace function public.approuver_devis(p_delivery_id uuid)
returns public.delivery_orders
language plpgsql security definer set search_path = public as $$
declare
  v_row public.delivery_orders;
begin
  if auth.uid() is null then raise exception 'non_authentifie: connexion requise'; end if;
  update public.delivery_orders set statut = 'approuvee'
   where id = p_delivery_id and client_id = auth.uid() and statut = 'devis_envoye'
   returning * into v_row;
  if not found then raise exception 'devis_introuvable: aucun devis à approuver pour cette commande'; end if;
  return v_row;
end;
$$;

create or replace function public.annuler_livraison(p_delivery_id uuid)
returns public.delivery_orders
language plpgsql security definer set search_path = public as $$
declare
  v_row public.delivery_orders;
begin
  if auth.uid() is null then raise exception 'non_authentifie: connexion requise'; end if;
  update public.delivery_orders set statut = 'annulee'
   where id = p_delivery_id and client_id = auth.uid()
     and statut in ('en_attente_devis', 'devis_envoye', 'approuvee')
   returning * into v_row;
  if not found then raise exception 'annulation_impossible: commande introuvable ou déjà prise en charge'; end if;
  return v_row;
end;
$$;

create or replace function public.pending_deliveries_nearby(p_lat float8, p_lng float8)
returns table (
  id uuid, type type_livraison, commerce text,
  collecte_label text, collecte_lat float8, collecte_lng float8,
  livraison_label text, livraison_lat float8, livraison_lng float8,
  montant_livraison numeric, vehicule_souhaite text,
  distance_collecte_m numeric, rayon_courant_km numeric, created_at timestamptz
)
language plpgsql stable security definer set search_path = public as $$
#variable_conflict use_column
declare
  v_pt geography := ST_SetSRID(ST_MakePoint(p_lng, p_lat), 4326)::geography;
  v_r0 numeric := public.cfg_num('livraison_rayon_initial_km');
  v_inc numeric := public.cfg_num('livraison_rayon_increment_km');
  v_delai numeric := public.cfg_num('livraison_delai_relance_s');
  v_max numeric := public.cfg_num('livraison_rayon_max_km');
begin
  perform public.assert_actor(array['chauffeur']::role_utilisateur[]);

  return query
  select d.id, d.type, m.nom_commerce,
         d.collecte_label, d.collecte_lat, d.collecte_lng,
         d.livraison_label, d.livraison_lat, d.livraison_lng,
         d.montant_livraison, d.vehicule_souhaite,
         round(ST_Distance(d.collecte_geom, v_pt))::numeric,
         least(v_max, v_r0 + floor(extract(epoch from (now() - d.approuvee_at)) / v_delai) * v_inc),
         d.created_at
    from public.delivery_orders d
    left join public.merchants m on m.id = d.merchant_id
   where d.statut = 'approuvee'
     and d.chauffeur_id is null
     and d.client_id <> auth.uid()
     and public.vehicule_compatible(auth.uid(), d.vehicule_souhaite)
     and ST_DWithin(d.collecte_geom, v_pt,
           least(v_max, v_r0 + floor(extract(epoch from (now() - d.approuvee_at)) / v_delai) * v_inc) * 1000)
   order by ST_Distance(d.collecte_geom, v_pt) asc;
end;
$$;

create or replace function public.accept_delivery_order(p_delivery_id uuid)
returns public.delivery_orders
language plpgsql security definer set search_path = public as $$
declare
  v_row public.delivery_orders;
begin
  perform public.assert_actor(array['chauffeur']::role_utilisateur[]);

  if public.has_unpaid_debt(auth.uid()) then
    raise exception 'compte_bloque: dette de commission impayée sur une course précédente';
  end if;
  if exists (select 1 from public.delivery_orders where chauffeur_id = auth.uid() and statut = 'en_livraison') then
    raise exception 'livraison_en_cours: terminez votre livraison actuelle avant d''en accepter une autre';
  end if;

  update public.delivery_orders d
     set statut = 'en_livraison', chauffeur_id = auth.uid()
   where d.id = p_delivery_id
     and d.statut = 'approuvee'
     and d.chauffeur_id is null
     and d.client_id <> auth.uid()
     and public.vehicule_compatible(auth.uid(), d.vehicule_souhaite)
   returning * into v_row;

  if not found then
    raise exception 'livraison_indisponible: déjà prise en charge, annulée, ou véhicule non adapté';
  end if;
  return v_row;
end;
$$;

-- Fin de livraison. Livraison simple : un paiement (livraison → livreur).
-- Livraison marchande : deux paiements distincts, chacun avec 5 % de commission —
-- produits → commerçant, livraison → livreur. Le paiement marchand doit être en
-- ligne (jamais en espèces), car le commerçant est réglé par la plateforme.
create or replace function public.terminer_livraison(p_delivery_id uuid, p_moyen moyen_paiement)
returns setof public.payments
language plpgsql security definer set search_path = public as $$
declare
  v_d public.delivery_orders;
  v_owner uuid;
begin
  perform public.assert_actor(array['chauffeur']::role_utilisateur[]);

  select * into v_d from public.delivery_orders
   where id = p_delivery_id and chauffeur_id = auth.uid() and statut = 'en_livraison' for update;
  if v_d.id is null then raise exception 'livraison_introuvable: livraison introuvable ou pas en cours'; end if;

  if v_d.merchant_id is not null then
    if p_moyen = 'especes' then
      raise exception 'paiement_en_ligne_requis: une commande marchande se règle par Wave ou Orange Money';
    end if;
    select owner_id into v_owner from public.merchants where id = v_d.merchant_id;

    return query select p.* from public._creer_paiement('delivery', v_d.id, 'produits', v_d.client_id, v_owner, p_moyen, v_d.montant_produits) p;
    return query select p.* from public._creer_paiement('delivery', v_d.id, 'livraison', v_d.client_id, auth.uid(), p_moyen, v_d.montant_livraison) p;
  else
    return query select p.* from public._creer_paiement('delivery', v_d.id, 'livraison', v_d.client_id, auth.uid(), p_moyen, v_d.montant_livraison) p;
  end if;

  update public.delivery_orders set statut = 'livree' where id = v_d.id;
end;
$$;

-- -----------------------------------------------------------------------------
-- 6. AVIS
-- -----------------------------------------------------------------------------
-- Course (client <-> chauffeur, après « terminee ») ou trajet interurbain
-- (passager -> chauffeur, après « termine »). Met à jour la note moyenne du destinataire.
create or replace function public.noter(p_source_type text, p_source_id uuid, p_note smallint, p_commentaire text default null)
returns public.reviews
language plpgsql security definer set search_path = public as $$
declare
  v_dest uuid;
  v_ride public.ride_requests;
  v_trip public.trips;
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

-- -----------------------------------------------------------------------------
-- 7. DROITS D'EXÉCUTION
-- -----------------------------------------------------------------------------
-- Les fonctions ci-dessus vérifient elles-mêmes auth.uid(). On retire simplement
-- l'accès aux visiteurs non connectés (anon) pour tout ce qui n'est pas public.
do $$
declare f text;
begin
  foreach f in array array[
    'assert_actor(role_utilisateur[])', 'mon_statut_chauffeur()', 'regler_dette(uuid)',
    'reserver_trajet(uuid,smallint)', 'confirmer_reservation(uuid)', 'annuler_reservation(uuid)',
    'terminer_trajet(uuid)', 'annuler_trajet(uuid)', 'encaisser_reservation(uuid,moyen_paiement)',
    'create_ride_request(categorie_vehicule,text,float8,float8,text,float8,float8,numeric,numeric)',
    'pending_rides_nearby(float8,float8)', 'accept_ride_request(uuid)', 'demarrer_course(uuid)',
    'terminer_course(uuid,moyen_paiement)', 'annuler_course(uuid)', 'chauffeur_desiste(uuid)',
    'create_delivery_order(type_livraison,text,float8,float8,text,float8,float8,numeric,text,text,text)',
    'envoyer_devis(uuid,jsonb,numeric,text)', 'refuser_commande(uuid)', 'approuver_devis(uuid)',
    'annuler_livraison(uuid)', 'pending_deliveries_nearby(float8,float8)', 'accept_delivery_order(uuid)',
    'terminer_livraison(uuid,moyen_paiement)', 'noter(text,uuid,smallint,text)'
  ] loop
    execute format('revoke execute on function public.%s from anon', f);
  end loop;
end $$;
