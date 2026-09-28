// Adaptateurs des opérateurs de paiement mobile : Wave, Orange Money, et un fournisseur simulé.
// Code sans dépendance propre à Deno (fetch + WebCrypto) : il est testé aussi sous Node.
//
// ATTENTION — non testé contre les vraies API :
//  * Wave : écrit d'après la documentation publique (https://docs.wave.com/checkout et /webhook).
//  * Orange Money : écrit d'après la documentation Orange Developer et des SDK communautaires ;
//    les chemins d'API (sandbox « dev » / production) et la devise sont à confirmer avec Orange
//    lors de l'ouverture de votre compte marchand (variables OM_*).
// Testez d'abord en bac à sable de chaque opérateur avant tout paiement réel.

export type Env = (key: string) => string | undefined;

export interface IntentInfo {
  id: string;
  ref_courte: string;
  montant: number;
  provider: 'wave' | 'orange_money';
  provider_ref: string | null;
  notif_token: string | null;
}

export interface CheckoutUrls { success: string; error: string; notif: string }
export interface CheckoutResult { providerRef: string; url: string; notifToken?: string }
export type ProviderStatut = 'reussi' | 'echoue' | 'en_attente';
export interface StatusResult { statut: ProviderStatut; providerRef?: string; montant?: number }

export interface Provider {
  createCheckout(i: IntentInfo, urls: CheckoutUrls): Promise<CheckoutResult>;
  getStatus(i: IntentInfo): Promise<StatusResult>;
}

const enc = new TextEncoder();

