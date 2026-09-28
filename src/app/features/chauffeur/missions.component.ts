import { Component, OnDestroy, OnInit, computed, signal } from '@angular/core';
import { RouterLink } from '@angular/router';
import {
  DeliveryOrder, DriverStatus, MoyenPaiement, NearbyDelivery, NearbyRide, RideRequest, Vehicle,
} from '../../core/models/models';
import { DeliveryService } from '../../core/services/delivery.service';
import { DriverService } from '../../core/services/driver.service';
import { DAKAR, GeoService } from '../../core/services/geo.service';
import { ProfileService, RelatedProfile } from '../../core/services/profile.service';
import { RidesService } from '../../core/services/rides.service';
import { SupabaseService } from '../../core/services/supabase.service';
import { ToastService } from '../../core/services/toast.service';
import {
  LIBELLES_CATEGORIE, LIBELLES_LIVRAISON, LIBELLES_MOYEN, distanceLisible, fcfa, messageErreur, mmss, secondesRestantes,
} from '../../core/util/format';
import { MapComponent, MapMarker, MapRoute } from '../../shared/map/map.component';
import { StarsComponent } from '../../shared/stars/stars.component';

@Component({
  selector: 'app-missions',
  standalone: true,
  imports: [RouterLink, MapComponent, StarsComponent],
  template: `
<section class="page">
  <div class="container">
    <header class="page-head">
      <div>
        <h1>Mode chauffeur</h1>
        <p>Recevez les courses et livraisons autour de vous, et acceptez celles qui vous conviennent.</p>
      </div>
      <label class="switch">
        <input type="checkbox" [checked]="online()" (change)="setOnline($any($event.target).checked)" [disabled]="!!activeRide() || !!activeDelivery()">
        <span class="switch__track"></span>
        <span>{{ online() ? 'En ligne' : 'Hors ligne' }}</span>
      </label>
    </header>

    @if (!estChauffeur()) {
      <div class="alert alert--warn"><i class="bi bi-lock"></i><p>Cette page est réservée aux comptes <strong>chauffeur</strong>. Créez un compte chauffeur pour recevoir des courses.</p></div>
    } @else {
      <div class="stack">
        @if (status(); as s) {
          @if (s.bloque) {
            <div class="alert alert--error">
              <i class="bi bi-slash-circle"></i>
              <div style="flex:1">
                <p><strong>Compte bloqué : {{ fcfa(s.dette_total) }} de commission à régler.</strong><br>
                Vous ne pouvez plus accepter de mission tant que cette somme (5 % des courses payées en espèces) n'est pas versée à Yobbalema.</p>
                <div class="row mt-1">
                  @if (s.mode_test_paiements) {
                    <button class="btn btn--ink btn--sm" (click)="settleAll(s)" [disabled]="busy() === 'debt'"><i class="bi bi-wallet2"></i> Régler ({{ fcfa(s.dette_total) }}) — simulation</button>
                  } @else { <a routerLink="/chauffeur" class="btn btn--ink btn--sm"><i class="bi bi-wallet2"></i> Régler en ligne ({{ fcfa(s.dette_total) }})</a> }
                </div>
              </div>
            </div>
          }
          @if (s.verification_requise && s.statut_verif !== 'verifie') {
            <div class="alert alert--warn"><i class="bi bi-shield-exclamation"></i><p>Votre identité n'est pas encore vérifiée. <a routerLink="/profil" class="strong">Ajoutez vos documents</a> pour pouvoir accepter des missions.</p></div>
          }
        }
        @if (vehicles().length === 0 && !loading()) {
          <div class="alert alert--warn"><i class="bi bi-car-front"></i><p>Vous n'avez enregistré aucun véhicule : vous ne recevrez aucune demande. <a routerLink="/chauffeur" class="strong">Ajouter un véhicule</a></p></div>
        }
        @if (error()) { <div class="alert alert--error"><i class="bi bi-exclamation-triangle"></i><p>{{ error() }}</p></div> }

        <!-- MISSION EN COURS : COURSE -->
        @if (activeRide(); as r) {
          <div class="cols-2 cols-2--form">
            <div class="card stack stack--lg" style="border-color:var(--color-teal)">
              <div class="row row--between">
                <span class="tag" [class]="r.statut === 'en_cours' ? 'tag tag--go' : 'tag tag--ok'">
                  <i class="bi bi-car-front-fill"></i> {{ r.statut === 'en_cours' ? 'Course en cours' : 'Course acceptée — allez chercher le client' }}
                </span>
                <span class="tag tag--off">{{ cat(r.categorie) }}</span>
              </div>
              <div>
                <span class="xs muted">Montant à encaisser</span>
                <div class="price price--lg">{{ fcfa(r.montant_offert ?? r.tarif_base) }}</div>
                @if (r.montant_offert) { <span class="xs muted">Offre waxalé (tarif de base : {{ fcfa(r.tarif_base) }})</span> }
              </div>
              <dl class="kv">
                <dt>Client</dt><dd>{{ client()?.prenom }} {{ client()?.nom }}</dd>
                <dt>Départ</dt><dd>{{ r.depart_label }}</dd>
                <dt>Arrivée</dt><dd>{{ r.arrivee_label }}</dd>
                <dt>Distance</dt><dd>{{ r.distance_km.toString().replace('.', ',') }} km</dd>
              </dl>
              @if (client()?.telephone; as tel) { <a class="btn btn--outline btn--sm" [href]="'tel:' + tel"><i class="bi bi-telephone"></i> Appeler {{ tel }}</a> }

              @if (r.statut === 'assignee') {
                <div class="row">
                  <button class="btn btn--teal" (click)="startRide(r)" [disabled]="!!busy()"><i class="bi bi-play-fill"></i> Démarrer la course</button>
                  <button class="btn btn--danger btn--sm" (click)="desist(r)" [disabled]="!!busy()">Me désister</button>
                </div>
              } @else {
                <div class="stack">
                  <div class="field">
                    <label for="moyen">Le client paie par</label>
                    <select id="moyen" (change)="moyen.set($any($event.target).value)">
                      @for (m of moyens; track m.id) { <option [value]="m.id" [selected]="moyen() === m.id">{{ m.nom }}</option> }
                    </select>
                    @if (moyen() === 'especes') { <span class="field-hint">Espèces : une commission de {{ fcfa(commission(r.montant_offert ?? r.tarif_base)) }} (5 %) sera à régler à Yobbalema.</span> }
                  </div>
                  <button class="btn btn--gold" (click)="finishRide(r)" [disabled]="!!busy()"><i class="bi bi-check2-circle"></i> Terminer et encaisser</button>
                </div>
              }
            </div>
            <div class="map-box map-box--tall"><app-map [markers]="activeMarkers()" [routes]="activeRoutes()" [fitKey]="r.id + r.statut" /></div>
          </div>
        }

        <!-- MISSION EN COURS : LIVRAISON -->
        @if (activeDelivery(); as d) {
          <div class="cols-2 cols-2--form">
            <div class="card stack stack--lg" style="border-color:var(--color-teal)">
              <div class="row row--between">
                <span class="tag tag--go"><i class="bi bi-box-seam-fill"></i> Livraison en cours</span>
                <span class="tag tag--off">{{ livraisonType(d.type) }}</span>
              </div>
              <dl class="kv">
                <dt>Collecte</dt><dd>{{ d.collecte_label }}</dd>
                <dt>Livraison</dt><dd>{{ d.livraison_label }}</dd>
                @if (d.description) { <dt>Contenu</dt><dd>{{ d.description }}</dd> }
                <dt>Client</dt><dd>{{ client()?.prenom }} {{ client()?.nom }}</dd>
              </dl>
              @if (client()?.telephone; as tel) { <a class="btn btn--outline btn--sm" [href]="'tel:' + tel"><i class="bi bi-telephone"></i> Appeler {{ tel }}</a> }
              <div class="card card--flat stack" style="--gap:.4rem">
                @if (d.merchant_id) {
                  <div class="row row--between"><span class="small">Produits (payés en ligne au commerçant)</span><strong>{{ fcfa(d.montant_produits) }}</strong></div>
                }
                <div class="row row--between"><span class="small">Votre livraison</span><strong>{{ fcfa(d.montant_livraison) }}</strong></div>
              </div>
              <div class="field">
                <label for="moyen2">Le client paie par</label>
                <select id="moyen2" (change)="moyen.set($any($event.target).value)">
                  @for (m of (d.merchant_id ? moyensEnLigne : moyens); track m.id) { <option [value]="m.id" [selected]="moyen() === m.id">{{ m.nom }}</option> }
                </select>
                @if (d.merchant_id) { <span class="field-hint">Une commande marchande se règle obligatoirement en ligne.</span> }
                @else if (moyen() === 'especes') { <span class="field-hint">Espèces : commission de {{ fcfa(commission(d.montant_livraison ?? 0)) }} (5 %) à régler à Yobbalema.</span> }
              </div>
              <button class="btn btn--gold" (click)="finishDelivery(d)" [disabled]="!!busy()"><i class="bi bi-check2-circle"></i> Livraison effectuée</button>
            </div>
            <div class="map-box map-box--tall"><app-map [markers]="activeMarkers()" [routes]="activeRoutes()" [fitKey]="d.id" /></div>
          </div>
        }

        <!-- FLUX DE DEMANDES -->
        @if (!activeRide() && !activeDelivery()) {
          <div class="cols-2 cols-2--form">
            <div class="stack stack--lg">
              @if (!online()) {
                <div class="card empty"><i class="bi bi-moon-stars"></i><p><strong>Vous êtes hors ligne.</strong><br>Passez en ligne pour recevoir les demandes autour de votre position.</p></div>
              } @else {
                <div class="row row--between">
                  <span class="row" style="gap:.5rem"><span class="pulse-dot"></span><strong>À l'écoute des demandes…</strong></span>
                  <span class="xs muted">{{ rides().length + deliveries().length }} demande(s)</span>
                </div>

                @if (rides().length === 0 && deliveries().length === 0) {
                  <div class="card empty"><i class="bi bi-hourglass-split"></i>
                    <p>Aucune demande dans votre zone pour le moment.<br><span class="xs">Les demandes s'élargissent progressivement : les plus proches sont vues en premier.</span></p></div>
                }

                @for (r of rides(); track r.id) {
                  <article class="card stack" style="--gap:.7rem">
                    <div class="row row--between">
                      <span class="tag tag--go"><i class="bi bi-car-front"></i> Course · {{ cat(r.categorie) }}</span>
                      <span class="xs muted">expire dans {{ mmss(left(r.expire_at)) }}</span>
                    </div>
                    <div><strong>{{ r.depart_label }}</strong> <i class="bi bi-arrow-right muted"></i> <strong>{{ r.arrivee_label }}</strong></div>
                    <div class="small muted row" style="gap:.5rem">Client à {{ dist(r.distance_client_m) }} · trajet de {{ r.distance_km.toString().replace('.', ',') }} km · {{ r.client_prenom }}
                      @if (r.client_note) { <app-stars [value]="r.client_note" [readonly]="true" /> } @else { <span class="tag tag--off">nouveau client</span> }</div>
                    <div class="row row--between">
                      <div>
                        <div class="price">{{ fcfa(r.prix_propose) }}</div>
                        @if (r.montant_offert) {
                          <span class="tag" [class]="r.montant_offert < r.tarif_base ? 'tag tag--wait' : 'tag tag--ok'" style="margin-top:.3rem">
                            Offre waxalé {{ ecart(r) }}
                          </span>
                        }
                        <div class="xs muted mt-1" style="margin-top:.4rem">Votre tarif habituel pour ce trajet : {{ fcfa(r.votre_tarif) }}</div>
                      </div>
                      <button class="btn btn--gold" (click)="acceptRide(r)" [disabled]="!!busy()">
                        @if (busy() === r.id) { … } @else { Accepter }
                      </button>
                    </div>
                  </article>
                }

                @for (d of deliveries(); track d.id) {
                  <article class="card stack" style="--gap:.7rem">
                    <div class="row row--between">
                      <span class="tag tag--go"><i class="bi bi-box-seam"></i> Livraison · {{ livraisonType(d.type) }}</span>
                      @if (d.vehicule_souhaite) { <span class="tag tag--off">{{ d.vehicule_souhaite }}</span> }
                    </div>
                    <div class="small"><i class="bi bi-shop"></i> <strong>{{ d.commerce || d.collecte_label }}</strong> <i class="bi bi-arrow-right muted"></i> {{ d.livraison_label }}</div>
                    <div class="small muted">Collecte à {{ dist(d.distance_collecte_m) }} de vous</div>
                    <div class="row row--between">
                      <div class="price">{{ fcfa(d.montant_livraison) }} <small>pour la livraison</small></div>
                      <button class="btn btn--gold" (click)="acceptDelivery(d)" [disabled]="!!busy()">
                        @if (busy() === d.id) { … } @else { Accepter }
                      </button>
                    </div>
                  </article>
                }
              }
            </div>

            <div class="stack">
              <div class="map-box map-box--tall">
                <app-map [center]="mapCenter()" [markers]="feedMarkers()" [clickable]="true" [fitKey]="fitKey()"
                         (mapClick)="setPosition($event.lat, $event.lng, 'manuel')" (markerMoved)="setPosition($event.lat, $event.lng, 'manuel')" />
              </div>
              <div class="card card--flat stack" style="--gap:.6rem">
                <div class="row row--between">
                  <span class="small"><i class="bi bi-crosshair"></i> Votre position : <strong>{{ posLabel() }}</strong></span>
                  <button class="btn btn--outline btn--sm" (click)="useGps()"><i class="bi bi-geo"></i> Utiliser mon GPS</button>
                </div>
                <span class="xs muted">Pour tester sans bouger : cliquez sur la carte ou faites glisser votre marqueur pour simuler votre position.</span>
              </div>
            </div>
          </div>
        }
      </div>
    }
  </div>
</section>
  `,
})
export class MissionsComponent implements OnInit, OnDestroy {
  readonly fcfa = fcfa;
  readonly mmss = mmss;
  readonly moyens: { id: MoyenPaiement; nom: string }[] = [
    { id: 'especes', nom: 'Espèces' }, { id: 'wave', nom: 'Wave' }, { id: 'orange_money', nom: 'Orange Money' },
  ];
  readonly moyensEnLigne = this.moyens.filter((m) => m.id !== 'especes');

