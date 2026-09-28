import { NgTemplateOutlet } from '@angular/common';
import { Component, OnDestroy, OnInit, computed, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { CategorieVehicule, DriverLocation, Payment, PricingConfig, RideRequest, Vehicle } from '../../core/models/models';
import { DriverService } from '../../core/services/driver.service';
import { GeoService, Place, RouteInfo } from '../../core/services/geo.service';
import { ProfileService, RelatedProfile } from '../../core/services/profile.service';
import { RideSettings, RidesService } from '../../core/services/rides.service';
import { SupabaseService } from '../../core/services/supabase.service';
import { ToastService } from '../../core/services/toast.service';
import { LIBELLES_CATEGORIE, LIBELLES_MOYEN, fcfa, messageErreur, mmss, secondesRestantes } from '../../core/util/format';
import { MapComponent, MapMarker, MapRoute } from '../../shared/map/map.component';
import { PlaceFieldComponent } from '../../shared/place-field/place-field.component';
import { PayButtonsComponent } from '../../shared/pay-buttons/pay-buttons.component';
import { StarsComponent } from '../../shared/stars/stars.component';

const CATEGORIES: { id: CategorieVehicule; nom: string; desc: string }[] = [
  { id: 'standard', nom: 'Standard', desc: 'Berline classique, le meilleur prix' },
  { id: 'confort', nom: 'Confort', desc: 'Véhicule récent, climatisé' },
  { id: 'pro', nom: 'Pro', desc: 'Haut de gamme, chauffeur expérimenté' },
];

@Component({
  selector: 'app-courses',
  standalone: true,
  imports: [FormsModule, NgTemplateOutlet, MapComponent, PlaceFieldComponent, StarsComponent, PayButtonsComponent],
  template: `
<section class="page">
  <div class="container">
    <header class="page-head">
      <div>
        <h1>Course à la demande</h1>
        <p>Commandez une course en ville, ou proposez votre prix avec le waxalé.</p>
      </div>
    </header>

    @if (loading()) {
      <div class="empty"><span class="pulse-dot"></span></div>
    } @else if (view() === 'form') {
      <div class="cols-2 cols-2--form">
        <form class="card stack stack--lg" (ngSubmit)="submit()" #f="ngForm">
          <div class="stack">
            <app-place-field label="Départ" icon="bi-geo-alt-fill" [place]="depart()" (placeChange)="setDepart($event)" />
            <app-place-field label="Arrivée" icon="bi-flag-fill" [place]="arrivee()" (placeChange)="setArrivee($event)" [gps]="false" />
            <div class="row">
              <button type="button" class="btn btn--outline btn--sm" [class.btn--ink]="pick() === 'depart'" (click)="togglePick('depart')">
                <i class="bi bi-cursor"></i> Placer le départ sur la carte
              </button>
              <button type="button" class="btn btn--outline btn--sm" [class.btn--ink]="pick() === 'arrivee'" (click)="togglePick('arrivee')">
                <i class="bi bi-cursor"></i> Placer l'arrivée
              </button>
            </div>
          </div>

          @if (route(); as r) {
            <div class="alert alert--info">
              <i class="bi bi-signpost-2"></i>
              <p>Distance : <strong>{{ r.distanceKm.toString().replace('.', ',') }} km</strong> · environ {{ r.durationMin }} min
                @if (!r.fiable) { <br><span class="xs">Itinéraire estimé (service de calcul indisponible) ; le prix final est confirmé par le serveur.</span> }</p>
            </div>
          }

          <fieldset class="stack" style="border:none;padding:0;margin:0">
            <legend class="strong small" style="margin-bottom:.5rem">Catégorie</legend>
            <div class="choice-grid">
              @for (c of categories; track c.id) {
                <div class="choice">
                  <input type="radio" name="cat" [id]="'cat-' + c.id" [checked]="categorie() === c.id" (change)="categorie.set(c.id)">
                  <label [attr.for]="'cat-' + c.id">
                    <span class="choice__title">{{ c.nom }}</span>
                    <span class="choice__sub">{{ c.desc }}</span>
                    <span class="choice__price">{{ estimate(c.id) !== null ? fcfa(estimate(c.id)) : (tarifKm(c.id) + ' F/km') }}</span>
                  </label>
                </div>
              }
            </div>
          </fieldset>

          <div class="stack">
            <label class="switch">
              <input type="checkbox" [checked]="useOffer()" (change)="toggleOffer($any($event.target).checked)">
              <span class="switch__track"></span>
              <span>Proposer mon prix — <em>waxalé</em></span>
            </label>
            @if (useOffer()) {
              <div class="field">
                <label for="offre">Votre offre (FCFA)</label>
                <input id="offre" type="number" name="offre" step="25" [min]="minOffer()" [ngModel]="offer()" (ngModelChange)="offer.set($event)" placeholder="Ex. 1 000">
                <span class="field-hint">
                  Les chauffeurs proches voient votre offre : le premier qui l'accepte prend la course.
                  @if (minOffer() > 0) { Minimum : {{ fcfa(minOffer()) }}. }
                </span>
              </div>
            }
          </div>

          <div class="row row--between">
            <div>
              <span class="xs muted">Vous paierez</span>
              <div class="price price--lg">{{ prixFinal() !== null ? fcfa(prixFinal()) : '—' }}</div>
            </div>
            <button class="btn btn--gold" type="submit" [disabled]="sending() || !route()">
              @if (sending()) { Envoi… } @else { <i class="bi bi-send"></i> Demander une course }
            </button>
          </div>
          <p class="xs muted mb-0">Paiement à bord : espèces, Wave ou Orange Money.</p>
        </form>

        <div class="stack">
          <div class="map-box map-box--tall">
            <app-map [markers]="formMarkers()" [routes]="formRoutes()" [clickable]="!!pick()" [fitKey]="fitKey()" (mapClick)="onMapClick($event)" />
          </div>
          @if (pick()) { <div class="alert alert--warn"><i class="bi bi-cursor"></i><p>Cliquez sur la carte pour placer {{ pick() === 'depart' ? 'le départ' : "l'arrivée" }}.</p></div> }
        </div>
      </div>
    } @else {
     @if (ride(); as r) {
      <div class="cols-2 cols-2--form">
        <div class="stack stack--lg">

          @switch (r.statut) {
            @case ('en_attente') {
              <div class="card card--ink stack">
                <div class="row"><span class="pulse-dot"></span><strong style="font-size:1.15rem">Recherche d'un chauffeur…</strong></div>
                <p class="mb-0" style="color:var(--color-text-on-ink-soft)">
                  Votre demande est envoyée aux chauffeurs {{ libelleCat(r.categorie) }} autour de vous
                  (rayon actuel : <strong>{{ rayonCourant().toString().replace('.', ',') }} km</strong>, élargi toutes les {{ (settings()?.delaiRelanceS ?? 120) / 60 }} min).
                </p>
                <div class="row row--between">
                  <div><span class="xs">{{ r.montant_offert ? 'Votre offre waxalé' : 'Prix' }}</span><div class="price" style="color:var(--color-gold)">{{ fcfa(r.montant_offert ?? r.tarif_base) }}</div></div>
                  <div style="text-align:right"><span class="xs">Expire dans</span><div class="price" style="color:var(--color-text-on-ink)">{{ mmss(secondsLeft()) }}</div></div>
                </div>
              </div>
              <button class="btn btn--danger" (click)="cancel(r)" [disabled]="sending()">Annuler la demande</button>
            }
            @case ('assignee') {
              <div class="card stack" style="border-color:var(--color-teal)">
                <span class="tag tag--ok"><i class="bi bi-check-circle-fill"></i> Chauffeur trouvé</span>
                <h2 class="mb-0" style="font-size:var(--text-xl)">{{ driver()?.prenom }} arrive</h2>
                @if (driverEta(); as e) {
                  <div class="alert alert--info"><i class="bi bi-geo-alt"></i><p>{{ e.perime ? 'Position du chauffeur non actualisée.' : 'Votre chauffeur est à environ ' + e.km.toFixed(1).replace('.', ',') + ' km (≈ ' + e.min + ' min)' + ' de ' + e.cible + '.' }}</p></div>
                } @else { <p class="small muted mb-0">Position du chauffeur bientôt disponible sur la carte.</p> }
                <ng-container *ngTemplateOutlet="driverInfo"></ng-container>
              </div>
              <button class="btn btn--danger" (click)="cancel(r)" [disabled]="sending()">Annuler la course</button>
            }
            @case ('en_cours') {
              <div class="card card--ink stack">
                <div class="row"><span class="pulse-dot"></span><strong style="font-size:1.15rem">Course en cours</strong></div>
                <p class="mb-0" style="color:var(--color-text-on-ink-soft)">Direction : {{ r.arrivee_label }}
                  @if (driverEta(); as e) { @if (!e.perime) { — environ {{ e.min }} min restantes } }</p>
              </div>
              <div class="card stack"><ng-container *ngTemplateOutlet="driverInfo"></ng-container></div>
            }
            @case ('terminee') {
              <div class="card stack" style="border-color:var(--color-teal)">
                <span class="tag tag--ok"><i class="bi bi-flag-fill"></i> Course terminée</span>
                <div class="price price--lg">{{ fcfa(payment()?.montant ?? r.montant_offert ?? r.tarif_base) }}</div>
                @if (payment(); as p) {
                  @if (p.statut_transaction === 'confirme') { <p class="small muted mb-0">Payé via {{ moyen(p.moyen) }}.</p> }
                  @else { <p class="small mb-0" style="color:var(--color-gold-deep)"><i class="bi bi-hourglass-split"></i> Paiement {{ moyen(p.moyen) }} en attente.</p> }
                }
                <app-pay-buttons source="ride" [sourceId]="r.id" />
                @if (!reviewed()) {
                  <hr style="border:none;border-top:1px solid var(--color-paper-line);width:100%">
                  <strong class="small">Comment s'est passée la course avec {{ driver()?.prenom }} ?</strong>
                  <app-stars [value]="note()" (valueChange)="note.set($event)" />
                  <div class="field"><textarea [ngModel]="comment()" (ngModelChange)="comment.set($event)" placeholder="Un commentaire (facultatif)"></textarea></div>
                  <button class="btn btn--ink" (click)="sendReview(r)" [disabled]="sending()">Envoyer mon avis</button>
                } @else {
                  <p class="small muted mb-0"><i class="bi bi-heart-fill" style="color:var(--color-rust)"></i> Merci pour votre avis !</p>
                }
              </div>
              <button class="btn btn--gold" (click)="dismiss(r)"><i class="bi bi-plus-lg"></i> Nouvelle course</button>
            }
            @case ('expiree') {
              <div class="card stack">
                <span class="tag tag--off">Aucun chauffeur disponible</span>
                <p class="mb-0">Personne n'a pu prendre votre course à temps. Vous pouvez relancer la demande, avec un prix plus attractif si vous utilisez le waxalé.</p>
              </div>
              <button class="btn btn--gold" (click)="dismiss(r)"><i class="bi bi-arrow-repeat"></i> Nouvelle demande</button>
            }
          }

          <div class="card card--flat">
            <dl class="kv">
              <dt>Départ</dt><dd>{{ r.depart_label }}</dd>
              <dt>Arrivée</dt><dd>{{ r.arrivee_label }}</dd>
              <dt>Distance</dt><dd>{{ r.distance_km.toString().replace('.', ',') }} km · {{ libelleCat(r.categorie) }}</dd>
              @if (r.montant_offert) { <dt>Tarif de base</dt><dd>{{ fcfa(r.tarif_base) }}</dd> }
            </dl>
          </div>
        </div>

        <div class="map-box map-box--tall">
          <app-map [markers]="rideMarkers()" [routes]="rideRoutes()" [fitKey]="r.id + r.statut + (driverPos() ? 'd' : '')" />
        </div>
      </div>

      <ng-template #driverInfo>
        @if (driver(); as d) {
          <dl class="kv">
            <dt>Chauffeur</dt><dd>{{ d.prenom }} {{ d.nom }}</dd>
            @if (d.note_moyenne) { <dt>Note</dt><dd><app-stars [value]="d.note_moyenne" [readonly]="true" /></dd> }
            @if (vehicle(); as v) { <dt>Véhicule</dt><dd>{{ v.marque }} {{ v.modele }} · {{ v.immatriculation }}</dd> }
          </dl>
          @if (d.telephone) { <a class="btn btn--outline btn--sm" [href]="'tel:' + d.telephone"><i class="bi bi-telephone"></i> Appeler {{ d.telephone }}</a> }
        } @else { <p class="muted small mb-0">Chargement des informations du chauffeur…</p> }
      </ng-template>
     }
    }
  </div>
</section>
  `,
})
export class CoursesComponent implements OnInit, OnDestroy {
  readonly categories = CATEGORIES;
  readonly fcfa = fcfa;
  readonly mmss = mmss;

  readonly loading = signal(true);
  readonly sending = signal(false);
  readonly pricing = signal<PricingConfig[]>([]);
  readonly settings = signal<RideSettings | null>(null);

  readonly depart = signal<Place | null>(null);
  readonly arrivee = signal<Place | null>(null);
  readonly route = signal<RouteInfo | null>(null);
  readonly categorie = signal<CategorieVehicule>('standard');
  readonly useOffer = signal(false);
  readonly offer = signal<number | null>(null);
  readonly pick = signal<'depart' | 'arrivee' | null>(null);
  readonly fitKey = signal(0);

  readonly ride = signal<RideRequest | null>(null);
  readonly dismissedId = signal<string | null>(null);
  readonly driver = signal<RelatedProfile | null>(null);
  readonly vehicle = signal<Vehicle | null>(null);
  readonly payment = signal<Payment | null>(null);
  readonly reviewed = signal(true);
  readonly note = signal(5);
  readonly comment = signal('');
  readonly rideRoute = signal<[number, number][]>([]);
  readonly driverPos = signal<DriverLocation | null>(null);
  readonly now = signal(Date.now());

  readonly view = computed<'form' | 'ride'>(() => {
    const r = this.ride();
    if (!r || this.dismissedId() === r.id) return 'form';
    if (r.statut === 'annulee') return 'form';
    return 'ride';
  });

  readonly secondsLeft = computed(() => {
    const r = this.ride();
    return r ? secondesRestantes(r.expire_at, this.now()) : 0;
  });

  readonly rayonCourant = computed(() => {
    const r = this.ride(); const s = this.settings();
    if (!r || !s) return 0.5;
    const elapsed = Math.max(0, (this.now() - new Date(r.created_at).getTime()) / 1000);
    return s.rayonInitialKm + Math.floor(elapsed / s.delaiRelanceS) * s.rayonIncrementKm;
  });

  readonly minOffer = computed(() => {
    const t = this.estimate(this.categorie()); const s = this.settings();
    return t !== null && s ? Math.round((t * s.offreMinPct) / 100 / 25) * 25 : 0;
  });

  readonly prixFinal = computed(() => {
    const t = this.estimate(this.categorie());
    if (t === null) return null;
    const o = this.offer();
    return this.useOffer() && o && o > 0 ? o : t;
  });

  readonly formMarkers = computed<MapMarker[]>(() => {
    const m: MapMarker[] = [];
    const d = this.depart(); const a = this.arrivee();
    if (d) m.push({ id: 'd', lat: d.lat, lng: d.lng, icon: 'bi-geo-alt-fill', color: '#0F766E', label: 'Départ' });
    if (a) m.push({ id: 'a', lat: a.lat, lng: a.lng, icon: 'bi-flag-fill', color: '#C1442E', label: 'Arrivée' });
    return m;
  });
  readonly formRoutes = computed<MapRoute[]>(() => (this.route() ? [{ points: this.route()!.geometry }] : []));

  readonly rideMarkers = computed<MapMarker[]>(() => {
    const r = this.ride(); if (!r) return [];
    const m: MapMarker[] = [
      { id: 'd', lat: r.depart_lat, lng: r.depart_lng, icon: 'bi-geo-alt-fill', color: '#0F766E', label: 'Départ' },
      { id: 'a', lat: r.arrivee_lat, lng: r.arrivee_lng, icon: 'bi-flag-fill', color: '#C1442E', label: 'Arrivée' },
    ];
    const d = this.driverPos();
    if (d) m.push({ id: 'chauffeur', lat: d.lat, lng: d.lng, icon: 'bi-car-front-fill', color: '#F0A93C', shape: 'round', label: 'Votre chauffeur' });
    return m;
  });

  /** Estimation grossière (ligne droite × 1,3 à 25 km/h) de l'arrivée du chauffeur, tant que sa position est récente. */
  readonly driverEta = computed(() => {
    const r = this.ride(); const d = this.driverPos();
    if (!r || !d || (r.statut !== 'assignee' && r.statut !== 'en_cours')) return null;
    const cible = r.statut === 'assignee' ? { lat: r.depart_lat, lng: r.depart_lng } : { lat: r.arrivee_lat, lng: r.arrivee_lng };
    const km = this.geo.haversineKm(d, cible) * 1.3;
    const age = (this.now() - new Date(d.updated_at).getTime()) / 1000;
    return { km, min: Math.max(1, Math.round((km / 25) * 60)), perime: age > 60, cible: r.statut === 'assignee' ? 'vous' : 'l’arrivée' };
  });
  readonly rideRoutes = computed<MapRoute[]>(() => (this.rideRoute().length ? [{ points: this.rideRoute() }] : []));

  private timers: ReturnType<typeof setInterval>[] = [];
  private unwatch?: () => void;
  private routeFor?: string;

  constructor(
    private rides: RidesService, private geo: GeoService, private sb: SupabaseService,
    private profiles: ProfileService, private toast: ToastService, private driverSvc: DriverService,
  ) {}

  async ngOnInit() {
    try {
      const [pricing, settings] = await Promise.all([this.rides.pricing(), this.rides.settings()]);
      this.pricing.set(pricing); this.settings.set(settings);
      await this.refresh();
    } catch (e) {
      this.toast.error(messageErreur(e));
    } finally {
      this.loading.set(false);
    }
    this.timers.push(setInterval(() => this.now.set(Date.now()), 1000));
    this.timers.push(setInterval(() => { if (this.isLive()) this.refresh(); }, 4000));
    this.unwatch = this.sb.watch('ride_requests', `client_id=eq.${this.sb.uid}`, () => this.refresh());
  }

  ngOnDestroy() {
    this.timers.forEach(clearInterval);
    this.unwatch?.();
  }

  private isLive() {
    const r = this.ride();
    const pay = this.payment();
    return !!r && (['en_attente', 'assignee', 'en_cours'].includes(r.statut) || (r.statut === 'terminee' && !!pay && pay.statut_transaction === 'en_attente'));
  }

  async refresh() {
    try {
      const r = await this.rides.latestAsClient();
      const prev = this.ride();
      this.ride.set(r);
      if (!r) return;
      if (prev && prev.statut !== r.statut) {
        if (r.statut === 'assignee') this.toast.ok('Un chauffeur a accepté votre course !');
        if (r.statut === 'en_cours') this.toast.info('Votre course a démarré.');
        if (r.statut === 'terminee') this.toast.ok('Course terminée.');
      }
      if (this.routeFor !== r.id) {
        this.routeFor = r.id;
        this.geo.route({ lat: r.depart_lat, lng: r.depart_lng }, { lat: r.arrivee_lat, lng: r.arrivee_lng })
          .then((ri) => this.rideRoute.set(ri.geometry));
      }
      if (r.driver_id && (r.statut === 'assignee' || r.statut === 'en_cours')) {
        this.driverPos.set(await this.driverSvc.locationOf(r.driver_id));
      } else { this.driverPos.set(null); }
      if (r.driver_id && !this.driver()) {
        this.driver.set(await this.profiles.related(r.driver_id));
        const { data } = await this.sb.client.from('vehicles').select('*').eq('user_id', r.driver_id).eq('categorie', r.categorie).limit(1);
        this.vehicle.set((data?.[0] as Vehicle) ?? null);
      }
      if (r.statut === 'terminee') {
        if (!this.payment() || this.payment()!.statut_transaction !== 'confirme') this.payment.set(await this.rides.paymentFor(r.id));
        this.reviewed.set(await this.rides.hasReviewed('ride', r.id));
      }
    } catch (e) {
      // silencieux pendant le polling ; l'erreur réapparaîtra au prochain cycle si persistante
      console.warn('refresh course', e);
    }
  }

  // ----- formulaire -----
  libelleCat(c: string) { return LIBELLES_CATEGORIE[c] ?? c; }
  moyen(m: string) { return LIBELLES_MOYEN[m] ?? m; }

  tarifKm(c: CategorieVehicule): number | string {
    return this.pricing().find((p) => p.categorie === c)?.tarif_km_base ?? '—';
  }

  estimate(c: CategorieVehicule): number | null {
    const r = this.route(); const s = this.settings();
    const base = this.pricing().find((p) => p.categorie === c)?.tarif_km_base;
    if (!r || !s || !base) return null;
    return this.rides.estimate(r.distanceKm, Number(base), s.tarifMinimum);
  }

  toggleOffer(on: boolean) {
    this.useOffer.set(on);
    if (on && !this.offer()) this.offer.set(this.estimate(this.categorie()));
  }

  async setDepart(p: Place | null) { this.depart.set(p); await this.updateRoute(); }
  async setArrivee(p: Place | null) { this.arrivee.set(p); await this.updateRoute(); }
  togglePick(w: 'depart' | 'arrivee') { this.pick.set(this.pick() === w ? null : w); }

  async onMapClick(pos: { lat: number; lng: number }) {
    const which = this.pick(); if (!which) return;
    this.pick.set(null);
    const label = await this.geo.reverse(pos.lat, pos.lng);
    const place = { label, lat: pos.lat, lng: pos.lng };
    if (which === 'depart') await this.setDepart(place); else await this.setArrivee(place);
  }

  private async updateRoute() {
    const d = this.depart(); const a = this.arrivee();
    if (!d || !a) { this.route.set(null); this.fitKey.update((k) => k + 1); return; }
    this.route.set(await this.geo.route(d, a));
    this.fitKey.update((k) => k + 1);
    if (this.useOffer() && !this.offer()) this.offer.set(this.estimate(this.categorie()));
  }

  async submit() {
    const d = this.depart(); const a = this.arrivee(); const r = this.route();
    if (!d || !a || !r) { this.toast.error('Indiquez un départ et une arrivée.'); return; }
    let montant: number | null = null;
    if (this.useOffer()) {
      montant = Number(this.offer());
      if (!montant || montant < this.minOffer()) { this.toast.error(`Votre offre doit être d'au moins ${fcfa(this.minOffer())}.`); return; }
    }
    this.sending.set(true);
    try {
      const created = await this.rides.create({ categorie: this.categorie(), depart: d, arrivee: a, distanceKm: r.distanceKm, montantOffert: montant });
      this.driver.set(null); this.vehicle.set(null); this.payment.set(null); this.dismissedId.set(null); this.routeFor = undefined;
      this.ride.set(created);
      this.toast.ok('Demande envoyée aux chauffeurs proches.');
    } catch (e) {
      this.toast.error(messageErreur(e));
    } finally {
      this.sending.set(false);
    }
  }

  async cancel(r: RideRequest) {
    this.sending.set(true);
    try { await this.rides.cancel(r.id); this.toast.info('Course annulée.'); await this.refresh(); }
    catch (e) { this.toast.error(messageErreur(e)); }
    finally { this.sending.set(false); }
  }

  dismiss(r: RideRequest) {
    this.dismissedId.set(r.id);
    this.driver.set(null); this.vehicle.set(null); this.payment.set(null);
    this.depart.set(null); this.arrivee.set(null); this.route.set(null); this.useOffer.set(false); this.offer.set(null);
  }

  async sendReview(r: RideRequest) {
    this.sending.set(true);
    try {
      await this.rides.rate('ride', r.id, this.note(), this.comment().trim() || null);
      this.reviewed.set(true); this.toast.ok('Merci pour votre avis !');
    } catch (e) { this.toast.error(messageErreur(e)); }
    finally { this.sending.set(false); }
  }
}
