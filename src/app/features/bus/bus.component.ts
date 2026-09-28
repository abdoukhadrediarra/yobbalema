import { Component, OnDestroy, OnInit, computed, signal } from '@angular/core';
import { RouterLink } from '@angular/router';
import { BusArrival, BusLine, BusTrajet } from '../../core/models/models';
import { BusService } from '../../core/services/bus.service';
import { DAKAR, GeoService, Place } from '../../core/services/geo.service';
import { SupabaseService } from '../../core/services/supabase.service';
import { ToastService } from '../../core/services/toast.service';
import { distanceLisible, ilYA, messageErreur } from '../../core/util/format';
import { MapComponent, MapMarker, MapRoute } from '../../shared/map/map.component';
import { PlaceFieldComponent } from '../../shared/place-field/place-field.component';

const COULEURS = ['#0F766E', '#C1442E', '#17233B', '#B7791F', '#6B46C1'];

/** Ligne affichée, commune aux deux modes (près de moi / mon trajet). */
interface BusRow {
  key: string; lineId: string; nom: string; label: string | null; termini: string;
  lat: number | null; lng: number | null; eta: number | null; distance: number | null;
  vitesse: number | null; statut: string; maj: string | null; dureeTrajet?: number; distanceTrajet?: number;
}

@Component({
  selector: 'app-bus',
  standalone: true,
  imports: [RouterLink, MapComponent, PlaceFieldComponent],
  template: `
<section class="page">
  <div class="container">
    <header class="page-head">
      <div>
        <h1>Bus TATA en direct</h1>
        <p>Voyez les bus qui approchent de vous et leur temps d'arrivée. Service gratuit.</p>
      </div>
      @if (estReceveur()) { <a routerLink="/bus/receveur" class="btn btn--gold"><i class="bi bi-broadcast"></i> Partager la position de mon bus</a> }
    </header>

    <div class="tabs" role="tablist">
      <button class="tab" [class.tab--active]="mode() === 'proche'" (click)="setMode('proche')" role="tab"><i class="bi bi-crosshair"></i> Près de moi</button>
      <button class="tab" [class.tab--active]="mode() === 'trajet'" (click)="setMode('trajet')" role="tab"><i class="bi bi-signpost-2"></i> Mon trajet (de A vers B)</button>
    </div>

    <div class="cols-2 cols-2--form">
      <div class="stack">
        @if (mode() === 'proche') {
          <div class="card card--flat row row--between">
            <span class="small"><i class="bi bi-crosshair"></i> Votre position : <strong>{{ posLabel() }}</strong></span>
            <button class="btn btn--outline btn--sm" (click)="useGps()"><i class="bi bi-geo"></i> Utiliser mon GPS</button>
          </div>
          <p class="xs muted mb-0" style="margin-top:-.4rem">Cliquez sur la carte pour indiquer où vous attendez. Les lignes passant à moins de {{ rayon }} m de vous sont proposées.</p>
        } @else {
          <div class="card stack">
            <app-place-field label="Je suis à (départ)" icon="bi-geo-alt-fill" [place]="from()" (placeChange)="setFrom($event)" />
            <app-place-field label="Je vais à (arrivée)" icon="bi-flag-fill" [place]="to()" (placeChange)="setTo($event)" [gps]="false" />
            <div class="row">
              <button type="button" class="btn btn--outline btn--sm" [class.btn--ink]="pick() === 'from'" (click)="togglePick('from')"><i class="bi bi-cursor"></i> Placer le départ</button>
              <button type="button" class="btn btn--outline btn--sm" [class.btn--ink]="pick() === 'to'" (click)="togglePick('to')"><i class="bi bi-cursor"></i> Placer l'arrivée</button>
            </div>
            <span class="field-hint">Nous cherchons les lignes qui passent près des deux points, dans le bon sens.</span>
          </div>
        }

        @if (error()) { <div class="alert alert--error"><i class="bi bi-exclamation-triangle"></i><p>{{ error() }}</p></div> }
        @if (mode() === 'trajet' && !(from() && to())) { <div class="card empty"><i class="bi bi-signpost-2"></i><p>Indiquez votre départ et votre arrivée pour voir les bus utiles.</p></div> }

        @for (a of approchant(); track a.key) {
          <article class="card stack" style="--gap:.6rem">
            <div class="row row--between">
              <div>
                <span class="tag tag--go"><i class="bi bi-bus-front"></i> {{ a.nom }}</span>
                @if (a.label) { <span class="tag tag--off" style="margin-left:.3rem">{{ a.label }}</span> }
                @if (a.termini) { <div class="small muted" style="margin-top:.35rem">{{ a.termini }}</div> }
              </div>
              <div style="text-align:right">
                @if (a.eta !== null) { <div class="price price--lg">{{ eta(a.eta) }}</div> } @else { <div class="price">—</div> }
                <span class="xs muted">{{ a.statut === 'approx' ? 'estimation approximative' : a.distance !== null ? 'à ' + dist(a.distance) : '' }}</span>
              </div>
            </div>
            @if (a.dureeTrajet !== undefined) {
              <div class="alert alert--info"><i class="bi bi-clock"></i><p>À bord : environ <strong>{{ eta(a.dureeTrajet) }}</strong> pour {{ dist(a.distanceTrajet ?? 0) }}. Arrivée estimée dans {{ eta((a.eta ?? 0) + a.dureeTrajet) }}.</p></div>
            }
            <div class="row xs muted" style="gap:1rem">
              @if (a.vitesse !== null) { <span><i class="bi bi-speedometer2"></i> {{ a.vitesse }} km/h</span> }
              @if (a.maj) { <span><i class="bi bi-clock-history"></i> position {{ ago(a.maj) }}</span> }
              @if (a.statut === 'approx') { <span><i class="bi bi-info-circle"></i> ligne sans tracé</span> }
            </div>
          </article>
        }

        @if (passes().length) {
          <div class="card card--flat stack" style="--gap:.4rem">
            <strong class="small">Déjà passés</strong>
            @for (a of passes(); track a.key) { <div class="small muted"><i class="bi bi-bus-front"></i> {{ a.nom }} {{ a.label ? '(' + a.label + ')' : '' }}{{ a.distance !== null ? ' — passé il y a ' + dist(a.distance) : '' }}</div> }
          </div>
        }

        @if (sansBus().length) {
          <div class="card card--flat stack" style="--gap:.4rem">
            <strong class="small">Lignes utiles sans bus en service actuellement</strong>
            @for (a of sansBus(); track a.key) { <div class="small muted"><i class="bi bi-bus-front"></i> {{ a.nom }} — {{ a.termini }} (trajet à bord ≈ {{ eta(a.dureeTrajet ?? 0) }})</div> }
          </div>
        }

        @if (!loading() && mode() === 'proche' && rows().length === 0) {
          <div class="card empty"><i class="bi bi-bus-front"></i><p><strong>Aucun bus actif près de vous.</strong><br>Les bus n'apparaissent que lorsqu'un receveur partage sa position.</p></div>
        }
        @if (!loading() && mode() === 'trajet' && from() && to() && rows().length === 0) {
          <div class="card empty"><i class="bi bi-slash-circle"></i><p><strong>Aucune ligne connue ne relie ces deux points.</strong><br>Essayez d'autres points, ou l'onglet « Près de moi ».</p></div>
        }
      </div>

      <div class="stack">
        <div class="map-box map-box--tall">
          <app-map [center]="center()" [markers]="markers()" [routes]="routes()" [clickable]="mode() === 'proche' || !!pick()" [fitKey]="fitKey()" (mapClick)="onMapClick($event)" />
        </div>
        @if (pick()) { <div class="alert alert--warn"><i class="bi bi-cursor"></i><p>Cliquez sur la carte pour placer {{ pick() === 'from' ? 'le départ' : "l'arrivée" }}.</p></div> }
      </div>
    </div>
  </div>
</section>
  `,
})
export class BusComponent implements OnInit, OnDestroy {
  readonly rayon = 400;
  readonly loading = signal(true);
  readonly error = signal('');
  readonly mode = signal<'proche' | 'trajet'>('proche');
  readonly pos = signal<{ lat: number; lng: number }>({ lat: DAKAR[0], lng: DAKAR[1] });
  readonly posSource = signal<'defaut' | 'gps' | 'manuel'>('defaut');
  readonly from = signal<Place | null>(null);
  readonly to = signal<Place | null>(null);
  readonly pick = signal<'from' | 'to' | null>(null);
  readonly arrivals = signal<BusArrival[]>([]);
  readonly trajets = signal<BusTrajet[]>([]);
  readonly lines = signal<Map<string, BusLine>>(new Map());
  readonly fitKey = signal(0);
  readonly now = signal(Date.now());

