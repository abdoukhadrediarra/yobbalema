// Gestionnaires HTTP des fonctions de paiement, indépendants de Deno (testables sous Node).
import { IntentInfo, Provider, pickProvider, parseWaveEvent, verifyWaveWebhook, Env } from './providers.ts';

type Db = { from(t: string): any; rpc(fn: string, args?: object): Promise<{ data: any; error: any }> };

export interface Deps {
  env: Env;
  fetch: typeof fetch;
  now: () => number;
  /** Client agissant avec les droits de l'appelant (les règles RLS s'appliquent). */
  userClient: (authHeader: string) => Db;
  /** Client clé service_role : uniquement pour confirmer / enregistrer côté serveur. */
  adminClient: () => Db;
}

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...CORS, 'Content-Type': 'application/json' } });

const toInfo = (row: any): IntentInfo => ({
  id: row.id, ref_courte: row.ref_courte, montant: Number(row.montant), provider: row.provider,
  provider_ref: row.provider_ref, notif_token: row.notif_token,
});

const siteUrl = (env: Env) => (env('SITE_URL') ?? '').replace(/\/$/, '');
const functionsUrl = (env: Env) => (env('FUNCTIONS_URL') ?? `${env('SUPABASE_URL') ?? ''}/functions/v1`).replace(/\/$/, '');

/**
 * POST { intent_id, action }
 *   create   : ouvre la session chez l'opérateur, renvoie l'URL de paiement
 *   status   : interroge l'opérateur (filet de sécurité si le webhook tarde) et confirme si payé
 *   mock_pay / mock_fail : simulation (PAYMENTS_MODE=mock uniquement)
 */
export async function handleCheckout(req: Request, deps: Deps): Promise<Response> {
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: CORS });
  if (req.method !== 'POST') return json({ error: 'methode_non_autorisee' }, 405);

  const auth = req.headers.get('authorization');
  if (!auth) return json({ error: 'non_authentifie' }, 401);

  let body: { intent_id?: string; action?: string };
  try { body = await req.json(); } catch { return json({ error: 'requete_invalide' }, 400); }
  if (!body.intent_id) return json({ error: 'intent_id_manquant' }, 400);
  const action = body.action ?? 'create';

  // Lecture avec les droits de l'appelant : une tentative d'autrui est invisible (RLS) → 404.
  const { data: intent, error } = await deps.userClient(auth).from('payment_intents').select('*').eq('id', body.intent_id).maybeSingle();
  if (error) return json({ error: 'lecture_impossible' }, 500);
  if (!intent) return json({ error: 'tentative_introuvable' }, 404);

  const admin = deps.adminClient();
  const mock = deps.env('PAYMENTS_MODE') === 'mock';

  try {
    if (action === 'create') {
      if (intent.statut === 'reussi') return json({ statut: 'reussi' });
      if (!['cree', 'en_attente'].includes(intent.statut)) return json({ error: 'tentative_close', statut: intent.statut }, 409);
      if (new Date(intent.expires_at).getTime() < deps.now()) return json({ error: 'tentative_expiree' }, 410);
      if (intent.statut === 'en_attente' && intent.checkout_url) return json({ url: intent.checkout_url, statut: 'en_attente' });

      const provider = pickProvider(intent.provider, deps.env, deps.fetch, deps.now);
      const r = await provider.createCheckout(toInfo(intent), {
        success: `${siteUrl(deps.env)}/paiement/retour?intent=${intent.id}&statut=ok`,
        error: `${siteUrl(deps.env)}/paiement/retour?intent=${intent.id}&statut=erreur`,
        notif: `${functionsUrl(deps.env)}/payments-webhook?p=${intent.provider}`,
      });
      const { error: e2 } = await admin.rpc('enregistrer_session_paiement', {
        p_intent: intent.id, p_provider_ref: r.providerRef, p_url: r.url, p_notif_token: r.notifToken ?? null,
      });
      if (e2) throw e2;
      return json({ url: r.url, statut: 'en_attente' });
    }

    if (action === 'status') {
      if (['reussi', 'echoue', 'expire'].includes(intent.statut) || !intent.provider_ref || mock) return json({ statut: intent.statut });
      const provider = pickProvider(intent.provider, deps.env, deps.fetch, deps.now);
      const st = await provider.getStatus(toInfo(intent));
      if (st.statut !== 'en_attente') {
        const { error: e3 } = await admin.rpc('confirmer_intent', {
          p_ref: intent.ref_courte, p_statut: st.statut, p_montant: st.montant ?? null, p_provider_ref: st.providerRef ?? null, p_detail: null,
        });
        if (e3) throw e3;
      }
      const { data: fresh } = await deps.userClient(auth).from('payment_intents').select('statut').eq('id', intent.id).maybeSingle();
      return json({ statut: fresh?.statut ?? intent.statut });
    }

    if (action === 'mock_pay' || action === 'mock_fail') {
      if (!mock) return json({ error: 'simulation_desactivee' }, 403);
      const { error: e4 } = await admin.rpc('confirmer_intent', {
        p_ref: intent.ref_courte, p_statut: action === 'mock_pay' ? 'reussi' : 'echoue',
        p_montant: action === 'mock_pay' ? Number(intent.montant) : null, p_provider_ref: `mock-${intent.ref_courte}`, p_detail: action === 'mock_fail' ? 'échec simulé' : null,
      });
      if (e4) throw e4;
      return json({ statut: action === 'mock_pay' ? 'reussi' : 'echoue' });
    }
    return json({ error: 'action_inconnue' }, 400);
  } catch (e) {
    const msg = e instanceof Error ? e.message : (e as { message?: string })?.message ?? 'erreur';
    return json({ error: 'echec', message: msg.replace(/^([a-z_]+): /, '') }, 502);
  }
}