export async function hmacHex(secret: string, data: string): Promise<string> {
  const key = await crypto.subtle.importKey('raw', enc.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const sig = await crypto.subtle.sign('HMAC', key, enc.encode(data));
  return [...new Uint8Array(sig)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

/** Comparaison en temps constant de deux chaînes. */
export function safeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let r = 0;
  for (let i = 0; i < a.length; i++) r |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return r === 0;
}

function need(env: Env, key: string): string {
  const v = env(key);
  if (!v) throw new Error(`provider_non_configure: la variable ${key} est absente`);
  return v;
}

// ------------------------------------------------------------------- Wave
export class WaveProvider implements Provider {
  constructor(private env: Env, private f: typeof fetch, private now: () => number) {}

  private async headers(body: string): Promise<Record<string, string>> {
    const h: Record<string, string> = { Authorization: `Bearer ${need(this.env, 'WAVE_API_KEY')}`, 'Content-Type': 'application/json' };
    const signing = this.env('WAVE_SIGNING_SECRET');
    if (signing) {
      const t = Math.floor(this.now() / 1000);
      h['Wave-Signature'] = `t=${t},v1=${await hmacHex(signing, `${t}${body}`)}`;
    }
    return h;
  }

  async createCheckout(i: IntentInfo, urls: CheckoutUrls): Promise<CheckoutResult> {
    const body = JSON.stringify({
      amount: String(Math.round(i.montant)),
      currency: 'XOF',
      success_url: urls.success,
      error_url: urls.error,
      client_reference: i.ref_courte,
    });
    const res = await this.f('https://api.wave.com/v1/checkout/sessions', { method: 'POST', headers: await this.headers(body), body });
    if (!res.ok) throw new Error(`wave_erreur: création de la session refusée (${res.status})`);
    const j = await res.json();
    if (!j.id || !j.wave_launch_url) throw new Error('wave_erreur: réponse inattendue');
    return { providerRef: j.id, url: j.wave_launch_url };
  }

  async getStatus(i: IntentInfo): Promise<StatusResult> {
    if (!i.provider_ref) return { statut: 'en_attente' };
    const res = await this.f(`https://api.wave.com/v1/checkout/sessions/${encodeURIComponent(i.provider_ref)}`, { headers: await this.headers('') });
    if (!res.ok) throw new Error(`wave_erreur: lecture de la session impossible (${res.status})`);
    const j = await res.json();
    const statut: ProviderStatut =
      j.payment_status === 'succeeded' ? 'reussi'
      : j.payment_status === 'cancelled' || j.checkout_status === 'expired' ? 'echoue'
      : 'en_attente';
    return { statut, providerRef: j.id, montant: j.amount !== undefined ? Number(j.amount) : undefined };
  }
}

/**
 * Vérifie un webhook Wave. Deux modes de sécurité existent côté Wave :
 *  - signature HMAC-SHA256 (en-tête Wave-Signature: t=…,v1=…, calculée sur « timestamp + corps brut ») — recommandé ;
 *  - secret partagé (en-tête Authorization: Bearer <secret>) — moins sûr.
 * Le corps doit être le TEXTE BRUT reçu, non re-sérialisé.
 */
export async function verifyWaveWebhook(
  raw: string, headers: Headers, env: Env, nowMs: number, toleranceS = 300,
): Promise<boolean> {
  const signing = env('WAVE_WEBHOOK_SECRET');
  const sigHeader = headers.get('wave-signature');
  if (signing && sigHeader) {
    const parts = Object.fromEntries(sigHeader.split(',').map((p) => p.trim().split('=') as [string, string]));
    const t = Number(parts['t']);
    const v1 = parts['v1'];
    if (!t || !v1) return false;
    if (Math.abs(nowMs / 1000 - t) > toleranceS) return false;   // rejeu d'un vieux message
    return safeEqual(await hmacHex(signing, `${t}${raw}`), v1);
  }
  const shared = env('WAVE_WEBHOOK_SHARED_SECRET');
  const auth = headers.get('authorization');
  if (shared && auth) return safeEqual(auth, `Bearer ${shared}`);
  return false;
}

export interface WaveEvent { ref: string; statut: 'reussi' | 'echoue'; montant?: number; providerRef?: string; devise?: string }

export function parseWaveEvent(raw: string): WaveEvent | null {
  let j: any;
  try { j = JSON.parse(raw); } catch { return null; }
  const d = j?.data ?? {};
  const ref = d.client_reference ?? d.id;
  if (!ref) return null;
  const type: string = j?.type ?? '';
  if (type === 'checkout.session.completed' && d.checkout_status !== 'expired') {
    return { ref, statut: 'reussi', montant: d.amount !== undefined ? Number(d.amount) : undefined, providerRef: d.id, devise: d.currency };
  }
  if (type.includes('failed') || type === 'checkout.session.expired' || d.payment_status === 'cancelled') {
    return { ref, statut: 'echoue', providerRef: d.id };
  }
  return null;
}

// --------------------------------------------------------- Orange Money
export class OrangeProvider implements Provider {
  private token?: { value: string; exp: number };
  constructor(private env: Env, private f: typeof fetch, private now: () => number) {}

  private base() { return this.env('OM_API_BASE') ?? 'https://api.orange.com'; }

  private async accessToken(): Promise<string> {
    if (this.token && this.token.exp > this.now() + 60_000) return this.token.value;
    const res = await this.f(this.env('OM_TOKEN_URL') ?? `${this.base()}/oauth/v3/token`, {
      method: 'POST',
      headers: { Authorization: need(this.env, 'OM_AUTH_HEADER'), 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/json' },
      body: 'grant_type=client_credentials',
    });
    if (!res.ok) throw new Error(`om_erreur: authentification refusée (${res.status})`);
    const j = await res.json();
    if (!j.access_token) throw new Error('om_erreur: jeton absent');
    this.token = { value: j.access_token, exp: this.now() + (Number(j.expires_in) || 3600) * 1000 };
    return this.token.value;
  }

  private async call(path: string, payload: object) {
    return this.f(`${this.base()}${path}`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${await this.accessToken()}`, 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify(payload),
    });
  }

  async createCheckout(i: IntentInfo, urls: CheckoutUrls): Promise<CheckoutResult> {
    const res = await this.call(this.env('OM_PAYMENT_PATH') ?? '/orange-money-webpay/dev/v1/webpayment', {
      merchant_key: need(this.env, 'OM_MERCHANT_KEY'),
      currency: this.env('OM_CURRENCY') ?? 'OUV',     // « OUV » en bac à sable ; « XOF » en production (à confirmer avec Orange)
      order_id: i.ref_courte,
      amount: Math.round(i.montant),
      return_url: urls.success,
      cancel_url: urls.error,
      notif_url: urls.notif,
      lang: 'fr',
      reference: i.ref_courte,
    });
    if (!res.ok) throw new Error(`om_erreur: création du paiement refusée (${res.status})`);
    const j = await res.json();
    if (!j.payment_url || !j.pay_token) throw new Error('om_erreur: réponse inattendue');
    return { providerRef: j.pay_token, url: j.payment_url, notifToken: j.notif_token };
  }

  async getStatus(i: IntentInfo): Promise<StatusResult> {
    if (!i.provider_ref) return { statut: 'en_attente' };
    const res = await this.call(this.env('OM_STATUS_PATH') ?? '/orange-money-webpay/dev/v1/transactionstatus', {
      order_id: i.ref_courte, amount: Math.round(i.montant), pay_token: i.provider_ref,
    });
    if (!res.ok) throw new Error(`om_erreur: lecture du statut impossible (${res.status})`);
    const j = await res.json();
    const s = String(j.status ?? '').toUpperCase();
    const statut: ProviderStatut = s === 'SUCCESS' ? 'reussi' : ['FAILED', 'EXPIRED', 'CANCELLED', 'CANCELED'].includes(s) ? 'echoue' : 'en_attente';
    return { statut, providerRef: j.txnid ?? i.provider_ref, montant: Math.round(i.montant) };
  }
}

// ---------------------------------------------------------- Simulation
/** Fournisseur de démonstration (PAYMENTS_MODE=mock) : aucun opérateur réel, page de paiement simulée. */
export class MockProvider implements Provider {
  constructor(private env: Env) {}
  async createCheckout(i: IntentInfo): Promise<CheckoutResult> {
    const site = need(this.env, 'SITE_URL');
    return { providerRef: `mock-${i.ref_courte}`, url: `${site}/paiement/simulation?intent=${i.id}` };
  }
  async getStatus(): Promise<StatusResult> { return { statut: 'en_attente' }; }
}

export function pickProvider(name: 'wave' | 'orange_money', env: Env, f: typeof fetch, now: () => number): Provider {
  if (env('PAYMENTS_MODE') === 'mock') return new MockProvider(env);
  return name === 'wave' ? new WaveProvider(env, f, now) : new OrangeProvider(env, f, now);
}
