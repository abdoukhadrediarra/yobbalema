import { Component, OnInit, computed, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Router, RouterLink } from '@angular/router';
import { Vehicle } from '../../core/models/models';
import { DriverService } from '../../core/services/driver.service';
import { GeoService, Place, RouteInfo } from '../../core/services/geo.service';
import { SupabaseService } from '../../core/services/supabase.service';
import { ToastService } from '../../core/services/toast.service';
import { TripsService } from '../../core/services/trips.service';
import { LIBELLES_CATEGORIE, fcfa, messageErreur } from '../../core/util/format';
import { MapComponent, MapMarker, MapRoute } from '../../shared/map/map.component';
import { PlaceFieldComponent } from '../../shared/place-field/place-field.component';

@Component({
  selector: 'app-trajet-publier',
  standalone: true,
  imports: [FormsModule, RouterLink, MapComponent, PlaceFieldComponent],
  template: `
<section class="page">
  <div class="container">
    <header class="page-head">
      <div><h1>Publier un trajet</h1><p>Proposez vos places libres sur un trajet entre deux villes.</p></div>
      <a routerLink="/mes-trajets" class="btn btn--outline">Mes trajets</a>
    </header>

    @if (!estChauffeur()) {
      <div class="alert alert--warn"><i class="bi bi-lock"></i><p>Seuls les comptes <strong>chauffeur</strong> peuvent publier un trajet.</p></div>
    } @else if (vehicles().length === 0 && !loading()) {
      <div class="alert alert--warn"><i class="bi bi-car-front"></i><p>Ajoutez d'abord un véhicule dans votre <a routerLink="/chauffeur" class="strong">espace chauffeur</a>.</p></div>
    } @else {
      <div class="cols-2 cols-2--form">
        <form class="card stack stack--lg" (ngSubmit)="publish()">
          <app-place-field label="Ville / lieu de départ" icon="bi-geo-alt-fill" [place]="depart()" (placeChange)="setDepart($event)" />
          <app-place-field label="Ville / lieu d'arrivée" icon="bi-flag-fill" [place]="arrivee()" (placeChange)="setArrivee($event)" [gps]="false" />

          <div class="row">
            <button type="button" class="btn btn--outline btn--sm" [class.btn--ink]="pick() === 'depart'" (click)="togglePick('depart')"><i class="bi bi-cursor"></i> Placer le départ sur la carte</button>
            <button type="button" class="btn btn--outline btn--sm" [class.btn--ink]="pick() === 'arrivee'" (click)="togglePick('arrivee')"><i class="bi bi-cursor"></i> Placer l'arrivée</button>
          </div>
          <span class="field-hint">Lieu introuvable dans la recherche ? Placez-le directement sur la carte.</span>

          @if (route(); as r) {
            <div class="alert alert--info"><i class="bi bi-signpost-2"></i><p>Distance : <strong>{{ r.distanceKm.toString().replace('.', ',') }} km</strong> · environ {{ duree(r.durationMin) }}</p></div>
          }

          <div class="field">
            <label for="veh">Véhicule</label>
            <select id="veh" name="veh" [ngModel]="vehicleId()" (ngModelChange)="vehicleId.set($event)">
              @for (v of vehicles(); track v.id) { <option [value]="v.id">{{ cat(v.categorie) }} — {{ v.marque }} {{ v.modele }} {{ v.immatriculation }}</option> }
            </select>
          </div>
          <div class="field">
            <label for="quand">Départ le</label>
            <input id="quand" name="quand" type="datetime-local" [min]="minDate" [ngModel]="quand()" (ngModelChange)="quand.set($event)" required>
          </div>
          <div class="row" style="align-items:flex-start">
            <div class="field" style="flex:1"><label for="places">Places offertes</label><input id="places" name="places" type="number" min="1" max="8" [ngModel]="places()" (ngModelChange)="places.set($event)" required></div>
            <div class="field" style="flex:1"><label for="prix">Prix par place (FCFA)</label><input id="prix" name="prix" type="number" min="500" step="100" [ngModel]="prix()" (ngModelChange)="prix.set($event)" required></div>
          </div>
          <p class="xs muted mb-0">Recette potentielle : <strong>{{ fcfa((+places() || 0) * (+prix() || 0)) }}</strong> — commission de 5 % prélevée sur vous uniquement, jamais sur le passager.</p>
          <button class="btn btn--gold" type="submit" [disabled]="busy()">@if (busy()) { Publication… } @else { <i class="bi bi-megaphone"></i> Publier le trajet }</button>
        </form>
        <div class="stack">
          <div class="map-box map-box--tall"><app-map [markers]="markers()" [routes]="routes()" [clickable]="!!pick()" [fitKey]="fitKey()" (mapClick)="onMapClick($event)" /></div>
          @if (pick()) { <div class="alert alert--warn"><i class="bi bi-cursor"></i><p>Cliquez sur la carte pour placer {{ pick() === 'depart' ? 'le départ' : "l'arrivée" }}.</p></div> }
        </div>
      </div>
    }
  </div>
</section>
  `,
})
export class TrajetPublierComponent implements OnInit {
  readonly fcfa = fcfa;
  readonly loading = signal(true);
  readonly busy = signal(false);
  readonly vehicles = signal<Vehicle[]>([]);
  readonly vehicleId = signal('');
  readonly depart = signal<Place | null>(null);
  readonly arrivee = signal<Place | null>(null);
  readonly route = signal<RouteInfo | null>(null);
  readonly quand = signal('');
  readonly places = signal<number | string>(3);
  readonly prix = signal<number | string>(3000);
  readonly fitKey = signal(0);
  readonly pick = signal<'depart' | 'arrivee' | null>(null);
  readonly minDate = new Date(Date.now() + 15 * 60000 - new Date().getTimezoneOffset() * 60000).toISOString().slice(0, 16);