/**
 * Webhook des opérateurs : /payments-webhook?p=wave | orange_money
 * Sans JWT (l'opérateur n'en a pas) : l'authenticité est vérifiée par signature / jeton + relecture du statut.
 * Renvoie 200 pour tout message authentique traité ou volontairement ignoré (l'opérateur ne doit pas réessayer),
 * 401 si l'authenticité n'est pas prouvée, 500 si la base est indisponible (l'opérateur réessaiera).
 */
export async function handleWebhook(req: Request, deps: Deps): Promise<Response> {
  if (req.method !== 'POST') return json({ error: 'methode_non_autorisee' }, 405);
  const p = new URL(req.url).searchParams.get('p');
  const raw = await req.text();          // corps BRUT : indispensable au calcul de la signature
  const admin = deps.adminClient();

  const confirm = async (ref: string, statut: 'reussi' | 'echoue', montant: number | null, providerRef: string | null) => {
    const { error } = await admin.rpc('confirmer_intent', { p_ref: ref, p_statut: statut, p_montant: montant, p_provider_ref: providerRef, p_detail: null });
    if (error) {
      if (String(error.message).includes('intent_introuvable')) return json({ ignored: 'reference_inconnue' });
      return json({ error: 'base_indisponible' }, 500);
    }
    return json({ ok: true });
  };

  if (p === 'wave') {
    if (!(await verifyWaveWebhook(raw, req.headers, deps.env, deps.now()))) return json({ error: 'signature_invalide' }, 401);
    const ev = parseWaveEvent(raw);
    if (!ev) return json({ ignored: 'evenement_non_pertinent' });
    if (ev.devise && ev.devise !== 'XOF') return json({ ignored: 'devise_inattendue' });
    return confirm(ev.ref, ev.statut, ev.montant ?? null, ev.providerRef ?? null);
  }

  if (p === 'orange_money') {
    let n: { notif_token?: string; status?: string };
    try { n = JSON.parse(raw); } catch { return json({ error: 'requete_invalide' }, 400); }
    if (!n.notif_token) return json({ error: 'jeton_absent' }, 401);
    const { data: intent, error } = await admin.from('payment_intents').select('*').eq('notif_token', n.notif_token).maybeSingle();
    if (error) return json({ error: 'base_indisponible' }, 500);
    if (!intent) return json({ error: 'jeton_inconnu' }, 401);      // jeton non émis par nous : rejeté
    // On ne se fie JAMAIS au contenu de la notification : le statut est relu auprès d'Orange.
    let provider: Provider;
    try {
      provider = pickProvider('orange_money', deps.env, deps.fetch, deps.now);
      const st = await provider.getStatus(toInfo(intent));
      if (st.statut === 'en_attente') return json({ ok: true, statut: 'en_attente' });
      return confirm(intent.ref_courte, st.statut, st.montant ?? null, st.providerRef ?? null);
    } catch {
      return json({ error: 'operateur_indisponible' }, 500);          // Orange réessaiera
    }
  }
  return json({ error: 'fournisseur_inconnu' }, 400);
}