  readonly loading = signal(true);
  readonly error = signal('');
  readonly status = signal<DriverStatus | null>(null);
  readonly vehicles = signal<Vehicle[]>([]);
  readonly online = signal(false);
  readonly pos = signal<{ lat: number; lng: number }>({ lat: DAKAR[0], lng: DAKAR[1] });
  readonly posSource = signal<'defaut' | 'gps' | 'manuel'>('defaut');
  readonly rides = signal<NearbyRide[]>([]);
  readonly deliveries = signal<NearbyDelivery[]>([]);
  readonly activeRide = signal<RideRequest | null>(null);
  readonly activeDelivery = signal<DeliveryOrder | null>(null);
  readonly client = signal<RelatedProfile | null>(null);
  readonly moyen = signal<MoyenPaiement>('especes');
  readonly busy = signal<string | null>(null);
  readonly now = signal(Date.now());
  readonly fitKey = signal(0);
  readonly activeRoute = signal<[number, number][]>([]);

  readonly estChauffeur = computed(() => this.sb.currentProfile()?.role === 'chauffeur');
  readonly posLabel = computed(() => {
    const s = this.posSource();
    return s === 'gps' ? 'GPS' : s === 'manuel' ? 'simulée sur la carte' : 'Dakar (par défaut)';
  });
  readonly mapCenter = computed<[number, number]>(() => [this.pos().lat, this.pos().lng]);

