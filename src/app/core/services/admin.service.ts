import { Injectable, effect, signal } from '@angular/core';
import { AdminStats, DriverLedgerEntry, Merchant, PricingConfig, Profile } from '../models/models';
import { DeliveryService } from './delivery.service';
import { SupabaseService } from './supabase.service';

export interface SoldeARerser { beneficiaire_id: string; prenom: string | null; nom: string | null; telephone: string | null; role: string; a_verser: number }

export type LedgerWithDriver = DriverLedgerEntry & { driver: Pick<Profile, 'prenom' | 'nom' | 'telephone'> | null };
export type MerchantWithOwner = Merchant & { owner: Pick<Profile, 'prenom' | 'nom' | 'telephone'> | null };

@Injectable({ providedIn: 'root' })
export class AdminService {
  /** true si l'utilisateur connecté est administrateur (table admins). */
  readonly isAdmin = signal(false);

  constructor(private sb: SupabaseService, private delivery: DeliveryService) {
    effect(() => {
      const uid = this.sb.currentUser()?.id;
      if (!uid) { this.isAdmin.set(false); return; }
      this.sb.rpc<boolean>('is_admin').then((v) => this.isAdmin.set(v === true)).catch(() => this.isAdmin.set(false));
    });
  }

  stats() { return this.sb.rpc<AdminStats>('admin_stats'); }

  async profilesToReview(statut: 'en_attente' | 'verifie' | 'rejete'): Promise<Profile[]> {
    let q = this.sb.client.from('profiles').select('*').eq('statut_verif', statut).order('created_at', { ascending: false }).limit(100);
    if (statut === 'en_attente') q = q.or('cni_url.not.is.null,permis_url.not.is.null');
    const { data, error } = await q;
    if (error) throw error;
    return data as Profile[];
  }

  setVerification(user: string, statut: 'verifie' | 'rejete' | 'en_attente') {
    return this.sb.rpc('admin_set_verification', { p_user: user, p_statut: statut });
  }

  async merchants(): Promise<MerchantWithOwner[]> {
    const { data, error } = await this.sb.client
      .from('merchants').select('*, owner:profiles!merchants_owner_id_fkey(prenom, nom, telephone)').order('statut_verif');
    if (error) throw error;
    return data as unknown as MerchantWithOwner[];
  }
  setMerchantVerification(id: string, statut: 'verifie' | 'rejete' | 'en_attente') {
    return this.sb.rpc('admin_set_merchant_verification', { p_merchant: id, p_statut: statut });
  }

  async ledger(): Promise<LedgerWithDriver[]> {
    const { data, error } = await this.sb.client
      .from('driver_ledger').select('*, driver:profiles!driver_ledger_driver_id_fkey(prenom, nom, telephone)')
      .eq('regle', false).order('created_at');
    if (error) throw error;
    return data as unknown as LedgerWithDriver[];
  }
  settleDebt(id: string) { return this.sb.rpc('admin_regler_dette', { p_ledger_id: id }); }

  async config(): Promise<{ cle: string; valeur: string; description: string | null }[]> {
    const { data, error } = await this.sb.client.from('app_config').select('*').order('cle');
    if (error) throw error;
    return data as { cle: string; valeur: string; description: string | null }[];
  }
  setConfig(cle: string, valeur: string) { return this.sb.rpc('admin_set_config', { p_cle: cle, p_valeur: valeur }); }

  async pricing(): Promise<PricingConfig[]> {
    const { data, error } = await this.sb.client.from('pricing_config').select('*').order('tarif_km_base');
    if (error) throw error;
    return data as PricingConfig[];
  }
  setPricing(categorie: string, min: number, max: number, base: number) {
    return this.sb.rpc('admin_set_pricing', { p_categorie: categorie, p_min: min, p_max: max, p_base: base });
  }

  soldes() { return this.sb.rpc<SoldeARerser[]>('admin_soldes'); }
  enregistrerVersement(beneficiaire: string, montant: number, moyen: 'wave' | 'orange_money', reference: string | null, note: string | null) {
    return this.sb.rpc('admin_enregistrer_versement', { p_beneficiaire: beneficiaire, p_montant: montant, p_moyen: moyen, p_reference: reference, p_note: note });
  }

  async suspendus(): Promise<Profile[]> {
    const { data, error } = await this.sb.client.from('profiles').select('*').gt('suspendu_jusqua', new Date().toISOString());
    if (error) throw error;
    return data as Profile[];
  }
  leverSuspension(user: string) { return this.sb.rpc('admin_lever_suspension', { p_user: user }); }

  signedDocument(path: string) { return this.delivery.signedUrl('documents', path); }
}
