/**
 * Test d'intégration : exécute les VRAIES classes de services Angular du site
 * (src/app/core/services/*) contre une API PostgREST réelle branchée sur la base
 * PostgreSQL de test, avec de vrais jetons JWT. Vérifie que les noms de paramètres,
 * les formats de données, les jointures et les upserts attendus par le site
 * correspondent bien à ce que la base expose.
 *
 * Lancement : voir supabase/tests/README.md
 */
import { PostgrestClient } from '@supabase/postgrest-js';
import { createHmac, randomUUID } from 'node:crypto';
import { execSync } from 'node:child_process';

import { RidesService } from '../../../src/app/core/services/rides.service';
import { TripsService } from '../../../src/app/core/services/trips.service';
import { BusService } from '../../../src/app/core/services/bus.service';
import { DeliveryService } from '../../../src/app/core/services/delivery.service';
import { DriverService } from '../../../src/app/core/services/driver.service';
import { ProfileService } from '../../../src/app/core/services/profile.service';
import { AdminService } from '../../../src/app/core/services/admin.service';
import { PaymentsService } from '../../../src/app/core/services/payments.service';
import { messageErreur } from '../../../src/app/core/util/format';

const API = process.env['API_URL'] ?? 'http://127.0.0.1:3000';
const SECRET = 'super-secret-jwt-token-with-at-least-32-characters-long';
const DB = process.env['API_DB'] ?? 'yobb_api';

let pass = 0, fail = 0;
const ok = (name: string, cond: unknown, detail = '') => {
  if (cond) { pass++; console.log(`  PASS  ${name}`); } else { fail++; console.log(`  FAIL  ${name} ${detail}`); }
};

function b64(o: object | Buffer) { return Buffer.from(o instanceof Buffer ? o : JSON.stringify(o)).toString('base64url'); }
function jwt(sub: string | null) {
  const head = b64({ alg: 'HS256', typ: 'JWT' });
  const body = b64({ role: sub ? 'authenticated' : 'anon', ...(sub ? { sub, aud: 'authenticated' } : {}), exp: Math.floor(Date.now() / 1000) + 3600 });
  const sig = createHmac('sha256', SECRET).update(`${head}.${body}`).digest('base64url');
  return `${head}.${body}.${sig}`;
}
const sql = (q: string) => execSync(`su postgres -c "psql -d ${DB} -At -q"`, { input: q }).toString().trim();

/** Faux SupabaseService : mêmes membres que le vrai (client, uid, rpc), branché sur PostgREST. */
class FakeSb {
  client: PostgrestClient;
  constructor(public uid: string | null) {
    this.client = new PostgrestClient(API, { headers: { Authorization: `Bearer ${jwt(uid)}` } });
  }
  // identique à SupabaseService.rpc()
  async rpc<T>(fn: string, args?: Record<string, unknown>): Promise<T> {
    const { data, error } = await this.client.rpc(fn, args ?? {});
    if (error) throw error;
    return data as T;
  }
  async refreshProfile() {}
  watch() { return () => {}; }
}
function adminSvc(sb: any, delivery: any): AdminService {
  const a = Object.create(AdminService.prototype) as any;
  a.sb = sb; a.delivery = delivery;   // les vraies méthodes, sans le constructeur (effect() nécessite Angular)
  return a as AdminService;
}
const svc = (uid: string | null) => {
  const sb = new FakeSb(uid) as any;
  return {
    rides: new RidesService(sb), trips: new TripsService(sb), bus: new BusService(sb),
    delivery: new DeliveryService(sb), driver: new DriverService(sb), profile: new ProfileService(sb), sb,
  };
};
async function fails(name: string, p: Promise<unknown>, contains: string) {
  try { await p; ok(name, false, '(aucune erreur levée)'); }
  catch (e) { const m = messageErreur(e); ok(name, m.toLowerCase().includes(contains.toLowerCase()), `→ « ${m} »`); }
}

