/**
 * Test des Edge Functions de paiement (payments-checkout / payments-webhook) : les vrais
 * gestionnaires sont exécutés contre l'API PostgREST et la base de test, avec de FAUSSES
 * réponses de Wave et d'Orange Money (aucun appel réseau réel).
 * Vérifie le flux, la sécurité (signatures, jetons, rejeu, montants) et l'écriture en base.
 */
import { PostgrestClient } from '@supabase/postgrest-js';
import { createHmac, randomUUID } from 'node:crypto';
import { execSync } from 'node:child_process';
import { handleCheckout, handleWebhook, Deps } from '../../functions/_shared/handlers.ts';
import { hmacHex } from '../../functions/_shared/providers.ts';

const API = process.env['API_URL'] ?? 'http://127.0.0.1:3000';
const SECRET = 'super-secret-jwt-token-with-at-least-32-characters-long';
const DB = process.env['API_DB'] ?? 'yobb_api';
let pass = 0, fail = 0;
const ok = (n: string, c: unknown, d = '') => { if (c) { pass++; console.log(`  PASS  ${n}`); } else { fail++; console.log(`  FAIL  ${n} ${d}`); } };

const b64 = (o: object) => Buffer.from(JSON.stringify(o)).toString('base64url');
function jwt(sub: string | null, role = 'authenticated') {
  const h = b64({ alg: 'HS256', typ: 'JWT' });
  const p = b64({ role, ...(sub ? { sub, aud: 'authenticated' } : {}), exp: Math.floor(Date.now() / 1000) + 3600 });
  return `${h}.${p}.${createHmac('sha256', SECRET).update(`${h}.${p}`).digest('base64url')}`;
}
const sql = (q: string) => execSync(`su postgres -c "psql -d ${DB} -At -q"`, { input: q }).toString().trim();
const pg = (uid: string | null, role = 'authenticated') => new PostgrestClient(API, { headers: { Authorization: `Bearer ${jwt(uid, role)}` } });
async function rpc<T = any>(uid: string, fn: string, args: object): Promise<T> {
  const { data, error } = await pg(uid).rpc(fn, args as any);
  if (error) throw new Error(`${fn}: ${error.message}`);
  return data as T;
}

type FetchLog = { url: string; init?: RequestInit }[];
function deps(env: Record<string, string>, f: (url: string, init?: RequestInit) => Promise<Response> = async () => { throw new Error('fetch inattendu'); }): Deps {
  return {
    env: (k) => env[k],
    fetch: f as unknown as typeof fetch,
    now: () => Date.now(),
    userClient: (auth) => new PostgrestClient(API, { headers: { Authorization: auth } }) as any,
    adminClient: () => pg(null, 'service_role') as any,
  };
}
const jres = (o: unknown, status = 200) => new Response(JSON.stringify(o), { status, headers: { 'Content-Type': 'application/json' } });
const checkoutReq = (uid: string | null, body: object) =>
  new Request('http://fn/payments-checkout', { method: 'POST', headers: { 'content-type': 'application/json', ...(uid ? { authorization: `Bearer ${jwt(uid)}` } : {}) }, body: JSON.stringify(body) });
const webhookReq = (p: string, raw: string, headers: Record<string, string> = {}) =>
  new Request(`http://fn/payments-webhook?p=${p}`, { method: 'POST', headers: { 'content-type': 'application/json', ...headers }, body: raw });
const intentRow = (id: string) => JSON.parse(sql(`select row_to_json(t) from (select * from payment_intents where id='${id}') t`));
const payStatut = (rideId: string) => sql(`select string_agg(statut_transaction, ',') from payments where source_id='${rideId}'`);

function mkuser(prenom: string, role: string) {
  const id = randomUUID();
  sql(`insert into auth.users(id,email,raw_user_meta_data) values ('${id}','${prenom}@t.sn', jsonb_build_object('prenom','${prenom}','nom','T','telephone','+221770000','role','${role}'))`);
  return id;
}