  readonly feedMarkers = computed<MapMarker[]>(() => {
    const m: MapMarker[] = [{ id: 'me', lat: this.pos().lat, lng: this.pos().lng, icon: 'bi-car-front-fill', color: '#0F766E', label: 'Vous', draggable: true, shape: 'round' }];
    for (const r of this.rides()) m.push({ id: 'r' + r.id, lat: r.depart_lat, lng: r.depart_lng, icon: 'bi-person-fill', color: '#F0A93C', label: fcfa(r.prix_propose) });
    for (const d of this.deliveries()) m.push({ id: 'd' + d.id, lat: d.collecte_lat, lng: d.collecte_lng, icon: 'bi-box-seam-fill', color: '#C1442E', label: fcfa(d.montant_livraison) });
    return m;
  });

  readonly activeMarkers = computed<MapMarker[]>(() => {
    const r = this.activeRide(); const d = this.activeDelivery();
    if (r) return [
      { id: 'd', lat: r.depart_lat, lng: r.depart_lng, icon: 'bi-geo-alt-fill', color: '#0F766E', label: 'Départ' },
      { id: 'a', lat: r.arrivee_lat, lng: r.arrivee_lng, icon: 'bi-flag-fill', color: '#C1442E', label: 'Arrivée' },
    ];
    if (d) return [
      { id: 'c', lat: d.collecte_lat, lng: d.collecte_lng, icon: 'bi-shop', color: '#0F766E', label: 'Collecte' },
      { id: 'l', lat: d.livraison_lat, lng: d.livraison_lng, icon: 'bi-house-fill', color: '#C1442E', label: 'Livraison' },
    ];
    return [];
  });
  readonly activeRoutes = computed<MapRoute[]>(() => (this.activeRoute().length ? [{ points: this.activeRoute() }] : []));