function mkuser(prenom: string, role: string) {
  const id = randomUUID();
  sql(`insert into auth.users(id,email,raw_user_meta_data) values ('${id}','${prenom}@t.sn', jsonb_build_object('prenom','${prenom}','nom','Test','telephone','+221770000','role','${role}'))`);
  return id;
}

async function main() {
  const A = mkuser('Awa', 'client'), B = mkuser('Bassirou', 'chauffeur'), R = mkuser('Rokhaya', 'receveur_bus'), M = mkuser('Moussa', 'commercant');
  const a = svc(A), b = svc(B), r = svc(R), m = svc(M), anon = svc(null);
  const PLATEAU = { lat: 14.6708, lng: -17.4382 }, OUAKAM = { lat: 14.7167, lng: -17.493 };

  console.log('== Chauffeur : véhicule, tarifs, statut');
  const veh = await b.driver.addVehicle({ categorie: 'standard', marque: 'Toyota', modele: 'Yaris', immatriculation: 'DK-1-AA' });
  ok('addVehicle renvoie le véhicule créé', veh.id && veh.categorie === 'standard');
  ok('vehicles() le liste', (await b.driver.vehicles()).length === 1);
  await b.driver.savePricing('standard', 160);
  await b.driver.savePricing('standard', 165); // upsert
  const mine = await b.driver.myPricing();
  ok('savePricing fait bien un UPSERT (1 ligne, 165)', mine.length === 1 && Number(mine[0].tarif_km_choisi) === 165, JSON.stringify(mine));
  await fails('tarif hors fourchette refusé (message en français)', b.driver.savePricing('standard', 999), 'doit être entre');
  const avg = await b.driver.averages();
  ok('averages() lit la vue tarif_moyen_par_categorie', avg.some((x) => x.categorie === 'standard' && Number(x.tarif_moyen) === 165), JSON.stringify(avg));
  const st = await b.driver.status();
  ok('status() : non bloqué, dette 0', st.bloque === false && st.dette_total === 0 && Array.isArray(st.dettes));

  console.log('\n== Course à la demande (RidesService)');
  const pricing = await a.rides.pricing();
  const settings = await a.rides.settings();
  ok('pricing() : 3 catégories avec des nombres', pricing.length === 3 && pricing.every((p) => Number(p.tarif_km_base) > 0));
  ok('settings() lit app_config (rayon 0,5 / relance 120 s / min 500)', settings.rayonInitialKm === 0.5 && settings.delaiRelanceS === 120 && settings.tarifMinimum === 500, JSON.stringify(settings));
  await fails('offre trop basse refusée', a.rides.create({ categorie: 'standard', depart: { label: 'Plateau', ...PLATEAU }, arrivee: { label: 'Ouakam', ...OUAKAM }, distanceKm: 9, montantOffert: 100 }), 'au moins');
  const ride = await a.rides.create({ categorie: 'standard', depart: { label: 'Plateau', ...PLATEAU }, arrivee: { label: 'Ouakam', ...OUAKAM }, distanceKm: 9, montantOffert: 1000 });
  ok('create() renvoie la course (en_attente, offre 1000)', ride.statut === 'en_attente' && Number(ride.montant_offert) === 1000, JSON.stringify(ride));
  const est = a.rides.estimate(9, Number(pricing.find((p) => p.categorie === 'standard')!.tarif_km_base), settings.tarifMinimum);
  ok("l'estimation du site = le tarif_base calculé par le serveur", est === Number(ride.tarif_base), `${est} vs ${ride.tarif_base}`);
  const latest = await a.rides.latestAsClient();
  ok('latestAsClient() retrouve la course', latest?.id === ride.id);

  const near = await b.rides.nearby(14.6712, -17.4385);
  ok('nearby() : le chauffeur voit la demande (prix proposé 1000)', near.length === 1 && Number(near[0].prix_propose) === 1000 && near[0].client_prenom === 'Awa', JSON.stringify(near));
  ok('nearby() : champs numériques bien typés', typeof near[0].distance_client_m === 'number' && typeof near[0].rayon_courant_km === 'number');
  await fails('un client ne peut pas appeler nearby()', a.rides.nearby(14.67, -17.43), 'rôle');

  const acc = await b.rides.accept(ride.id);
  ok('accept() → assignee', acc.statut === 'assignee' && acc.driver_id === B);
  ok('activeAsDriver() la retrouve', (await b.rides.activeAsDriver())?.id === ride.id);
  await b.rides.start(ride.id);
  const pay = await b.rides.finish(ride.id, 'especes');
  ok('finish() renvoie le paiement (1000, 5 %, espèces)', Number(pay.montant) === 1000 && Number(pay.commission_pct) === 5 && pay.moyen === 'especes', JSON.stringify(pay));
  const st2 = await b.driver.status();
  ok('status() : bloqué avec 50 FCFA de dette', st2.bloque === true && Number(st2.dette_total) === 50 && st2.dettes.length === 1, JSON.stringify(st2));
  const done = await a.rides.latestAsClient();
  ok('le client voit la course terminée', done?.statut === 'terminee');
  ok('paymentFor() renvoie le paiement au client', Number((await a.rides.paymentFor(ride.id))?.montant) === 1000);
  ok('hasReviewed() = false avant avis', (await a.rides.hasReviewed('ride', ride.id)) === false);
  await a.rides.rate('ride', ride.id, 5, 'Très bien');
  ok('hasReviewed() = true après avis', (await a.rides.hasReviewed('ride', ride.id)) === true);
  await fails('double avis refusé', a.rides.rate('ride', ride.id, 4, null), 'déjà');
  const rel = await a.profile.related(B);
  ok('related() : le client lit le profil complet (téléphone) du chauffeur', rel?.telephone === '+221770000' && Number(rel?.note_moyenne) === 5, JSON.stringify(rel));
  ok('publicProfile() lit la vue publique', (await a.profile.publicProfile(B))?.prenom === 'Bassirou');
  ok('un inconnu ne lit PAS le profil complet', (await m.profile.related(B)) === null);
  await b.driver.settleDebt(st2.dettes[0].id);
  ok('settleDebt() débloque le chauffeur', (await b.driver.status()).bloque === false);

  console.log('\n== Trajets interurbains (TripsService)');
  const inTwoDays = new Date(Date.now() + 2 * 86400000).toISOString();
  const trip = await b.trips.publish({ vehicle_id: veh.id, depart_label: 'Dakar', arrivee_label: 'Thiès', depart_lat: 14.67, depart_lng: -17.43, arrivee_lat: 14.79, arrivee_lng: -16.93, date_heure_depart: inTwoDays, places_dispo: 3, prix_place: 3000 });
  ok('publish() crée le trajet', trip.id && trip.statut === 'ouvert');
  const found = await a.trips.search({ depart: 'dak', arrivee: 'thi' });
  ok('search() filtre (ilike) et trouve le trajet', found.some((t) => t.id === trip.id));
  ok('search() : le conducteur ne voit pas son propre trajet', !(await b.trips.search({})).some((t) => t.id === trip.id));
  ok('search() par date (jour du départ)', (await a.trips.search({ date: inTwoDays.slice(0, 10) })).some((t) => t.id === trip.id));
  ok('search() par mauvaise ville = vide', (await a.trips.search({ depart: 'Ziguinchor' })).length === 0);
  const profs = await a.trips.profiles([B]);
  ok('profiles() → Map avec prénom du chauffeur', profs.get(B)?.prenom === 'Bassirou');
  const vehs = await a.trips.vehicles([veh.id]);
  ok('vehicles() → Map avec le véhicule', vehs.get(veh.id)?.marque === 'Toyota');
  const res = await a.trips.reserve(trip.id, 2);
  ok('reserve() → en_attente', res.statut === 'en_attente' && res.nb_places === 2);
  const myRes = await a.trips.myReservations();
  ok('myReservations() : jointure trip:trips(*) fonctionne', myRes.length === 1 && myRes[0].trip?.depart_label === 'Dakar', JSON.stringify(myRes[0]).slice(0, 200));
  const myTrips = await b.trips.myTrips();
  ok('myTrips() : jointure reservations(*) fonctionne', myTrips[0]?.reservations?.length === 1);
  ok('le chauffeur lit le profil du passager (relation)', (await b.profile.related(A))?.prenom === 'Awa');
  await b.trips.confirm(res.id);
  ok('places restantes = 1 après confirmation', (await b.trips.myTrips())[0].places_dispo === 1);
  await fails('encaisser avant la fin refusé', b.trips.collect(res.id, 'especes'), 'terminez');
  await b.trips.finishTrip(trip.id);
  const p2 = await b.trips.collect(res.id, 'wave');
  ok('collect() Wave (mode test) = 6000', Number(p2.montant) === 6000 && p2.moyen === 'wave');
  ok('paidReservationIds() contient la réservation', (await b.trips.paidReservationIds([res.id])).has(res.id));
  await a.rides.rate('trip', trip.id, 4, null);
  ok('avis sur le trajet enregistré', (await a.rides.hasReviewed('trip', trip.id)) === true);

  console.log('\n== Bus TATA (BusService)');
  const route: [number, number][] = [[14.7, -17.45], [14.7, -17.425], [14.7, -17.4]];
  const line = await r.bus.createLine({ nom_ligne: 'Ligne 12', terminus_depart: 'Liberté 6', terminus_arrivee: 'Petersen', trajet: route });
  ok('createLine() enregistre le tracé (jsonb)', Array.isArray(line.trajet) && line.trajet!.length === 3);
  await fails('un client ne peut pas créer de ligne', a.bus.createLine({ nom_ligne: 'X', terminus_depart: '', terminus_arrivee: '', trajet: null }), 'non autorisée');
  await r.bus.sendPosition(line.id, 14.7, -17.45, 20, 'Bus 1');
  await r.bus.sendPosition(line.id, 14.7, -17.448, 22, 'Bus 1'); // upsert
  ok('sendPosition() est un upsert (1 ligne pour ce bus)', sql(`select count(*) from bus_positions where bus_line_id='${line.id}'`) === '1');
  const arr = await anon.bus.arrivals(14.7002, -17.42);
  ok('arrivals() accessible SANS connexion (service public)', arr.length === 1 && arr[0].statut === 'approche', JSON.stringify(arr));
  ok('arrivals() : distance ≈ 3,1 km, ETA ≈ 8 min (22 km/h)', arr[0].distance_m > 2900 && arr[0].distance_m < 3300 && arr[0].eta_minutes! > 7.5 && arr[0].eta_minutes! < 9, JSON.stringify(arr[0]));
  ok('arrivals() : nombres bien typés (pas de chaînes)', typeof arr[0].distance_m === 'number' && typeof arr[0].eta_minutes === 'number' && typeof arr[0].vitesse_kmh === 'number');
  ok('linesByIds() (public) renvoie le tracé', (await anon.bus.linesByIds([line.id]))[0]?.trajet?.length === 3);
  ok('myLines()', (await r.bus.myLines()).length === 1);
  await r.bus.setActive(line.id, false);
  ok('ligne désactivée : plus de bus proposé', (await anon.bus.arrivals(14.7002, -17.42)).length === 0);
  await r.bus.setActive(line.id, true);

  console.log('\n== Livraison (DeliveryService)');
  ok('myMerchant() = null au départ', (await m.delivery.myMerchant()) === null);
  const shop = await m.delivery.createMerchant({ type: 'pharmacie', nom_commerce: 'Pharmacie Liberté', lat: 14.679, lng: -17.44 });
  ok('createMerchant() ; statut forcé à en_attente', shop.statut_verif === 'en_attente');
  await fails('pharmacie sans ordonnance refusée', a.delivery.create({ type: 'pharmacie', livraison: { label: 'Domicile', lat: 14.672, lng: -17.439 } }), 'ordonnance');
  const cmd = await a.delivery.create({ type: 'pharmacie', livraison: { label: 'Domicile', lat: 14.672, lng: -17.439 }, ordonnancePath: `${A}/ordo.jpg`, description: 'Urgent' });
  ok('create() pharmacie → en_attente_devis, collecte = la pharmacie', cmd.statut === 'en_attente_devis' && cmd.collecte_label === 'Pharmacie Liberté' && cmd.merchant_id === shop.id, JSON.stringify(cmd));
  ok('merchantOrders() voit la commande', (await m.delivery.merchantOrders(shop.id)).some((o) => o.id === cmd.id));
  const devis = await m.delivery.sendQuote(cmd.id, [{ libelle: 'Paracétamol', prix: 850 }, { libelle: 'Amoxicilline', prix: 2400 }], 700, 'Prêt dans 10 min');
  ok('sendQuote() : total produits 3250, statut devis_envoye, lignes jsonb', Number(devis.montant_produits) === 3250 && devis.statut === 'devis_envoye' && devis.devis_lignes?.length === 2, JSON.stringify(devis));
  ok('myOrders() côté client montre le devis', (await a.delivery.myOrders())[0].devis_lignes?.[1].prix === 2400);
  await a.delivery.approve(cmd.id);
  const dn = await b.delivery.nearby(14.6795, -17.4405);
  ok('nearby() livraison : le livreur voit la commande', dn.length === 1 && Number(dn[0].montant_livraison) === 700 && dn[0].commerce === 'Pharmacie Liberté', JSON.stringify(dn));
  await b.delivery.accept(cmd.id);
  ok('activeAsDriver() livraison', (await b.delivery.activeAsDriver())?.id === cmd.id);
  await fails('espèces refusé pour commande marchande', b.delivery.finish(cmd.id, 'especes'), 'Wave ou Orange Money');
  const pays = await b.delivery.finish(cmd.id, 'wave');
  ok('finish() renvoie 2 paiements (produits 3250 + livraison 700)', pays.length === 2 && pays.some((p) => p.categorie_montant === 'produits' && Number(p.montant) === 3250) && pays.some((p) => p.categorie_montant === 'livraison' && Number(p.montant) === 700), JSON.stringify(pays));
  ok('le commerçant est bénéficiaire des produits', pays.find((p) => p.categorie_montant === 'produits')?.beneficiaire_id === M);
  const colis = await a.delivery.create({ type: 'colis', livraison: { label: 'Almadies', lat: 14.745, lng: -17.5 }, collecte: { label: 'Plateau', ...PLATEAU }, distanceKm: 10, description: 'Carton', vehicule: 'voiture' });
  ok('colis : approuvé direct, prix calculé serveur', colis.statut === 'approuvee' && Number(colis.montant_livraison) >= 500, JSON.stringify(colis));
  ok('earnings() : le livreur voit ses paiements', (await b.driver.earnings()).length >= 2);


  console.log('\n== Bus : plusieurs bus par ligne, recherche par trajet');
  const R2 = mkuser('Ramatoulaye', 'receveur_bus'); const r2 = svc(R2);
  await r2.bus.sendPosition(line.id, 14.7, -17.43, 30, 'Bus 2');
  ok('un 2e receveur fait circuler son bus sur la MÊME ligne', sql(`select count(*) from bus_positions where bus_line_id='${line.id}'`) === '2');
  const two = await anon.bus.arrivals(14.7002, -17.42);
  ok('arrivals() : 2 bus distincts, avec libellé', two.length === 2 && new Set(two.map((x) => x.bus_id)).size === 2 && two.some((x) => x.bus_label === 'Bus 2'), JSON.stringify(two).slice(0, 200));
  ok('activeLines() : toutes les lignes actives (choix du receveur)', (await r2.bus.activeLines()).some((l) => l.id === line.id));
  const tj = await anon.bus.trajet({ lat: 14.7002, lng: -17.42 }, { lat: 14.7002, lng: -17.41 });
  ok('trajet() : 2 bus, durée à bord et distance renseignées', tj.length === 2 && typeof tj[0].duree_trajet_min === 'number' && tj[0].distance_trajet_m > 900, JSON.stringify(tj[0]));
  ok('trajet() : sens inverse = aucune ligne', (await anon.bus.trajet({ lat: 14.7002, lng: -17.41 }, { lat: 14.7002, lng: -17.42 })).length === 0);
  await r2.bus.stopPosition(line.id);
  ok('stopPosition() retire uniquement MON bus', sql(`select count(*) from bus_positions where bus_line_id='${line.id}'`) === '1');
  await fails('un receveur ne peut pas déplacer le bus d\u2019un autre', (async () => { const { data } = await r2.sb.client.from('bus_positions').update({ lat: 0 }).eq('receveur_id', R).select(); if (!data?.length) throw new Error('non autorisée : aucune ligne modifiable'); })(), 'non autorisée');

  console.log('\n== Position en direct du chauffeur');
  await b.driver.pushLocation(14.671, -17.438, 25);
  await b.driver.pushLocation(14.672, -17.439, 30);
  ok('pushLocation() est un upsert', sql(`select count(*) from driver_locations where driver_id='${B}'`) === '1');
  ok('locationOf() : invisible sans course en cours', (await a.driver.locationOf(B)) === null);
  const liveRide = await a.rides.create({ categorie: 'standard', depart: { label: 'Plateau', ...PLATEAU }, arrivee: { label: 'Ouakam', ...OUAKAM }, distanceKm: 9, montantOffert: null });
  await b.rides.accept(liveRide.id);
  const seen = await a.driver.locationOf(B);
  ok('locationOf() : le client voit son chauffeur pendant la course', seen !== null && Number(seen.lat) === 14.672 && Number(seen.vitesse_kmh) === 30, JSON.stringify(seen));
  ok('locationOf() : un tiers ne voit rien', (await m.driver.locationOf(B)) === null);
  await b.rides.start(liveRide.id); await b.rides.finish(liveRide.id, 'wave');
  ok('locationOf() : invisible une fois la course terminée', (await a.driver.locationOf(B)) === null);
  await b.driver.clearLocation();
  ok('clearLocation() supprime la position', sql(`select count(*) from driver_locations where driver_id='${B}'`) === '0');

  console.log('\n== Avis livraison / commerçant, modification de trajet');
  await a.rides.rate('delivery', cmd.id, 5, 'Rapide');
  await a.rides.rate('commerce', cmd.id, 4, null);
  const keys = await a.delivery.reviewedKeys([cmd.id]);
  ok('reviewedKeys() retrouve les deux avis', keys.has(`delivery:${cmd.id}`) && keys.has(`commerce:${cmd.id}`), [...keys].join());
  await fails('avis « commerce » refusé au livreur', b.rides.rate('commerce', cmd.id, 1, null), 'client');
  const trip2 = await b.trips.publish({ vehicle_id: veh.id, depart_label: 'Dakar', arrivee_label: 'Mbour', depart_lat: 14.67, depart_lng: -17.43, arrivee_lat: 14.42, arrivee_lng: -16.96, date_heure_depart: new Date(Date.now() + 3 * 86400000).toISOString(), places_dispo: 3, prix_place: 2500 });
  const mod = await b.trips.modify(trip2.id, 3000, new Date(Date.now() + 4 * 86400000).toISOString(), 5);
  ok('modify() : prix 3000 et 5 places', Number(mod.prix_place) === 3000 && mod.places_dispo === 5, JSON.stringify(mod));
  await a.trips.reserve(trip2.id, 1);
  await fails('modify() refuse de changer le prix une fois réservé', b.trips.modify(trip2.id, 2000, new Date(Date.now() + 4 * 86400000).toISOString(), 5), 'passagers ont réservé');

  console.log('\n== Notifications (mêmes requêtes que NotificationsService)');
  const nq = await b.sb.client.from('notifications').select('*').order('created_at', { ascending: false }).limit(40);
  ok('load() : le chauffeur lit ses notifications (réservation, dette…)', !nq.error && (nq.data ?? []).length > 0 && (nq.data ?? []).some((n: any) => n.type === 'reservation_nouvelle'), JSON.stringify(nq.error));
  const nA = await a.sb.client.from('notifications').select('*');
  ok('chaque utilisateur ne voit que les siennes', (nA.data ?? []).every((n: any) => n.user_id === A));
  const nb = await a.sb.rpc<number>('notifications_marquer_lues');
  ok('notifications_marquer_lues() renvoie le nombre traité', nb > 0);
  ok('… puis plus rien de non lu', ((await a.sb.client.from('notifications').select('id').eq('lu', false)).data ?? []).length === 0);

  console.log('\n== Administration (AdminService)');
  const ADM = mkuser('Admin', 'client'); const adm = svc(ADM);
  const admin = adminSvc(adm.sb, adm.delivery);
  await fails('un non-admin ne peut pas appeler stats()', adminSvc(a.sb, a.delivery).stats(), 'administrateurs');
  ok('is_admin() = false pour un utilisateur ordinaire', (await a.sb.rpc<boolean>('is_admin')) === false);
  sql(`insert into admins(user_id) values ('${ADM}')`);
  ok('is_admin() = true pour l\u2019administrateur', (await adm.sb.rpc<boolean>('is_admin')) === true);
  const stt = await admin.stats();
  ok('stats() : indicateurs numériques', typeof stt.courses_terminees === 'number' && stt.courses_terminees >= 2 && typeof stt.volume_paiements === 'number', JSON.stringify(stt).slice(0, 200));
  const pend = await admin.profilesToReview('en_attente');
  ok('profilesToReview() : uniquement les comptes avec documents', Array.isArray(pend) && pend.every((p) => p.cni_url || p.permis_url));
  sql(`update profiles set cni_url='${B}/cni.jpg' where id='${B}'`);
  ok('… un compte avec CNI apparaît', (await admin.profilesToReview('en_attente')).some((p) => p.id === B));
  await admin.setVerification(B, 'verifie');
  ok('setVerification() met à jour le compte', sql(`select statut_verif from profiles where id='${B}'`) === 'verifie');
  ok('… et notifie l\u2019utilisateur', sql(`select count(*) from notifications where user_id='${B}' and type='compte_verifie'`) === '1');
  const ms = await admin.merchants();
  ok('merchants() : jointure gérant (owner:profiles!merchants_owner_id_fkey)', ms.length >= 1 && ms[0].owner?.prenom === 'Moussa', JSON.stringify(ms[0]).slice(0, 200));
  await admin.setMerchantVerification(shop.id, 'verifie');
  ok('setMerchantVerification() fonctionne malgré la protection des colonnes', sql(`select statut_verif from merchants where id='${shop.id}'`) === 'verifie');
  const led = await admin.ledger();
  ok('ledger() : jointure chauffeur (driver:profiles!driver_ledger_driver_id_fkey)', Array.isArray(led), '');
  sql(`insert into driver_ledger(driver_id, payment_id, montant) select '${B}', id, 50 from payments limit 1`);
  const led2 = await admin.ledger();
  ok('ledger() : la dette apparaît avec le nom du chauffeur', led2.length >= 1 && led2[0].driver?.prenom === 'Bassirou', JSON.stringify(led2[0]).slice(0, 200));
  await admin.settleDebt(led2[0].id);
  ok('settleDebt() : dette réglée', (await admin.ledger()).length === led2.length - 1);
  const cfg = await admin.config();
  ok('config() lit les paramètres', cfg.some((c) => c.cle === 'tarif_minimum'));
  await admin.setConfig('tarif_minimum', '650');
  ok('setConfig() enregistre', sql(`select valeur from app_config where cle='tarif_minimum'`) === '650');
  await admin.setConfig('tarif_minimum', '500');
  await fails('setConfig() refuse une clé inconnue', admin.setConfig('inconnue', '1'), 'existe pas');
  const pr = await admin.pricing();
  ok('pricing() : 3 catégories', pr.length === 3);
  await admin.setPricing('standard', 130, 190, 150);
  await fails('setPricing() refuse min > base', admin.setPricing('standard', 200, 190, 150), 'minimum');
  ok('un non-admin ne peut pas modifier un tarif', await (async () => { try { await adminSvc(a.sb, a.delivery).setPricing('standard', 1, 2, 1); return false; } catch { return true; } })());


  console.log('\n== Paiements en ligne (PaymentsService) et versements (AdminService)');
  const ps = (sb: any) => new PaymentsService(sb);
  ok('config() : mode test actif par défaut, fournisseurs lus', (await ps(a.sb).config()).test === true && (await ps(a.sb).config()).fournisseurs.length === 2);
  sql(`update app_config set valeur='false' where cle='mode_test_paiements'`);
  const cfgReal = await ps(a.sb).config();
  ok('config() : mode réel après bascule (Wave et Orange Money proposés)', cfgReal.test === false && cfgReal.fournisseurs.join() === 'wave,orange_money', JSON.stringify(cfgReal));
  const payRide = await a.rides.create({ categorie: 'standard', depart: { label: 'Plateau', ...PLATEAU }, arrivee: { label: 'Ouakam', ...OUAKAM }, distanceKm: 9, montantOffert: null });
  await b.rides.accept(payRide.id); await b.rides.start(payRide.id);
  const pendingPay = await b.rides.finish(payRide.id, 'wave');
  ok('en mode réel, le paiement Wave est « en_attente »', pendingPay.statut_transaction === 'en_attente', JSON.stringify(pendingPay));
  const due = await ps(a.sb).pendingFor('ride', payRide.id);
  ok('pendingFor() : le client voit ce qu\u2019il doit', due.length === 1 && Number(due[0].montant) === Number(pendingPay.montant));
  ok('pendingFor() : le chauffeur (bénéficiaire) ne voit rien à payer', (await ps(b.sb).pendingFor('ride', payRide.id)).length === 0);
  const it = await a.sb.rpc<any>('demander_paiement', { p_source: 'ride', p_source_id: payRide.id, p_provider: 'wave' });
  ok('demander_paiement() renvoie la tentative', it.statut === 'cree' && Number(it.montant) === Number(pendingPay.montant) && it.ref_courte.startsWith('YB'));
  ok('intent() : lisible par son propriétaire, pas par un tiers', (await ps(a.sb).intent(it.id))?.id === it.id && (await ps(m.sb).intent(it.id)) === null);
  const soldeAvant = await ps(b.sb).solde();
  sql(`select confirmer_intent('${it.ref_courte}','reussi',${it.montant},'W-TXN')`);
  ok('pendingFor() : plus rien à payer une fois confirmé', (await ps(a.sb).pendingFor('ride', payRide.id)).length === 0);
  const soldeApres = await ps(b.sb).solde();
  ok('solde() : le net du chauffeur (95 %) est ajouté au solde à reverser', Math.abs(Number(soldeApres.a_verser) - Number(soldeAvant.a_verser) - Number(it.montant) * 0.95) < 0.01, JSON.stringify([soldeAvant, soldeApres]));
  const so = await admin.soldes();
  ok('AdminService.soldes() liste le chauffeur', so.some((x) => x.beneficiaire_id === B && Number(x.a_verser) > 0));
  await admin.enregistrerVersement(B, 500, 'wave', 'W-PAYOUT', null);
  ok('enregistrerVersement() diminue le solde de 500', Math.abs(Number((await ps(b.sb).solde()).a_verser) - (Number(soldeApres.a_verser) - 500)) < 0.01);
  await fails('versement au-delà du solde refusé', admin.enregistrerVersement(B, 99999999, 'wave', null, null), 'entre 1 et');
  ok('suspendus() : aucun compte suspendu', (await admin.suspendus()).length === 0);
  sql(`update app_config set valeur='true' where cle='mode_test_paiements'`);

  console.log(`\n===== RÉSULTAT : ${pass} réussis, ${fail} échoués =====`);
  process.exit(fail ? 1 : 0);
}
main().catch((e) => { console.error('ERREUR NON GÉRÉE', e); process.exit(2); });