  readonly estChauffeur = computed(() => this.sb.currentProfile()?.role === 'chauffeur');
  readonly markers = computed<MapMarker[]>(() => {
    const m: MapMarker[] = []; const d = this.depart(); const a = this.arrivee();
    if (d) m.push({ id: 'd', lat: d.lat, lng: d.lng, icon: 'bi-geo-alt-fill', color: '#0F766E', label: 'Départ' });
    if (a) m.push({ id: 'a', lat: a.lat, lng: a.lng, icon: 'bi-flag-fill', color: '#C1442E', label: 'Arrivée' });
    return m;
  });
  readonly routes = computed<MapRoute[]>(() => (this.route() ? [{ points: this.route()!.geometry }] : []));

  constructor(
    private driver: DriverService, private geo: GeoService, private trips: TripsService,
    private sb: SupabaseService, private toast: ToastService, private router: Router,
  ) {}

  async ngOnInit() {
    if (this.estChauffeur()) {
      try {
        const v = await this.driver.vehicles();
        this.vehicles.set(v);
        if (v.length) this.vehicleId.set(v[0].id);
      } catch (e) { this.toast.error(messageErreur(e)); }
    }
    this.loading.set(false);
  }

  cat(c: string) { return LIBELLES_CATEGORIE[c] ?? c; }
  duree(min: number) { return min >= 60 ? `${Math.floor(min / 60)} h ${(min % 60).toString().padStart(2, '0')}` : `${min} min`; }

  async setDepart(p: Place | null) { this.depart.set(p); await this.updateRoute(); }
  async setArrivee(p: Place | null) { this.arrivee.set(p); await this.updateRoute(); }
  togglePick(w: 'depart' | 'arrivee') { this.pick.set(this.pick() === w ? null : w); }
  async onMapClick(pos: { lat: number; lng: number }) {
    const which = this.pick(); if (!which) return;
    this.pick.set(null);
    const place = { label: await this.geo.reverse(pos.lat, pos.lng), lat: pos.lat, lng: pos.lng };
    if (which === 'depart') await this.setDepart(place); else await this.setArrivee(place);
  }

  private async updateRoute() {
    const d = this.depart(); const a = this.arrivee();
    this.route.set(d && a ? await this.geo.route(d, a) : null);
    this.fitKey.update((k) => k + 1);
  }

  async publish() {
    const d = this.depart(); const a = this.arrivee();
    if (!d || !a) { this.toast.error('Choisissez un départ et une arrivée dans la liste de suggestions.'); return; }
    if (!this.quand()) { this.toast.error('Indiquez la date et l\'heure de départ.'); return; }
    this.busy.set(true);
    try {
      await this.trips.publish({
        vehicle_id: this.vehicleId(), depart_label: d.label, arrivee_label: a.label,
        depart_lat: d.lat, depart_lng: d.lng, arrivee_lat: a.lat, arrivee_lng: a.lng,
        date_heure_depart: new Date(this.quand()).toISOString(), places_dispo: Number(this.places()), prix_place: Number(this.prix()),
      });
      this.toast.ok('Trajet publié !');
      this.router.navigateByUrl('/mes-trajets');
    } catch (e) { this.toast.error(messageErreur(e)); }
    finally { this.busy.set(false); }
  }
}