async function main() {
  sql(`update app_config set valeur='false' where cle='mode_test_paiements'`);
  const A = mkuser('Awa', 'client'), D = mkuser('Demba', 'chauffeur'), X = mkuser('Xavier', 'client');
  sql(`insert into vehicles(user_id,categorie) values ('${D}','standard')`);

  /** Course terminée en mode réel → paiement en attente → tentative de paiement de A. */
  async function pendingIntent(provider: 'wave' | 'orange_money') {
    const ride = await rpc<any>(A, 'create_ride_request', { p_categorie: 'standard', p_depart_label: 'Plateau', p_depart_lat: 14.6708, p_depart_lng: -17.4382, p_arrivee_label: 'Ouakam', p_arrivee_lat: 14.7167, p_arrivee_lng: -17.493, p_distance_km: 9, p_montant_offert: null });
    await rpc(D, 'accept_ride_request', { p_ride_id: ride.id });
    await rpc(D, 'demarrer_course', { p_ride_id: ride.id });
    await rpc(D, 'terminer_course', { p_ride_id: ride.id, p_moyen: provider });
    const intent = await rpc<any>(A, 'demander_paiement', { p_source: 'ride', p_source_id: ride.id, p_provider: provider });
    return { rideId: ride.id as string, intent };
  }

  const SITE = { SITE_URL: 'https://yobbalema.test', SUPABASE_URL: 'https://proj.supabase.co' };

  console.log('== Mode simulation (PAYMENTS_MODE=mock)');
  const m = await pendingIntent('wave');
  const mockEnv = { ...SITE, PAYMENTS_MODE: 'mock' };
  ok('sans jeton : 401', (await handleCheckout(checkoutReq(null, { intent_id: m.intent.id }), deps(mockEnv))).status === 401);
  ok('la tentative d\u2019autrui est invisible : 404', (await handleCheckout(checkoutReq(X, { intent_id: m.intent.id }), deps(mockEnv))).status === 404);
  let r = await handleCheckout(checkoutReq(A, { intent_id: m.intent.id, action: 'create' }), deps(mockEnv));
  let j: any = await r.json();
  ok('create : URL de la page de paiement simulée', r.status === 200 && j.url === `https://yobbalema.test/paiement/simulation?intent=${m.intent.id}`, JSON.stringify(j));
  ok('la tentative passe « en_attente » avec sa référence', intentRow(m.intent.id).statut === 'en_attente' && intentRow(m.intent.id).provider_ref.startsWith('mock-'));
  r = await handleCheckout(checkoutReq(A, { intent_id: m.intent.id }), deps(mockEnv));
  ok('create est idempotent (même URL)', ((await r.json()) as any).url === j.url);
  r = await handleCheckout(checkoutReq(A, { intent_id: m.intent.id, action: 'mock_pay' }), deps({ ...SITE }));
  ok('simulation refusée hors mode mock : 403', r.status === 403);
  r = await handleCheckout(checkoutReq(A, { intent_id: m.intent.id, action: 'mock_pay' }), deps(mockEnv));
  ok('mock_pay : tentative « reussi », paiement confirmé', ((await r.json()) as any).statut === 'reussi' && payStatut(m.rideId) === 'confirme');

  console.log('\n== Wave');
  const waveEnv = { ...SITE, WAVE_API_KEY: 'wave_sn_prod_KEY', WAVE_SIGNING_SECRET: 'sign-secret', WAVE_WEBHOOK_SECRET: 'whsec', FUNCTIONS_URL: 'https://proj.supabase.co/functions/v1' };
  const w1 = await pendingIntent('wave');
  const calls: FetchLog = [];
  const waveFetch = async (url: string, init?: RequestInit) => {
    calls.push({ url, init });
    if (url === 'https://api.wave.com/v1/checkout/sessions' && init?.method === 'POST') return jres({ id: 'cos-TEST1', wave_launch_url: 'https://pay.wave.com/c/cos-TEST1', checkout_status: 'open' });
    return jres({}, 404);
  };
  r = await handleCheckout(checkoutReq(A, { intent_id: w1.intent.id }), deps(waveEnv, waveFetch));
  j = await r.json();
  ok('create : URL Wave renvoyée', r.status === 200 && j.url === 'https://pay.wave.com/c/cos-TEST1', JSON.stringify(j));
  const c0 = calls[0]; const sent = JSON.parse(String(c0.init?.body)); const hdr = c0.init?.headers as Record<string, string>;
  ok('requête Wave : POST /v1/checkout/sessions avec la clé API', c0.url === 'https://api.wave.com/v1/checkout/sessions' && hdr['Authorization'] === 'Bearer wave_sn_prod_KEY');
  ok('corps : montant en chaîne entière, XOF, référence = notre référence courte', sent.amount === String(Math.round(w1.intent.montant)) && sent.currency === 'XOF' && sent.client_reference === w1.intent.ref_courte, JSON.stringify(sent));
  ok('corps : URLs de retour vers le site', sent.success_url.startsWith('https://yobbalema.test/paiement/retour?intent=') && sent.error_url.includes('statut=erreur'));
  const sigParts = Object.fromEntries(String(hdr['Wave-Signature']).split(',').map((p) => p.split('=') as [string, string]));
  ok('la requête est signée (HMAC-SHA256 de « timestamp + corps »)', sigParts['v1'] === await hmacHex('sign-secret', `${sigParts['t']}${c0.init?.body}`));
  ok('la session Wave est enregistrée en base', intentRow(w1.intent.id).provider_ref === 'cos-TEST1' && intentRow(w1.intent.id).checkout_url === 'https://pay.wave.com/c/cos-TEST1' && intentRow(w1.intent.id).statut === 'en_attente');

  const waveEvent = (type: string, data: object) => JSON.stringify({ id: 'AE_' + randomUUID().slice(0, 6), type, data });
  const signed = async (raw: string, t = Math.floor(Date.now() / 1000), secret = 'whsec') => ({ 'wave-signature': `t=${t},v1=${await hmacHex(secret, `${t}${raw}`)}` });
  const okBody = waveEvent('checkout.session.completed', { id: 'cos-TEST1', amount: String(Math.round(w1.intent.montant)), currency: 'XOF', checkout_status: 'complete', client_reference: w1.intent.ref_courte });

  const w2 = await pendingIntent('wave');
  await handleCheckout(checkoutReq(A, { intent_id: w2.intent.id }), deps(waveEnv, async () => jres({ id: 'cos-TEST2', wave_launch_url: 'https://pay.wave.com/c/cos-TEST2' })));
  const w2Body = waveEvent('checkout.session.completed', { id: 'cos-TEST2', amount: String(Math.round(w2.intent.montant)), currency: 'XOF', checkout_status: 'complete', client_reference: w2.intent.ref_courte });

  ok('webhook sans signature : 401', (await handleWebhook(webhookReq('wave', w2Body), deps(waveEnv))).status === 401);
  ok('webhook au corps falsifié : 401', (await handleWebhook(webhookReq('wave', w2Body.replace('complete', 'complète'), await signed(w2Body)), deps(waveEnv))).status === 401);
  ok('webhook signé avec un mauvais secret : 401', (await handleWebhook(webhookReq('wave', w2Body, await signed(w2Body, undefined, 'autre')), deps(waveEnv))).status === 401);
  ok('webhook rejoué (horodatage vieux de 20 min) : 401', (await handleWebhook(webhookReq('wave', w2Body, await signed(w2Body, Math.floor(Date.now() / 1000) - 1200)), deps(waveEnv))).status === 401);
  ok('… rien n\u2019a été confirmé pour autant', payStatut(w2.rideId) === 'en_attente');

  const badAmount = waveEvent('checkout.session.completed', { id: 'cos-TEST2', amount: '1', currency: 'XOF', checkout_status: 'complete', client_reference: w2.intent.ref_courte });
  r = await handleWebhook(webhookReq('wave', badAmount, await signed(badAmount)), deps(waveEnv));
  ok('montant incohérent : 200 mais RIEN de confirmé, anomalie enregistrée', r.status === 200 && payStatut(w2.rideId) === 'en_attente' && String(intentRow(w2.intent.id).detail).includes('montant_incoherent'), await r.text());
  const wrongCur = waveEvent('checkout.session.completed', { id: 'cos-TEST2', amount: String(Math.round(w2.intent.montant)), currency: 'EUR', checkout_status: 'complete', client_reference: w2.intent.ref_courte });
  r = await handleWebhook(webhookReq('wave', wrongCur, await signed(wrongCur)), deps(waveEnv));
  ok('devise inattendue : ignoré', payStatut(w2.rideId) === 'en_attente' && ((await r.json()) as any).ignored === 'devise_inattendue');

  r = await handleWebhook(webhookReq('wave', okBody, await signed(okBody)), deps(waveEnv));
  ok('webhook valide : 200, tentative « reussi », paiement confirmé', r.status === 200 && intentRow(w1.intent.id).statut === 'reussi' && payStatut(w1.rideId) === 'confirme');
  ok('la référence Wave est conservée sur le paiement', sql(`select reference_externe from payments where source_id='${w1.rideId}'`) === 'cos-TEST1');
  r = await handleWebhook(webhookReq('wave', okBody, await signed(okBody)), deps(waveEnv));
  ok('rejeu d\u2019un webhook valide : 200, aucun double effet', r.status === 200 && sql(`select count(*) from payments where source_id='${w1.rideId}'`) === '1' && payStatut(w1.rideId) === 'confirme');

  const failBody = waveEvent('checkout.session.payment_failed', { id: 'cos-TEST2', client_reference: w2.intent.ref_courte, payment_status: 'cancelled' });
  r = await handleWebhook(webhookReq('wave', failBody, await signed(failBody)), deps(waveEnv));
  ok('échec signalé par Wave : tentative « echoue », paiement toujours dû', r.status === 200 && intentRow(w2.intent.id).statut === 'echoue' && payStatut(w2.rideId) === 'en_attente');

  const unknown = waveEvent('checkout.session.completed', { id: 'cos-XXX', amount: '100', currency: 'XOF', checkout_status: 'complete', client_reference: 'YBINCONNU' });
  r = await handleWebhook(webhookReq('wave', unknown, await signed(unknown)), deps(waveEnv));
  ok('référence inconnue : 200 « ignoré » (Wave ne doit pas réessayer)', r.status === 200 && ((await r.json()) as any).ignored === 'reference_inconnue');
  const other = waveEvent('checkout.session.refunded', { id: 'cos-1', client_reference: w1.intent.ref_courte });
  r = await handleWebhook(webhookReq('wave', other, await signed(other)), deps(waveEnv));
  ok('événement sans intérêt : ignoré', ((await r.json()) as any).ignored === 'evenement_non_pertinent');

  const sharedEnv = { ...SITE, WAVE_WEBHOOK_SHARED_SECRET: 'partage' };
  const w3 = await pendingIntent('wave');
  await handleCheckout(checkoutReq(A, { intent_id: w3.intent.id }), deps(waveEnv, async () => jres({ id: 'cos-TEST3', wave_launch_url: 'https://pay.wave.com/c/cos-TEST3' })));
  const w3Body = waveEvent('checkout.session.completed', { id: 'cos-TEST3', amount: String(Math.round(w3.intent.montant)), currency: 'XOF', checkout_status: 'complete', client_reference: w3.intent.ref_courte });
  ok('mode « secret partagé » : mauvais secret refusé', (await handleWebhook(webhookReq('wave', w3Body, { authorization: 'Bearer faux' }), deps(sharedEnv))).status === 401);
  ok('mode « secret partagé » : bon secret accepté', (await handleWebhook(webhookReq('wave', w3Body, { authorization: 'Bearer partage' }), deps(sharedEnv))).status === 200 && payStatut(w3.rideId) === 'confirme');

  console.log('\n== Wave : statut interrogé sans webhook (filet de sécurité)');
  const w4 = await pendingIntent('wave');
  await handleCheckout(checkoutReq(A, { intent_id: w4.intent.id }), deps(waveEnv, async () => jres({ id: 'cos-TEST4', wave_launch_url: 'https://pay.wave.com/c/cos-TEST4' })));
  r = await handleCheckout(checkoutReq(A, { intent_id: w4.intent.id, action: 'status' }), deps(waveEnv, async (url) => url.endsWith('/cos-TEST4') ? jres({ id: 'cos-TEST4', checkout_status: 'open', payment_status: 'processing', amount: String(Math.round(w4.intent.montant)) }) : jres({}, 404)));
  ok('status : paiement encore en cours → rien de confirmé', ((await r.json()) as any).statut === 'en_attente' && payStatut(w4.rideId) === 'en_attente');
  r = await handleCheckout(checkoutReq(A, { intent_id: w4.intent.id, action: 'status' }), deps(waveEnv, async (url) => url.endsWith('/cos-TEST4') ? jres({ id: 'cos-TEST4', checkout_status: 'complete', payment_status: 'succeeded', amount: String(Math.round(w4.intent.montant)) }) : jres({}, 404)));
  ok('status : Wave dit « succeeded » → confirmé sans webhook', ((await r.json()) as any).statut === 'reussi' && payStatut(w4.rideId) === 'confirme');
  r = await handleCheckout(checkoutReq(A, { intent_id: w2.intent.id }), deps(waveEnv, waveFetch));
  ok('tentative déjà échouée : 409, pas de nouvelle session', r.status === 409);

  console.log('\n== Orange Money');
  const omEnv = { ...SITE, OM_AUTH_HEADER: 'Basic b21jbGllbnQ6c2VjcmV0', OM_MERCHANT_KEY: 'mk-123', FUNCTIONS_URL: 'https://proj.supabase.co/functions/v1' };
  const o1 = await pendingIntent('orange_money');
  const omCalls: FetchLog = []; let omStatus = 'PENDING'; let omDown = false;
  const omFetch = async (url: string, init?: RequestInit) => {
    omCalls.push({ url, init });
    if (url.endsWith('/oauth/v3/token')) return jres({ token_type: 'Bearer', access_token: 'tok-1', expires_in: '7776000' });
    if (url.endsWith('/webpayment')) return jres({ status: 201, message: 'OK', pay_token: 'PT-1', payment_url: 'https://webpayment-sb.orange-money.com/payment/pay_token/PT-1', notif_token: 'NT-1' });
    if (url.endsWith('/transactionstatus')) return omDown ? jres({}, 503) : jres({ status: omStatus, order_id: o1.intent.ref_courte, txnid: 'MP.1' });
    return jres({}, 404);
  };
  r = await handleCheckout(checkoutReq(A, { intent_id: o1.intent.id }), deps(omEnv, omFetch));
  j = await r.json();
  ok('create : URL de paiement Orange Money renvoyée', r.status === 200 && j.url.includes('PT-1'), JSON.stringify(j));
  ok('jeton OAuth demandé avec l\u2019en-tête Basic, en formulaire', omCalls[0].url === 'https://api.orange.com/oauth/v3/token' && (omCalls[0].init?.headers as any)['Authorization'] === omEnv.OM_AUTH_HEADER && String(omCalls[0].init?.body) === 'grant_type=client_credentials');
  const omBody = JSON.parse(String(omCalls[1].init?.body));
  ok('webpayment : jeton porteur, clé marchand, référence, montant entier', (omCalls[1].init?.headers as any)['Authorization'] === 'Bearer tok-1' && omBody.merchant_key === 'mk-123' && omBody.order_id === o1.intent.ref_courte && omBody.amount === Math.round(o1.intent.montant), JSON.stringify(omBody));
  ok('notif_url pointe vers le webhook Orange Money', omBody.notif_url === 'https://proj.supabase.co/functions/v1/payments-webhook?p=orange_money', omBody.notif_url);
  ok('pay_token et notif_token enregistrés en base', intentRow(o1.intent.id).provider_ref === 'PT-1' && intentRow(o1.intent.id).notif_token === 'NT-1');

  ok('notification sans jeton : 401', (await handleWebhook(webhookReq('orange_money', JSON.stringify({ status: 'SUCCESS' })), deps(omEnv, omFetch))).status === 401);
  ok('notification avec un jeton inconnu : 401', (await handleWebhook(webhookReq('orange_money', JSON.stringify({ status: 'SUCCESS', notif_token: 'FAUX' })), deps(omEnv, omFetch))).status === 401);
  ok('… rien n\u2019est confirmé', payStatut(o1.rideId) === 'en_attente');
  r = await handleWebhook(webhookReq('orange_money', JSON.stringify({ status: 'SUCCESS', notif_token: 'NT-1' })), deps(omEnv, omFetch));
  ok('jeton valide mais Orange répond « PENDING » à la relecture : non confirmé (on ne croit pas la notification)', r.status === 200 && payStatut(o1.rideId) === 'en_attente');
  omDown = true;
  r = await handleWebhook(webhookReq('orange_money', JSON.stringify({ status: 'SUCCESS', notif_token: 'NT-1' })), deps(omEnv, omFetch));
  ok('Orange indisponible à la relecture : 500 (Orange réessaiera)', r.status === 500 && payStatut(o1.rideId) === 'en_attente');
  omDown = false; omStatus = 'SUCCESS';
  r = await handleWebhook(webhookReq('orange_money', JSON.stringify({ status: 'SUCCESS', notif_token: 'NT-1' })), deps(omEnv, omFetch));
  ok('Orange confirme « SUCCESS » : paiement confirmé', r.status === 200 && payStatut(o1.rideId) === 'confirme' && intentRow(o1.intent.id).statut === 'reussi');
  ok('la référence de transaction Orange est conservée', sql(`select reference_externe from payments where source_id='${o1.rideId}'`) === 'MP.1');
  ok('fournisseur inconnu : 400', (await handleWebhook(webhookReq('paypal', '{}'), deps(omEnv))).status === 400);
  ok('configuration manquante → erreur claire, pas de plantage', await (async () => {
    const o2 = await pendingIntent('orange_money');
    const rr = await handleCheckout(checkoutReq(A, { intent_id: o2.intent.id }), deps({ ...SITE }, omFetch));
    const body: any = await rr.json();
    return rr.status === 502 && /variable OM_[A-Z_]+ est absente/.test(String(body.message));
  })());

  sql(`update app_config set valeur='true' where cle='mode_test_paiements'`);
  console.log(`\n===== RÉSULTAT : ${pass} réussis, ${fail} échoués =====`);
  process.exit(fail ? 1 : 0);
}
main().catch((e) => { console.error('ERREUR NON GÉRÉE', e); process.exit(2); });