  private timers: ReturnType<typeof setInterval>[] = [];
  private clientFor?: string;
  private routeFor?: string;
  private ticking = false;
  private seen = new Set<string>();
  private audio?: AudioContext;
  private locationSent = false;

  constructor(
    private rideSvc: RidesService, private deliverySvc: DeliveryService, private driverSvc: DriverService,
    private profiles: ProfileService, private geo: GeoService, private sb: SupabaseService, private toast: ToastService,
  ) {}

  async ngOnInit() {
    this.timers.push(setInterval(() => this.now.set(Date.now()), 1000));
    if (!this.estChauffeur()) { this.loading.set(false); return; }
    try {
      const [status, vehicles] = await Promise.all([this.driverSvc.status(), this.driverSvc.vehicles()]);
      this.status.set(status); this.vehicles.set(vehicles);
      await this.tick();
    } catch (e) { this.error.set(messageErreur(e)); }
    finally { this.loading.set(false); }
    this.timers.push(setInterval(() => this.tick(), 4000));
  }

  ngOnDestroy() {
    this.timers.forEach(clearInterval);
    if (this.locationSent && !this.activeRide() && !this.activeDelivery()) this.driverSvc.clearLocation().catch(() => undefined);
  }

  cat(c: string) { return LIBELLES_CATEGORIE[c] ?? c; }
  livraisonType(t: string) { return LIBELLES_LIVRAISON[t] ?? t; }
  dist(m: number) { return distanceLisible(m); }
  left(iso: string) { return secondesRestantes(iso, this.now()); }
  commission(montant: number) { return Math.round(montant * 0.05); }
  ecart(r: NearbyRide) {
    if (!r.montant_offert) return '';
    const pct = Math.round((1 - r.montant_offert / r.tarif_base) * 100);
    return pct > 0 ? `(−${pct} % vs tarif de base)` : pct < 0 ? `(+${-pct} % vs tarif de base)` : '(= tarif de base)';
  }

