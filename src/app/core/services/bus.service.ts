import { Injectable } from '@angular/core';
import { BusArrival, BusLine, BusTrajet } from '../models/models';
import { SupabaseService } from './supabase.service';

@Injectable({ providedIn: 'root' })
export class BusService {
  constructor(private sb: SupabaseService) {}

  arrivals(lat: number, lng: number) {
    return this.sb.rpc<BusArrival[]>('bus_arrivals', { p_lat: lat, p_lng: lng });
  }

  /** Bus sur un trajet A → B (lignes qui passent près des deux points, dans le bon sens). */
  trajet(from: { lat: number; lng: number }, to: { lat: number; lng: number }) {
    return this.sb.rpc<BusTrajet[]>('bus_trajet', { p_from_lat: from.lat, p_from_lng: from.lng, p_to_lat: to.lat, p_to_lng: to.lng });
  }

  /** Toutes les lignes actives (un receveur peut faire circuler son bus sur une ligne existante). */
  async activeLines(): Promise<BusLine[]> {
    const { data, error } = await this.sb.client.from('bus_lines').select('*').eq('actif', true).order('nom_ligne');
    if (error) throw error;
    return data as BusLine[];
  }

  async linesByIds(ids: string[]): Promise<BusLine[]> {
    if (!ids.length) return [];
    const { data, error } = await this.sb.client.from('bus_lines').select('*').in('id', ids);
    if (error) throw error;
    return data as BusLine[];
  }

  async myLines(): Promise<BusLine[]> {
    const { data, error } = await this.sb.client
      .from('bus_lines').select('*').eq('receveur_id', this.sb.uid!).order('created_at', { ascending: false });
    if (error) throw error;
    return data as BusLine[];
  }

  async createLine(l: { nom_ligne: string; terminus_depart: string; terminus_arrivee: string; trajet: [number, number][] | null }) {
    const { data, error } = await this.sb.client
      .from('bus_lines').insert({ ...l, receveur_id: this.sb.uid! }).select().single();
    if (error) throw error;
    return data as BusLine;
  }

  async setActive(id: string, actif: boolean) {
    const { error } = await this.sb.client.from('bus_lines').update({ actif }).eq('id', id);
    if (error) throw error;
  }

  async deleteLine(id: string) {
    const { error } = await this.sb.client.from('bus_lines').delete().eq('id', id);
    if (error) throw error;
  }

  /** Une position par (ligne, receveur) : chaque receveur fait circuler SON bus. */
  async sendPosition(lineId: string, lat: number, lng: number, vitesseKmh: number | null, busLabel: string | null) {
    const { error } = await this.sb.client
      .from('bus_positions')
      .upsert(
        { bus_line_id: lineId, receveur_id: this.sb.uid!, lat, lng, vitesse_estimee: vitesseKmh, bus_label: busLabel },
        { onConflict: 'bus_line_id,receveur_id' },
      );
    if (error) throw error;
  }

  /** Retire mon bus de la carte (fin de service). */
  async stopPosition(lineId: string) {
    const { error } = await this.sb.client.from('bus_positions').delete().eq('bus_line_id', lineId).eq('receveur_id', this.sb.uid!);
    if (error) throw error;
  }
}
