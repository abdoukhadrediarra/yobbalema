import { Injectable } from '@angular/core';
import { MoyenPaiement, Payment, PublicProfile, Reservation, Trip, Vehicle } from '../models/models';
import { SupabaseService } from './supabase.service';

export interface TripFilters {
  depart?: string;
  arrivee?: string;
  date?: string; // AAAA-MM-JJ
}

export type TripWithReservations = Trip & { reservations: Reservation[] };
export type ReservationWithTrip = Reservation & { trip: Trip };

@Injectable({ providedIn: 'root' })
export class TripsService {
  constructor(private sb: SupabaseService) {}

  async search(f: TripFilters): Promise<Trip[]> {
    let q = this.sb.client.from('trips').select('*').eq('statut', 'ouvert').gt('places_dispo', 0);
    const debut = f.date ? new Date(f.date + 'T00:00:00') : new Date();
    q = q.gte('date_heure_depart', (debut.getTime() < Date.now() ? new Date() : debut).toISOString());
    if (f.date) {
      const fin = new Date(f.date + 'T23:59:59');
      q = q.lte('date_heure_depart', fin.toISOString());
    }
    if (f.depart?.trim()) q = q.ilike('depart_label', `%${f.depart.trim()}%`);
    if (f.arrivee?.trim()) q = q.ilike('arrivee_label', `%${f.arrivee.trim()}%`);
    const { data, error } = await q.order('date_heure_depart').limit(60);
    if (error) throw error;
    return (data as Trip[]).filter((t) => t.driver_id !== this.sb.uid);
  }

  async profiles(ids: string[]): Promise<Map<string, PublicProfile>> {
    const uniq = [...new Set(ids)];
    if (!uniq.length) return new Map();
    const { data, error } = await this.sb.client.from('profils_publics').select('*').in('id', uniq);
    if (error) throw error;
    return new Map((data as PublicProfile[]).map((p) => [p.id, p]));
  }

  async vehicles(ids: string[]): Promise<Map<string, Vehicle>> {
    const uniq = [...new Set(ids)];
    if (!uniq.length) return new Map();
    const { data, error } = await this.sb.client.from('vehicles').select('*').in('id', uniq);
    if (error) throw error;
    return new Map((data as Vehicle[]).map((v) => [v.id, v]));
  }

  async publish(t: {
    vehicle_id: string; depart_label: string; arrivee_label: string;
    depart_lat: number; depart_lng: number; arrivee_lat: number; arrivee_lng: number;
    date_heure_depart: string; places_dispo: number; prix_place: number;
  }): Promise<Trip> {
    const { data, error } = await this.sb.client
      .from('trips').insert({ ...t, driver_id: this.sb.uid! }).select().single();
    if (error) throw error;
    return data as Trip;
  }

  reserve(tripId: string, nb: number) {
    return this.sb.rpc<Reservation>('reserver_trajet', { p_trip_id: tripId, p_nb_places: nb });
  }
  confirm(id: string) { return this.sb.rpc<Reservation>('confirmer_reservation', { p_reservation_id: id }); }
  cancelReservation(id: string) { return this.sb.rpc<Reservation>('annuler_reservation', { p_reservation_id: id }); }
  finishTrip(id: string) { return this.sb.rpc<Trip>('terminer_trajet', { p_trip_id: id }); }
  modify(id: string, prix: number, date: string, placesTotal: number) {
    return this.sb.rpc<Trip>('modifier_trajet', { p_trip_id: id, p_prix: prix, p_date: date, p_places_total: placesTotal });
  }
  cancelTrip(id: string) { return this.sb.rpc<Trip>('annuler_trajet', { p_trip_id: id }); }
  collect(reservationId: string, moyen: MoyenPaiement) {
    return this.sb.rpc<Payment>('encaisser_reservation', { p_reservation_id: reservationId, p_moyen: moyen });
  }

  async myReservations(): Promise<ReservationWithTrip[]> {
    const { data, error } = await this.sb.client
      .from('reservations').select('*, trip:trips(*)').eq('passager_id', this.sb.uid!)
      .order('created_at', { ascending: false });
    if (error) throw error;
    return (data as unknown as ReservationWithTrip[]).filter((r) => !!r.trip);
  }

  async myTrips(): Promise<TripWithReservations[]> {
    const { data, error } = await this.sb.client
      .from('trips').select('*, reservations(*)').eq('driver_id', this.sb.uid!)
      .order('date_heure_depart', { ascending: false });
    if (error) throw error;
    return data as unknown as TripWithReservations[];
  }

  async paidReservationIds(ids: string[]): Promise<Set<string>> {
    if (!ids.length) return new Set();
    const { data, error } = await this.sb.client.from('payments').select('source_id').eq('source_type', 'trip').in('source_id', ids);
    if (error) throw error;
    return new Set((data as { source_id: string }[]).map((p) => p.source_id));
  }
}