  /** Petit bip pour signaler une nouvelle demande (autorisé car déclenché après un clic « En ligne »). */
  private beep() {
    try {
      this.audio ??= new AudioContext();
      const o = this.audio.createOscillator(); const g = this.audio.createGain();
      o.connect(g); g.connect(this.audio.destination);
      o.frequency.value = 880; g.gain.value = 0.08;
      o.start(); o.stop(this.audio.currentTime + 0.18);
    } catch { /* son indisponible : sans importance */ }
  }

  async setOnline(on: boolean) {
    this.online.set(on);
    if (on) {
      this.audio ??= (typeof AudioContext !== 'undefined' ? new AudioContext() : undefined);
      if (this.posSource() === 'defaut') await this.useGps(true);
      await this.tick();
    } else {
      this.rides.set([]); this.deliveries.set([]); this.seen.clear();
      if (!this.activeRide() && !this.activeDelivery()) { this.locationSent = false; this.driverSvc.clearLocation().catch(() => undefined); }
    }
  }

  async useGps(silent = false) {
    try {
      const p = await this.geo.currentPosition();
      this.setPosition(p.lat, p.lng, 'gps');
    } catch (e) { if (!silent) this.toast.error((e as Error).message); }
  }

  setPosition(lat: number, lng: number, src: 'gps' | 'manuel') {
    this.pos.set({ lat, lng }); this.posSource.set(src); this.fitKey.update((k) => k + 1);
    if (this.online()) this.tick();
  }

