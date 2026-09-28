import { Injectable } from '@angular/core';
import {
  CategorieVehicule, MoyenPaiement, NearbyRide, Payment, PricingConfig, RideRequest,
} from '../models/models';
import { SupabaseService } from './supabase.service';

export interface NewRide {
  categorie: CategorieVehicule;
  depart: { label: string; lat: number; lng: number };
  arrivee: { label: string; lat: number; lng: number };
  distanceKm: number;
  montantOffert: number | null;
}

/** Réglages de diffusion (table app_config), utilisés pour l'affichage côté client. */
export interface RideSettings {
  rayonInitialKm: number;
  rayonIncrementKm: number;
  delaiRelanceS: number;
  tarifMinimum: number;
  offreMinPct: number;
}

@Injectable({ providedIn: 'root' })
export class RidesService {
  private pricingCache?: PricingConfig[];
  private settingsCache?: RideSettings;

  constructor(private sb: SupabaseService) {}

  async pricing(): Promise<PricingConfig[]> {
    if (this.pricingCache) return this.pricingCache;
    const { data, error } = await this.sb.client.from('pricing_config').select('*').order('tarif_km_base');
    if (error) throw error;
    this.pricingCache = data as PricingConfig[];
    return this.pricingCache;
  }

  async settings(): Promise<RideSettings> {
    if (this.settingsCache) return this.settingsCache;
    const { data, error } = await this.sb.client.from('app_config').select('cle, valeur');
    if (error) throw error;
    const m = new Map((data as { cle: string; valeur: string }[]).map((r) => [r.cle, r.valeur]));
    const n = (k: string, d: number) => (m.has(k) ? Number(m.get(k)) : d);
    this.settingsCache = {
      rayonInitialKm: n('rayon_initial_km', 0.5),
      rayonIncrementKm: n('rayon_increment_km', 0.5),
      delaiRelanceS: n('delai_relance_secondes', 120),
      tarifMinimum: n('tarif_minimum', 500),
      offreMinPct: n('offre_min_pct', 50),
    };
    return this.settingsCache;
  }

  /** Tarif estimé (même formule que le serveur, qui reste seul juge). */
  estimate(distanceKm: number, tarifKmBase: number, minimum: number): number {
    return Math.max(minimum, Math.round((distanceKm * tarifKmBase) / 25) * 25);
  }

  // ---------- côté client ----------
  async create(r: NewRide): Promise<RideRequest> {
    return this.sb.rpc<RideRequest>('create_ride_request', {
      p_categorie: r.categorie,
      p_depart_label: r.depart.label, p_depart_lat: r.depart.lat, p_depart_lng: r.depart.lng,
      p_arrivee_label: r.arrivee.label, p_arrivee_lat: r.arrivee.lat, p_arrivee_lng: r.arrivee.lng,
      p_distance_km: r.distanceKm,
      p_montant_offert: r.montantOffert,
    });
  }

  /** Dernière course du client connecté (quel que soit son statut). */
  async latestAsClient(): Promise<RideRequest | null> {
    await this.sb.rpc('expire_stale_rides');
    const { data, error } = await this.sb.client
      .from('ride_requests').select('*').eq('client_id', this.sb.uid!)
      .order('created_at', { ascending: false }).limit(1);
    if (error) throw error;
    return (data?.[0] as RideRequest) ?? null;
  }

  cancel(id: string) { return this.sb.rpc<RideRequest>('annuler_course', { p_ride_id: id }); }

  async hasReviewed(sourceType: 'ride' | 'trip' | 'delivery' | 'commerce', sourceId: string): Promise<boolean> {
    const { data, error } = await this.sb.client
      .from('reviews').select('id').eq('source_type', sourceType).eq('source_id', sourceId).eq('auteur_id', this.sb.uid!).limit(1);
    if (error) throw error;
    return (data?.length ?? 0) > 0;
  }

  rate(sourceType: 'ride' | 'trip' | 'delivery' | 'commerce', sourceId: string, note: number, commentaire: string | null) {
    return this.sb.rpc('noter', { p_source_type: sourceType, p_source_id: sourceId, p_note: note, p_commentaire: commentaire });
  }

  async paymentFor(sourceId: string): Promise<Payment | null> {
    const { data, error } = await this.sb.client.from('payments').select('*').eq('source_id', sourceId).limit(1);
    if (error) throw error;
    return (data?.[0] as Payment) ?? null;
  }

  // ---------- côté chauffeur ----------
  nearby(lat: number, lng: number) {
    return this.sb.rpc<NearbyRide[]>('pending_rides_nearby', { p_lat: lat, p_lng: lng });
  }
  accept(id: string) { return this.sb.rpc<RideRequest>('accept_ride_request', { p_ride_id: id }); }
  start(id: string) { return this.sb.rpc<RideRequest>('demarrer_course', { p_ride_id: id }); }
  finish(id: string, moyen: MoyenPaiement) { return this.sb.rpc<Payment>('terminer_course', { p_ride_id: id, p_moyen: moyen }); }
  desist(id: string) { return this.sb.rpc<RideRequest>('chauffeur_desiste', { p_ride_id: id }); }

  async activeAsDriver(): Promise<RideRequest | null> {
    const { data, error } = await this.sb.client
      .from('ride_requests').select('*').eq('driver_id', this.sb.uid!).in('statut', ['assignee', 'en_cours'])
      .order('created_at', { ascending: false }).limit(1);
    if (error) throw error;
    return (data?.[0] as RideRequest) ?? null;
  }
}
