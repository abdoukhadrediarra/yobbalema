import { Injectable } from '@angular/core';
import { Payment, PaymentIntent, Solde } from '../models/models';
import { SupabaseService } from './supabase.service';

export type Fournisseur = 'wave' | 'orange_money';
export type Source = 'ride' | 'trip' | 'delivery';

export interface PaymentsConfig {
  /** true : Wave / Orange Money sont simulés (confirmés immédiatement, rien à payer en ligne). */
  test: boolean;
  fournisseurs: Fournisseur[];
}

/**
 * Paiements en ligne. Le navigateur ne confirme JAMAIS un paiement : il demande une tentative
 * (RPC demander_paiement), obtient l'URL de l'opérateur via l'Edge Function payments-checkout,
 * puis c'est le webhook de l'opérateur qui confirme côté serveur.
 */
@Injectable({ providedIn: 'root' })
export class PaymentsService {
  constructor(private sb: SupabaseService) {}

  async config(): Promise<PaymentsConfig> {
    const { data, error } = await this.sb.client.from('app_config').select('cle, valeur').in('cle', ['mode_test_paiements', 'paiements_fournisseurs']);
    if (error) throw error;
    const m = new Map((data as { cle: string; valeur: string }[]).map((r) => [r.cle, r.valeur]));
    return {
      test: m.get('mode_test_paiements') === 'true',
      fournisseurs: (m.get('paiements_fournisseurs') ?? '').split(',').map((x) => x.trim()).filter((x): x is Fournisseur => x === 'wave' || x === 'orange_money'),
    };
  }

  /** Paiements que l'utilisateur doit encore régler pour une course / un trajet / une livraison. */
  async pendingFor(source: Source, sourceId: string): Promise<Payment[]> {
    const { data, error } = await this.sb.client.from('payments').select('*')
      .eq('source_type', source).eq('source_id', sourceId).eq('payeur_id', this.sb.uid!).eq('statut_transaction', 'en_attente');
    if (error) throw error;
    return data as Payment[];
  }

  async pay(source: Source, sourceId: string, provider: Fournisseur): Promise<string> {
    const intent = await this.sb.rpc<PaymentIntent>('demander_paiement', { p_source: source, p_source_id: sourceId, p_provider: provider });
    return this.checkout(intent.id);
  }

  async payDebt(provider: Fournisseur): Promise<string> {
    const intent = await this.sb.rpc<PaymentIntent>('demander_paiement_dette', { p_provider: provider });
    return this.checkout(intent.id);
  }

  /** Ouvre la session chez l'opérateur et renvoie l'URL vers laquelle rediriger (dans le navigateur, pas une webview). */
  async checkout(intentId: string): Promise<string> {
    const r = await this.invoke({ intent_id: intentId, action: 'create' });
    if (!r.url) throw new Error(r.statut === 'reussi' ? 'Ce paiement est déjà confirmé.' : 'Le lien de paiement est indisponible.');
    return r.url as string;
  }

  async status(intentId: string): Promise<PaymentIntent['statut']> {
    const r = await this.invoke({ intent_id: intentId, action: 'status' });
    return r.statut;
  }

  mock(intentId: string, action: 'mock_pay' | 'mock_fail') { return this.invoke({ intent_id: intentId, action }); }

  async intent(id: string): Promise<PaymentIntent | null> {
    const { data } = await this.sb.client.from('payment_intents').select('*').eq('id', id).maybeSingle();
    return (data as PaymentIntent) ?? null;
  }

  solde() { return this.sb.rpc<Solde>('mon_solde'); }

  private async invoke(body: Record<string, unknown>): Promise<any> {
    const { data, error } = await this.sb.client.functions.invoke('payments-checkout', { body });
    if (error) {
      let msg = 'Le paiement en ligne est momentanément indisponible. Réessayez.';
      try {
        const ctx = (error as { context?: Response }).context;
        if (ctx) {
          const j = await ctx.clone().json();
          if (j?.message) msg = j.message;
          else if (j?.error === 'tentative_expiree') msg = 'Cette tentative de paiement a expiré : recommencez.';
          else if (j?.error === 'tentative_close') msg = 'Cette tentative de paiement est terminée.';
        }
      } catch { /* message par défaut */ }
      throw new Error(msg);
    }
    return data;
  }
}