  readonly estReceveur = computed(() => this.sb.currentProfile()?.role === 'receveur_bus');
  readonly center = computed<[number, number]>(() => [this.pos().lat, this.pos().lng]);
  readonly posLabel = computed(() => (this.posSource() === 'gps' ? 'GPS' : this.posSource() === 'manuel' ? 'choisie sur la carte' : 'Dakar (par défaut)'));

  readonly rows = computed<BusRow[]>(() => {
    if (this.mode() === 'proche') {
      return this.arrivals().map((a) => ({
        key: a.bus_id, lineId: a.bus_line_id, nom: a.nom_ligne, label: a.bus_label, termini: [a.terminus_depart, a.terminus_arrivee].filter(Boolean).join(' → '),
        lat: a.bus_lat, lng: a.bus_lng, eta: a.eta_minutes, distance: a.distance_m, vitesse: a.vitesse_kmh, statut: a.statut, maj: a.mise_a_jour,
      }));
    }
    return this.trajets().map((a, i) => ({
      key: (a.bus_id ?? 'l' + a.bus_line_id) + i, lineId: a.bus_line_id, nom: a.nom_ligne, label: a.bus_label, termini: [a.terminus_depart, a.terminus_arrivee].filter(Boolean).join(' → '),
      lat: a.bus_lat, lng: a.bus_lng, eta: a.eta_minutes, distance: a.distance_m, vitesse: a.vitesse_kmh, statut: a.statut, maj: a.mise_a_jour,
      dureeTrajet: a.duree_trajet_min, distanceTrajet: a.distance_trajet_m,
    }));
  });
  readonly approchant = computed(() => this.rows().filter((a) => a.statut === 'approche' || a.statut === 'approx'));
  readonly passes = computed(() => this.rows().filter((a) => a.statut === 'passe'));
  readonly sansBus = computed(() => this.rows().filter((a) => a.statut === 'aucun_bus'));

