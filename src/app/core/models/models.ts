// Types reflétant les tables définies dans supabase/schema.sql
// Voir le Document de référence technique YOBBALEMA (v3) pour le détail du modèle.

export type Role = 'client' | 'chauffeur' | 'receveur_bus' | 'commercant';
export type CategorieVehicule = 'standard' | 'confort' | 'pro' | 'moto' | 'jakarta' | 'tiak_tiak';
export type StatutVerif = 'en_attente' | 'verifie' | 'rejete';

export interface Profile {
  id: string;
  nom: string | null;
  prenom: string | null;
  telephone: string | null;
  role: Role;
  cni_url: string | null;
  permis_url: string | null;
  statut_verif: StatutVerif;
  note_moyenne: number | null;
  suspendu_jusqua: string | null;
  created_at: string;
}

export interface Vehicle {
  id: string;
  user_id: string;
  categorie: CategorieVehicule;
  marque: string | null;
  modele: string | null;
  immatriculation: string | null;
  carte_grise_url: string | null;
  created_at: string;
}

export interface PricingConfig {
  id: string;
  categorie: CategorieVehicule;
  tarif_km_min: number;
  tarif_km_max: number;
  tarif_km_base: number;
}

export interface DriverPricing {
  id: string;
  driver_id: string;
  categorie: CategorieVehicule;
  tarif_km_choisi: number;
}

export type StatutTrip = 'ouvert' | 'complet' | 'termine' | 'annule';

export interface Trip {
  id: string;
  driver_id: string;
  vehicle_id: string;
  depart_label: string;
  arrivee_label: string;
  depart_lat: number;
  depart_lng: number;
  arrivee_lat: number;
  arrivee_lng: number;
  date_heure_depart: string;
  places_dispo: number;
  prix_place: number;
  statut: StatutTrip;
  created_at: string;
}

export type StatutReservation = 'en_attente' | 'confirmee' | 'annulee';

export interface Reservation {
  id: string;
  trip_id: string;
  passager_id: string;
  nb_places: number;
  statut: StatutReservation;
  created_at: string;
}

export type StatutRide = 'en_attente' | 'assignee' | 'en_cours' | 'terminee' | 'expiree' | 'annulee';

export interface RideRequest {
  id: string;
  client_id: string;
  categorie: CategorieVehicule;
  depart_label: string;
  arrivee_label: string;
  depart_lat: number;
  depart_lng: number;
  arrivee_lat: number;
  arrivee_lng: number;
  distance_km: number;
  tarif_base: number;
  montant_offert: number | null;
  rayon_km: number;
  statut: StatutRide;
  driver_id: string | null;
  created_at: string;
  derniere_relance: string;
  expire_at: string;
}

export type MoyenPaiement = 'wave' | 'orange_money' | 'especes';
export type SourcePaiement = 'trip' | 'ride' | 'delivery';

export interface Payment {
  id: string;
  source_type: SourcePaiement;
  source_id: string;
  categorie_montant: CategorieMontant;
  payeur_id: string | null;
  beneficiaire_id: string | null;
  moyen: MoyenPaiement;
  montant: number;
  commission_pct: number;
  statut_transaction: string;
  reference_externe: string | null;
  created_at: string;
}

export interface DriverLedgerEntry {
  id: string;
  driver_id: string;
  payment_id: string | null;
  montant: number;
  regle: boolean;
  regle_type: 'auto' | 'manuel' | null;
  regle_at: string | null;
  created_at: string;
}

export interface BusLine {
  id: string;
  receveur_id: string;
  nom_ligne: string;
  terminus_depart: string | null;
  terminus_arrivee: string | null;
  /** Tracé de la ligne : liste de points [lat, lng]. */
  trajet: [number, number][] | null;
  actif: boolean;
  created_at: string;
}

export interface BusPosition {
  id: string;
  bus_line_id: string;
  lat: number;
  lng: number;
  vitesse_estimee: number | null;
  updated_at: string;
}

export type TypeCommerce = 'pharmacie' | 'restaurant' | 'marche';

export interface Merchant {
  id: string;
  owner_id: string;
  type: TypeCommerce;
  nom_commerce: string;
  lat: number;
  lng: number;
  statut_verif: StatutVerif;
}

export type TypeLivraison = 'colis' | 'repas' | 'pharmacie' | 'marche';
export type StatutLivraison = 'en_attente_devis' | 'devis_envoye' | 'approuvee' | 'en_livraison' | 'livree' | 'annulee';

export interface DevisLigne {
  libelle: string;
  prix: number;
}

export type VehiculeLivraison = 'voiture' | 'moto' | 'jakarta' | 'tiak_tiak';

