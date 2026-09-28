import { Injectable } from '@angular/core';
import {
  DeliveryOrder, DevisLigne, Merchant, MoyenPaiement, NearbyDelivery, Payment,
  TypeCommerce, TypeLivraison, VehiculeLivraison,
} from '../models/models';
import { SupabaseService } from './supabase.service';

export interface NewDelivery {
  type: TypeLivraison;
  livraison: { label: string; lat: number; lng: number };
  collecte?: { label: string; lat: number; lng: number } | null;
  distanceKm?: number | null;
  description?: string | null;
  ordonnancePath?: string | null;
  vehicule?: VehiculeLivraison | null;
}

@Injectable({ providedIn: 'root' })
export class DeliveryService {
  constructor(private sb: SupabaseService) {}

  create(d: NewDelivery) {
    return this.sb.rpc<DeliveryOrder>('create_delivery_order', {
      p_type: d.type,
      p_livraison_label: d.livraison.label, p_livraison_lat: d.livraison.lat, p_livraison_lng: d.livraison.lng,
      p_collecte_label: d.collecte?.label ?? null, p_collecte_lat: d.collecte?.lat ?? null, p_collecte_lng: d.collecte?.lng ?? null,
      p_distance_km: d.distanceKm ?? null,
      p_description: d.description ?? null,
      p_ordonnance_path: d.ordonnancePath ?? null,
      p_vehicule: d.vehicule ?? null,
    });
  }

  /** Envoie l'ordonnance dans le bucket privé et renvoie son chemin (à passer à create). */
  async uploadPrescription(file: File): Promise<string> {
    const ext = (file.name.split('.').pop() || 'jpg').toLowerCase().replace(/[^a-z0-9]/g, '');
    const path = `${this.sb.uid}/${crypto.randomUUID()}.${ext}`;
    const { error } = await this.sb.client.storage.from('ordonnances').upload(path, file, { contentType: file.type });
    if (error) throw error;
    return path;
  }

  /** Identifiants des commandes déjà notées par l'utilisateur, par type d'avis. */
  async reviewedKeys(ids: string[]): Promise<Set<string>> {
    if (!ids.length) return new Set();
    const { data, error } = await this.sb.client.from('reviews').select('source_type, source_id')
      .eq('auteur_id', this.sb.uid!).in('source_type', ['delivery', 'commerce']).in('source_id', ids);
    if (error) throw error;
    return new Set((data as { source_type: string; source_id: string }[]).map((r) => `${r.source_type}:${r.source_id}`));
  }

  async signedUrl(bucket: 'ordonnances' | 'documents', path: string): Promise<string | null> {
    const { data, error } = await this.sb.client.storage.from(bucket).createSignedUrl(path, 600);
    if (error) return null;
    return data.signedUrl;
  }

  /** Applique les expirations (commerçant sans réponse, devis périmé) avant de lire les commandes. */
  private expireStale() { return this.sb.rpc('expire_stale_deliveries').catch(() => undefined); }

  async myOrders(): Promise<DeliveryOrder[]> {
    await this.expireStale();
    const { data, error } = await this.sb.client
      .from('delivery_orders').select('*').eq('client_id', this.sb.uid!).order('created_at', { ascending: false }).limit(30);
    if (error) throw error;
    return data as DeliveryOrder[];
  }

  approve(id: string) { return this.sb.rpc<DeliveryOrder>('approuver_devis', { p_delivery_id: id }); }
  cancel(id: string) { return this.sb.rpc<DeliveryOrder>('annuler_livraison', { p_delivery_id: id }); }

  // ---------- commerçant ----------
  async myMerchant(): Promise<Merchant | null> {
    const { data, error } = await this.sb.client.from('merchants').select('*').eq('owner_id', this.sb.uid!).limit(1);
    if (error) throw error;
    return (data?.[0] as Merchant) ?? null;
  }

  async createMerchant(m: { type: TypeCommerce; nom_commerce: string; lat: number; lng: number }) {
    const { data, error } = await this.sb.client.from('merchants').insert({ ...m, owner_id: this.sb.uid! }).select().single();
    if (error) throw error;
    return data as Merchant;
  }

  async merchantOrders(merchantId: string): Promise<DeliveryOrder[]> {
    await this.expireStale();
    const { data, error } = await this.sb.client
      .from('delivery_orders').select('*').eq('merchant_id', merchantId).order('created_at', { ascending: false }).limit(40);
    if (error) throw error;
    return data as DeliveryOrder[];
  }

  sendQuote(id: string, lignes: DevisLigne[], montantLivraison: number, note: string | null) {
    return this.sb.rpc<DeliveryOrder>('envoyer_devis', {
      p_delivery_id: id, p_lignes: lignes, p_montant_livraison: montantLivraison, p_note: note,
    });
  }
  refuse(id: string) { return this.sb.rpc<DeliveryOrder>('refuser_commande', { p_delivery_id: id }); }

  // ---------- livreur ----------
  nearby(lat: number, lng: number) {
    return this.sb.rpc<NearbyDelivery[]>('pending_deliveries_nearby', { p_lat: lat, p_lng: lng });
  }
  accept(id: string) { return this.sb.rpc<DeliveryOrder>('accept_delivery_order', { p_delivery_id: id }); }
  finish(id: string, moyen: MoyenPaiement) { return this.sb.rpc<Payment[]>('terminer_livraison', { p_delivery_id: id, p_moyen: moyen }); }

  async activeAsDriver(): Promise<DeliveryOrder | null> {
    const { data, error } = await this.sb.client
      .from('delivery_orders').select('*').eq('chauffeur_id', this.sb.uid!).eq('statut', 'en_livraison')
      .order('created_at', { ascending: false }).limit(1);
    if (error) throw error;
    return (data?.[0] as DeliveryOrder) ?? null;
  }
}