  readonly markers = computed<MapMarker[]>(() => {
    const m: MapMarker[] = [];
    if (this.mode() === 'proche') m.push({ id: 'me', lat: this.pos().lat, lng: this.pos().lng, icon: 'bi-person-fill', color: '#0F766E', label: 'Vous', shape: 'round' });
    else {
      const f = this.from(); const t = this.to();
      if (f) m.push({ id: 'f', lat: f.lat, lng: f.lng, icon: 'bi-geo-alt-fill', color: '#0F766E', label: 'Départ' });
      if (t) m.push({ id: 't', lat: t.lat, lng: t.lng, icon: 'bi-flag-fill', color: '#C1442E', label: 'Arrivée' });
    }
    for (const a of this.rows()) {
      if (a.lat === null || a.lng === null) continue;
      m.push({ id: 'b' + a.key, lat: a.lat, lng: a.lng, icon: 'bi-bus-front-fill', shape: 'round', color: a.statut === 'passe' ? '#8a8378' : '#F0A93C',
        label: `${a.nom}${a.label ? ' · ' + a.label : ''}${a.eta !== null ? ' · ' + this.eta(a.eta) : ''}` });
    }
    return m;
  });
  readonly routes = computed<MapRoute[]>(() => {
    const out: MapRoute[] = []; const seen = new Set<string>(); let i = 0;
    for (const a of this.rows()) {
      if (seen.has(a.lineId)) continue; seen.add(a.lineId);
      const l = this.lines().get(a.lineId);
      if (l?.trajet && l.trajet.length > 1) out.push({ points: l.trajet, color: COULEURS[i % COULEURS.length] });
      i++;
    }
    return out;
  });

