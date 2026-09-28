import { Injectable } from '@angular/core';
import { CategorieVehicule, DriverLocation, DriverStatus, DriverPricing, Payment, Vehicle } from '../models/models';
import { SupabaseService } from './supabase.service';

export interface TarifMoyen { categorie: CategorieVehicule; tarif_moyen: number; nb_chauffeurs: number }

@Injectable({ providedIn: 'root' })
export class DriverService {
  constructor(private sb: SupabaseService) {}

  status() { return this.sb.rpc<DriverStatus>('mon_statut_chauffeur'); }
  settleDebt(id: string) { return this.sb.rpc('regler_dette', { p_ledger_id: id }); }

  async vehicles(): Promise<Vehicle[]> {
    const { data, error } = await this.sb.client.from('vehicles').select('*').eq('user_id', this.sb.uid!).order('created_at');
    if (error) throw error;
    return data as Vehicle[];
  }

  async addVehicle(v: { categorie: CategorieVehicule; marque: string | null; modele: string | null; immatriculation: string | null }) {
    const { data, error } = await this.sb.client.from('vehicles').insert({ ...v, user_id: this.sb.uid! }).select().single();
    if (error) throw error;
    return data as Vehicle;
  }

  async deleteVehicle(id: string) {
    const { error } = await this.sb.client.from('vehicles').delete().eq('id', id);
    if (error) throw error;
  }

  async myPricing(): Promise<DriverPricing[]> {
    const { data, error } = await this.sb.client.from('driver_pricing').select('*').eq('driver_id', this.sb.uid!);
    if (error) throw error;
    return data as DriverPricing[];
  }

  async averages(): Promise<TarifMoyen[]> {
    const { data, error } = await this.sb.client.from('tarif_moyen_par_categorie').select('*');
    if (error) throw error;
    return data as TarifMoyen[];
  }

  async savePricing(categorie: CategorieVehicule, tarif: number) {
    const { error } = await this.sb.client
      .from('driver_pricing')
      .upsert({ driver_id: this.sb.uid!, categorie, tarif_km_choisi: tarif, updated_at: new Date().toISOString() }, { onConflict: 'driver_id,categorie' });
    if (error) throw error;
  }

  async earnings(): Promise<Payment[]> {
    const { data, error } = await this.sb.client
      .from('payments').select('*').eq('beneficiaire_id', this.sb.uid!).order('created_at', { ascending: false }).limit(40);
    if (error) throw error;
    return data as Payment[];
  }

  // ---------- position en direct ----------
  async pushLocation(lat: number, lng: number, vitesseKmh: number | null) {
    const { error } = await this.sb.client
      .from('driver_locations')
      .upsert({ driver_id: this.sb.uid!, lat, lng, vitesse_kmh: vitesseKmh }, { onConflict: 'driver_id' });
    if (error) throw error;
  }

  async clearLocation() {
    const { error } = await this.sb.client.from('driver_locations').delete().eq('driver_id', this.sb.uid!);
    if (error) throw error;
  }

  /** Position d'un chauffeur visible par son client (course / livraison en cours uniquement). */
  async locationOf(driverId: string): Promise<DriverLocation | null> {
    const { data } = await this.sb.client.from('driver_locations').select('*').eq('driver_id', driverId).maybeSingle();
    return (data as DriverLocation) ?? null;
  }
}