export interface DeliveryOrder {
  id: string;
  client_id: string;
  type: TypeLivraison;
  merchant_id: string | null;
  /** Chemin du fichier dans le bucket privé « ordonnances ». */
  photo_ordonnance_url: string | null;
  description: string | null;
  collecte_label: string;
  collecte_lat: number;
  collecte_lng: number;
  livraison_label: string;
  livraison_lat: number;
  livraison_lng: number;
  montant_produits: number | null;
  montant_livraison: number | null;
  devis_lignes: DevisLigne[] | null;
  devis_note: string | null;
  vehicule_souhaite: VehiculeLivraison | null;
  distance_km: number | null;
  chauffeur_id: string | null;
  motif_annulation: string | null;
  devis_expire_at: string | null;
  statut: StatutLivraison;
  created_at: string;
}

export interface Review {
  id: string;
  source_type: 'trip' | 'ride' | 'delivery' | 'commerce';
  source_id: string;
  auteur_id: string;
  destinataire_id: string | null;
  note: number;
  commentaire: string | null;
  created_at: string;
}

export interface PublicProfile {
  id: string;
  prenom: string | null;
  note_moyenne: number | null;
  role: Role;
}

export type CategorieMontant = 'trajet' | 'produits' | 'livraison';

/** Résultat de pending_rides_nearby() : demande de course visible par un chauffeur. */
export interface NearbyRide {
  id: string;
  categorie: CategorieVehicule;
  depart_label: string;
  arrivee_label: string;
  depart_lat: number;
  depart_lng: number;
  arrivee_lat: number;
  arrivee_lng: number;
  distance_km: number;
  tarif_base: number;
  montant_offert: number | null;
  prix_propose: number;
  votre_tarif: number;
  client_prenom: string | null;
  client_note: number | null;
  distance_client_m: number;
  rayon_courant_km: number;
  expire_at: string;
  created_at: string;
}

/** Résultat de pending_deliveries_nearby() : livraison visible par un livreur. */
export interface NearbyDelivery {
  id: string;
  type: TypeLivraison;
  commerce: string | null;
  collecte_label: string;
  collecte_lat: number;
  collecte_lng: number;
  livraison_label: string;
  livraison_lat: number;
  livraison_lng: number;
  montant_livraison: number;
  vehicule_souhaite: VehiculeLivraison | null;
  distance_collecte_m: number;
  rayon_courant_km: number;
  created_at: string;
}

/** Résultat de bus_arrivals() : une ligne par BUS (une ligne de bus compte plusieurs bus). */
export interface BusArrival {
  bus_id: string;
  bus_label: string | null;
  bus_line_id: string;
  nom_ligne: string;
  terminus_depart: string | null;
  terminus_arrivee: string | null;
  bus_lat: number;
  bus_lng: number;
  distance_m: number;
  eta_minutes: number | null;
  vitesse_kmh: number;
  statut: 'approche' | 'passe' | 'approx';
  mise_a_jour: string;
}

/** Résultat de bus_trajet() : bus « sur mon trajet » de A vers B. */
export interface BusTrajet extends Omit<BusArrival, 'bus_id' | 'bus_lat' | 'bus_lng' | 'distance_m' | 'statut'> {
  bus_id: string | null;
  bus_lat: number | null;
  bus_lng: number | null;
  distance_m: number | null;
  duree_trajet_min: number;
  distance_trajet_m: number;
  statut: 'approche' | 'passe' | 'aucun_bus';
}

export interface AppNotification {
  id: string;
  user_id: string;
  type: string;
  titre: string;
  corps: string | null;
  data: Record<string, string>;
  lu: boolean;
  created_at: string;
}

export interface DriverLocation {
  driver_id: string;
  lat: number;
  lng: number;
  vitesse_kmh: number | null;
  updated_at: string;
}

export interface PaymentIntent {
  id: string;
  ref_courte: string;
  kind: 'paiement' | 'dette';
  montant: number;
  provider: 'wave' | 'orange_money';
  checkout_url: string | null;
  statut: 'cree' | 'en_attente' | 'reussi' | 'echoue' | 'expire';
  detail: string | null;
  expires_at: string;
}

/** Résultat de mon_solde() : ce que la plateforme doit encore reverser à l'utilisateur. */
export interface Solde {
  a_verser: number;
  en_attente_de_paiement: number;
  dettes_deduites: number;
  deja_verse: number;
}

export interface AdminStats {
  utilisateurs: Record<string, number>;
  verifications_en_attente: number;
  commerces_en_attente: number;
  courses_terminees: number;
  courses_aujourdhui: number;
  courses_en_attente: number;
  livraisons_livrees: number;
  trajets_ouverts: number;
  bus_actifs: number;
  volume_paiements: number;
  commissions_generees: number;
  dettes_en_cours: number;
  chauffeurs_bloques: number;
  paiements_en_attente: number;
  a_verser_total: number;
  anomalies_paiement: number;
  comptes_suspendus: number;
}

/** Résultat de mon_statut_chauffeur(). */
export interface DriverStatus {
  role: Role;
  statut_verif: StatutVerif;
  verification_requise: boolean;
  bloque: boolean;
  dette_total: number;
  dettes: { id: string; montant: number; created_at: string }[];
  mode_test_paiements: boolean;
}