  private timers: ReturnType<typeof setInterval>[] = [];

  constructor(private bus: BusService, private geo: GeoService, private sb: SupabaseService, private toast: ToastService) {}

  async ngOnInit() {
    await this.useGps(true);
    await this.refresh();
    this.loading.set(false);
    this.timers.push(setInterval(() => this.refresh(), 5000));
    this.timers.push(setInterval(() => this.now.set(Date.now()), 1000));
  }
  ngOnDestroy() { this.timers.forEach(clearInterval); }

  eta(min: number) { return min < 1 ? '< 1 min' : `${Math.round(min)} min`; }
  dist(m: number) { return distanceLisible(m); }
  ago(iso: string) { return ilYA(iso, this.now()); }

  setMode(m: 'proche' | 'trajet') { this.mode.set(m); this.pick.set(null); this.fitKey.update((k) => k + 1); this.refresh(); }

  async useGps(silent = false) {
    try { const p = await this.geo.currentPosition(); this.setPosition(p.lat, p.lng, 'gps'); }
    catch (e) { if (!silent) this.toast.error((e as Error).message); }
  }
  setPosition(lat: number, lng: number, src: 'gps' | 'manuel') {
    this.pos.set({ lat, lng }); this.posSource.set(src); this.fitKey.update((k) => k + 1); this.refresh();
  }

  async setFrom(p: Place | null) { this.from.set(p); this.fitKey.update((k) => k + 1); await this.refresh(); }
  async setTo(p: Place | null) { this.to.set(p); this.fitKey.update((k) => k + 1); await this.refresh(); }
  togglePick(w: 'from' | 'to') { this.pick.set(this.pick() === w ? null : w); }

  async onMapClick(pos: { lat: number; lng: number }) {
    if (this.mode() === 'proche') { this.setPosition(pos.lat, pos.lng, 'manuel'); return; }
    const w = this.pick(); if (!w) return;
    this.pick.set(null);
    const place = { label: await this.geo.reverse(pos.lat, pos.lng), lat: pos.lat, lng: pos.lng };
    if (w === 'from') await this.setFrom(place); else await this.setTo(place);
  }

  async refresh() {
    try {
      let ids: string[];
      if (this.mode() === 'proche') {
        const p = this.pos();
        const a = await this.bus.arrivals(p.lat, p.lng);
        this.arrivals.set(a ?? []); ids = (a ?? []).map((x) => x.bus_line_id);
      } else {
        const f = this.from(); const t = this.to();
        if (!f || !t) { this.trajets.set([]); this.error.set(''); return; }
        const r = await this.bus.trajet(f, t);
        this.trajets.set(r ?? []); ids = (r ?? []).map((x) => x.bus_line_id);
      }
      const missing = ids.filter((id) => !this.lines().has(id));
      if (missing.length) {
        const ls = await this.bus.linesByIds([...new Set(missing)]);
        const next = new Map(this.lines()); ls.forEach((l) => next.set(l.id, l)); this.lines.set(next);
      }
      this.error.set('');
    } catch (e) { this.error.set(messageErreur(e)); }
  }
}