  private async tick() {
    if (this.ticking) return;
    this.ticking = true;
    try {
      const [ar, ad] = await Promise.all([this.rideSvc.activeAsDriver(), this.deliverySvc.activeAsDriver()]);
      this.activeRide.set(ar); this.activeDelivery.set(ad);

      const other = ar?.client_id ?? ad?.client_id;
      if (other && this.clientFor !== other) { this.clientFor = other; this.client.set(await this.profiles.related(other)); }
      if (!other) { this.clientFor = undefined; this.client.set(null); }

      const key = ar ? ar.id : ad ? ad.id : undefined;
      if (key && this.routeFor !== key) {
        this.routeFor = key;
        const a = ar ? { lat: ar.depart_lat, lng: ar.depart_lng } : { lat: ad!.collecte_lat, lng: ad!.collecte_lng };
        const b = ar ? { lat: ar.arrivee_lat, lng: ar.arrivee_lng } : { lat: ad!.livraison_lat, lng: ad!.livraison_lng };
        this.geo.route(a, b).then((r) => this.activeRoute.set(r.geometry));
      }
      if (!key) { this.routeFor = undefined; this.activeRoute.set([]); }

      // Position en direct : partagée tant que le chauffeur est en ligne ou en mission (visible de son seul client pendant la mission).
      if (this.online() || ar || ad) {
        const p = this.pos();
        this.driverSvc.pushLocation(p.lat, p.lng, null).then(() => (this.locationSent = true)).catch(() => undefined);
      } else if (this.locationSent) {
        this.locationSent = false;
        this.driverSvc.clearLocation().catch(() => undefined);
      }

      if (this.online() && !ar && !ad) {
        const p = this.pos();
        const [r, d] = await Promise.all([this.rideSvc.nearby(p.lat, p.lng), this.deliverySvc.nearby(p.lat, p.lng)]);
        const newOnes = [...(r ?? []).map((x) => x.id), ...(d ?? []).map((x) => x.id)].filter((id) => !this.seen.has(id));
        if (newOnes.length) this.beep();
        [...(r ?? []).map((x) => x.id), ...(d ?? []).map((x) => x.id)].forEach((id) => this.seen.add(id));
        this.rides.set(r ?? []); this.deliveries.set(d ?? []);
      } else { this.rides.set([]); this.deliveries.set([]); }
      this.error.set('');
    } catch (e) {
      this.error.set(messageErreur(e));
    } finally { this.ticking = false; }
  }

  private async act<T>(id: string, fn: () => Promise<T>, okMsg?: string): Promise<T | undefined> {
    this.busy.set(id);
    try {
      const res = await fn();
      if (okMsg) this.toast.ok(okMsg);
      return res;
    } catch (e) { this.toast.error(messageErreur(e)); return undefined; }
    finally { this.busy.set(null); await this.tick(); this.status.set(await this.driverSvc.status().catch(() => this.status())); }
  }

  acceptRide(r: NearbyRide) { return this.act(r.id, () => this.rideSvc.accept(r.id), 'Course acceptée. Le client est prévenu.'); }
  acceptDelivery(d: NearbyDelivery) { return this.act(d.id, () => this.deliverySvc.accept(d.id), 'Livraison acceptée.'); }
  startRide(r: RideRequest) { return this.act(r.id, () => this.rideSvc.start(r.id), 'Course démarrée.'); }
  desist(r: RideRequest) { return this.act(r.id, () => this.rideSvc.desist(r.id), 'Vous vous êtes désisté : la course est remise à disposition.'); }

  async finishRide(r: RideRequest) {
    const pay = await this.act(r.id, () => this.rideSvc.finish(r.id, this.moyen()));
    if (pay) this.afterPayment(pay.moyen, pay.montant, pay.commission_pct, pay.statut_transaction);
  }

  async finishDelivery(d: DeliveryOrder) {
    const moyen = d.merchant_id && this.moyen() === 'especes' ? 'wave' : this.moyen();
    const pays = await this.act(d.id, () => this.deliverySvc.finish(d.id, moyen));
    const livraison = pays?.find((p) => p.categorie_montant === 'livraison');
    if (livraison) this.afterPayment(livraison.moyen, livraison.montant, livraison.commission_pct, livraison.statut_transaction);
  }

  private afterPayment(moyen: MoyenPaiement, montant: number, pct: number, statut = 'confirme') {
    const commission = Math.round((montant * pct) / 100);
    if (statut === 'en_attente') this.toast.info(`Mission terminée. En attente du paiement ${LIBELLES_MOYEN[moyen]} du client : vous serez notifié dès qu'il est confirmé.`);
    else if (moyen === 'especes') this.toast.info(`Terminé. Commission de ${fcfa(commission)} à régler à Yobbalema avant votre prochaine mission.`);
    else this.toast.ok(`Terminé. Paiement ${LIBELLES_MOYEN[moyen]} enregistré (commission ${fcfa(commission)} déduite).`);
    this.moyen.set('especes');
  }

  async settleAll(s: DriverStatus) {
    this.busy.set('debt');
    try {
      for (const d of s.dettes) await this.driverSvc.settleDebt(d.id);
      this.toast.ok('Dette réglée (simulation). Votre compte est débloqué.');
    } catch (e) { this.toast.error(messageErreur(e)); }
    finally { this.busy.set(null); this.status.set(await this.driverSvc.status()); }
  }
}
